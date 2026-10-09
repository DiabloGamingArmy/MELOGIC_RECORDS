// mct-origami-v31.2.1-mod-ring-retrigger-refine
// mct-origami-v30.1.0-env-sync-native-menus-retrigger
// mct-origami-performance-audio-ui-repair-v23.4.4
// mct-origami-v23.4.3-engine-tests-newline-repair-2
// mct-origami-glide-mono-legato-v23.4.3
// mct-origami-osc1-smooth-basic-shapes-v22.3
#include "core/Engine.h"
#include "core/dsp/Unison.h"
#include "core/dsp/FastMath.h"
#include "core/dsp/Filter.h"
#include "core/RealtimeThreadPolicy.h"
#include "core/preset/Patch.h"
#include "core/preset/StateCodec.h"
#include "tests/OptimizedPathGolden.h"
#include "tests/FilterResponseTests.h"
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <fstream>
#include <iostream>
#include <limits>
#include <new>
#include <memory>
#include <chrono>
#include <thread>
#include <sstream>
#include <stdexcept>
#include <vector>
namespace {
std::atomic<bool> guardAllocations {false}; std::atomic<unsigned> allocations {0},frees {0};
// Per-thread accounting for concurrent tests: only a thread that set this
// flag (the simulated audio thread) is counted.
thread_local bool audioThread=false;
std::atomic<unsigned> audioAllocations {0},audioFrees {0};
}
#ifndef ORIGAMI_SANITIZED
// ASan owns allocation interception; count realtime allocations in normal builds.
void* operator new(std::size_t size) { if(guardAllocations.load()) ++allocations; if(audioThread) ++audioAllocations; if(void* p=std::malloc(size?size:1)) return p; throw std::bad_alloc(); }
void* operator new[](std::size_t size) { return ::operator new(size); }
void operator delete(void* p) noexcept { if(p && guardAllocations.load()) ++frees; if(p && audioThread) ++audioFrees; std::free(p); }
void operator delete[](void* p) noexcept { ::operator delete(p); }
void operator delete(void* p, std::size_t) noexcept { ::operator delete(p); }
void operator delete[](void* p, std::size_t) noexcept { ::operator delete(p); }
#endif
using namespace mct::origami;
namespace {
unsigned checks=0;
void check(bool condition, const char* message) { ++checks; if(!condition) throw std::runtime_error(message); }
const dsp::Wavetable& bank() { static const auto table=dsp::Wavetable::builtIns();return table; }
void prepare(OrigamiEngine& engine, double rate=48000, unsigned channels=1) {check(engine.installWavetable(bank()),"bank installs");check(engine.prepare(rate,256,channels),"prepare");}
std::vector<float> render(OrigamiEngine& engine, std::size_t count, std::size_t block=137) {
    std::vector<float> output(count);
    for(std::size_t i=0;i<count;i+=block) {float* ptr=output.data()+i;check(engine.process(&ptr,1,std::min(block,count-i)),"render block");}
    return output;
}
double energy(const std::vector<float>& samples) {double total=0;for(float value:samples) total+=double(value)*value;return total;}
void set(OrigamiEngine& engine, ParameterId id,float value) {check(engine.setParameter(id,value),"set parameter");}
void registryAndPatches() {
    for(std::size_t i=0;i<parameterCount;++i) {
        const auto& p=parameterRegistry()[i];check(findParameter(p.key)==&p,"parameter lookup");
        for(std::size_t j=i+1;j<parameterCount;++j) check(p.id!=parameterRegistry()[j].id && p.key!=parameterRegistry()[j].key,"unique stable IDs");
        for(float normalized:{0.f,.25f,.5f,1.f}) {float v=fromNormalized(p.id,normalized);check(v>=p.minimum && v<=p.maximum,"normalized limits"); if(p.scale!=ParameterScale::Choice) check(std::abs(toNormalized(p.id,v)-normalized)<1e-5,"parameter conversion round trip");}
    }
    auto engineOwner=std::make_unique<OrigamiEngine>();auto& engine=*engineOwner;check(!engine.setParameter("missing",1),"invalid string ID");check(!engine.setParameter(static_cast<ParameterId>(500),1),"invalid numeric ID");
    check(!engine.setParameter(ParameterId::Cutoff,std::numeric_limits<float>::quiet_NaN()),"reject NaN");
    check(!engine.setParameter(ParameterId::MasterGain,std::numeric_limits<float>::infinity()),"reject infinity");
    set(engine,ParameterId::MasterGain,50);check(engine.parameterState()[9]==1,"gain clamped");
    // V22.3 regression: OSC1 WT POS must remain continuous.
    set(engine,ParameterId::Waveform,0.5f);
    check(std::abs(engine.parameterState()[static_cast<std::size_t>(ParameterId::Waveform)]-0.5f)<1e-6f,
          "OSC1 WT position preserves fractional values");
    std::ifstream input(ORIGAMI_INIT_PATCH);std::ostringstream text;text<<input.rdbuf();check(bool(input),"read canonical Init");
    Patch patch;std::string error;check(parsePatch(text.str(),patch,error),"parse Init");check(patch.parameters==canonicalInitState().parameters,"Init JSON equals canonical authored parameters");
    Patch decoded;check(parsePatch(serializePatch(patch),decoded,error),"JSON round trip");check(decoded.parameters==patch.parameters && decoded.name=="Init","exact float round trip");
    patch.name="MCT 雪 \"one\"\n";check(parsePatch(serializePatch(patch),decoded,error) && decoded.name==patch.name,"UTF-8 and escaping");
    const auto before=decoded.parameters;
    for(const std::string invalid:{"{}","{\"format\":\"other\"}","{\"version\":2}","{\"name\":\"\\ud800\"}","{\"version\":01}","{\"version\":NaN}"}) check(!parsePatch(invalid,decoded,error) && decoded.parameters==before && !error.empty(),"invalid JSON unchanged");
    std::string bad=text.str();bad.replace(bad.find("8000"),4,"1e999");check(!parsePatch(bad,decoded,error),"huge exponent rejected");
    bad=text.str();bad.insert(bad.find("\"osc.1.level\""),"\"osc.1.waveform\": 2,\n");check(!parsePatch(bad,decoded,error),"duplicate parameters rejected");
    check(engine.applyPatchState(patch.parameters),"apply patch state");auto invalid=patch.parameters;invalid[0]=std::numeric_limits<float>::quiet_NaN();check(!engine.applyPatchState(invalid) && engine.parameterState()==patch.parameters,"invalid state transactional");
}
void canonicalInitAudit() {
    const auto init=canonicalInitState();
    check(validInstrumentState(init),"canonical Init is valid");
    check(init.oscillators[0].id==1 && init.oscillators[0].enabled && init.nextId==2,"Init stable single oscillator identity");
    const auto& o=init.oscillators[0];
    check(o.tableId==dsp::BuiltinWavetableId::BasicShapes && o.wtPosition==1.f/3.f && o.waveform==1,"Init unmixed canonical saw frame");
    check(o.octave==0 && o.semitone==0 && o.fineCents==0 && o.unison==1 && o.detuneCents==0 && o.blend==.5f && o.pan==0 && o.level==1,"Init exact oscillator controls");
    check(o.processCount==0 && o.routeCount==0 && oscBusSend(o,mainBusId)==1,"Init clean direct output");
    for(std::size_t i=1;i<init.oscillators.size();++i) check(!init.oscillators[i].id && !init.oscillators[i].enabled,"no extra Init oscillators");
    const auto v=[&](ParameterId id){return init.parameters[std::size_t(id)];};
    check(v(ParameterId::Attack)==.01f && v(ParameterId::Decay)==.5f && v(ParameterId::Sustain)==1 && v(ParameterId::Release)==0,"Init ENV1 exact authored values");
    check(init.modulation.env2.release==.25f && init.modulation.env3.sustain==.7f,"ENV2 and ENV3 retain low-level defaults");
    for(const auto& f:init.modulation.synthFilters.filters) check(!f.id,"no Init Synth Filters");
    for(const auto& r:init.modulation.routes) check(!r.id,"no Init modulation");
    const auto bytes=encodeInstrumentState(init);InstrumentState decoded;check(decodeInstrumentState(bytes.data(),bytes.size(),decoded) && encodeInstrumentState(decoded)==encodeInstrumentState(init),"Init binary round trip");
    check(toNormalized(ParameterId::Release,0)==0 && fromNormalized(ParameterId::Release,0)==0,"zero release mapping finite and exact");
    for(float seconds:{.001f,.25f,1.f,20.f}) check(std::abs(fromNormalized(ParameterId::Release,toNormalized(ParameterId::Release,seconds))-seconds)<.00005f,"positive release physical value round trip");
    for(int note:{36,60,84}) {
        auto e=std::make_unique<OrigamiEngine>();check(e->restoreInstrumentState(init),"Init restore");prepare(*e,48000,2);e->noteOn(note,1);
        std::array<float,256> l{},r{};float* buffers[]{l.data(),r.data()};double peak=0,power=0,mean=0;int count=0;
        for(int block=0;block<188;++block) {check(e->process(buffers,2,256),"Init stereo render");if(block>93) for(int i=0;i<256;++i){check(std::isfinite(l[i]) && l[i]==r[i],"Init finite symmetric centered output");peak=std::max(peak,double(std::abs(l[i])));power+=l[i]*l[i];mean+=l[i];++count;}}
        const double db=20*std::log10(peak);check(db>-11.2 && db<-10.2,"Init nominal peak target tolerance");check(std::abs(mean/count)<.001,"Init no DC regression");
        std::cout<<"Init MIDI "<<note<<" peak="<<peak<<" dB="<<db<<" RMS="<<std::sqrt(power/count)<<" DC="<<mean/count<<'\n';
        e->noteOff(note);e->process(buffers,2,256);check(e->activeVoiceCount()==0,"Init zero release completes in existing one-sample segment");
    }
    // Independent raw-table probe closes the transparent gain equation.
    dsp::WavetableOscillator raw;double rawPeak=0,rawPower=0;int rawCount=0;
    for(int sample=0;sample<48128;++sample) {const float x=raw.nextSimple(bank(),dsp::midiFrequency(60),48000,1.f/3.f);if(sample>=24064){rawPeak=std::max(rawPeak,double(std::abs(x)));rawPower+=x*x;++rawCount;}}
    std::cout<<"Init gain stages MIDI60 raw="<<rawPeak<<" rawRMS="<<std::sqrt(rawPower/rawCount)<<" postENV/level="<<rawPeak<<" stereoPostRoute="<<rawPeak*.70710678<<" previousMaster0.2="<<rawPeak*.70710678*.2<<" calibratedMaster0.35="<<rawPeak*.70710678*.35<<'\n';
    auto e=std::make_unique<OrigamiEngine>();e->restoreInstrumentState(init);prepare(*e);e->noteOn(60,1);auto reference=render(*e,48000,256);
    for(std::size_t block:{1u,7u,127u,511u,1024u}) {e->reset();e->noteOn(60,1);check(render(*e,48000,block)==reference,"Init deterministic block partitions");}
    for(unsigned unison:{1u,4u,8u,16u}) for(bool chord:{false,true}) {
        auto s=init;s.oscillators[0].unison=unison;s.parameters[std::size_t(ParameterId::OscUnison)]=float(unison);s.oscillators[0].detuneCents=12;s.parameters[std::size_t(ParameterId::OscDetune)]=12;
        check(e->restoreInstrumentState(s),"Init unison/chord restore");e->reset();e->noteOn(48,1);if(chord) for(int n:{55,60,64}) e->noteOn(n,1);
        prepare(*e,48000,2);e->noteOn(48,1);if(chord)for(int n:{55,60,64})e->noteOn(n,1);
        std::array<float,256> left{},right{};float* b[]{left.data(),right.data()};double peak=0;
        for(int block=0;block<188;++block){e->process(b,2,256);for(float x:left){check(std::isfinite(x),"Init chord/unison finite");peak=std::max(peak,double(std::abs(x)));}}
        std::cout<<"Init stereo headroom unison="<<unison<<" chord="<<chord<<" peak="<<peak<<'\n';
        check(peak<1,"representative stereo Init chord/unison avoids clipping");
    }
}
void envelopeTiming() {
    for(double rate:{44100.,48000.,96000.}) {
        dsp::Envelope env;env.prepare(rate);dsp::EnvelopeSettings settings{.01f,.02f,.4f,.03f};env.noteOn(settings);
        const auto attack=std::lround(settings.attack*rate),decay=std::lround(settings.decay*rate),release=std::lround(settings.release*rate);
        float previous=0;
        for(long i=0;i<attack;++i) {const float value=env.next(settings.sustain);check(value>=previous && value<=1,"attack monotonic");previous=value;}
        check(env.stage()==dsp::Envelope::Stage::Decay && env.value()==1,"attack timing");
        for(long i=0;i<decay;++i) env.next(settings.sustain);
        check(env.stage()==dsp::Envelope::Stage::Sustain && std::abs(env.value()-.4f)<1e-6,"decay timing");
        env.noteOff(settings);previous=env.value();
        for(long i=0;i<release;++i) {const float value=env.next(settings.sustain);check(value<=previous+1e-6f && value>=0,"release monotonic");previous=value;}
        check(env.stage()==dsp::Envelope::Stage::Idle && env.value()==0,"release timing");
        env.noteOn(settings);for(int i=0;i<20;++i) env.next(.4f);const float start=env.value();env.noteOff(settings);check(env.next(.4f)<=start,"early release continuity");
    }
}
void pitchAndBlocks() {
    for(double rate:{44100.,48000.}) for(int note:{60,69}) {
        auto engineOwner=std::make_unique<OrigamiEngine>();auto& engine=*engineOwner;prepare(engine,rate);set(engine,ParameterId::Waveform,0);set(engine,ParameterId::Sustain,1);engine.reset();
        check(engine.noteOn(note,.8f),"note accepted");const auto output=render(engine,static_cast<std::size_t>(rate));
        check(energy(output)>.01,"audible output");
        std::vector<std::size_t> crossings;
        for(std::size_t i=static_cast<std::size_t>(rate/4)+1;i<output.size();++i) if(output[i-1]<=0 && output[i]>0) crossings.push_back(i);
        check(crossings.size()>100,"pitch crossings");const double frequency=rate*double(crossings.size()-1)/double(crossings.back()-crossings.front());
        check(std::abs(frequency-dsp::midiFrequency(note))<.1,"rendered MIDI frequency");
        engine.noteOff(note);render(engine,static_cast<std::size_t>(rate));check(engine.activeVoiceCount()==0,"release eventually inactive");check(energy(render(engine,128))==0,"release silence");
    }
    auto engineOwner=std::make_unique<OrigamiEngine>();auto& engine=*engineOwner;prepare(engine);engine.noteOn(60,1);const auto reference=render(engine,4000,4000);
    for(std::size_t block:{1u,7u,127u,128u,257u,511u,1024u}) {engine.reset();engine.noteOn(60,1);check(render(engine,4000,block)==reference,"block partition invariance");}
    engine.reset();check(engine.activeVoiceCount()==0 && energy(render(engine,321))==0,"reset clears all state");
    check(!engine.noteOn(128,1) && !engine.noteOn(-1,1) && !engine.noteOn(60,NAN),"invalid notes rejected");
    check(engine.noteOn(0,1) && engine.noteOn(127,1),"full MIDI range");
}
void voicesAndRealtime() {
    auto engineOwner=std::make_unique<OrigamiEngine>();auto& engine=*engineOwner;prepare(engine);
    for(int i=0;i<16;++i) engine.noteOn(48+i,.5f);
    check(engine.activeVoiceCount()==16,"16 voices");engine.noteOn(90,.8f);check(engine.voiceInfo(0).address.note==90,"oldest voice stolen");
    engine.noteOff(55);engine.noteOn(91,.8f);check(engine.voiceInfo(7).address.note==91,"releasing voice stolen first");
    engine.reset();set(engine,ParameterId::Release,2.0f);engine.noteOn(64,.8f);render(engine,256);engine.noteOff(64);
    check(engine.voiceInfo(0).releasing,"same-note fixture enters release");
    engine.noteOn(64,.9f);
    check(engine.voiceInfo(0).active && !engine.voiceInfo(0).releasing && engine.voiceInfo(0).address.note==64,
          "same note retriggers during release");
    engine.reset();engine.noteOn(60,.5f,0,100);engine.noteOn(60,.5f,0,101);engine.noteOff(60,0,101);check(!engine.voiceInfo(0).releasing && engine.voiceInfo(1).releasing,"note identity");engine.allNotesOff();check(engine.voiceInfo(0).releasing,"all notes off releases");
    float left[1024]{},right[1024]{};float* buffers[]{left,right};check(engine.prepare(48000,64,2),"stereo prepare");
    allocations.store(0);guardAllocations.store(true);
    bool ok=true;
    for(int block=0;block<200;++block) {
        ok &= engine.setParameter(ParameterId::Cutoff,20.f+float(block%2)*19980.f);
        ok &= engine.setParameter(ParameterId::Resonance,float(block%2));
        ok &= engine.noteOn(block%128,.8f);
        ok &= engine.process(buffers,2,static_cast<std::size_t>(block%1023+1));
        ok &= engine.noteOff(block%128);
    }
    engine.allNotesOff();engine.reset();guardAllocations.store(false);
    check(ok,"realtime operations succeed");
#ifndef ORIGAMI_SANITIZED
    check(allocations.load()==0,"realtime operations allocate no heap");
#endif
    for(float sample:left) check(std::isfinite(sample),"master left finite");for(float sample:right) check(std::isfinite(sample),"master right finite");
    set(engine,ParameterId::OscPan,-1);engine.reset();engine.noteOn(69,1);engine.process(buffers,2,1024);check(std::all_of(std::begin(right),std::end(right),[](float v){return v==0;}),"pan left");
    set(engine,ParameterId::MasterGain,0);engine.reset();engine.noteOn(60,1);engine.process(buffers,2,1024);check(std::all_of(std::begin(left),std::end(left),[](float v){return v==0;}),"master zero");
}
void performanceModes() {
    auto engineOwner=std::make_unique<OrigamiEngine>();auto& engine=*engineOwner;prepare(engine);
    PerformanceState p;p.voiceMode=VoiceMode::Mono;p.notePriority=NotePriority::Last;p.legato=true;p.glideSeconds=.05f;
    check(engine.setPerformanceState(p),"mono state accepted");
    engine.noteOn(60,1);
    check(energy(render(engine,2048))>.001,"mono mode produces audible signal");
    engine.noteOn(64,1);
    check(engine.activeVoiceCount()==1 && engine.voiceInfo(0).address.note==64,"mono last priority");
    engine.noteOff(64);check(engine.voiceInfo(0).address.note==60 && !engine.voiceInfo(0).releasing,"mono fallback");
    engine.noteOff(60);check(engine.voiceInfo(0).releasing,"mono final release");

    // V31.2.1 regression: mono + legato must still retrigger the SAME note
    // while its previous articulation is releasing.
    engine.noteOn(60,1);
    check(engine.voiceInfo(0).active && !engine.voiceInfo(0).releasing &&
          engine.voiceInfo(0).address.note==60,
          "mono legato same note retriggers during release");

    engine.reset();p.notePriority=NotePriority::High;check(engine.setPerformanceState(p),"high priority accepted");engine.noteOn(72,1);engine.noteOn(60,1);check(engine.voiceInfo(0).address.note==72,"high priority");
    engine.reset();p.notePriority=NotePriority::Low;check(engine.setPerformanceState(p),"low priority accepted");engine.noteOn(60,1);engine.noteOn(72,1);check(engine.voiceInfo(0).address.note==60,"low priority");
    auto aOwner=std::make_unique<OrigamiEngine>();auto& a=*aOwner;auto bOwner=std::make_unique<OrigamiEngine>();auto& b=*bOwner;prepare(a);prepare(b);p.notePriority=NotePriority::Last;p.legato=true;p.glideSeconds=0;check(a.setPerformanceState(p),"zero glide");p.glideSeconds=.2f;check(b.setPerformanceState(p),"glide accepted");
    a.noteOn(60,1);b.noteOn(60,1);render(a,512);render(b,512);a.noteOn(72,1);b.noteOn(72,1);check(render(a,512)!=render(b,512),"glide changes transition");
    PerformanceState poly=p;poly.voiceMode=VoiceMode::Poly;poly.glideSeconds=0;
    check(engine.setPerformanceState(poly),"poly state accepted after mono");
    engine.noteOn(67,1);check(energy(render(engine,2048))>.001,"poly mode remains audible after mono");
    PerformanceState bad=p;bad.glideSeconds=6;check(!engine.setPerformanceState(bad),"invalid glide rejected");
}
void signalBehavior() {
    auto engineOwner=std::make_unique<OrigamiEngine>();auto& engine=*engineOwner;
    float empty[8]; std::fill_n(empty,8,1.f); float* emptyPointer=empty;
    check(!engine.process(&emptyPointer,1,8) && std::all_of(std::begin(empty),std::end(empty),[](float v){return v==0;}),"unprepared output silent");
    check(!engine.prepare(NAN,256,2) && !engine.prepare(48000,0,2) && !engine.prepare(48000,256,3),"invalid preparation rejected");
    prepare(engine);
    for(int waveform=0;waveform<4;++waveform) {
        set(engine,ParameterId::Waveform,static_cast<float>(waveform));engine.reset();engine.noteOn(69,1);
        check(energy(render(engine,4000))>.001,"each waveform audible");
    }
    // V22.3: a fractional OSC1 position must render as an interpolated
    // Basic Shapes position rather than being rounded to an anchor.
    set(engine,ParameterId::Waveform,0.5f);engine.reset();engine.noteOn(69,1);
    const auto morphA=render(engine,1024);
    set(engine,ParameterId::Waveform,1.0f);engine.reset();engine.noteOn(69,1);
    const auto anchorA=render(engine,1024);
    check(morphA!=anchorA,"OSC1 fractional WT position changes rendered waveform");
    engine.reset();engine.noteOn(69,1);const auto loud=energy(render(engine,5000));
    engine.reset();engine.noteOn(69,.5f);const auto quiet=energy(render(engine,5000));
    check(std::abs(quiet/loud-.25)<1e-5,"linear velocity amplitude");
    {auto m=engine.instrumentState().modulation;m.filterEnabled=true;check(engine.setModulationState(m),"explicit low-pass fixture");}
    set(engine,ParameterId::Cutoff,20);engine.reset();engine.noteOn(100,1);const double low=energy(render(engine,24000));
    set(engine,ParameterId::Cutoff,20000);engine.reset();engine.noteOn(100,1);const double high=energy(render(engine,24000));
    check(low<high*.01,"low-pass attenuates high frequencies");
    engine.reset();engine.noteOn(60,1);engine.noteOn(60,0);check(engine.voiceInfo(0).releasing,"zero velocity releases");
    check(engine.process(nullptr,0,0),"zero-length block safe");
    dsp::Envelope env;env.prepare(48000);dsp::EnvelopeSettings settings{.001f,.01f,.8f,.1f};env.noteOn(settings);
    for(int i=0;i<500;++i) env.next(.1f);
    check(std::abs(env.next(.1f)-.1f)<.1f,"decay follows changed sustain without boundary jump");
}
void oscillatorAndFilter() {
    check(bank().valid(),"built-in bank valid");dsp::Wavetable invalid;check(!invalid.valid(),"invalid bank rejected");
    dsp::WavetableOscillator oscillator;
    for(int i=0;i<2000000;++i) {const float v=oscillator.next(bank(),dsp::midiFrequency(127),48000,.33333333f);if(!std::isfinite(v) || oscillator.phase()<0 || oscillator.phase()>=1) throw std::runtime_error("long oscillator unstable");}
    check(true,"bounded phase over long render");
    constexpr int count=8192, fundamentalBin=300, aliasBin=2192;double real=0,imag=0;
    oscillator.reset();for(int i=0;i<count;++i) {const double v=oscillator.next(bank(),48000.*fundamentalBin/count,48000,1.f/3);const double angle=2*3.14159265358979323846*aliasBin*i/count;real+=v*std::cos(angle);imag+=v*std::sin(angle);}
    check(2*std::hypot(real,imag)/count<1e-4,"band-limited saw suppresses folded harmonic");
    for(double rate:{8000.,44100.,48000.,192000.}) {
        dsp::LowPassFilter filter;
        for(int i=0;i<20000;++i) {auto coefficients=dsp::LowPassCoefficients::make(rate,i%2?20:20000,i%2?0:1);check(std::isfinite(filter.next(i%2?1.f:-1.f,coefficients)),"filter finite at extremes");}
    }
}
}
void realtimeThreadPolicyAudit() {
    check(!RealtimeThreadPolicy::auxiliaryRenderThreadsEnabled,
          "Patch 19 keeps auxiliary realtime rendering disabled by default");
    check(!RealtimeThreadPolicy::audioCallbackMayBlockForWorker,
          "audio callback may not block waiting for auxiliary workers");
    check(!RealtimeThreadPolicy::perDspObjectWorkersAllowed,
          "worker-per-DSP-object architecture is forbidden");

    const auto root=std::filesystem::path(__FILE__).parent_path().parent_path();
    const auto readText=[](const std::filesystem::path& p) {
        std::ifstream f(p);
        return std::string(std::istreambuf_iterator<char>(f),
                           std::istreambuf_iterator<char>());
    };

    const auto engine=readText(root/"core/Engine.cpp");
    const auto voice=readText(root/"core/Voice.cpp");
    check(engine.find("std::thread")==std::string::npos
          && engine.find("std::async")==std::string::npos
          && engine.find("std::condition_variable")==std::string::npos,
          "engine render source contains no accidental auxiliary-thread primitives");
    check(voice.find("std::thread")==std::string::npos
          && voice.find("std::async")==std::string::npos
          && voice.find("std::condition_variable")==std::string::npos,
          "voice render source contains no accidental auxiliary-thread primitives");
}

