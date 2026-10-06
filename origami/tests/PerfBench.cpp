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
#include "plugin/PluginProcessor.h"
#include "core/preset/StateCodec.h"
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

// ---- measurement -------------------------------------------------------------
struct Result {
    double median=0,p95=0,p99=0,worst=0,budgetUs=0;
    std::uint64_t hash=0;          // FNV-1a over every output sample's bits: bit-exact A/B
    std::uint64_t blocks=0,fallbacks=0; // spectral cache misses during measurement
};

double percentile(std::vector<double> v,double q) {
    if(v.empty()) return 0.0;
    std::sort(v.begin(),v.end());
    return v[std::min(v.size()-1,static_cast<std::size_t>(q*double(v.size()-1)+0.5))];
}

Result run(const Scenario& s,double measureSeconds,bool profileLoop=false) {
    auto owner=std::make_unique<OrigamiAudioProcessor>(); auto& p=*owner;
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
        const auto before=dsp::spectralCompilerStats().fallbackReads;
        for(int i=0;i<warmBlocks/4+1;++i) { audio.clear(); p.processBlock(audio,none); }
        if(dsp::spectralCompilerStats().fallbackReads==before) break;
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
    const auto fallbacksBefore=dsp::spectralCompilerStats().fallbackReads;
    const auto deadline=std::chrono::steady_clock::now()+std::chrono::duration<double>(measureSeconds);
    do {
        for(std::size_t b=0;b<blocks;++b) {
            audio.clear();
            if(s.perBlock) s.perBlock(p,b);
            const auto t0=std::chrono::steady_clock::now();
            p.processBlock(audio,none);
            const auto t1=std::chrono::steady_clock::now();
            times.push_back(std::chrono::duration<double,std::micro>(t1-t0).count());
            if(!profileLoop) for(int ch=0;ch<2;++ch) {
                const auto* x=audio.getReadPointer(ch);
                for(int i=0;i<s.block;++i) {
                    std::uint32_t bits; std::memcpy(&bits,x+i,sizeof bits);
                    hash=(hash^bits)*0x100000001b3ull;
                }
            }
        }
        if(profileLoop) times.clear();
    } while(profileLoop && std::chrono::steady_clock::now()<deadline);
    r.median=percentile(times,.5); r.p95=percentile(times,.95); r.p99=percentile(times,.99);
    r.worst=times.empty() ? 0.0 : *std::max_element(times.begin(),times.end());
    r.hash=hash; r.blocks=times.size();
    r.fallbacks=dsp::spectralCompilerStats().fallbackReads-fallbacksBefore;
    return r;
}

std::vector<Scenario> matrix() {
    std::vector<Scenario> m;
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
    // Value edits while playing (B44): an oscillator knob republishes the
    // module snapshot; a route amount republishes the modulation state.
    // (OSC 2: OSC 1's level is a host parameter, which overrides module state.)
    m.push_back({"knob drag: OSC 2 LEVEL, typical",48000,256,8,typical,[](OrigamiAudioProcessor& p,std::size_t b){
        OscillatorModuleId id=0;
        for(const auto& o:p.getUiInstrumentState().oscillators) if(o.id && o.id!=firstOscillator(p)) { id=o.id; break; }
        auto st=p.getUiOscillatorState(id);
        st.level=0.5f+0.25f*std::sin(0.05f*float(b)); p.setUiOscillatorState(id,st); }});
    m.push_back({"knob drag: OSC 1 LEVEL parameter, typical",48000,256,8,typical,[](OrigamiAudioProcessor& p,std::size_t b){
        p.setUiParameter(ParameterId::OscLevel,0.5f+0.25f*std::sin(0.05f*float(b))); }});
    m.push_back({"knob drag: route amount, typical",48000,256,8,typical,[](OrigamiAudioProcessor& p,std::size_t b){
        auto mod=p.getUiInstrumentState().modulation;
        for(auto& r:mod.routes) if(r.id) { r.amount=0.2f+0.1f*std::sin(0.05f*float(b)); break; }
        p.setUiModulationState(mod); }});
    m.push_back({"heavy everything, 16 voices",48000,256,16,[](OrigamiAudioProcessor& p){
        oscillators(p,4,4); chain(p,true); routes(p,32,true,0.5f); busFx(p,true); }});
    return m;
}
}

int main(int argc,char** argv) {
#if defined(__APPLE__)
    // Audio threads run on performance cores; so does the measurement (a
    // default-QoS thread may be scheduled on efficiency cores mid-run).
    pthread_set_qos_class_self_np(QOS_CLASS_USER_INTERACTIVE,0);
#endif
    juce::ScopedJuceInitialiser_GUI gui;
    dsp::prepareSpectralCompiler();
    auto scenarios=matrix();
    if(argc>=4 && std::strcmp(argv[1],"--profile")==0) {
        for(const auto& s:scenarios) if(s.name.find(argv[2])!=std::string::npos) {
            std::printf("profiling '%s' for %s s\n",s.name.c_str(),argv[3]); std::fflush(stdout);
            run(s,std::atof(argv[3]),true); return 0;
        }
        return 1;
    }
    std::printf("%-40s %6s %5s %4s | %9s %9s %9s | %7s %7s | %8s | %-16s | %s\n","scenario","rate","block","vox","median us","p95 us","p99 us","med %","p99 %","ns/smp","output hash","spectral misses");
    for(const auto& s:scenarios) {
        bool wanted=argc<=1;
        for(int a=1;a<argc;++a) wanted|=s.name.find(argv[a])!=std::string::npos;
        if(!wanted) continue;
        const auto r=run(s,1.5);
        std::printf("%-40s %6.1f %5d %4d | %9.1f %9.1f %9.1f | %6.2f%% %6.2f%% | %8.1f | %016llx | %llu\n",
                    s.name.c_str(),s.sampleRate/1000.0,s.block,s.voices,r.median,r.p95,r.p99,
                    100.0*r.median/r.budgetUs,100.0*r.p99/r.budgetUs,1000.0*r.median/double(s.block),
                    static_cast<unsigned long long>(r.hash),static_cast<unsigned long long>(r.fallbacks));
        std::fflush(stdout);
    }
    return 0;
}
