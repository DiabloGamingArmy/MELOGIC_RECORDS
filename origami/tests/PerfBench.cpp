#include "TestAuthorization.h"
// mct-origami-dsp-performance-stereo-chain: performance regression harness.
//
// Drives the real OrigamiAudioProcessor::processBlock (engine + bus FX +
// global FX + callback bookkeeping) over a scenario matrix and reports, per
// scenario, the per-callback time distribution (median / p95 / p99), the
// share of the realtime callback budget, ns per output sample, a hash of
// every output sample (nothing can be optimised away, and baseline / new
// builds can be compared for bit-identical output) and the spectral cache
// misses during measurement (a miss reads the dry fallback, so a non-zero
// count also means the output depends on worker timing).
//
// It is a measurement tool, not a gate: it never fails because a laptop was
// a few percent slower. Usage:
//   origami_perf_bench                 full matrix
//   origami_perf_bench <substring>...  only scenarios whose name contains one
//   origami_perf_bench --profile <name> <seconds>   run one scenario in a loop
//                                      (attach `sample` / Instruments to it)
//   origami_perf_bench --memory        fixed footprints of the realtime objects
#include "plugin/PluginProcessor.h"
#include "core/preset/StateCodec.h"
#include "plugin/content/ContentLibrary.h"
#include <atomic>
#include "tests/NodesScenarios.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstring>
#include <functional>
#include <memory>
#include <string>
#include <thread>
#include <vector>
#if defined(__APPLE__)
#include <pthread.h>
#include <sys/qos.h>
#endif