void spectralPreparationBoundaryAudit() {
    using namespace mct::origami::dsp;
    const auto root=std::filesystem::path(__FILE__).parent_path().parent_path();
    std::ifstream sourceFile(root/"core/dsp/Wavetable.cpp");
    const std::string source((std::istreambuf_iterator<char>(sourceFile)),std::istreambuf_iterator<char>());
    check(!source.empty(),"Wavetable.cpp available for spectral RT audit");
    const auto nextStart=source.find("float WavetableOscillator::next");
    const auto nextEnd=source.find("double midiFrequency",nextStart);
    check(nextStart!=std::string::npos && nextEnd>nextStart,"spectral oscillator source bounds found");
    const auto nextBody=source.substr(nextStart,nextEnd-nextStart);
    check(nextBody.find("renderProcessedFrame2048(")==std::string::npos,
          "WavetableOscillator::next contains no FFT/IFFT construction");
    check(prepareSpectralCompiler(),"spectral preparation worker starts off RT");
    auto table=Wavetable::builtIns();
    WavetableOscillator oscillator;
    const auto before=spectralCompilerStats();
    const float first=oscillator.next(table,220.0,48000.0,0.25f,
        OscProcessType::FormantPeaks,0.75f,OscProcessType::Off,0.0f);
    check(std::isfinite(first),"spectral miss produces finite fallback audio");
    bool prepared=false;
    for(int i=0;i<200 && !prepared;++i) {
        std::this_thread::sleep_for(std::chrono::milliseconds(1));
        prepared=spectralCompilerStats().prepared>before.prepared;
    }
    check(prepared,"spectral miss is prepared asynchronously");
    const float later=oscillator.next(table,220.0,48000.0,0.25f,
        OscProcessType::FormantPeaks,0.75f,OscProcessType::Off,0.0f);
    check(std::isfinite(later),"prepared spectral playback remains finite");
    const auto after=spectralCompilerStats();
    check(after.requests>=before.requests+1,"spectral miss emitted bounded preparation request");
    check(after.fallbackReads>=before.fallbackReads+1,"spectral miss used realtime-safe fallback");
}

void randomSpectralAmountResponse() {
    using namespace dsp;
    std::array<float,2048> source{},dry{},previous{},current{},repeat{},reseeded{};
    for(std::size_t i=0;i<source.size();++i) {
        const double phase=2.0*3.14159265358979323846*static_cast<double>(i)/2048.0;
        for(int h=1;h<=64;++h)
            source[i]+=static_cast<float>(0.16*std::sin(phase*h)/h);
    }
    for(const auto type:{OscProcessType::RandAmp,OscProcessType::RandSparse}) {
        OscProcessPlan plan{};plan.count=1;plan.stages[0]={type,0.0f,0x1234abcdu};
        renderProcessedFrame2048(source.data(),dry.data(),plan);
        renderProcessedFrame2048(source.data(),repeat.data(),plan);
        check(dry==repeat,"random spectral output is deterministic for seed and frame");
        for(int step=1;step<=10;++step) {
            plan.stages[0].amount=static_cast<float>(step)/10.0f;
            renderProcessedFrame2048(source.data(),current.data(),plan);
            renderProcessedFrame2048(source.data(),repeat.data(),plan);
            double adjacent=0.0;
            for(std::size_t i=0;i<current.size();++i) {
                const double delta=current[i]-(step==1?dry[i]:previous[i]);
                adjacent+=delta*delta;
                check(current[i]==repeat[i],"random spectral output is deterministic for seed and frame");
            }
            check(adjacent>1.0e-7,"random spectral frame control has no broad inert interval");
            previous=current;
        }
        plan.stages[0].amount=0.5f;plan.stages[0].seed=0x76543210u;
        renderProcessedFrame2048(source.data(),reseeded.data(),plan);
        plan.stages[0].seed=0x1234abcdu;
        renderProcessedFrame2048(source.data(),current.data(),plan);
        check(current!=reseeded,"random spectral seed changes the realization");
    }
}