using namespace mct::origami;
namespace {

struct Scenario {
    std::string name;
    double sampleRate=48000.0;
    int block=256;
    int voices=8;
    std::function<void(OrigamiAudioProcessor&)> setup;
    // A UI-thread edit before each measured callback (outside the timed
    // region): the callback then pays only for consuming it.
    std::function<void(OrigamiAudioProcessor&,std::size_t)> perBlock{};
};

// ---- patch building blocks -------------------------------------------------
void oscillators(OrigamiAudioProcessor& p,int count,unsigned unison=1) {
    auto st=p.getUiInstrumentState();
    std::vector<OscillatorModuleId> ids;
    for(const auto& m:st.oscillators) if(m.id) ids.push_back(m.id);
    while(int(ids.size())>count && ids.size()>1) { p.removeUiOscillator(ids.back()); ids.pop_back(); }
    while(int(ids.size())<count) { const auto id=p.addUiOscillator(); if(!id) break; ids.push_back(id); }
    // OSC 1's tuning / unison come from its host parameters (the engine reads
    // them every sample); the other oscillators from their module state.
    p.setUiParameter(ParameterId::OscUnison,float(unison));
    p.setUiParameter(ParameterId::OscDetune,14.0f);
    for(const auto id:ids) {
        auto m=p.getUiOscillatorState(id);
        m.unison=unison; m.detuneCents=14.0f; m.blend=0.6f; m.wtPosition=0.37f;
        p.setUiOscillatorState(id,m);
        p.setUiOscillatorEnabled(id,true);
    }
}
OscillatorModuleId firstOscillator(OrigamiAudioProcessor& p) {
    for(const auto& m:p.getUiInstrumentState().oscillators) if(m.id) return m.id;
    return 0;
}
void chain(OrigamiAudioProcessor& p,bool heavy) {
    const auto id=firstOscillator(p);
    auto m=p.getUiOscillatorState(id);
    m.processCount=0; m.nextProcessId=1;
    const auto add=[&](dsp::OscProcessType type,float amount) {
        m.processes[m.processCount++]={m.nextProcessId++,type,amount,0x5150u+m.nextProcessId,true};
    };
    add(dsp::OscProcessType::BendPlus,0.35f);
    if(heavy) {
        add(dsp::OscProcessType::SineWarp,0.4f);
        add(dsp::OscProcessType::Fold,0.3f);
        add(dsp::OscProcessType::RandAmp,0.5f);
        // Cross-oscillator routes from the second oscillator, when present.
        OscillatorModuleId other=0;
        for(const auto& o:p.getUiInstrumentState().oscillators) if(o.id && o.id!=id) { other=o.id; break; }
        if(other) {
            m.routeCount=0; m.nextRouteId=1;
            m.routes[m.routeCount++]={m.nextRouteId++,other,OscRouteType::RingMod,0.4f,true};
            m.routes[m.routeCount++]={m.nextRouteId++,other,OscRouteType::PhaseMod,0.3f,true};
        }
    }
    p.setUiOscillatorState(id,m);
}
// `count` routes from a rotating set of sources to a rotating set of
// destinations on the first oscillator and the filter.
void routes(OrigamiAudioProcessor& p,int count,bool funcLfos,float stereo=0.0f) {
    auto mod=p.getUiInstrumentState().modulation;
    const auto id=firstOscillator(p);
    for(std::size_t i=0;i<4;++i) {
        auto& l=lfoSettings(mod,i);
        l.mode=i%2 ? LfoMode::Loop : LfoMode::Free; l.rateHz=1.5f+float(i);
        if(funcLfos) { l.smooth=.2f; l.skew=.3f; l.entropy=.4f; l.fracture=.3f; l.quantize=.2f; l.pingPong=true; l.phase=.1f; }
        l.stereo=stereo;
    }
    const std::array<ModSource,8> sources{ModSource::Lfo1,ModSource::Lfo2,ModSource::Lfo3,ModSource::Lfo4,
                                          ModSource::Env2,ModSource::Env3,ModSource::Random,ModSource::Macro1};
    const std::array<ModDestination,6> oscDest{ModDestination::Level,ModDestination::WtPosition,ModDestination::Pan,
                                               ModDestination::Fine,ModDestination::Detune,ModDestination::Semitone};
    const std::array<ModDestination,2> globalDest{ModDestination::Cutoff,ModDestination::Resonance};
    std::size_t slot=0;
    for(int r=0;r<count && slot<mod.routes.size();++r) {
        ModRoute route;
        route.id=mod.nextRouteId; route.enabled=true; route.source=sources[std::size_t(r)%sources.size()];
        const auto pick=std::size_t(r/int(sources.size()));
        if(pick%3==2) route.destination={globalDest[pick%globalDest.size()],0,0};
        else route.destination={oscDest[(std::size_t(r)+pick)%oscDest.size()],id,0};
        route.amount=0.15f+0.01f*float(r%7); route.bipolar=true;
        if(routeDuplicates(mod,route)) continue;
        mod.routes[slot++]=route; ++mod.nextRouteId;
    }
    if(!p.setUiModulationState(mod)) std::fprintf(stderr,"warning: route set rejected\n");
}
void stereoChainRoute(OrigamiAudioProcessor& p) {
    auto mod=p.getUiInstrumentState().modulation;
    const auto id=firstOscillator(p);
    const auto m=p.getUiOscillatorState(id);
    mod.lfo1.mode=LfoMode::Loop; mod.lfo1.rateHz=3.0f; mod.lfo1.stereo=1.0f;
    std::size_t slot=0; while(slot<mod.routes.size() && mod.routes[slot].id) ++slot;
    for(std::size_t i=0;i<m.processCount && slot<mod.routes.size();++i)
        mod.routes[slot++]={mod.nextRouteId++,true,ModSource::Lfo1,{ModDestination::ProcessAmount,id,m.processes[i].id},0.5f,true};
    p.setUiModulationState(mod);
}
// A common live case: LFO vibrato on FINE (audio-rate pitch on every
// oscillator / unison voice) plus the pitch wheel held off-centre.
void vibrato(OrigamiAudioProcessor& p) {
    auto mod=p.getUiInstrumentState().modulation;
    const auto id=firstOscillator(p);
    mod.lfo1.mode=LfoMode::Free; mod.lfo1.rateHz=5.5f;
    std::size_t slot=0; while(slot<mod.routes.size() && mod.routes[slot].id) ++slot;
    mod.routes[slot]={mod.nextRouteId++,true,ModSource::Lfo1,{ModDestination::Fine,id,0},0.08f,true};
    if(!p.setUiModulationState(mod)) std::fprintf(stderr,"warning: vibrato route rejected\n");
}
void nodes(OrigamiAudioProcessor& p,bool heavy) {
    auto mod=heavy ? scenarios::maximal() : scenarios::mixedControl();
    mod.macroMask=p.getUiInstrumentState().modulation.macroMask;
    if(!p.setUiModulationState(mod)) std::fprintf(stderr,"warning: NODES scenario rejected\n");
}
void filter(OrigamiAudioProcessor& p,bool on) {
    auto mod=p.getUiInstrumentState().modulation; mod.filterEnabled=on; p.setUiModulationState(mod);
}
void busFx(OrigamiAudioProcessor& p,bool heavy) {
    using fx::FxEffectType;
    std::vector<FxEffectType> chainFx{FxEffectType::Drive,FxEffectType::Delay,FxEffectType::Reverb};
    if(heavy) for(auto t:{FxEffectType::Chorus,FxEffectType::Compressor,FxEffectType::Equalizer,FxEffectType::Phaser,FxEffectType::Filter}) chainFx.push_back(t);
    for(auto t:chainFx) p.getUiFxDocument().edit([t](fx::FxGraph& g){ return g.insertEffectBeforeOutput(t)!=0; });
}

// mct-origami-nested-modulation-manual-qa
void crossOscStereo(OrigamiAudioProcessor& p) {
    oscillators(p,2,1);
    p.setUiParameter(ParameterId::OscLevel,0.0f); // OSC 1 silent, still the PD source
    const auto o1=firstOscillator(p);
    auto m1=p.getUiOscillatorState(o1);
    m1.processCount=1; m1.nextProcessId=2; m1.processes[0]={1,dsp::OscProcessType::RandAmp,0.5f,0x1234u,true};
    p.setUiOscillatorState(o1,m1);
    OscillatorModuleId o2=0; for(const auto& o:p.getUiInstrumentState().oscillators) if(o.id && o.id!=o1) { o2=o.id; break; }
    auto m2=p.getUiOscillatorState(o2);
    m2.routeCount=1; m2.nextRouteId=2; m2.routes[0]={1,o1,OscRouteType::PhaseMod,0.6f,true}; m2.level=0.8f;
    p.setUiOscillatorState(o2,m2);
    auto mod=p.getUiInstrumentState().modulation;
    mod.lfo1.mode=LfoMode::Loop; mod.lfo1.rateHz=5.0f; mod.lfo1.stereo=1.0f; // 180 degrees
    std::size_t slot=0; while(slot<mod.routes.size() && mod.routes[slot].id) ++slot;
    mod.routes[slot]={mod.nextRouteId++,true,ModSource::Lfo1,{ModDestination::ProcessAmount,o1,1},0.9f,true};
    if(!p.setUiModulationState(mod)) std::fprintf(stderr,"warning: cross-osc stereo rejected\n");
}
// 0: MACRO 1 -> MACRO 2 (MACRO 2 -> OSC 1 LEVEL); 1: MACRO 1 -> LFO 1 RATE;
// 2: LFO 3 -> LFO 1 RATE; 3: LFO 4 -> the depth of the first four routes.
void nested(OrigamiAudioProcessor& p,int kind) {
    auto mod=p.getUiInstrumentState().modulation;
    const auto id=firstOscillator(p);
    std::size_t slot=0; while(slot<mod.routes.size() && mod.routes[slot].id) ++slot;
    const auto add=[&](ModSource s,ModAddress d,float amount,bool bipolar) {
        if(slot>=mod.routes.size()) return;
        ModRoute r{mod.nextRouteId,true,s,d,amount,bipolar};
        if(routeDuplicates(mod,r) || routeClosesCycle(mod,r)) return;
        mod.routes[slot++]=r; ++mod.nextRouteId;
    };
    mod.macros[0]=0.4f; mod.lfo3.mode=LfoMode::Free; mod.lfo3.rateHz=0.7f; mod.lfo4.mode=LfoMode::Free; mod.lfo4.rateHz=0.3f;
    if(kind==0) { add(macroSource(1),macroValueAddress(2),0.5f,false); add(macroSource(2),{ModDestination::Level,id,0},0.3f,false); }
    if(kind==1) add(macroSource(1),lfoRateAddress(0),0.3f,false);
    if(kind==2) add(ModSource::Lfo3,lfoRateAddress(0),0.2f,true);
    if(kind==3) {
        std::vector<std::uint32_t> targets;
        for(const auto& r:mod.routes) if(r.id && routeComplete(r) && !isNestedDestination(r.destination.parameter) && targets.size()<4) targets.push_back(r.id);
        for(const auto t:targets) add(ModSource::Lfo4,routeDepthAddress(t),0.25f,true);
    }
    if(!p.setUiModulationState(mod)) std::fprintf(stderr,"warning: nested scenario %d rejected\n",kind);
}

// ---- measurement -------------------------------------------------------------
struct Result {
    double median=0,p95=0,p99=0,worst=0,budgetUs=0;
    std::uint64_t hash=0;          // FNV-1a over every output sample's bits: bit-exact A/B
    std::uint64_t blocks=0,fallbacks=0; // spectral cache misses during measurement
    std::uint64_t requests=0;      // spectral frames requested from the worker
    std::uint32_t compiles=0;      // modulation plan compiles during measurement
    double maxSecondDifference=0;  // click metric: max |x[n] - 2 x[n-1] + x[n-2]|
};

double percentile(std::vector<double> v,double q) {
    if(v.empty()) return 0.0;
    std::sort(v.begin(),v.end());
    return v[std::min(v.size()-1,static_cast<std::size_t>(q*double(v.size()-1)+0.5))];
}

Result run(const Scenario& s,double measureSeconds,bool profileLoop=false) {
    auto owner=std::make_unique<OrigamiAudioProcessor>(origami_test::authorized()); auto& p=*owner;
    p.setPlayConfigDetails(0,2,s.sampleRate,s.block);
    p.prepareToPlay(s.sampleRate,s.block);
    if(s.setup) s.setup(p);
    juce::AudioBuffer<float> audio(2,s.block);
    juce::MidiBuffer midi,none;
    for(int v=0;v<s.voices;++v) midi.addEvent(juce::MidiMessage::noteOn(1,40+(v*5)%48,0.75f),0);
    // Warm: settle state publication, voice start, spectral worker caches.
    const auto warmBlocks=std::max(1,int(0.5*s.sampleRate/s.block));
    for(int i=0;i<warmBlocks;++i) { audio.clear(); p.processBlock(audio,i==0 ? midi : none); }
    for(int pass=0;pass<50;++pass) {
        const auto before=dsp::spectralMisses(dsp::spectralCompilerStats());
        for(int i=0;i<warmBlocks/4+1;++i) { audio.clear(); p.processBlock(audio,none); }
        if(dsp::spectralMisses(dsp::spectralCompilerStats())==before) break;
        std::this_thread::sleep_for(std::chrono::milliseconds(5));
    }
    // The warm-up's first-touch spectral misses depend on worker timing and
    // FX tails (reverb / delay) would carry them into the measurement. Restart
    // the processor (same tables, so the global spectral cache stays warm) and
    // replay the identical note-on: the measured output is then deterministic
    // whenever the measurement itself has no misses.
    p.releaseResources();
    p.prepareToPlay(s.sampleRate,s.block);
    for(int i=0;i<warmBlocks;++i) { audio.clear(); p.processBlock(audio,i==0 ? midi : none); }
    Result r; r.budgetUs=1.0e6*double(s.block)/s.sampleRate;
    const auto blocks=static_cast<std::size_t>(std::max(200.0,measureSeconds*s.sampleRate/s.block));
    std::vector<double> times; times.reserve(blocks);
    std::uint64_t hash=0xcbf29ce484222325ull;
    const auto fallbacksBefore=dsp::spectralMisses(dsp::spectralCompilerStats());
    const auto requestsBefore=dsp::spectralCompilerStats().requests;
    const auto compilesBefore=p.getUiNodesDiagnostics().compiles;
    std::array<float,2> previous{},previous2{}; double maxD2=0; std::size_t sampleIndex=0;
    const auto deadline=std::chrono::steady_clock::now()+std::chrono::duration<double>(measureSeconds);
    do {
        for(std::size_t b=0;b<blocks;++b) {
            audio.clear();
            if(s.perBlock) s.perBlock(p,b);
            const auto t0=std::chrono::steady_clock::now();
            p.processBlock(audio,none);
            const auto t1=std::chrono::steady_clock::now();
            times.push_back(std::chrono::duration<double,std::micro>(t1-t0).count());
            if(!profileLoop) {
                for(int ch=0;ch<2;++ch) {
                    const auto* x=audio.getReadPointer(ch);
                    for(int i=0;i<s.block;++i) {
                        std::uint32_t bits; std::memcpy(&bits,x+i,sizeof bits);
                        hash=(hash^bits)*0x100000001b3ull;
                    }
                }
                for(int i=0;i<s.block;++i,++sampleIndex) for(int ch=0;ch<2;++ch) {
                    const float x=audio.getSample(ch,i);
                    if(sampleIndex>=2) maxD2=std::max(maxD2,std::abs(double(x)-2.0*double(previous[std::size_t(ch)])+double(previous2[std::size_t(ch)])));
                    previous2[std::size_t(ch)]=previous[std::size_t(ch)]; previous[std::size_t(ch)]=x;
                }
            }
        }
        if(profileLoop) times.clear();
    } while(profileLoop && std::chrono::steady_clock::now()<deadline);
    r.median=percentile(times,.5); r.p95=percentile(times,.95); r.p99=percentile(times,.99);
    r.worst=times.empty() ? 0.0 : *std::max_element(times.begin(),times.end());
    r.hash=hash; r.blocks=times.size();
    r.fallbacks=dsp::spectralMisses(dsp::spectralCompilerStats())-fallbacksBefore;
    r.requests=dsp::spectralCompilerStats().requests-requestsBefore;
    r.compiles=p.getUiNodesDiagnostics().compiles-compilesBefore;
    r.maxSecondDifference=maxD2;
    return r;
}

std::vector<Scenario> matrix() {
    std::vector<Scenario> m;
    for(int voices:{1,8,16}) for(int mode=0;mode<6;++mode) {
        const char* names[]{"zero","single","shared four OSC","serial two","four separate","maximum eight serial"};
        m.push_back({std::string("Synth filters ")+names[mode]+", "+std::to_string(voices)+" voices",48000,256,voices,[mode](OrigamiAudioProcessor& p){
            oscillators(p,(mode==2 || mode==4 || mode==5)?4:1);
            auto state=p.getUiInstrumentState();auto mod=state.modulation;std::array<SynthFilterId,maxSynthFilters> ids{};
            const int count=mode==0?0:mode==3?2:mode==4?4:mode==5?8:1;
            for(int i=0;i<count;++i) {ids[std::size_t(i)]=addSynthFilter(mod);mod.synthFilters.filters[std::size_t(i)].values.cutoff=1200+400*float(i);}
            if(count) {insertSynthFilter(mod,state.oscillators,ids[0],state.oscillators[0].id);
                if(mode==2) for(const auto& osc:state.oscillators) if(osc.id && osc.id!=state.oscillators[0].id) insertSynthFilter(mod,state.oscillators,ids[0],osc.id);
                if(mode==4) for(int i=1;i<4;++i) insertSynthFilter(mod,state.oscillators,ids[std::size_t(i)],state.oscillators[std::size_t(i)].id);
                if(mode==3 || mode==5) for(int i=1;i<count;++i) insertSynthFilterAfter(mod,ids[std::size_t(i)],ids[std::size_t(i-1)]);
            }
            p.setUiModulationState(mod);
        }});
    }
    for(int voices:{1,8,16}) for(int mode=0;mode<7;++mode) {
        const char* names[]{"MAIN only","FILTER only","MAIN + FILTER","MAIN + FILTER + BUS","four OSC multi sends","maximum 16 OSC 16 sends","dry + serial chain"};
        m.push_back({std::string("Route mixer ")+names[mode]+", "+std::to_string(voices)+" voices",48000,256,voices,[mode](OrigamiAudioProcessor& p){
            oscillators(p,mode==5?16:mode==4?4:1);const int buses=mode==5?7:mode>=3?1:0;
            for(int b=0;b<buses;++b) p.addUiBus();auto state=p.getUiInstrumentState();auto mod=state.modulation;
            std::array<SynthFilterId,8> filters{};const int count=mode==0?0:mode==5?8:mode==6?2:1;
            for(int f=0;f<count;++f) {filters[std::size_t(f)]=addSynthFilter(mod);mod.synthFilters.filters[std::size_t(f)].values.cutoff=1200+float(f)*400;}
            if(mode==6) insertSynthFilterAfter(mod,filters[1],filters[0]);
            for(auto osc:state.oscillators) if(osc.id) {
                osc.busRouteCount=0;osc.busRoutes={};if(mode!=1) osc.busRoutes[osc.busRouteCount++]={mainBusId,mode==0?1.f:.25f};
                for(int f=0;f<(mode==6?1:count);++f) osc.busRoutes[osc.busRouteCount++]={filters[std::size_t(f)],mode==5?.1f:1.f,true};
                for(std::size_t b=1;b<state.buses.count;++b) osc.busRoutes[osc.busRouteCount++]={state.buses.buses[b].id,mode==5?.1f:.5f};
                setOscillatorOutputRouting(mod,osc);
            }p.setUiModulationState(mod);
        }});
    }
    for(int voices:{1,8,16}) for(bool serial:{false,true}) m.push_back({std::string("Synth multimode ")+(serial?"mixed eight serial":"band pass")+", "+std::to_string(voices)+" voices",48000,256,voices,[serial](OrigamiAudioProcessor& p){
        oscillators(p,1);auto state=p.getUiInstrumentState();auto mod=state.modulation;SynthFilterId previous=0;
        for(int i=0;i<(serial?8:1);++i) {const auto id=addSynthFilter(mod);auto& f=mod.synthFilters.filters[std::size_t(i)];f.type=serial?static_cast<dsp::FilterType>(i):dsp::FilterType::BandPass;f.values.cutoff=1200+400*float(i);f.values.gain=dsp::filterTypeInfo(f.type)->gain?6.f:0.f;
            if(previous) insertSynthFilterAfter(mod,id,previous);else insertSynthFilter(mod,state.oscillators,id,state.oscillators[0].id);previous=id;
        }p.setUiModulationState(mod);
    }});
    for(double rate:{48000.,192000.}) for(int voices:{1,8,16}) for(int mode:{0,1,2,4,8}) m.push_back({"Comb audit "+std::string(mode==0?"zero filters":mode==1?"one ordinary":std::to_string(mode==2?1:mode)+" Comb")+", "+std::to_string(voices)+" voices",rate,256,voices,[mode](OrigamiAudioProcessor& p){
        oscillators(p,1);auto state=p.getUiInstrumentState();auto mod=state.modulation;SynthFilterId previous=0;
        for(int i=0;i<(mode==2?1:mode);++i) {const auto id=addSynthFilter(mod);auto& f=mod.synthFilters.filters[std::size_t(i)];f.type=mode==1?dsp::FilterType::LowPass:dsp::FilterType::Comb;f.values={370,.85f,0,1,0,0};if(previous) insertSynthFilterAfter(mod,id,previous);else insertSynthFilter(mod,state.oscillators,id,state.oscillators[0].id);previous=id;}p.setUiModulationState(mod);
    }});
    const auto typical=[](OrigamiAudioProcessor& p){ oscillators(p,2,4); chain(p,false); routes(p,8,false); };
    m.push_back({"idle (no notes)",48000,256,0,[](OrigamiAudioProcessor& p){ oscillators(p,1); }});
    for(int v:{1,8,16}) m.push_back({"1 osc, "+std::to_string(v)+" voices",48000,256,v,[](OrigamiAudioProcessor& p){ oscillators(p,1); }});
    m.push_back({"4 osc, 16 voices",48000,256,16,[](OrigamiAudioProcessor& p){ oscillators(p,4); }});
    m.push_back({"16 osc, 16 voices",48000,256,16,[](OrigamiAudioProcessor& p){ oscillators(p,16); }});
    for(unsigned u:{4u,8u,16u}) m.push_back({"1 osc unison "+std::to_string(u)+", 16 voices",48000,256,16,[u](OrigamiAudioProcessor& p){ oscillators(p,1,u); }});
    m.push_back({"vibrato, unison 8, 16 voices",48000,256,16,[](OrigamiAudioProcessor& p){ oscillators(p,1,8); vibrato(p); }});
    m.push_back({"chain light, 16 voices",48000,256,16,[](OrigamiAudioProcessor& p){ oscillators(p,2); chain(p,false); }});
    m.push_back({"chain heavy (spectral), 16 voices",48000,256,16,[](OrigamiAudioProcessor& p){ oscillators(p,2); chain(p,true); }});
    m.push_back({"chain heavy + stereo LFO, 16 voices",48000,256,16,[](OrigamiAudioProcessor& p){ oscillators(p,2); chain(p,true); stereoChainRoute(p); }});
    for(int r:{8,32}) m.push_back({std::to_string(r)+" routes, 16 voices",48000,256,16,[r](OrigamiAudioProcessor& p){ oscillators(p,1); routes(p,r,false); }});
    m.push_back({"32 routes FUNC LFOs, 16 voices",48000,256,16,[](OrigamiAudioProcessor& p){ oscillators(p,1); routes(p,32,true); }});
    m.push_back({"32 routes stereo LFOs, 16 voices",48000,256,16,[](OrigamiAudioProcessor& p){ oscillators(p,1); routes(p,32,true,1.0f); }});
    m.push_back({"NODES moderate, 16 voices",48000,256,16,[](OrigamiAudioProcessor& p){ oscillators(p,1); nodes(p,false); }});
    m.push_back({"NODES heavy, 16 voices",48000,256,16,[](OrigamiAudioProcessor& p){ oscillators(p,1); nodes(p,true); }});
    m.push_back({"filter off, 16 voices",48000,256,16,[](OrigamiAudioProcessor& p){ oscillators(p,1); filter(p,false); }});
    m.push_back({"bus FX moderate, 8 voices",48000,256,8,[](OrigamiAudioProcessor& p){ oscillators(p,1); busFx(p,false); }});
    m.push_back({"bus FX heavy, 8 voices",48000,256,8,[](OrigamiAudioProcessor& p){ oscillators(p,1); busFx(p,true); }});
    m.push_back({"typical, idle FX heavy (no notes)",48000,256,0,[](OrigamiAudioProcessor& p){ oscillators(p,1); busFx(p,true); }});
    for(int b:{32,64,128,256,512,1024}) m.push_back({"typical @ block "+std::to_string(b),48000,b,8,typical});
    for(double sr:{44100.0,96000.0}) m.push_back({"typical @ "+std::to_string(int(sr/1000))+" kHz",sr,256,8,typical});
    // mct-origami-nested-modulation-manual-qa: manual OSC CHAIN drags (a UI
    // drag event every other callback, ~94 Hz, sweeping 0.2 <-> 0.8 in 0.6 s)
    // against the same chain held still and driven by an LFO.
    const auto chainOf=[](dsp::OscProcessType type) { return [type](OrigamiAudioProcessor& p) {
        oscillators(p,1,1);
        const auto id=firstOscillator(p); auto m=p.getUiOscillatorState(id);
        m.processCount=1; m.nextProcessId=2; m.processes[0]={1,type,0.5f,0x5151u,true};
        p.setUiOscillatorState(id,m); }; };
    const auto dragOf=[](float rateScale) { return [rateScale](OrigamiAudioProcessor& p,std::size_t b) {
        if(b%2) return;
        const auto id=firstOscillator(p); auto m=p.getUiOscillatorState(id);
        const double t=double(b)*256.0/48000.0*rateScale;            // seconds
        const double tri=1.0-std::abs(std::fmod(t/0.6,2.0)-1.0);     // 0..1..0 every 1.2 s
        m.processes[0].amount=float(0.2+0.6*tri); p.setUiOscillatorState(id,m); }; };
    for(const auto& [label,type]:std::array<std::pair<const char*,dsp::OscProcessType>,4>{{
            {"RAND AMP",dsp::OscProcessType::RandAmp},{"SPARSE",dsp::OscProcessType::RandSparse},
            {"COMB",dsp::OscProcessType::SpectralComb},{"BEND+",dsp::OscProcessType::BendPlus}}}) {
        m.push_back({std::string("held ")+label+", 8 voices",48000,256,8,chainOf(type)});
        m.push_back({std::string("drag ")+label+", 8 voices",48000,256,8,chainOf(type),dragOf(1.0f)});
        m.push_back({std::string("LFO -> ")+label+", 8 voices",48000,256,8,[setup=chainOf(type)](OrigamiAudioProcessor& p){
            setup(p);
            auto mod=p.getUiInstrumentState().modulation; const auto id=firstOscillator(p);
            mod.lfo1.mode=LfoMode::Free; mod.lfo1.rateHz=0.8f;
            std::size_t slot=0; while(slot<mod.routes.size() && mod.routes[slot].id) ++slot;
            mod.routes[slot]={mod.nextRouteId++,true,ModSource::Lfo1,{ModDestination::ProcessAmount,id,1},0.6f,true};
            p.setUiModulationState(mod); }});
    }
    // Value edits while playing (B44): an oscillator knob republishes the
    // module snapshot; a route amount republishes the modulation state.
    // (OSC 2: OSC 1's level is a host parameter, which overrides module state.)
    m.push_back({"knob drag: OSC 2 LEVEL, typical",48000,256,8,typical,[](OrigamiAudioProcessor& p,std::size_t b){
        OscillatorModuleId id=0;
        for(const auto& o:p.getUiInstrumentState().oscillators) if(o.id && o.id!=firstOscillator(p)) { id=o.id; break; }
        auto st=p.getUiOscillatorState(id);
        st.level=0.5f+0.25f*std::sin(0.05f*float(b)); p.setUiOscillatorState(id,st); }});
    m.push_back({"knob drag: OSC 1 LEVEL param, typical",48000,256,8,typical,[](OrigamiAudioProcessor& p,std::size_t b){
        p.setUiParameter(ParameterId::OscLevel,0.5f+0.25f*std::sin(0.05f*float(b))); }});
    m.push_back({"knob drag: route amount, typical",48000,256,8,typical,[](OrigamiAudioProcessor& p,std::size_t b){
        auto mod=p.getUiInstrumentState().modulation;
        for(auto& r:mod.routes) if(r.id) { r.amount=0.2f+0.1f*std::sin(0.05f*float(b)); break; }
        p.setUiModulationState(mod); }});
    m.push_back({"heavy everything, 16 voices",48000,256,16,[](OrigamiAudioProcessor& p){
        oscillators(p,4,4); chain(p,true); routes(p,32,true,0.5f); busFx(p,true); }});
    // mct-origami-nested-modulation-manual-qa: the manual cross-oscillator
    // stereo case (silent OSC 1 RAND AMP at STEREO 180 phase-modulating OSC 2)
    // and nested modulation (Macro -> Macro, Macro / LFO -> LFO RATE, LFO ->
    // route DEPTH), on top of the typical patch.
    m.push_back({"cross-osc stereo PD, 8 voices",48000,256,8,crossOscStereo});
    m.push_back({"nested: MACRO -> MACRO, typical",48000,256,8,[typical](OrigamiAudioProcessor& p){ typical(p); nested(p,0); }});
    m.push_back({"nested: MACRO -> LFO RATE, typical",48000,256,8,[typical](OrigamiAudioProcessor& p){ typical(p); nested(p,1); }});
    m.push_back({"nested: LFO -> LFO RATE, typical",48000,256,8,[typical](OrigamiAudioProcessor& p){ typical(p); nested(p,2); }});
    m.push_back({"nested: LFO -> 4 route depths, typical",48000,256,8,[typical](OrigamiAudioProcessor& p){ typical(p); nested(p,3); }});
    const auto nestedAll=[typical](OrigamiAudioProcessor& p){ typical(p); for(int k=0;k<4;++k) nested(p,k); };
    for(int b:{32,64,256,1024}) m.push_back({"nested all @ block "+std::to_string(b),48000,b,8,nestedAll});
    for(int b:{64,256}) {
        m.push_back({"typical @ 96 kHz block "+std::to_string(b),96000,b,8,typical});
        m.push_back({"nested all @ 96 kHz block "+std::to_string(b),96000,b,8,nestedAll});
    }
    m.push_back({"32 routes + nested all, 16 voices",48000,256,16,[](OrigamiAudioProcessor& p){
        oscillators(p,1); routes(p,32,true); for(int k=0;k<4;++k) nested(p,k); }});
    for(int count:{0,8,32}) m.push_back({"instance pool "+std::to_string(count)+", 16 voices",48000,256,16,[count](OrigamiAudioProcessor& p) {
        oscillators(p,1);auto state=p.getUiInstrumentState().modulation;
        for(int i=0;i<count;++i) {
            const auto source=addSourceInstance(state,static_cast<SourceFamily>(i%7+1));
            auto& a=state.instances[std::size_t(i)];a.lfo.mode=LfoMode::Loop;
            state.routes[std::size_t(i)]={state.nextRouteId++,true,source,{ModDestination::Level,firstOscillator(p),0},.01f,false};
        }
        p.setUiModulationState(state);
    }});
    return m;
}
}

// mct-origami-content-browser: the audio callback while content work runs on
// another thread (as the UI thread would): 10k-record search / filter / sort,
// wavetable import / export, preset loads, wavetable loads. Typical patch,
// 16 voices, 256-sample blocks at 48 kHz.
void browseStress() {
    using namespace mct::origami::content;
    const auto base=juce::File::getSpecialLocation(juce::File::tempDirectory).getChildFile("origami-browse-stress");
    base.deleteRecursively(); base.createDirectory();
    Snapshot snap; LibraryState st;
    const char* words[]{"bass","lead","pad","pluck","keys","metallic","vocal","dark","bright","wide"};
    for(int i=0;i<10000;++i) {
        ContentRecord r; r.id="p"+juce::String(i); r.name=juce::String(words[i%10])+" "+juce::String(words[(i/10)%10])+" "+juce::String(i);
        r.author="Author "+juce::String(i%40); r.category=words[i%5]; r.tags={words[(i*7)%10]}; r.created=r.modified=1700000000000+i; r.buildSearchText();
        snap.records.push_back(r);
    }
    WavetableData table; table.name="Stress";
    for(int i=0;i<64*2048;++i) table.samples.push_back(0.6f*std::sin(float(i)*0.011f));
    const auto source=base.getChildFile("source.wav");
    writeWavetableWav(source,table);
    const auto typical=[](OrigamiAudioProcessor& p){ oscillators(p,2,4); chain(p,false); routes(p,8,false); };
    const char* names[]{"idle UI thread","search / filter / sort 10k records","wavetable import (64 frames)","wavetable export (64 frames)","preset loads","wavetable loads into OSC 1"};
    for(int mode=0;mode<6;++mode) {
        auto owner=std::make_unique<OrigamiAudioProcessor>(origami_test::authorized()); auto& p=*owner;
        p.setPlayConfigDetails(0,2,48000.0,256); p.prepareToPlay(48000.0,256);
        typical(p);
        juce::MemoryBlock presetA,presetB; p.getStateInformation(presetA);
        p.setUiParameter(ParameterId::OscLevel,0.3f); p.getStateInformation(presetB);
        ContentLibrary library(base.getChildFile("lib"+juce::String(mode)));
        std::atomic<bool> stop{false}; std::atomic<unsigned> ops{0};
        std::thread ui([&] {
            int k=0;
            while(!stop.load()) {
                Query q;
                switch(mode) {
                    case 0: std::this_thread::sleep_for(std::chrono::milliseconds(5)); break;
                    case 1: q.text=juce::String(words[k%10]).substring(0,1+k%4); q.sort=Sort(k%3); runQuery(snap,q,st); q.facetKind="category"; q.facetValue=words[k%5]; runQuery(snap,q,st); facetsFor(snap,ContentType::Preset); break;
                    case 2: { ContentRecord r; bool dup; library.importWavetable(source,r,dup); if(r.file.existsAsFile()) library.remove(r.id); break; }
                    case 3: writeWavetableWav(base.getChildFile("export.wav"),table); break;
                    case 4: p.loadUiPresetState(k%2 ? presetA : presetB,"x","X"); std::this_thread::sleep_for(std::chrono::milliseconds(20)); break;
                    case 5: p.setUiOscillatorWavetable(firstOscillator(p),table,{}); std::this_thread::sleep_for(std::chrono::milliseconds(10)); break;
                }
                ++k; ops.fetch_add(1);
            }
        });
        juce::AudioBuffer<float> audio(2,256); juce::MidiBuffer midi,none;
        for(int v=0;v<16;++v) midi.addEvent(juce::MidiMessage::noteOn(1,40+(v*5)%48,0.75f),0);
        audio.clear(); p.processBlock(audio,midi);
        std::vector<double> times;
        const auto end=std::chrono::steady_clock::now()+std::chrono::seconds(3);
        while(std::chrono::steady_clock::now()<end) {
            audio.clear();
            const auto t0=std::chrono::steady_clock::now();
            p.processBlock(audio,none);
            times.push_back(std::chrono::duration<double,std::micro>(std::chrono::steady_clock::now()-t0).count());
            if(mode==4 && times.size()%200==0) { midi.clear(); for(int v=0;v<16;++v) midi.addEvent(juce::MidiMessage::noteOn(1,40+(v*5)%48,0.75f),0); audio.clear(); p.processBlock(audio,midi); }
        }
        stop.store(true); ui.join();
        std::printf("%-40s median %7.1f us  p99 %7.1f us  worst %7.1f us  (%u UI operations)\n",names[mode],percentile(times,.5),percentile(times,.99),
                    *std::max_element(times.begin(),times.end()),ops.load());
    }
    base.deleteRecursively();
}