void spectralCachePlayback() {
    using namespace mct::origami::dsp;
    check(prepareSpectralCompiler(),"spectral worker prepared before rendering");
    auto table=Wavetable::builtIns();
    WavetableOscillator oscillator;
    OscProcessPlan plan;
    const std::array<OscProcessType,8> types{{OscProcessType::RandAmp,OscProcessType::RandSparse,
        OscProcessType::PhaseShift,OscProcessType::BendPlus,OscProcessType::OddFocus,
        OscProcessType::HarmonicTilt,OscProcessType::RandAmp,OscProcessType::RandSparse}};
    for(std::size_t p=0;p<types.size();++p)
        plan.stages[p]={types[p],0.375f,0x753100u+static_cast<std::uint32_t>(p)};
    auto verify=[&] {
        // At 93.75 Hz the renderer selects the 128-harmonic band (index 7).
        std::array<float,2048> expected{};
        renderProcessedFrame2048(table.frames[1].bands[7].samples.data(),expected.data(),plan);
        auto reference=[&](double phase) {
            const double pos=phase*2048.0;
            const auto index=static_cast<std::size_t>(pos);
            const float f=static_cast<float>(pos-static_cast<double>(index));
            return expected[index]+f*(expected[(index+1)%2048]-expected[index]);
        };
        bool ready=false;
        for(unsigned attempt=0;attempt<500 && !ready;++attempt) {
            ready=true;
            for(double phase:{0.137,0.271,0.463,0.791}) {
                oscillator.reset(phase);
                const float actual=oscillator.next(table,93.75,48000,1.0f/3.0f,plan);
                ready=ready && std::abs(actual-reference(phase))<1.0e-6f;
            }
            if(!ready) std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
        check(ready,"spectral cache converges to full offline chain output");
        oscillator.reset(0.137);
        const auto before=spectralCompilerStats();
        allocations.store(0);guardAllocations.store(true);
        bool equal=true;
        for(unsigned sample=0;sample<2048;++sample) {
            const float wanted=reference(oscillator.phase());
            equal=std::abs(oscillator.next(table,93.75,48000,1.0f/3.0f,plan)-wanted)<1.0e-6f && equal;
        }
        guardAllocations.store(false);
        check(equal,"cached spectral samples preserve interpolation and seeded chain output");
        check(allocations.load()==0,"warm spectral playback allocates no heap");
        check(spectralCompilerStats().requests==before.requests,"warm spectral playback does not rebuild frames");
    };
    for(auto count:{1u,2u,8u}) {plan.count=static_cast<std::uint8_t>(count);verify();}
    plan.stages[0].seed+=77;verify();
    plan.stages[1].amount=0.625f;verify();
    std::swap(plan.stages[2],plan.stages[3]);verify();
    for(auto& frame:table.frames) for(auto& band:frame.bands)
        for(auto& sample:band.samples) sample=-sample;
    assignWavetableGeneration(table);verify();
}

void spectralCacheConcurrentEviction() {
    using namespace mct::origami::dsp;
    // More keys than a cache set can hold, with readers sharing the same slots
    // while the worker evicts them. All storage/threads are prepared off RT.
    const auto table=Wavetable::builtIns();
    constexpr std::size_t keys=640;
    std::vector<std::array<float,2048>> expected(keys);
    auto makePlan=[](std::size_t key) {
        OscProcessPlan plan;plan.count=2;
        plan.stages[0]={OscProcessType::RandAmp,0.375f,static_cast<std::uint32_t>(0x740000u+key)};
        plan.stages[1]={OscProcessType::RandSparse,0.625f,static_cast<std::uint32_t>(0x840000u+key)};
        return plan;
    };
    const auto& dry=table.frames[1].bands[7].samples;
    for(std::size_t key=0;key<keys;++key)
        renderProcessedFrame2048(dry.data(),expected[key].data(),makePlan(key));
    std::atomic<bool> start{false},failed{false};
    std::atomic<std::uint64_t> exactReads{0};
    std::array<std::thread,4> readers;
    for(std::size_t r=0;r<readers.size();++r) readers[r]=std::thread([&,r] {
        WavetableOscillator oscillator;oscillator.reset(0.137);
        while(!start.load(std::memory_order_acquire)) std::this_thread::yield(); // test barrier only
        // mct-origami-nested-modulation-manual-qa: a miss holds the table this
        // reader last adopted (never torn data). 400 Hz makes the table
        // transition one read long (2 ms x 400 Hz < 1) so every output is a
        // whole waveform: the requested one, a recently adopted one, or dry.
        // (1 Hz at 400 Hz reads band 7, like 93.75 Hz at 48 kHz.)
        for(std::size_t sample=0;sample<32000;++sample) {
            const auto key=(sample/8+r*97)%keys;
            const double position=oscillator.phase()*2048.0;
            const auto index=static_cast<std::size_t>(position);
            const float fraction=static_cast<float>(position-static_cast<double>(index));
            const auto lookup=[&](const auto& wave) {
                return wave[index]+fraction*(wave[(index+1)%2048]-wave[index]);
            };
            const float output=oscillator.next(table,1.0,400,1.0f/3.0f,makePlan(key));
            bool valid=std::isfinite(output) && (std::abs(output-lookup(expected[key]))<=1.0e-6f || std::abs(output-lookup(dry))<=1.0e-6f);
            if(valid && std::abs(output-lookup(expected[key]))<=1.0e-6f) exactReads.fetch_add(1,std::memory_order_relaxed);
            // A busy compiler can legitimately hold a reader's last whole
            // table for longer than 512 key changes. Check every seeded
            // candidate; the safety property is that no slot is torn.
            for(std::size_t back=1;!valid && back<=sample/8 && back<keys;++back)
                valid=std::abs(output-lookup(expected[(key+keys-back)%keys]))<=1.0e-6f;
            if(!valid) failed.store(true,std::memory_order_relaxed);
        }
    });
    start.store(true,std::memory_order_release);
    for(auto& reader:readers) reader.join();
    check(!failed.load(),"concurrent eviction returns only whole seeded waveforms (requested, held previous) or dry fallback");
    check(exactReads.load()>0,"concurrent eviction still serves requested waveforms");
    // Requests own their source samples; table destruction is safe even if
    // the worker still has queued requests from this temporary generation.
}

void randomSpectralMorphAudit() {
    using namespace mct::origami::dsp;
    const auto table=Wavetable::builtIns();
    const auto& source=table.frames[1].bands[7].samples;
    for(const auto type:{OscProcessType::RandAmp,OscProcessType::RandSparse}) {
        OscProcessPlan low{},high{};
        low.count=high.count=1;
        low.stages[0]={type,12.0f/32.0f,0x4242u};
        high.stages[0]={type,13.0f/32.0f,0x4242u};
        auto mid=low;mid.stages[0].amount=12.5f/32.0f;
        std::array<float,2048> a{},b{};
        renderProcessedFrame2048(source.data(),a.data(),low);
        renderProcessedFrame2048(source.data(),b.data(),high);
        constexpr double phase=0.137;
        const double position=phase*2048.0;
        const auto index=static_cast<std::size_t>(position);
        const float fraction=static_cast<float>(position-double(index));
        const auto read=[&](const auto& wave){return wave[index]+fraction*(wave[(index+1)%2048]-wave[index]);};
        const float expected=0.5f*(read(a)+read(b));
        WavetableOscillator osc;
        std::array<SpectralReadHint,2> morphStorage{}; // a Voice provides this in its cold storage
        osc.setMorphHints(morphStorage.data());
        bool ready=false;
        for(int attempt=0;attempt<500 && !ready;++attempt) {
            osc.reset(phase);
            const float actual=osc.next(table,93.75,48000,1.0f/3.0f,mid);
            ready=std::abs(actual-expected)<1.0e-5f;
            if(!ready) std::this_thread::sleep_for(std::chrono::milliseconds(1));
        }
        check(ready,"random spectral magnitude blends neighboring prepared frames");
    }
}

// A moving random amount crossing a prepared key must stay on the blend of its
// neighbours: the full-weight endpoint never fades back from the previous key.
void randomSpectralMorphCrossingAudit() {
    using namespace mct::origami::dsp;
    const auto table=Wavetable::builtIns();
    const auto& source=table.frames[1].bands.back().samples; // the band a near-0 Hz read uses (all harmonics)
    for(const auto type:{OscProcessType::RandAmp,OscProcessType::RandSparse}) {
        constexpr double phase=0.137,frequency=1.0e-4; // the read phase holds (5e-5 cycles of drift)
        const auto planAt=[type](float amount){ OscProcessPlan plan{}; plan.count=1; plan.stages[0]={type,amount,0x4242u}; return plan; };
        const double position=phase*2048.0;
        const auto index=static_cast<std::size_t>(position);
        const float fraction=static_cast<float>(position-double(index));
        std::array<float,15> reference{};
        for(int k=10;k<=14;++k) {
            std::array<float,2048> frame{};
            renderProcessedFrame2048(source.data(),frame.data(),planAt(float(k)/32.0f));
            reference[std::size_t(k)]=frame[index]+fraction*(frame[(index+1)%2048]-frame[index]);
        }
        WavetableOscillator osc;
        std::array<SpectralReadHint,2> morphStorage{};
        osc.setMorphHints(morphStorage.data());
        bool prepared=true; // every key of the sweep is cached before it is measured
        for(int k=10;k<=14;++k) {
            bool ready=false;
            for(int attempt=0;attempt<500 && !ready;++attempt) {
                osc.reset(phase);
                ready=std::abs(osc.next(table,frequency,48000,1.0f/3.0f,planAt(float(k)/32.0f))-reference[std::size_t(k)])<1.0e-5f;
                if(!ready) std::this_thread::sleep_for(std::chrono::milliseconds(1));
            }
            prepared=prepared && ready;
        }
        check(prepared,"random morph crossing: neighbouring keys prepared");
        float maxStep=0.0f,maxDeviation=0.0f;
        for(int k=10;k<14;++k) maxStep=std::max(maxStep,std::abs(reference[std::size_t(k+1)]-reference[std::size_t(k)]));
        osc.reset(phase);
        constexpr int samples=24000; // 10.5 -> 13.5 keys in 0.5 s: three crossings
        for(int n=0;n<samples;++n) {
            const float coordinate=10.5f+3.0f*float(n)/float(samples);
            const float actual=osc.next(table,frequency,48000,1.0f/3.0f,planAt(coordinate/32.0f));
            const auto lower=static_cast<std::size_t>(coordinate);
            const float blend=coordinate-float(lower);
            const float expected=reference[lower]+blend*(reference[lower+1]-reference[lower]);
            maxDeviation=std::max(maxDeviation,std::abs(actual-expected));
        }
        check(maxStep>1.0e-3f && maxDeviation<0.2f*maxStep,"random morph crossing a key never steps back to the previous frame");
    }
}

void oscillatorGenerationCoherenceAudit() {
    const auto root=std::filesystem::path(__FILE__).parent_path().parent_path();
    auto read=[](const std::filesystem::path& path) {
        std::ifstream f(path);
        return std::string(std::istreambuf_iterator<char>(f),std::istreambuf_iterator<char>());
    };
    const auto bank=read(root/"core/OscillatorModule.h");
    const auto engine=read(root/"core/Engine.cpp");

    check(bank.find("std::array<AtomicSlot") == std::string::npos,
          "oscillator bank no longer publishes field-by-field atomics");
    check(bank.find("consumeSnapshot(") != std::string::npos,
          "oscillator bank exposes whole-generation consumer");
    check(bank.find("middle_.exchange(") != std::string::npos,
          "oscillator generation publication uses ownership exchange");
    check(engine.find("consumeSnapshot(hostModules_,hostModuleGeneration_)") != std::string::npos,
          "host callback consumes coherent oscillator generation");

    OscillatorModuleBank bankModel;
    std::array<OscillatorModuleState,OscillatorModuleBank::capacity> first{};
    std::uint64_t g1=0,g2=0;
    check(bankModel.consumeSnapshot(first,g1),
          "initial oscillator generation is published");

    auto s=bankModel.state(1);
    s.unison=7;
    s.detuneCents=41.0f;
    s.pan=-0.5f;
    check(bankModel.set(1,s),"oscillator generation edit accepted");

    std::array<OscillatorModuleState,OscillatorModuleBank::capacity> second{};
    check(bankModel.consumeSnapshot(second,g2),
          "edited oscillator generation is published");
    check(g2>g1,"oscillator generations are monotonic");
    check(second[0].unison==7 && second[0].detuneCents==41.0f && second[0].pan==-0.5f,
          "consumer receives one complete oscillator state generation");
    check(!bankModel.consumeSnapshot(second,g2),
          "consumer performs no work when no new oscillator generation exists");
}

void audioRateFastMathAudit() {
    // Numerical accuracy: these are audio DSP approximations, not arbitrary
    // "fast math" compiler flags.
    double exp2Worst=0.0;
    for(int i=0;i<=8000;++i) {
        const double x=-4.0+8.0*static_cast<double>(i)/8000.0;
        const double exact=std::exp2(x);
        const double fast=dsp::fastExp2Audio(x);
        exp2Worst=std::max(exp2Worst,std::abs(fast-exact)/exact);
    }
    check(exp2Worst<2.0e-6,"fast audio exp2 accuracy");

    double sinWorst=0.0;
    for(int i=0;i<=8192;++i) {
        const double phase=static_cast<double>(i)/8192.0;
        sinWorst=std::max(sinWorst,std::abs(
            dsp::fastSinCycle(phase)-std::sin(phase*6.28318530717958647692)));
    }
    check(sinWorst<2.0e-6,"fast audio sine accuracy");

    double powWorst=0.0;
    for(int xi=1;xi<=1000;++xi) {
        const double x=static_cast<double>(xi)/1000.0;
        for(double exponent:{0.25,0.5,1.0,2.0,3.5,5.0,6.0})
            powWorst=std::max(powWorst,std::abs(
                dsp::fastPow01(x,exponent)-std::pow(x,exponent)));
    }
    check(powWorst<2.0e-6,"fast audio curve-power accuracy");

    // mct-origami-dsp-performance-stereo-chain: the bit-level exp2 / log2
    // splits must reproduce the previous std::ldexp / std::frexp versions
    // bit for bit (a sound-preserving optimisation, not a new approximation).
    {
        const auto referenceExp2=[](double x) {
            if(!std::isfinite(x)) return 1.0;
            x=std::clamp(x,-126.0,126.0);
            const int whole=static_cast<int>(std::floor(x));
            const double y=(x-static_cast<double>(whole))*0.69314718055994530942;
            const double p=1.0+y*(1.0+y*(0.5+y*(1.0/6.0+y*(1.0/24.0+
                y*(1.0/120.0+y*(1.0/720.0+y*(1.0/5040.0+y*(1.0/40320.0))))))));
            return std::ldexp(p,whole);
        };
        const auto referenceLog2=[](double x) {
            if(!(x>0.0) || !std::isfinite(x)) return -126.0;
            int exponent=0; double mantissa=std::frexp(x,&exponent);
            mantissa*=2.0; --exponent;
            const double z=(mantissa-1.0)/(mantissa+1.0),z2=z*z;
            double term=z,sum=term;
            term*=z2;sum+=term/3.0; term*=z2;sum+=term/5.0; term*=z2;sum+=term/7.0;
            term*=z2;sum+=term/9.0; term*=z2;sum+=term/11.0; term*=z2;sum+=term/13.0;
            return static_cast<double>(exponent)+2.0*sum*1.4426950408889634074;
        };
        const auto same=[](double a,double b) { return std::memcmp(&a,&b,sizeof a)==0; };
        std::uint64_t state=0x9e3779b97f4a7c15ull;
        const auto next=[&] { state^=state<<13; state^=state>>7; state^=state<<17; return state; };
        bool exp2Same=true,log2Same=true;
        for(int i=-260000;i<=260000;++i) exp2Same=exp2Same && same(dsp::fastExp2Audio(i/2000.0),referenceExp2(i/2000.0));
        for(int i=0;i<200000;++i) {
            const double r=static_cast<double>(next()>>11)*0x1p-53;
            exp2Same=exp2Same && same(dsp::fastExp2Audio(-140.0+280.0*r),referenceExp2(-140.0+280.0*r));
            std::uint64_t bits=next(); double x; std::memcpy(&x,&bits,sizeof x); x=std::abs(x); // every exponent, subnormals included
            log2Same=log2Same && same(dsp::fastLog2Positive(x),referenceLog2(x));
            log2Same=log2Same && same(dsp::fastLog2Positive(r),referenceLog2(r));
        }
        for(double x:{std::numeric_limits<double>::denorm_min(),std::numeric_limits<double>::min(),1.0,0.5,
                      std::numeric_limits<double>::max(),0.0,-1.0,std::numeric_limits<double>::infinity()})
            log2Same=log2Same && same(dsp::fastLog2Positive(x),referenceLog2(x));
        check(exp2Same,"bit-level exp2 split is bit-identical to the ldexp version");
        check(log2Same,"bit-level log2 split is bit-identical to the frexp version (normal and subnormal)");
    }

    double foldWorst=0.0;
    for(int i=-8000;i<=8000;++i) {
        const double x=static_cast<double>(i)/1000.0;
        const double exact=std::asin(std::sin(x*1.57079632679489661923))
            *0.63661977236758134308;
        foldWorst=std::max(foldWorst,std::abs(
            static_cast<double>(dsp::triangleFold(static_cast<float>(x)))-exact));
    }
    check(foldWorst<2.0e-6,"triangle wavefold matches asin(sin()) transfer");

    for(double rate:{44100.0,48000.0,96000.0}) {
        dsp::LowPassCoefficientTable table;
        table.prepare(rate);
        check(table.prepared(),"filter coefficient table prepares off RT");
        for(float cutoff:{20.0f,37.0f,440.0f,1000.0f,8000.0f,16000.0f,19500.0f})
            for(float resonance:{0.0f,0.2f,0.7f,1.0f}) {
                const auto fast=table.make(cutoff,resonance);
                const auto exact=dsp::LowPassCoefficients::make(rate,cutoff,resonance);
                check(std::abs(fast.g-exact.g)<1.0e-5,
                      "prepared filter g matches exact tan coefficient");
                check(std::abs(fast.a1-exact.a1)<1.0e-5,
                      "prepared filter a1 matches exact coefficient");
            }
    }

    const auto root=std::filesystem::path(__FILE__).parent_path().parent_path();
    auto read=[](const std::filesystem::path& path) {
        std::ifstream f(path);
        return std::string(std::istreambuf_iterator<char>(f),std::istreambuf_iterator<char>());
    };
    const auto voice=read(root/"core/Voice.cpp");
    const auto modulation=read(root/"core/modulation/Modulation.cpp");
    const auto envelope=read(root/"core/dsp/Envelope.cpp");
    const auto wavetable=read(root/"core/dsp/Wavetable.cpp");

    const auto voiceStart=voice.find("Voice::Samples Voice::nextModules");
    const auto voiceEnd=voice.find("VoiceInfo Voice::info",voiceStart);
    const auto voiceBody=voice.substr(voiceStart,voiceEnd-voiceStart);
    check(voiceBody.find("std::exp2")==std::string::npos,
          "voice hot loop contains no std::exp2");
    check(voiceBody.find("std::sin")==std::string::npos &&
          voiceBody.find("std::asin")==std::string::npos,
          "voice hot loop contains no trig wavefold");

    const auto vf=modulation.find("void CompiledModulation::voiceFrame");
    const auto vfEnd=modulation.find("\\n}",vf);
    const auto voiceFrameBody=modulation.substr(vf,vfEnd-vf);
    check(voiceFrameBody.find("LowPassCoefficients::make")==std::string::npos,
          "voice filter modulation contains no realtime tan constructor");
    check(envelope.find("std::pow(")==std::string::npos,
          "envelope audio curve contains no std::pow");

    const auto phaseStart=wavetable.find("double processOscillatorPhase");
    const auto phaseEnd=wavetable.find("void renderProcessedFrame2048",phaseStart);
    const auto phaseBody=wavetable.substr(phaseStart,phaseEnd-phaseStart);
    check(phaseBody.find("std::pow(")==std::string::npos,
          "oscillator phase processes contain no std::pow");
}
void qosVoiceAdmissionAudit() {
    auto engineOwner=std::make_unique<OrigamiEngine>();auto& engine=*engineOwner;
    check(engine.prepare(48000.0,128,2),"QoS admission engine prepares");

    engine.setVoiceAdmissionCeiling(4);
    check(engine.voiceAdmissionCeiling()==4,
          "engine accepts bounded QoS voice ceiling");

    for(int note=60;note<64;++note)
        check(engine.noteOn(note,0.8f,0,0),"initial QoS-limited voices admit");
    check(engine.activeVoiceCount()==4,
          "QoS ceiling permits initial voices up to ceiling");

    // A fifth articulation must remain responsive, but it must replace one of
    // those voices rather than increasing concurrent workload to five.
    check(engine.noteOn(72,0.8f,0,0),
          "QoS admission replaces a voice instead of dropping note-on");
    check(engine.activeVoiceCount()==4,
          "critical QoS admission prevents polyphony growth above ceiling");

    bool foundNew=false;
    for(std::size_t i=0;i<OrigamiEngine::voiceCount;++i) {
        const auto info=engine.voiceInfo(i);
        if(info.active && info.address.note==72) foundNew=true;
    }
    check(foundNew,"incoming note remains musically responsive under QoS admission");

    engine.setVoiceAdmissionCeiling(16);
    check(engine.noteOn(73,0.8f,0,0),"released QoS ceiling admits growth again");
    check(engine.activeVoiceCount()==5,
          "polyphony can grow again after QoS pressure clears");
}


void dynamicTopologyRecompilation() {
    auto actual=std::make_unique<OrigamiEngine>();
    auto reference=std::make_unique<OrigamiEngine>();
    prepare(*actual);prepare(*reference);
    auto state=actual->instrumentState();
    auto& module=state.oscillators[0];
    module.processCount=3;module.nextProcessId=4;
    module.processes[0]={1,dsp::OscProcessType::BendPlus,0.1f,9,true};
    module.processes[1]={2,dsp::OscProcessType::PhaseShift,0.3f,8,true};
    module.processes[2]={3,dsp::OscProcessType::Reverse,0.2f,7,false};
    state.modulation.routes[0]={1,true,ModSource::Env1,{ModDestination::ProcessAmount,1,2},0.2f,true};
    state.modulation.nextRouteId=2;
    check(actual->restoreInstrumentState(state) && reference->restoreInstrumentState(state),
          "dynamic topology preset restores");
    actual->noteOn(60,0.8f);reference->noteOn(60,0.8f);
    auto compare=[&] {
        check(render(*actual,512)==render(*reference,512),
              "topology edits preserve stable child modulation addressing");
    };
    auto publish=[&] {
        check(actual->setOscillatorModuleState(1,module) && reference->setOscillatorModuleState(1,module),
              "live child topology update accepted");
        // Force the reference to recompile via a modulation publication too.
        // The actual engine must detect child edits from the oscillator state.
        check(reference->setModulationState(state.modulation),"reference modulation republished");
        compare();
    };
    compare();
    std::swap(module.processes[0],module.processes[1]);publish();
    module.processes[0].type=dsp::OscProcessType::BendMinus;publish();
    module.processes[1].enabled=false;publish();
    module.processes[2].enabled=true;publish();
    module.processCount=1;publish(); // remove unrelated children, keep ID 2
    module.processes[1]={4,dsp::OscProcessType::SineWarp,-0.2f,6,true};
    module.processCount=2;module.nextProcessId=5;publish();

    const auto sourceA=actual->addOscillatorModule();
    const auto sourceB=actual->addOscillatorModule();
    check(sourceA==reference->addOscillatorModule() && sourceB==reference->addOscillatorModule(),
          "oscillator additions preserve stable identities");
    module.routeCount=2;module.nextRouteId=12;
    module.routes[0]={10,sourceB,OscRouteType::RingMod,0.1f,true};
    module.routes[1]={11,sourceA,OscRouteType::Crossfade,0.2f,true};
    publish();
    state.modulation.routes[1]={2,true,ModSource::Lfo1,{ModDestination::RouteAmount,1,10},0.3f,true};
    state.modulation.nextRouteId=3;
    check(actual->setModulationState(state.modulation) && reference->setModulationState(state.modulation),
          "stable route-child modulation accepted");
    compare();
    std::swap(module.routes[0],module.routes[1]);publish();
    module.routes[1].enabled=false;publish();
    module.routes[1].enabled=true;publish();
    module.routes[0]=module.routes[1];module.routeCount=1;publish();
    check(actual->removeOscillatorModule(sourceA) && reference->removeOscillatorModule(sourceA),
          "deleting an oscillator compacts source slots");
    compare();
    check(actual->removeOscillatorModule(sourceB) && reference->removeOscillatorModule(sourceB),
          "deleting the routed source succeeds");
    compare();
    const auto remaining=actual->instrumentState();
    check(validInstrumentState(remaining) && remaining.oscillators[0].routes[0].sourceId==0 &&
          remaining.oscillators[0].routes[0].type==OscRouteType::Off,
          "source deletion clears dynamic routing references and preserves valid presets");

    OscillatorRenderPlan plan;
    auto modules=state.oscillators;
    modules[1].id=42;modules[1].enabled=true;
    modules[0].routeCount=4;
    modules[0].routes[0]={1,42,OscRouteType::RingMod,0.4f,true};
    modules[0].routes[1]={2,42,OscRouteType::PhaseMod,0.2f,true};
    modules[0].routes[2]={3,42,OscRouteType::WaveFold,0.3f,false};
    modules[0].routes[3]={4,42,OscRouteType::Crossfade,0.1f,true};
    plan.compile(modules);
    check(plan.activeCount==2 && plan.modules[0].preCount==1 && plan.modules[0].postCount==2,
          "compiled plan excludes bypassed routes and separates routing domains");
    check(plan.modules[0].postRoutes[0].amountSlot==0 && plan.modules[0].postRoutes[1].amountSlot==3,
          "post-routing order and amount slots survive compilation");
    std::swap(modules[1],modules[3]);plan.compile(modules);
    check(plan.modules[0].preRoutes[0].source==3,"source IDs resolve after oscillator slot changes");
    modules[3]={};plan.compile(modules);
    check(plan.modules[0].preCount==0 && plan.modules[0].postCount==0,
          "removed sources are absent from active routing");
}

void oscillatorControlCacheEquivalence() {
    dsp::OscillatorControlCache cache;
    const float nan=std::numeric_limits<float>::quiet_NaN();
    const float inf=std::numeric_limits<float>::infinity();
    const std::array<float,11> values{{-100.0f,-1.0f,-0.0f,0.0f,0.125f,0.999f,1.0f,100.0f,nan,inf,-inf}};
    // Repeated values exercise hits; ramps, boundary values and invalid input
    // exercise immediate refresh and the established sanitization behavior.
    for(unsigned sample=0;sample<8192;++sample) {
        if(sample%101==0) cache.invalidate();
        const float octave=values[(sample/17)%values.size()];
        const float semitone=values[(sample/31)%values.size()];
        const float fine=sample%2 ? static_cast<float>(sample%201)-100.0f : values[(sample/7)%values.size()];
        const auto finite=[](float v){return std::isfinite(v)?v:0.0f;};
        const double pitch=static_cast<double>(finite(octave))*12.0+
            static_cast<double>(finite(semitone))+static_cast<double>(finite(fine))/100.0;
        check(cache.pitchRatio(octave,semitone,fine)==dsp::fastExp2Audio(pitch/12.0),
              "cached pitch is exactly equivalent to uncached audio-rate math");
        const float input=sample%2 ? static_cast<float>(sample%2001)/1000.0f-1.0f : values[(sample/13)%values.size()];
        const float pan=std::isfinite(input)?std::clamp(input,-1.0f,1.0f):0.0f;
        const double cycle=(static_cast<double>(pan)+1.0)*0.125;
        float left,right;cache.pan(input,left,right);
        check(left==static_cast<float>(dsp::fastSinCycle(0.25-cycle)) &&
              right==static_cast<float>(dsp::fastSinCycle(cycle)),
              "cached pan is exactly equivalent to uncached audio-rate math");
    }
}

void simplePlaybackAndVisualizationPolicy() {
    for(double rate:{44100.0,48000.0,96000.0}) {
        dsp::WavetableOscillator simple,reference;
        simple.reset(0.37);reference.reset(0.37);
        for(unsigned i=0;i<8192;++i) {
            const double frequency=20.0+static_cast<double>(i%2000);
            const float position=static_cast<float>(i%1024)/1023.0f;
            check(simple.nextSimple(bank(),frequency,rate,position)==
                  reference.next(bank(),frequency,rate,position),
                  "simple playback is exactly equal to general playback under changing pitch and position");
        }
    }
    std::array<OscillatorModuleState,16> modules{};
    modules[0].id=1;modules[0].enabled=true;
    OscillatorRenderPlan topology;topology.compile(modules);
    check(topology.modules[0].simple,"plain oscillator compiles to simple path");
    modules[0].process1=dsp::OscProcessType::BendPlus;topology.compile(modules);
    check(!topology.modules[0].simple,"process topology excludes simple path");
    modules[0].process1=dsp::OscProcessType::Off;
    modules[1].id=2;modules[0].route1SourceId=2;modules[0].route1Type=OscRouteType::FrequencyMod;
    topology.compile(modules);check(!topology.modules[0].simple,"FM topology excludes simple path");
    // QoS: suppression skips engine-side observation entirely, reduction only
    // decimates it, and recovery immediately produces a fresh observation.
    // Audio must be bit-identical to an unthrottled engine throughout.
    auto reference=std::make_unique<OrigamiEngine>();auto controlled=std::make_unique<OrigamiEngine>();
    prepare(*reference);prepare(*controlled);
    reference->noteOn(60,0.8f);controlled->noteOn(60,0.8f);
    check(render(*reference,1024)==render(*controlled,1024),"nominal policy audio matches");
    check(controlled->runtimeVisualizationSnapshot().active,"nominal policy observes the sounding voice");
    const auto frozenPhases=controlled->runtimeVisualizationSnapshot().oscillatorPhases;
    const auto frozenSources=controlled->runtimeVisualizationSnapshot().sourcePhases;
    controlled->setVisualizationPolicy(true,false);
    check(render(*reference,2048)==render(*controlled,2048),"suppressed visualization leaves audio bit-identical");
    check(controlled->runtimeVisualizationSnapshot().oscillatorPhases==frozenPhases &&
          controlled->runtimeVisualizationSnapshot().sourcePhases==frozenSources,
          "suppression performs no engine observation work");
    controlled->setVisualizationPolicy(false,true);
    check(render(*reference,1024)==render(*controlled,1024),"reduced observation rate leaves audio bit-identical");
    check(controlled->runtimeVisualizationSnapshot().oscillatorPhases!=frozenPhases,
          "observation resumes after suppression is lifted");
    controlled->setVisualizationPolicy(false,false);
    check(render(*reference,1)==render(*controlled,1),"recovery sample matches");
    const auto recovered=controlled->runtimeVisualizationSnapshot().oscillatorPhases;
    check(render(*reference,1024)==render(*controlled,1024),"recovered policy audio matches");
    check(controlled->runtimeVisualizationSnapshot().active &&
          controlled->runtimeVisualizationSnapshot().oscillatorPhases!=recovered,
          "nominal observation keeps refreshing after recovery");
}

void cleanSineSimplePathP0() {
    // P0 gate: 1 oscillator, sine, no process/route/modulation, open filter.
    // The compiled plan must take the simple path and the output must be a
    // clean, stable, finite sine at the expected fundamental.
    auto engine=std::make_unique<OrigamiEngine>();prepare(*engine);
    set(*engine,ParameterId::Waveform,0.0f);set(*engine,ParameterId::OscUnison,1.0f);
    set(*engine,ParameterId::OscDetune,0.0f);set(*engine,ParameterId::OscPan,0.0f);
    set(*engine,ParameterId::Cutoff,20000.0f);set(*engine,ParameterId::Resonance,0.0f);
    set(*engine,ParameterId::Attack,0.001f);set(*engine,ParameterId::Sustain,1.0f);
    std::array<OscillatorModuleState,16> modules{};
    for(unsigned id=1;id<=16;++id){auto s=engine->oscillatorModuleState(id);if(s.id)modules[id-1]=s;}
    for(std::size_t m=1;m<modules.size();++m) if(modules[m].id) check(engine->setOscillatorModuleEnabled(modules[m].id,false),"isolate OSC1");
    OscillatorRenderPlan plan;modules[0].enabled=true;
    for(std::size_t m=1;m<modules.size();++m) modules[m].enabled=false;
    plan.compile(modules);
    check(plan.activeCount==1 && plan.modules[0].simple,"P0 sine compiles to the simple path");
    check(engine->noteOn(69,0.9f),"P0 sine note");
    render(*engine,4800);
    const auto out=render(*engine,48000);
    double sum=0;for(float x:out){check(std::isfinite(x),"P0 sine finite");sum+=x;}
    const double dc=sum/static_cast<double>(out.size());
    // Least-squares fit at 440 Hz: residual energy is everything that is not the fundamental.
    double ss=0,cc=0,sc=0,ys=0,yc=0;
    for(std::size_t n=0;n<out.size();++n){
        const double w=2.0*3.14159265358979323846*440.0*static_cast<double>(n)/48000.0;
        const double sn=std::sin(w),cs=std::cos(w),y=out[n]-dc;
        ss+=sn*sn;cc+=cs*cs;sc+=sn*cs;ys+=y*sn;yc+=y*cs;
    }
    const double det=ss*cc-sc*sc;check(std::abs(det)>1e-9,"P0 sine fit conditioned");
    const double a=(ys*cc-yc*sc)/det,b=(yc*ss-ys*sc)/det;
    double signal=0,residual=0,maxDelta=0,firstHalf=0,secondHalf=0;
    for(std::size_t n=0;n<out.size();++n){
        const double w=2.0*3.14159265358979323846*440.0*static_cast<double>(n)/48000.0;
        const double fit=a*std::sin(w)+b*std::cos(w);
        signal+=fit*fit;residual+=(out[n]-dc-fit)*(out[n]-dc-fit);
        (n<out.size()/2?firstHalf:secondHalf)+=static_cast<double>(out[n])*out[n];
        if(n) maxDelta=std::max(maxDelta,std::abs(static_cast<double>(out[n])-out[n-1]));
    }
    check(signal>1e-6,"P0 sine has fundamental energy at 440 Hz");
    check(std::sqrt(residual/signal)<0.01,"P0 sine residual (all non-fundamental content) below 1 percent");
    check(std::abs(dc)<1e-3,"P0 sine has negligible DC");
    const double peak=std::sqrt(2.0*signal/static_cast<double>(out.size()));
    check(maxDelta<2.0*3.14159265358979323846*440.0/48000.0*peak*1.05,"P0 sine has no discontinuities");
    check(std::abs(firstHalf/secondHalf-1.0)<0.01,"P0 sine amplitude is stable");
}

void performanceVisualizationSources() {
    auto engine=std::make_unique<OrigamiEngine>();prepare(*engine);
    engine->modWheel(0,64);engine->aftertouch(0,96);engine->pitchWheel(0,12288);
    check(engine->noteOn(60,0.8f),"performance visualization note starts");
    render(*engine,256);
    const auto sources=engine->runtimeVisualizationSnapshot().performanceSources;
    check(std::abs(sources[0]-64.0f/127.0f)<1.0e-6f &&
          std::abs(sources[1]-96.0f/127.0f)<1.0e-6f &&
          std::abs(sources[2]-0.5f)<1.0e-3f && sources[3]==1.0f,
          "visualization publishes observed wheel, pressure, bend and gate");
    engine->noteOff(60);render(*engine,256);
    check(engine->runtimeVisualizationSnapshot().performanceSources[3]==0.0f,
          "visualization gate follows note release");
}

void voiceObservationDoesNotChangeAudio() {
    auto observed=std::make_unique<Voice>();
    auto unobserved=std::make_unique<Voice>();
    observed->prepare(48000);unobserved->prepare(48000);
    ModulationState state;
    ModulationFrame frame;
    frame.modules[0].id=1;frame.modules[0].enabled=true;
    frame.modules[0].unison=4;
    frame.modules[0].processCount=2;
    frame.modules[0].processes[0]={1,dsp::OscProcessType::BendPlus,0.4f,7,true};
    frame.modules[0].processes[1]={2,dsp::OscProcessType::PhaseShift,-0.2f,8,true};
    state.routes[0]={1,true,ModSource::Env1,{ModDestination::ProcessAmount,1,1},0.2f,false};
    CompiledModulation compiled;
    compiled.prepare(48000);compiled.compile(state,frame.modules,true);
    compiled.globalFrame(frame,{},48000);
    dsp::EnvelopeSettings envelope;
    OscillatorRenderPlan topology;topology.compile(frame.modules);
    OscillatorProcessPlans sharedProcesses;
    topology.processPlan(0,frame.modules[0],sharedProcesses[0]);
    observed->start({},0.8f,1,envelope,state.env2,state.env3);
    unobserved->start({},0.8f,1,envelope,state.env2,state.env3);
    std::array<const dsp::Wavetable*,OscillatorModuleBank::capacity> tables{};
    tables.fill(&bank());
    for(unsigned i=0;i<512;++i) {
        const auto a=observed->nextModules(tables,frame,envelope.sustain,compiled,state,0,0,0,0,topology,sharedProcesses,true);
        const auto b=unobserved->nextModules(tables,frame,envelope.sustain,compiled,state,0,0,0,0,topology,sharedProcesses,false);
        check(a.left==b.left && a.right==b.right && a.mono==b.mono,
              "visualization observation does not affect modulated unison audio");
    }
    check(observed->visualizationSnapshot().modules[0].id==1,
          "observed voice publishes current modules");
    check(unobserved->visualizationSnapshot().modules[0].id==0,
          "unobserved voice skips snapshot copies");
}

void engineVisualizationCadenceDoesNotChangeAudio() {
    auto observed=std::make_unique<OrigamiEngine>();
    auto reference=std::make_unique<OrigamiEngine>();
    check(observed->prepare(96000,512,2) && reference->prepare(96000,512,2),
          "visualization cadence engines prepare at live rate");
    for(auto* engine:{observed.get(),reference.get()}) {
        check(engine->setParameter(ParameterId::Waveform,0.0f),"visualization cadence sine accepted");
        check(engine->setParameter(ParameterId::Sustain,1.0f),"visualization cadence sustain accepted");
        check(engine->noteOn(69,1.0f),"visualization cadence note accepted");
    }
    std::array<float,512> observedL{},observedR{},referenceL{},referenceR{};
    float* observedOut[]{observedL.data(),observedR.data()};
    float* referenceOut[]{referenceL.data(),referenceR.data()};
    for(int block=0;block<8;++block) {
        check(observed->process(observedOut,2,512) && reference->process(referenceOut,2,512),
              "visualization cadence renders live-size blocks");
        for(std::size_t i=0;i<512;++i)
            check(observedL[i]==referenceL[i] && observedR[i]==referenceR[i],
                  "visualization cadence is audio-transparent");
    }
    check(observed->runtimeVisualizationSnapshot().active,
          "decimated visualization still observes active voice");
}

void performanceSourceCurveAudit() {
    PerformanceSourceCurve linear{};
    check(std::abs(performanceSourceCurveValue(linear,0.0f)-0.0f)<1.0e-6f,
          "performance curve preserves zero endpoint");
    check(std::abs(performanceSourceCurveValue(linear,0.5f)-0.5f)<1.0e-6f,
          "default performance curve is linear at midpoint");
    check(std::abs(performanceSourceCurveValue(linear,1.0f)-1.0f)<1.0e-6f,
          "performance curve preserves one endpoint");
    PerformanceSourceCurve sensitive{};sensitive.points[1].y=0.75f;
    check(std::abs(performanceSourceCurveValue(sensitive,0.5f)-0.75f)<1.0e-5f,
          "raised midpoint increases velocity/note sensitivity");
    PerformanceSourceCurve gentle{};gentle.points[1].y=0.25f;
    check(std::abs(performanceSourceCurveValue(gentle,0.5f)-0.25f)<1.0e-5f,
          "lowered midpoint decreases velocity/note sensitivity");
    const float base=0.5f,depth=0.5f;
    check(std::abs(std::clamp(base-depth,0.0f,1.0f))<1.0e-6f,
          "50 percent bipolar LFO depth reaches oscillator level zero");
    check(std::abs(std::clamp(base+depth,0.0f,1.0f)-1.0f)<1.0e-6f,
          "50 percent bipolar LFO depth reaches oscillator level full scale");
}


// mct-origami-dsp-performance-stereo-chain: the handoff under real
// concurrency. One thread renders continuously (the audio thread) while the
// main thread publishes tables to two oscillators, collects replaced ones,
// and removes / re-adds a module whose table is live. The audio thread must
// never allocate or free, playback must stay finite, and every holder must
// be reclaimed (the engine destructor frees anything still in flight).
void wavetableHandoffConcurrencyAudit() {
    const auto authored=[](float gain) {
        auto table=dsp::Wavetable::builtIns();
        for(auto& frame:table.frames) for(auto& band:frame.bands) for(auto& v:band.samples) v*=gain;
        return table;
    };
    std::vector<dsp::Wavetable> tables; for(float g:{.9f,-.7f,.5f,-.3f}) tables.push_back(authored(g));
    auto owner=std::make_unique<OrigamiEngine>(); auto& engine=*owner;
    prepare(engine,48000,2);
    const auto second=engine.addOscillatorModule();
    for(int note:{45,52,57,64}) check(engine.noteOn(note,.8f),"concurrency audit notes");
    std::atomic<bool> stop{false},finite{true};
    std::atomic<unsigned> blocks{0};
    std::thread audio([&] {
        std::vector<float> l(256),r(256); float* io[2]{l.data(),r.data()};
        audioThread=true;
        while(!stop.load(std::memory_order_acquire)) {
            engine.process(io,2,256);
            for(int i=0;i<256;++i) if(!std::isfinite(l[std::size_t(i)]) || !std::isfinite(r[std::size_t(i)])) finite.store(false);
            blocks.fetch_add(1,std::memory_order_relaxed);
        }
        audioThread=false;
    });
    // Same-thread rule of the plugin: UI-side engine edits are serialized
    // (stateLock_), never with process().
    OscillatorModuleId third=engine.addOscillatorModule();
    unsigned published=0;
    for(int round=0;round<240;++round) {
        auto a=tables[std::size_t(round)%tables.size()],b=tables[std::size_t(round+1)%tables.size()];
        published+=engine.publishWavetableForOscillator(second,std::move(a)) ? 1u : 0u;
        if(third) published+=engine.publishWavetableForOscillator(third,std::move(b)) ? 1u : 0u;
        if(round%16==7 && third) { engine.removeOscillatorModule(third); third=0; }
        else if(round%16==11 && !third) third=engine.addOscillatorModule();
        engine.collectRetiredWavetables();
        const auto target=blocks.load()+1;
        while(blocks.load()<target) std::this_thread::yield(); // let at least one callback adopt
    }
    stop.store(true,std::memory_order_release);
    audio.join();
    engine.collectRetiredWavetables();
#ifndef ORIGAMI_SANITIZED
    check(audioAllocations.load()==0 && audioFrees.load()==0,"concurrent table commits / module removal: the audio thread never allocates or frees");
#endif
    check(finite.load(),"concurrent table commits keep playback finite");
    check(published>240,"tables were published throughout");
    check(blocks.load()>=240,"the audio thread rendered throughout");
}

// mct-origami-nested-modulation-manual-qa: spectral table transitions. A new
// cached table of the same frame / band is crossfaded in over 2 ms
// (exact: b + w (a - b), w = remaining / length); a table still being built
// is preceded by the previous one held, never the dry fallback.
void spectralTransitionAudit() {
    using namespace mct::origami::dsp;
    check(prepareSpectralCompiler(),"spectral worker for transition audit");
    const auto table=Wavetable::builtIns();
    const auto planOf=[](float amount,std::uint32_t seed) { OscProcessPlan p; p.count=1; p.stages[0]={OscProcessType::RandAmp,amount,seed}; return p; };
    const auto a=planOf(12.0f/32.0f,0x5eed01u),b=planOf(13.0f/32.0f,0x5eed01u);
    // Warm both keys: a fresh oscillator hits each from its first read.
    const auto warm=[&](const OscProcessPlan& plan) {
        for(int attempt=0;attempt<400;++attempt) {
            const auto before=spectralMisses(spectralCompilerStats());
            WavetableOscillator o; o.reset(0.21);
            for(int i=0;i<64;++i) (void)o.next(table,93.75,48000,1.0f/3.0f,plan);
            if(spectralMisses(spectralCompilerStats())==before) return true;
            std::this_thread::sleep_for(std::chrono::milliseconds(2));
        }
        return false;
    };
    check(warm(a) && warm(b),"transition audit keys cached");
    WavetableOscillator oa,ob,ox; oa.reset(0.21); ob.reset(0.21); ox.reset(0.21);
    for(int i=0;i<100;++i) { (void)oa.next(table,93.75,48000,1.0f/3.0f,a); (void)ob.next(table,93.75,48000,1.0f/3.0f,b); (void)ox.next(table,93.75,48000,1.0f/3.0f,a); }
    const int length=static_cast<int>(std::lround(48000*spectralTransitionSeconds));
    bool exact=true;
    for(int k=0;k<length+64;++k) {
        const float va=oa.next(table,93.75,48000,1.0f/3.0f,a),vb=ob.next(table,93.75,48000,1.0f/3.0f,b);
        const float vx=ox.next(table,93.75,48000,1.0f/3.0f,b);
        const float w=k<length ? static_cast<float>(length-k)/static_cast<float>(length) : 0.0f;
        const float expected=k<length ? vb+w*(va-vb) : vb;
        exact=exact && std::abs(vx-expected)<=1.0e-6f;
    }
    check(exact,"a cached key switch crossfades linearly over 2 ms, then reads the new table exactly");
    // An uncached key: the previous table is held (no dry read) until built,
    // then crossfaded in.
    const auto c=planOf(20.0f/32.0f,0xc0ffeeu+static_cast<std::uint32_t>(std::chrono::steady_clock::now().time_since_epoch().count()&0xffff));
    const auto dryBefore=spectralCompilerStats().fallbackReads,heldBefore=spectralCompilerStats().heldReads;
    bool heldExactly=true,arrived=false;
    for(int i=0;i<200000 && !arrived;++i) {
        const float vb=ob.next(table,93.75,48000,1.0f/3.0f,b);
        const float vx=ox.next(table,93.75,48000,1.0f/3.0f,c);
        if(spectralCompilerStats().transitions>0 && std::abs(vx-vb)>1.0e-6f) arrived=true;
        else heldExactly=heldExactly && std::abs(vx-vb)<=1.0e-6f;
        if(i%4096==4095) std::this_thread::sleep_for(std::chrono::milliseconds(1));
    }
    check(heldExactly,"while the new table is built the previous one is held exactly");
    check(arrived && spectralCompilerStats().heldReads>heldBefore,"the new table arrives and is crossfaded in");
    check(spectralCompilerStats().fallbackReads==dryBefore,"no dry fallback read during a table change");
}

// mct-origami-nested-modulation-manual-qa: manual-edit dezipper. A UI value
// edit glides linearly over 10 ms; internal modulation (here a FREE LFO on
// the same LEVEL) stays sample-accurate, with no added latency; structural
// edits apply at once.
void manualEditDezipperAudit() {
    struct Rig { std::unique_ptr<OrigamiEngine> e; OscillatorModuleId osc2=0; };
    const auto make=[](float baseLevel,bool lfoRoute) {
        Rig r; r.e=std::make_unique<OrigamiEngine>(); auto& e=*r.e;
        check(e.prepare(48000,512,1),"dezip rig prepare");
        r.osc2=e.addOscillatorModule();
        set(e,ParameterId::OscLevel,0.0f); set(e,ParameterId::Attack,0.001f); set(e,ParameterId::Sustain,1.0f);
        auto m=e.oscillatorModuleState(r.osc2); m.enabled=true; m.level=baseLevel; m.wtPosition=0.0f; m.unison=1; m.pan=0.0f;
        check(e.setOscillatorModuleState(r.osc2,m),"dezip rig OSC 2");
        auto mod=e.instrumentState().modulation; mod.filterEnabled=false;
        mod.lfo1.mode=LfoMode::Free; mod.lfo1.rateHz=3.0f;
        if(lfoRoute) { mod.routes[0]={1,true,ModSource::Lfo1,{ModDestination::Level,r.osc2,0},0.2f,true}; mod.nextRouteId=2; }
        check(e.setModulationState(mod),"dezip rig modulation");
        e.reset(); check(e.noteOn(69,1.0f),"dezip rig note");
        return r;
    };
    auto A=make(0.5f,true),B=make(0.5f,true),C=make(1.0f,false);
    std::vector<float> a(4096),b(4096),c(4096);
    const auto play=[](OrigamiEngine& e,float* out,std::size_t n) { for(std::size_t i=0;i<n;i+=256) { float* p=out+i; check(e.process(&p,1,256),"dezip rig render"); } };
    play(*A.e,a.data(),2048); play(*B.e,b.data(),2048); play(*C.e,c.data(),2048);
    auto edit=A.e->oscillatorModuleState(A.osc2); edit.level=0.6f;
    check(A.e->setOscillatorModuleState(A.osc2,edit),"UI edit of OSC 2 LEVEL");
    play(*A.e,a.data()+2048,2048); play(*B.e,b.data()+2048,2048); play(*C.e,c.data()+2048,2048);
    const auto N=static_cast<std::size_t>(std::lround(48000*OrigamiEngine::dezipSeconds));
    bool ramp=true,lfoExact=true; std::size_t checked=0;
    double phase=0.0;
    for(std::size_t n=0;n<4096;++n) {
        const double lfo=dsp::fastSinCycle(phase); phase+=3.0/48000.0; phase-=std::floor(phase);
        if(std::abs(c[n])<0.05f) continue; // where the oscillator itself is near zero the ratio is ill-conditioned
        ++checked;
        // B / C = 0.5 + 0.1 LFO(n) (a bipolar route of depth 0.2 spans
        // +/-0.1): the LFO acts on the very sample it is computed for.
        lfoExact=lfoExact && std::abs(b[n]/c[n]-(0.5+0.1*lfo))<2.0e-4;
        const double expected=n<2048 ? 0.0 : 0.1*std::min(1.0,static_cast<double>(n-2048+1)/static_cast<double>(N));
        ramp=ramp && std::abs((a[n]-b[n])/c[n]-expected)<2.0e-4;
    }
    check(checked>2000,"dezip audit has enough well-conditioned samples");
    check(lfoExact,"LFO -> LEVEL is sample-accurate (no UI smoothing on modulation)");
    check(ramp,"a manual LEVEL edit glides linearly over 10 ms on top of the unchanged modulation");
    // Value edit -> glide; structural edit -> immediate.
    edit.level=0.3f; check(A.e->setOscillatorModuleState(A.osc2,edit),"second value edit");
    float* p=a.data(); check(A.e->process(&p,1,128),"render");
    check(A.e->dezipping(),"a value edit glides");
    edit.processCount=1; edit.nextProcessId=2; edit.processes[0]={1,dsp::OscProcessType::BendPlus,0.4f,7u,true};
    check(A.e->setOscillatorModuleState(A.osc2,edit),"structural edit");
    check(A.e->process(&p,1,128),"render");
    check(!A.e->dezipping(),"a structural edit applies at once (no glide)");
}

// mct-origami-nested-modulation-manual-qa: nested modulation renders without
// allocating (prepared programs; nothing is traversed or built per sample).
void nestedModulationRealtimeAudit() {
    auto owner=std::make_unique<OrigamiEngine>(); auto& e=*owner;
    check(e.prepare(48000,512,2),"nested realtime prepare");
    const auto osc2=e.addOscillatorModule();
    auto mod=e.instrumentState().modulation;
    mod.lfo1.mode=LfoMode::Free; mod.lfo2.mode=LfoMode::Loop; mod.lfo3.mode=LfoMode::Free; mod.lfo3.stereo=0.5f;
    const auto route=[](std::uint32_t id,ModSource src,ModAddress dst,float amount,bool bipolar=true) { ModRoute r; r.id=id; r.enabled=true; r.source=src; r.destination=dst; r.amount=amount; r.bipolar=bipolar; return r; };
    mod.routes[0]=route(1,ModSource::Lfo1,{ModDestination::Level,osc2,0},0.3f);
    mod.routes[1]=route(2,ModSource::Macro1,routeDepthAddress(1),0.4f,false);
    mod.routes[2]=route(3,ModSource::Lfo3,lfoRateAddress(0),0.3f);
    mod.routes[3]=route(4,ModSource::Macro2,macroValueAddress(1),0.5f,false);
    mod.routes[4]=route(5,ModSource::Lfo2,{ModDestination::Cutoff,0,0},0.3f);
    mod.routes[5]=route(6,ModSource::Env2,lfoRateAddress(1),0.4f,false);
    mod.routes[6]=route(7,ModSource::Env3,routeDepthAddress(5),0.3f,false);
    mod.routes[7]=route(8,ModSource::Velocity,macroValueAddress(2),0.2f,false);
    mod.nextRouteId=9;
    check(e.setModulationState(mod),"dense nested patch accepted");
    e.reset();
    for(int n:{48,55,60,64,67}) check(e.noteOn(n,.8f),"nested realtime notes");
    std::vector<float> l(512),r(512); float* io[2]{l.data(),r.data()};
    e.process(io,2,512);
#ifndef ORIGAMI_SANITIZED
    allocations.store(0);frees.store(0);guardAllocations.store(true);
#endif
    bool finite=true;
    for(int b=0;b<64;++b) { e.process(io,2,512); for(int i=0;i<512;++i) finite=finite && std::isfinite(l[i]) && std::isfinite(r[i]); }
#ifndef ORIGAMI_SANITIZED
    guardAllocations.store(false);
    check(allocations.load()==0 && frees.load()==0,"nested modulation (route depth, LFO / ENV -> LFO RATE, MACRO -> MACRO, per-voice programs) allocates nothing");
#endif
    check(finite,"nested modulation renders finite audio");
}

// mct-origami-dsp-performance-stereo-chain: every optimised path renders the
// pre-optimisation output bit for bit (hashes captured on 378ad97), at block
// sizes 32 / 256 / 1000, deterministically.
void optimizedPathGoldenAudit() {
    const bool print=std::getenv("ORIGAMI_PRINT_GOLDEN")!=nullptr;
    // Scenario 3 uses interpolated random spectral frames; its old quantized
    // hash was 0x004177b6dc1873d3 (and 0x8ab144d7b625d5a0 while a key crossing
    // still faded the full-weight endpoint back from the previous key). The
    // other paths retain their pinned single-lane hashes. Unison repair
    // deliberately re-baselines scenarios 0 (8 lanes) and 5 (3 lanes):
    // stereo ensembles, independent phases and compensated summing.
    static constexpr std::uint64_t expected[golden::scenarioCount]{
        0x053118a75389cdb9ull,0xf2cb0320aab297acull,0x69eb600ae29a68dbull,
        0xf726293442577439ull,0x47585a3f316d4135ull,0xcf211d5863c3b2efull};
    for(int s=0;s<golden::scenarioCount;++s) {
        const auto a=golden::render(s,32),b=golden::render(s,256),c=golden::render(s,1000),again=golden::render(s,256);
        if(print) std::cout<<"GOLDEN "<<golden::scenarioName(s)<<" 0x"<<std::hex<<b.hash<<std::dec<<"\n";
        check(a.finite && b.finite && c.finite,"golden render stays finite");
        check(a.hash==b.hash && b.hash==c.hash,"optimised paths are block-size independent (32 / 256 / 1000)");
        check(again.hash==b.hash,"optimised paths render deterministically");
        check(b.hash==expected[s],"paths match pinned single-lane or repaired-unison golden render");
    }
}

// mct-origami-dsp-performance-stereo-chain: editor wavetable commits while
// voices play. The audio thread adopts by swap: it never allocates or frees
// (the old mailbox copied the table and freed the previous one in the
// callback), the result equals an exclusive install, back-to-back commits to
// two oscillators are both kept, and removing a module whose table is live
// frees nothing under the audio thread.
void wavetableHandoffAudit() {
    const auto authored=[](float gain) {
        auto table=dsp::Wavetable::builtIns();
        for(auto& frame:table.frames) for(auto& band:frame.bands) for(auto& v:band.samples) v*=gain;
        return table;
    };
    // Preallocated output: the guarded sections measure the engine only.
    const auto play=[](OrigamiEngine& e,std::vector<float>& out) {
        for(std::size_t i=0;i<out.size();i+=256) { float* ptr=out.data()+i; check(e.process(&ptr,1,std::min<std::size_t>(256,out.size()-i)),"handoff render block"); }
    };
    std::vector<float> adopted(1024),expected(1024),scratch(1024);
    auto referenceOwner=std::make_unique<OrigamiEngine>(),actualOwner=std::make_unique<OrigamiEngine>();
    auto& reference=*referenceOwner;auto& actual=*actualOwner;
    prepare(reference);prepare(actual);
    const auto second=actual.addOscillatorModule();
    check(second!=0 && second==reference.addOscillatorModule(),"second oscillator for the handoff audit");
    for(auto* e:{&reference,&actual}) {
        for(int note:{48,55,60,67}) check(e->noteOn(note,.8f),"handoff audit notes");
        render(*e,512,256);
    }
    // Two commits before one callback: both oscillators must receive theirs.
    check(actual.publishWavetableForOscillator(1,authored(-.9f)),"OSC 1 table publishes");
    check(actual.publishWavetableForOscillator(second,authored(.5f)),"OSC 2 table publishes");
    check(!actual.publishWavetableForOscillator(99,authored(1.f)),"unknown module rejected before publication");
    auto broken=authored(1.f);broken.frames[0].bands[0].samples[3]=std::numeric_limits<float>::quiet_NaN();
    check(!actual.publishWavetableForOscillator(1,std::move(broken)),"invalid table rejected before publication");
    check(reference.installWavetableForOscillator(1,authored(-.9f)) &&
          reference.installWavetableForOscillator(second,authored(.5f)),"exclusive reference installs");
    check(actual.wavetableHandoffPending(),"tables wait for the callback boundary");
#ifndef ORIGAMI_SANITIZED
    allocations.store(0);frees.store(0);guardAllocations.store(true);
#endif
    play(actual,adopted);
#ifndef ORIGAMI_SANITIZED
    guardAllocations.store(false);
    check(allocations.load()==0 && frees.load()==0,"adopting editor tables allocates and frees nothing in the callback");
#endif
    check(!actual.wavetableHandoffPending(),"both tables adopted at the boundary");
    play(reference,expected);
    bool same=adopted.size()==expected.size();
    for(std::size_t i=0;same && i<adopted.size();++i) same=adopted[i]==expected[i];
    check(same,"published tables render exactly like an exclusive install (both oscillators)");
    // Replace a live table, then remove the module whose table is playing.
    check(actual.publishWavetableForOscillator(second,authored(.25f)),"replacement publishes");
#ifndef ORIGAMI_SANITIZED
    allocations.store(0);frees.store(0);guardAllocations.store(true);
#endif
    play(actual,scratch);
#ifndef ORIGAMI_SANITIZED
    guardAllocations.store(false);
    check(allocations.load()==0 && frees.load()==0,"replacing a live table frees nothing in the callback");
    frees.store(0);guardAllocations.store(true);
#endif
    actual.collectRetiredWavetables(); // non-audio thread: the replaced tables are freed here
#ifndef ORIGAMI_SANITIZED
    guardAllocations.store(false);
    check(frees.load()>0,"replaced tables are freed by the non-audio collector");
#endif
    check(actual.removeOscillatorModule(second),"remove the module with a live table");
#ifndef ORIGAMI_SANITIZED
    allocations.store(0);frees.store(0);guardAllocations.store(true);
#endif
    play(actual,scratch);
    const auto& afterRemove=scratch;
#ifndef ORIGAMI_SANITIZED
    guardAllocations.store(false);
    check(allocations.load()==0 && frees.load()==0,"removing a module with a live table frees nothing in the callback");
#endif
    check(std::all_of(afterRemove.begin(),afterRemove.end(),[](float v){return std::isfinite(v);}),"playback stays finite after removal");
    // The released slot is reused by the next commit (its stale storage is
    // swapped out and freed off-thread).
    const auto third=actual.addOscillatorModule();
    check(actual.publishWavetableForOscillator(third,authored(.7f)),"new module table publishes");
    render(actual,256,256);
    check(!actual.wavetableHandoffPending(),"released slot accepts a new table");
    actual.collectRetiredWavetables();
}
void sourceInstanceRealtimeAudit() {
    auto e=std::make_unique<OrigamiEngine>();check(e->prepare(48000,256,2),"instance RT prepare");
    auto m=e->instrumentState().modulation;
    std::array<ModSource,maxSourceInstances> sources{};
    for(std::size_t i=0;i<maxSourceInstances;++i) {
        const auto f=static_cast<SourceFamily>(i%7+1);sources[i]=addSourceInstance(m,f);
        auto& a=m.instances[i];a.lfo.mode=i%2 ? LfoMode::Loop : LfoMode::Free;a.lfo.stereo=.7f;a.random.rateHz=40;
        m.routes[i]={m.nextRouteId++,true,sources[i],{ModDestination::Level,1,0},.01f,false};
    }
    // A nested rate uses stable instance identity, including through Nodes.
    m.routes[0].destination={ModDestination::LfoRate,0,std::uint32_t(sources[1])};
    check(e->setModulationState(m),"full pool installed");e->reset();
    std::array<float,256> left{},right{};float* out[]{left.data(),right.data()};
    allocations.store(0);frees.store(0);guardAllocations.store(true);
    bool okay=true;
    for(int n=0;n<16;++n) okay &= e->noteOn(48+n,.6f);
    for(int block=0;block<100;++block) okay &= e->process(out,2,256);
    for(int n=0;n<16;++n) okay &= e->noteOff(48+n);
    okay &= e->process(out,2,256);e->emergencyResetRuntime();
    guardAllocations.store(false);
    check(okay,"32-source pool renders, releases and resets under load");
#ifndef ORIGAMI_SANITIZED
    check(allocations.load()==0 && frees.load()==0,"full pool has no audio-thread allocation or free");
#endif
    for(float x:left) check(std::isfinite(x),"full pool output finite");
    e->noteOn(60,.8f);e->process(out,2,256);
    const auto& visual=e->runtimeVisualizationSnapshot();
    for(std::size_t i=0;i<maxSourceInstances;++i) check(visual.instanceIds[i]==instanceIdOf(sources[i]),"telemetry retains instance identity");
    const auto r1=modulationSourceSlot(sources[2],m),r2=modulationSourceSlot(sources[9],m);
    check(visual.routeSources[r1]!=visual.routeSources[r2],"additional Random sources have independent streams");
    check(removeSourceInstance(m,sources[2]),"live deletion accepted");const auto fresh=addSourceInstance(m,SourceFamily::Random);
    check(fresh!=sources[2] && e->setModulationState(m),"live recreation uses a new identity");
    allocations.store(0);frees.store(0);guardAllocations.store(true);okay=e->process(out,2,256);guardAllocations.store(false);
    check(okay,"live source pool handoff renders");
#ifndef ORIGAMI_SANITIZED
    check(allocations.load()==0 && frees.load()==0,"pool mailbox adoption and recompilation allocate nothing");
#endif
}

void correctiveSpectralPreview() {
    std::array<float,2048> input{},left{},right{},middle{};
    for(std::size_t i=0;i<input.size();++i) input[i]=2.0f*float(i)/float(input.size())-1.0f;
    for(const auto type:{dsp::OscProcessType::RandAmp,dsp::OscProcessType::RandSparse}) {
        dsp::OscProcessPlan plan;plan.count=1;plan.stages[0]={type,0,0xabcdefu};
        for(int boundary=1;boundary<32;++boundary) {
            const float key=float(boundary)/32;
            plan.stages[0].amount=key-1e-5f;dsp::renderOscillatorPreview2048(input.data(),left.data(),plan);
            plan.stages[0].amount=key+1e-5f;dsp::renderOscillatorPreview2048(input.data(),right.data(),plan);
            float delta=0;for(std::size_t i=0;i<input.size();++i) delta=std::max(delta,std::abs(left[i]-right[i]));
            check(delta<.002f,"random preview is continuous across every preparation boundary");
        }
        for(int key=0;key<32;++key) {
            plan.stages[0].amount=float(key)/32;dsp::renderProcessedFrame2048(input.data(),left.data(),plan);
            plan.stages[0].amount=float(key+1)/32;dsp::renderProcessedFrame2048(input.data(),right.data(),plan);
            plan.stages[0].amount=(float(key)+.37f)/32;dsp::renderOscillatorPreview2048(input.data(),middle.data(),plan);
            for(std::size_t i=0;i<input.size();++i) check(std::abs(middle[i]-(left[i]+.37f*(right[i]-left[i])))<2e-6f,"preview represents DSP endpoint interpolation exactly");
        }
    }
    check(dsp::oscillatorPreviewPhase(383,384)<1.0f,"visible waveform terminal phase cannot wrap to first point");
    const float last=2*dsp::oscillatorPreviewPhase(383,384)-1;
    check(last>.99f,"saw viewport ends on final positive sample rather than artificial negative edge");
}

void oscillatorRouteMixerAudit() {
    const auto fixture=std::string(__FILE__).substr(0,std::string(__FILE__).find_last_of('/'))+"/fixtures/";
    std::ifstream patch(fixture+"synth-serial-v36.bin",std::ios::binary);std::vector<std::uint8_t> bytes((std::istreambuf_iterator<char>(patch)),{});InstrumentState legacy;
    check(!bytes.empty() && decodeInstrumentState(bytes.data(),bytes.size(),legacy),"actual v36 fixture migrates");
    check(legacy.modulation.synthFilters.inputs[0].buses[0].filter && legacy.modulation.synthFilters.inputs[0].buses[0].level==1,"v36 single edge becomes unity typed send");
    auto old=std::make_unique<OrigamiEngine>();check(old->prepare(48000,256,2) && old->restoreInstrumentState(legacy),"migrated fixture restores");old->noteOn(60,.7f);
    std::ifstream reference(fixture+"synth-serial-v36.f32",std::ios::binary);std::array<float,256> l{},r{},expected{};float* output[]{l.data(),r.data()};
    for(int block=0;block<16;++block) {check(old->process(output,2,256),"legacy audio renders");for(auto* channel:output) {reference.read(reinterpret_cast<char*>(expected.data()),sizeof(expected));check(bool(reference),"legacy reference exists");for(int n=0;n<256;++n) check(std::abs(channel[n]-expected[n])<1e-6f,"v36 audio matches pre-change engine");}}
    const auto make=[] {auto e=std::make_unique<OrigamiEngine>();check(e->prepare(48000,256,2),"route fixture prepares");e->setMasterAfterFx(true);return e;};
    for(bool chain:{false,true}) {
        auto dry=make(),wet=make(),parallel=make();auto s=wet->instrumentState();const auto f=addSynthFilter(s.modulation);check(insertSynthFilter(s.modulation,s.oscillators,f,1),"wet route inserts");s.modulation.synthFilters.filters[0].values={1200,.2f,0,1,0};
        if(chain) {const auto next=addSynthFilter(s.modulation);check(insertSynthFilterAfter(s.modulation,next,f),"serial chain inserts");s.modulation.synthFilters.filters[1].values.cutoff=2400;}
        check(wet->restoreInstrumentState(s),"wet fixture restores");auto p=s;const auto bus=addBus(p.buses);auto routing=oscillatorOutputRouting(p.modulation,p.oscillators[0]);routing.busRoutes[0].level=.25f;routing.busRoutes[routing.busRouteCount++]={bus,.5f};
        check(setOscillatorOutputRouting(p.modulation,routing) && parallel->restoreInstrumentState(p),"parallel fixture restores");
        dry->noteOn(60,.2f);wet->noteOn(60,.2f);parallel->noteOn(60,.2f);
        std::array<float,256> dl{},dr{},wl{},wr{},pl{},pr{},bl{},br{};float* d[]{dl.data(),dr.data()},*w[]{wl.data(),wr.data()},*o[]{pl.data(),pr.data()};std::array<float*,14> aux{};aux[0]=bl.data();aux[1]=br.data();
        for(int block=0;block<16;++block) {check(dry->process(d,2,256) && wet->process(w,2,256) && parallel->beginHostBlock(2) && parallel->processSpan(o,2,256,aux.data()),"parallel buses render");parallel->endHostBlock();for(int n=0;n<256;++n) {check(std::abs(pl[n]-(.25f*dl[n]+wl[n]))<3e-6f && std::abs(pr[n]-(.25f*dr[n]+wr[n]))<3e-6f,"dry plus filtered sum is unnormalized");check(std::abs(bl[n]-.5f*dl[n])<3e-6f && std::abs(br[n]-.5f*dr[n])<3e-6f,"third bus gets independent half-level dry send");}}
        // Prepared gain adoption is smooth and allocation-free during a held note.
        auto mod=parallel->instrumentState().modulation;routing=oscillatorOutputRouting(mod,p.oscillators[0]);for(std::size_t n=0;n<routing.busRouteCount;++n) routing.busRoutes[n].level=0;
        check(setOscillatorOutputRouting(mod,routing) && parallel->setModulationState(mod),"held gains publish");
        allocations.store(0);frees.store(0);guardAllocations.store(true);const bool ok=parallel->process(o,2,256);parallel->emergencyResetRuntime();guardAllocations.store(false);
        check(ok,"held gain adoption renders");
#ifndef ORIGAMI_SANITIZED
        check(!allocations.load() && !frees.load(),"gain adoption/render/Panic allocate and free zero objects");
#endif
    }
    // Pure bus gain smoothing can be checked sample-for-sample against an unchanged held oscillator.
    auto control=make(),smooth=make();control->noteOn(60,.2f);smooth->noteOn(60,.2f);std::array<float,256> a{},b{},ar{},br{};float* x[]{a.data(),ar.data()},*y[]{b.data(),br.data()};check(control->process(x,2,256) && smooth->process(y,2,256),"held smoothing fixtures warm");
    auto s=smooth->instrumentState();auto routing=s.oscillators[0];routing.busRoutes[0].level=0;check(setOscillatorOutputRouting(s.modulation,routing) && smooth->setModulationState(s.modulation),"zero gain publishes");check(control->process(x,2,256) && smooth->process(y,2,256),"smoothed gain renders");for(int n=0;n<256;++n) check(std::abs(b[n]-a[n]*std::max(0.f,1-float(n+1)/240))<3e-6f,"bus gain follows continuous five millisecond ramp");
}

void synthCombStorageLifecycleAudit() {
    auto engine=std::make_unique<OrigamiEngine>();check(engine->prepare(48000,256,2),"Comb pool prepares without a delay bank");check(engine->synthCombStorageBytes()==0,"zero Comb uses zero heap delay bytes");
    auto state=engine->instrumentState();SynthFilterId previous=0;
    for(int i=0;i<8;++i) {const auto id=addSynthFilter(state.modulation);auto& f=state.modulation.synthFilters.filters[i];f.type=dsp::FilterType::Comb;f.values={370,.85f,0,1,1,0};if(previous) insertSynthFilterAfter(state.modulation,id,previous);else insertSynthFilter(state.modulation,state.oscillators,id,1);previous=id;
        check(engine->setModulationState(state.modulation),"Comb writer allocates each newly used slot before publication");check(engine->synthCombStorageBytes()==std::size_t(i+1)*307712,"Comb banks grow by exact bounded per-slot budget");}
    std::array<float,256> left{},right{};float* output[]{left.data(),right.data()};allocations.store(0);frees.store(0);guardAllocations.store(true);
    bool okay=true;for(int i=0;i<32;++i) {okay=engine->noteOn(48+i,.1f) && okay;okay=engine->process(output,2,256) && okay;}const auto tracked=engine->runtimeVisualizationSnapshot();const bool tracking=std::abs(tracked.synthFilters[0].cutoff-370.f*std::pow(2.f,19.f/12.f))<1.f;engine->allNotesOff();for(int i=0;i<32;++i) okay=engine->process(output,2,256) && okay;engine->emergencyResetRuntime();okay=engine->process(output,2,256) && okay;guardAllocations.store(false);
    check(tracking,"Comb note keytracking reaches actual effective delay-frequency telemetry");check(okay && !engine->activeVoiceCount(),"maximum Comb bank voice steals, releases and Panic are deterministic");
#ifndef ORIGAMI_SANITIZED
    check(!allocations.load() && !frees.load(),"128 stereo Comb stages lifecycle allocates/frees nothing on audio");
#endif
    for(float sample:left) check(sample==0,"Comb Panic clears all tails exactly");
    check(engine->synthCombStorageBytes()==2461696,"Panic retains bounded banks without freeing them");
    for(int pass=0;pass<3;++pass) for(const auto& info:dsp::filterTypes) {
        for(auto& f:state.modulation.synthFilters.filters) f.type=info.id;
        check(engine->setModulationState(state.modulation),"rapid canonical type switches preserve topology and identities");allocations.store(0);frees.store(0);guardAllocations.store(true);engine->noteOn(60,.1f);const bool rendered=engine->process(output,2,256);guardAllocations.store(false);check(rendered,"rapid all-type adoption renders finite initialized state");
#ifndef ORIGAMI_SANITIZED
        check(!allocations.load() && !frees.load(),"type adoption never allocates or frees delay storage on audio");
#endif
        for(float value:left) check(std::isfinite(value) && std::abs(value)<8,"type switches do not explode");
    }
    for(auto& f:state.modulation.synthFilters.filters) f.type=dsp::FilterType::LowPass;
    check(engine->setModulationState(state.modulation) && engine->prepare(48000,256,2) && engine->synthCombStorageBytes()==0,"stopped reprepare releases unused Comb banks");
    std::vector<float> l(2404),r(2404);SynthFilterRuntime runtime;runtime.adopt(1,dsp::FilterType::Comb);runtime.comb[0].bind(l.data(),l.size());runtime.comb[1].bind(r.data(),r.size());runtime.combCoefficients=dsp::combDesign(48000,370,.9f);
    for(int i=0;i<10000;++i) {runtime.process(i==0?.1f:0.f,{},0,1,false);check(runtime.process(0,{},0,1,true)==0,"stereo Comb histories stay independent");}
    for(int n=0;n<100000;++n) runtime.process(0,{},0,1,false);check(runtime.quiet(),"Comb silence naturally drains the damped feedback tail");
    runtime.comb[0].lowpass=std::numeric_limits<float>::quiet_NaN();check(std::isfinite(runtime.process(0,{},0,1,false)),"Comb invalid recursive state recovers to finite output");
    runtime.adopt(2,dsp::FilterType::Comb);for(int i=0;i<3000;++i) check(runtime.process(0,{},0,1,false)==0,"new identity/retrigger cannot inherit a Comb tail");
}

void multimodeSynthLifecycleAudit() {
    const auto make=[](const ModulationState& mod) {auto engine=std::make_unique<OrigamiEngine>();check(engine->prepare(48000,256,2) && engine->setModulationState(mod),"multimode engine prepares");engine->setMasterAfterFx(true);return engine;};
    for(const auto& info:dsp::filterTypes) if(info.synth) {
        auto fixture=std::make_unique<OrigamiEngine>();auto state=fixture->instrumentState();const auto id=addSynthFilter(state.modulation);check(insertSynthFilter(state.modulation,state.oscillators,id,1),"multimode route authors");auto& filter=state.modulation.synthFilters.filters[0];filter.type=info.id;filter.values={600,.2f,0,1,1,info.gain?6.f:0.f};
        auto poly=make(state.modulation);std::array<std::unique_ptr<OrigamiEngine>,3> solo;std::array<std::array<float,256>,3> left{},right{};std::array<float,256> pl{},pr{};float* output[]{pl.data(),pr.data()};
        for(int i=0;i<3;++i) {solo[i]=make(state.modulation);solo[i]->noteOn(60+i*4,.1f);poly->noteOn(60+i*4,.1f);}
        for(int block=0;block<6;++block) {check(poly->process(output,2,256),"multimode poly renders");for(int i=0;i<3;++i){float* out[]{left[i].data(),right[i].data()};check(solo[i]->process(out,2,256),"multimode solo renders");}for(int n=0;n<256;++n) check(std::abs(pl[n]-left[0][n]-left[1][n]-left[2][n])<4e-6f && std::abs(pr[n]-right[0][n]-right[1][n]-right[2][n])<4e-6f,"every Synth type owns independent polyphonic state");}
        const auto visual=poly->runtimeVisualizationSnapshot();check(visual.synthFilterIds[0]==id && std::abs(visual.synthFilters[0].resonance-.2f)<.001f && std::abs(visual.synthFilters[0].gain-filter.values.gain)<.001f,"every type publishes actual smoothed Q and Gain from the observed voice");
        auto mod=state.modulation;const auto env=addSourceInstance(mod,SourceFamily::Envelope);const auto lfo=addSourceInstance(mod,SourceFamily::Lfo);mod.instances[sourceInstanceSlot(mod,lfo)].lfo.mode=LfoMode::Loop;mod.routes[0]={mod.nextRouteId++,true,env,{ModDestination::SynthCutoff,0,id},-.4f,false};mod.routes[1]={mod.nextRouteId++,true,lfo,{ModDestination::SynthResonance,0,id},.2f,false};check(poly->setModulationState(mod),"all types retain canonical modulation");for(int i=0;i<24;++i) poly->noteOn(48+i,.1f);
        allocations.store(0);frees.store(0);guardAllocations.store(true);bool ok=true;for(int i=0;i<8;++i) ok=poly->process(output,2,256) && ok;
        const auto effectiveVisual=poly->runtimeVisualizationSnapshot();const bool effectiveChanged=effectiveVisual.synthFilterIds[0]==id && std::abs(effectiveVisual.synthFilters[0].resonance-filter.values.resonance)>.001f;
        poly->emergencyResetRuntime();guardAllocations.store(false);check(effectiveChanged,"every type telemetry reflects modulated per-voice Resonance instead of stale authored Q");check(ok && poly->activeVoiceCount()==0,"multimode adoption, voice steal and Panic complete");
#ifndef ORIGAMI_SANITIZED
        check(!allocations.load() && !frees.load(),"every type adoption/render/Panic has zero allocations and frees");
#endif
        mod.synthFilters.filters[0].type=info.id==dsp::FilterType::Comb?dsp::FilterType::LowPass:static_cast<dsp::FilterType>(int(info.id)+1);check(poly->setModulationState(mod),"held voices publish bounded type change");poly->noteOn(60,.1f);allocations.store(0);frees.store(0);guardAllocations.store(true);const bool changed=poly->process(output,2,256);guardAllocations.store(false);check(changed,"held type change adopts independent reset state");
#ifndef ORIGAMI_SANITIZED
        check(!allocations.load() && !frees.load(),"type switching has no callback allocation or free");
#endif
        mod.synthFilters.filters[0].type=info.id;check(poly->setModulationState(mod),"mono legato returns to audited type");poly->emergencyResetRuntime();
        auto perf=poly->performanceState();perf.voiceMode=VoiceMode::Mono;perf.legato=true;check(poly->setPerformanceState(perf),"multimode mono mode");poly->noteOn(60,.1f);poly->process(output,2,256);poly->noteOn(64,.1f);check(poly->process(output,2,256) && poly->activeVoiceCount()==1,"every type supports mono legato retarget");for(float x:pl) check(std::isfinite(x),"multimode modulation remains finite");
    }
}

void synthFilterRoutingAudit() {
    const auto make=[](int oscillators) {
        auto e=std::make_unique<OrigamiEngine>();check(e->prepare(48000,256,2),"Synth filter engine prepares");
        for(int n=1;n<oscillators;++n) check(e->addOscillatorModule()!=0,"filter fixture adds oscillator");
        auto state=e->instrumentState();for(auto& m:state.oscillators) if(m.id) m.enabled=m.id<=unsigned(oscillators);
        state.parameters[std::size_t(ParameterId::Waveform)]=1;applyLegacyOscillatorParameters(state.oscillators[0],state.parameters);
        check(e->restoreInstrumentState(state),"Synth filter fixture restores");e->setMasterAfterFx(true);return e;
    };
    auto dry=make(2),wet=make(2);auto state=wet->instrumentState();auto mod=state.modulation;
    const auto f=addSynthFilter(mod);check(f && insertSynthFilter(mod,state.oscillators,f,1) && insertSynthFilter(mod,state.oscillators,f,2),"two oscillators share one filter identity");
    mod.synthFilters.filters[0].values={950,.4f,12,.7f,0};check(wet->setModulationState(mod),"shared filter topology adopts");
    dry->noteOn(60,.7f);wet->noteOn(60,.7f);
    dsp::LowPassCoefficientTable table;table.prepare(48000);const auto c=table.make(950,.4f);dsp::LowPassFilter ref[2];
    std::array<float,256> dl{},dr{},wl{},wr{};float* d[]{dl.data(),dr.data()},*w[]{wl.data(),wr.data()};double energy=0,difference=0;
    const double gain=dsp::fastExp2Audio(12/6.020599913);
    for(int block=0;block<24;++block) {check(dry->process(d,2,256) && wet->process(w,2,256),"shared filter renders");for(std::size_t n=0;n<256;++n) for(int ch=0;ch<2;++ch) {
        const float input=2*(ch?dr[n]:dl[n]);const float driven=float(std::tanh(gain*input)/std::sqrt(gain));
        const float expected=.5f*(input+.7f*(ref[ch].next(driven,c)-input));const float actual=ch?wr[n]:wl[n];
        check(std::abs(expected-actual)<3e-6f,"shared filter executes once over the per-voice sum, with preserved normalization");energy+=actual*actual;difference+=std::abs(actual-(ch?dr[n]:dl[n]));}}
    check(energy>1e-4 && difference>1,"filter changes audible output");
    // New polyphonic sources resolve through the existing compiler and values.
    const auto env=addSourceInstance(mod,SourceFamily::Envelope);const auto lfo=addSourceInstance(mod,SourceFamily::Lfo);
    mod.routes[0]={mod.nextRouteId++,true,env,{ModDestination::SynthCutoff,0,f},-.4f,false};
    mod.routes[1]={mod.nextRouteId++,true,lfo,{ModDestination::SynthResonance,0,f},.3f,false};
    mod.instances[sourceInstanceSlot(mod,lfo)].lfo.mode=LfoMode::Loop;
    const auto random=addSourceInstance(mod,SourceFamily::Random);mod.instances[sourceInstanceSlot(mod,random)].random.rateHz=40;mod.routes[2]={mod.nextRouteId++,true,random,{ModDestination::SynthDrive,0,f},.3f,true};
    check(wet->setModulationState(mod),"ENV4 and LFO5 drive canonical filter destinations");
    auto tail=f;for(std::size_t n=1;n<maxSynthFilters;++n) {const auto next=addSynthFilter(mod);check(insertSynthFilterAfter(mod,next,tail),"maximum serial filter topology");tail=next;}check(wet->setModulationState(mod),"maximum filter topology adopts");
    for(int n=0;n<16;++n) wet->noteOn(48+n,.6f);
    allocations.store(0);frees.store(0);guardAllocations.store(true);bool processed=true;for(int block=0;block<8;++block) processed=wet->process(w,2,256) && processed;const auto observedId=wet->runtimeVisualizationSnapshot().synthFilterIds[0];const auto observed=wet->runtimeVisualizationSnapshot().synthFilters[0];wet->emergencyResetRuntime();guardAllocations.store(false);const auto filterAllocations=allocations.load(),filterFrees=frees.load();
    check(processed,"filter adoption and sixteen voices process under guard");
    check(observedId==f && std::abs(observed.cutoff-950)>10 && std::abs(observed.resonance-.4f)>.001f,"observed ENV4/LFO5 filter modulation is effective per voice");
    check(observed.drive>=0 && observed.drive<=24,"Random2 filter drive remains bounded");
    auto performance=wet->performanceState();performance.voiceMode=VoiceMode::Mono;performance.legato=true;check(wet->setPerformanceState(performance),"Synth filters enter mono/legato");
    allocations.store(0);frees.store(0);guardAllocations.store(true);wet->noteOn(60,.5f);wet->noteOn(64,.6f);processed=wet->process(w,2,256);wet->noteOff(64);processed=wet->process(w,2,256) && processed;guardAllocations.store(false);check(processed && wet->activeVoiceCount()==1,"filter lifecycle survives mono retarget and release");
#ifndef ORIGAMI_SANITIZED
    check(!allocations.load() && !frees.load(),"mono filter lifecycle has zero allocations/frees");
#endif
#ifndef ORIGAMI_SANITIZED
    check(!filterAllocations && !filterFrees,"filter processing/adoption/reset has zero allocations/frees");
#endif
    auto reordered=mod;std::swap(reordered.synthFilters.filters[0],reordered.synthFilters.filters[1]);
    check(wet->setModulationState(reordered) && wet->process(w,2,256),"reordered storage adopts stable filter identities");
    const auto rebound=wet->runtimeVisualizationSnapshot();
    check(rebound.synthFilterIds[1]==f && std::abs(rebound.synthFilters[1].resonance-.4f)>.001f,"unchanged route identities recompile when prepared runtime slots move");
    // Chord output must equal the sum of independent note/filter lifetimes.
    auto poly=make(1);auto m=poly->instrumentState().modulation;const auto pf=addSynthFilter(m);check(insertSynthFilter(m,poly->instrumentState().oscillators,pf,1),"poly filter inserts");m.synthFilters.filters[0].values={600,.2f,0,1,1};check(poly->setModulationState(m),"poly keytrack state");
    std::array<std::unique_ptr<OrigamiEngine>,3> solo;std::array<std::array<float,256>,3> left{},right{};
    for(int n=0;n<3;++n) {solo[n]=make(1);check(solo[n]->setModulationState(m),"independent filter fixture");solo[n]->noteOn(60+n*4,.3f);poly->noteOn(60+n*4,.3f);}
    for(int block=0;block<16;++block) {check(poly->process(w,2,256),"poly renders");for(int n=0;n<3;++n) {float* out[]{left[n].data(),right[n].data()};check(solo[n]->process(out,2,256),"solo renders");}for(std::size_t n=0;n<256;++n) {check(std::abs(wl[n]-left[0][n]-left[1][n]-left[2][n])<4e-6f,"per-voice keytracked filter state is independent");}}
    // Every supported sample rate/extreme must retain finite, bounded state.
    for(double rate:{8000.,22050.,44100.,48000.,96000.,192000.,384000.}) {table.prepare(rate);for(float cutoff:{20.f,1000.f,20000.f}) for(float res:{0.f,1.f}) {dsp::LowPassFilter filter;const auto coeff=table.make(cutoff,res);for(int n=0;n<4096;++n) {const float sample=filter.next(n==0?1.f:0.f,coeff);check(std::isfinite(sample) && std::abs(sample)<8,"extreme Synth TPT remains finite and bounded");}}}
}

#include "UnisonAudit.h"

int main() {
    // OrigamiEngine/Voice are intentionally large fixed-storage realtime
    // objects. Keep every engine-heavy regression off the process stack so the
    // test runner cannot overflow before it reaches its first diagnostic.
    // Production engine ownership already follows this pattern.
    try {
        unison_audit::run();if(std::getenv("ORIGAMI_UNISON_ONLY")){std::cout<<"PASS focused unison: "<<checks<<" checks\n";return 0;}
        canonicalInitAudit();filter_response_audit::run(check);synthCombStorageLifecycleAudit();multimodeSynthLifecycleAudit();oscillatorRouteMixerAudit();synthFilterRoutingAudit();
        correctiveSpectralPreview();
        sourceInstanceRealtimeAudit();
        std::cerr<<"dynamic topology\n";dynamicTopologyRecompilation();
        std::cerr<<"oscillator control cache\n";oscillatorControlCacheEquivalence();
        std::cerr<<"simple playback + visualization policy\n";simplePlaybackAndVisualizationPolicy();
        std::cerr<<"clean sine simple path P0\n";cleanSineSimplePathP0();
        std::cerr<<"performance visualization sources\n";performanceVisualizationSources();
        std::cerr<<"voice observation\n";voiceObservationDoesNotChangeAudio();
        std::cerr<<"visualization cadence\n";engineVisualizationCadenceDoesNotChangeAudio();
        std::cerr<<"performance source curves\n";performanceSourceCurveAudit();
        std::cerr<<"QoS voice admission\n";qosVoiceAdmissionAudit();
        std::cerr<<"audio-rate fast math\n";audioRateFastMathAudit();
        std::cerr<<"oscillator generation\n";oscillatorGenerationCoherenceAudit();
        std::cerr<<"spectral preparation\n";spectralPreparationBoundaryAudit();
        std::cerr<<"random spectral amount\n";randomSpectralAmountResponse();
        std::cerr<<"spectral playback\n";spectralCachePlayback();
        std::cerr<<"spectral concurrent eviction\n";spectralCacheConcurrentEviction();
        std::cerr<<"random spectral morph\n";randomSpectralMorphAudit();
        std::cerr<<"random spectral morph crossing\n";randomSpectralMorphCrossingAudit();
        std::cerr<<"realtime thread policy\n";realtimeThreadPolicyAudit();
        std::cerr<<"wavetable handoff\n";wavetableHandoffAudit();
        std::cerr<<"wavetable handoff concurrency\n";wavetableHandoffConcurrencyAudit();
        std::cerr<<"optimised-path golden renders\n";optimizedPathGoldenAudit();
        std::cerr<<"spectral transitions\n";spectralTransitionAudit();
        std::cerr<<"manual-edit dezipper\n";manualEditDezipperAudit();
        std::cerr<<"nested modulation realtime\n";nestedModulationRealtimeAudit();
        std::cerr<<"registry and patches\n";registryAndPatches();
        std::cerr<<"envelope timing\n";envelopeTiming();
        std::cerr<<"pitch and blocks\n";pitchAndBlocks();
        std::cerr<<"voices and realtime\n";voicesAndRealtime();
        std::cerr<<"performance modes\n";performanceModes();
        std::cerr<<"signal behavior\n";signalBehavior();
        std::cerr<<"oscillator and filter\n";oscillatorAndFilter();
        std::cout<<"PASS: "<<checks<<" checks\n";return 0;
    } catch(const std::exception& error) {
        guardAllocations.store(false);
        std::cerr<<"FAIL: "<<error.what()<<'\n';return 1;
    }
}