// B40 memory budget: the realtime objects' fixed footprints.
void memoryReport() {
    std::printf("Exact bytes: Voice=%zu Engine=%zu Processor=%zu\n",sizeof(Voice),sizeof(OrigamiEngine),sizeof(OrigamiAudioProcessor));
    const auto kb=[](std::size_t b){ return double(b)/1024.0; };
    std::printf("OrigamiAudioProcessor  %10.1f KB\n",kb(sizeof(OrigamiAudioProcessor)));
    std::printf("  OrigamiEngine        %10.1f KB\n",kb(sizeof(OrigamiEngine)));
    std::printf("    Voice              %10.1f KB  (x%zu = %.1f KB)\n",kb(sizeof(Voice)),OrigamiEngine::voiceCount,kb(OrigamiEngine::voiceCount*sizeof(Voice)));
    std::printf("    CompiledModulation %10.1f KB\n",kb(sizeof(CompiledModulation)));
    std::printf("    ModulationState    %10.1f KB\n",kb(sizeof(ModulationState)));
    std::printf("    ModulationFrame    %10.1f KB  (stereo part %zu B)\n",kb(sizeof(ModulationFrame)),sizeof(StereoModulationFrame));
    std::printf("    OscillatorRenderPlan %8.1f KB\n",kb(sizeof(OscillatorRenderPlan)));
    std::printf("  fx::FxEnvironment    %10.1f KB\n",kb(sizeof(fx::FxEnvironment)));
    std::printf("WavetableOscillator    %10zu B   SpectralReadHint %zu B\n",sizeof(dsp::WavetableOscillator),sizeof(dsp::SpectralReadHint));
    std::printf("Lfo                    %10zu B   LowPassFilter %zu B   Envelope %zu B\n",sizeof(Lfo),sizeof(dsp::LowPassFilter),sizeof(dsp::Envelope));
    std::printf("OscillatorModuleState  %10zu B   InstrumentState %.1f KB\n",sizeof(OscillatorModuleState),kb(sizeof(InstrumentState)));
    std::printf("SynthCombPool metadata %zu B, CombState %zu B, ring samples/channel @48k=2404; lazy bytes/slot=307712, max16x8=2461696\n",sizeof(SynthCombPool),sizeof(dsp::CombState));
    std::printf("SynthFilterRuntime %zu B (x8 per voice), SynthFilterPlan %zu B, SynthFilterCollection %zu B\n",sizeof(SynthFilterRuntime),sizeof(SynthFilterPlan),sizeof(SynthFilterCollection));
    const auto table=dsp::Wavetable::builtIns(); std::size_t samples=0;
    for(const auto& f:table.frames) for(const auto& b:f.bands) samples+=b.samples.size();
    std::printf("built-in table data    %10.1f KB  (%zu frames x %zu bands x %zu)\n",kb(samples*sizeof(float)),table.frames.size(),table.frames[0].bands.size(),table.tableLength);
    std::printf("256-frame custom table %10.1f KB  (x10 bands x 2048, per oscillator)\n",kb(std::size_t{256}*10*2048*sizeof(float)));
    std::printf("spectral cache (global)%10.1f KB  (512 slots x 2048 floats + keys)\n",kb(std::size_t{512}*(2048*sizeof(float)+sizeof(dsp::OscProcessPlan)+64)));
}

int main(int argc,char** argv) {
    melogic::account::Service::useInMemoryForTesting();
    if(argc>=2 && std::strcmp(argv[1],"--memory")==0) { juce::ScopedJuceInitialiser_GUI gui; memoryReport(); return 0; }
    if(argc>=2 && std::strcmp(argv[1],"--browse-stress")==0) {
#if defined(__APPLE__)
        pthread_set_qos_class_self_np(QOS_CLASS_USER_INTERACTIVE,0);
#endif
        juce::ScopedJuceInitialiser_GUI gui; dsp::prepareSpectralCompiler(); browseStress(); return 0;
    }
#if defined(__APPLE__)
    // Audio threads run on performance cores; so does the measurement (a
    // default-QoS thread may be scheduled on efficiency cores mid-run).
    pthread_set_qos_class_self_np(QOS_CLASS_USER_INTERACTIVE,0);
#endif
    juce::ScopedJuceInitialiser_GUI gui;
    dsp::prepareSpectralCompiler();
    if(argc>=2 && std::strcmp(argv[1],"--filter-prepare")==0) {
        OrigamiAudioProcessor processor{origami_test::authorized()};oscillators(processor,4);auto state=processor.getUiInstrumentState();auto mod=state.modulation;SynthFilterId previous=0;
        for(std::size_t n=0;n<maxSynthFilters;++n) {const auto id=addSynthFilter(mod);if(previous) insertSynthFilterAfter(mod,id,previous);else insertSynthFilter(mod,state.oscillators,id,state.oscillators[0].id);previous=id;}
        std::vector<double> times;times.reserve(1000);
        for(int n=0;n<1000;++n) {const auto start=std::chrono::steady_clock::now();const bool ok=processor.setUiModulationState(mod);const auto stop=std::chrono::steady_clock::now();if(!ok) return 1;times.push_back(std::chrono::duration<double,std::micro>(stop-start).count());}
        std::sort(times.begin(),times.end());std::printf("maximum Synth topology writer validation/preparation/publication: median %.3f us, p99 %.3f us\n",times[500],times[990]);return 0;
    }
    auto scenarios=matrix();
    if(argc>=4 && std::strcmp(argv[1],"--profile")==0) {
        for(const auto& s:scenarios) if(s.name.find(argv[2])!=std::string::npos) {
            std::printf("profiling '%s' for %s s\n",s.name.c_str(),argv[3]); std::fflush(stdout);
            run(s,std::atof(argv[3]),true); return 0;
        }
        return 1;
    }
    std::printf("%-40s %6s %5s %4s | %9s %9s %9s | %7s %7s | %8s | %-16s | %s | %s | %s | %s\n","scenario","rate","block","vox","median us","p95 us","p99 us","med %","p99 %","ns/smp","output hash","spectral misses","requests","compiles","max d2");
    for(const auto& s:scenarios) {
        bool wanted=argc<=1;
        for(int a=1;a<argc;++a) wanted|=s.name.find(argv[a])!=std::string::npos;
        if(!wanted) continue;
        const auto r=run(s,1.5);
        std::printf("%-40s %6.1f %5d %4d | %9.1f %9.1f %9.1f | %6.2f%% %6.2f%% | %8.1f | %016llx | %llu | %llu | %u | %.4f\n",
                    s.name.c_str(),s.sampleRate/1000.0,s.block,s.voices,r.median,r.p95,r.p99,
                    100.0*r.median/r.budgetUs,100.0*r.p99/r.budgetUs,1000.0*r.median/double(s.block),
                    static_cast<unsigned long long>(r.hash),static_cast<unsigned long long>(r.fallbacks),
                    static_cast<unsigned long long>(r.requests),r.compiles,r.maxSecondDifference);
        std::fflush(stdout);
    }
    return 0;
}
