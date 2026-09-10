#include "core/Engine.h"
#include "core/preset/Patch.h"
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <limits>
#include <new>
#include <sstream>
#include <stdexcept>
#include <vector>
namespace { std::atomic<bool> guardAllocations {false}; std::atomic<unsigned> allocations {0}; }
#ifndef ORIGAMI_SANITIZED
// ASan owns allocation interception; count realtime allocations in normal builds.
void* operator new(std::size_t size) { if(guardAllocations.load()) ++allocations; if(void* p=std::malloc(size?size:1)) return p; throw std::bad_alloc(); }
void* operator new[](std::size_t size) { return ::operator new(size); }
void operator delete(void* p) noexcept { std::free(p); }
void operator delete[](void* p) noexcept { std::free(p); }
void operator delete(void* p, std::size_t) noexcept { std::free(p); }
void operator delete[](void* p, std::size_t) noexcept { std::free(p); }
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
    OrigamiEngine engine;check(!engine.setParameter("missing",1),"invalid string ID");check(!engine.setParameter(static_cast<ParameterId>(500),1),"invalid numeric ID");
    check(!engine.setParameter(ParameterId::Cutoff,std::numeric_limits<float>::quiet_NaN()),"reject NaN");
    check(!engine.setParameter(ParameterId::MasterGain,std::numeric_limits<float>::infinity()),"reject infinity");
    set(engine,ParameterId::MasterGain,50);check(engine.parameterState()[9]==1,"gain clamped");
    std::ifstream input(ORIGAMI_INIT_PATCH);std::ostringstream text;text<<input.rdbuf();check(bool(input),"read canonical Init");
    Patch patch;std::string error;check(parsePatch(text.str(),patch,error),"parse Init");check(patch.parameters==defaultParameters(),"Init equals defaults");
    Patch decoded;check(parsePatch(serializePatch(patch),decoded,error),"JSON round trip");check(decoded.parameters==patch.parameters && decoded.name=="Init","exact float round trip");
    patch.name="MCT 雪 \"one\"\n";check(parsePatch(serializePatch(patch),decoded,error) && decoded.name==patch.name,"UTF-8 and escaping");
    const auto before=decoded.parameters;
    for(const std::string invalid:{"{}","{\"format\":\"other\"}","{\"version\":2}","{\"name\":\"\\ud800\"}","{\"version\":01}","{\"version\":NaN}"}) check(!parsePatch(invalid,decoded,error) && decoded.parameters==before && !error.empty(),"invalid JSON unchanged");
    std::string bad=text.str();bad.replace(bad.find("8000"),4,"1e999");check(!parsePatch(bad,decoded,error),"huge exponent rejected");
    bad=text.str();bad.insert(bad.find("\"osc.1.level\""),"\"osc.1.waveform\": 2,\n");check(!parsePatch(bad,decoded,error),"duplicate parameters rejected");
    check(engine.applyPatchState(patch.parameters),"apply patch state");auto invalid=patch.parameters;invalid[0]=std::numeric_limits<float>::quiet_NaN();check(!engine.applyPatchState(invalid) && engine.parameterState()==patch.parameters,"invalid state transactional");
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
        OrigamiEngine engine;prepare(engine,rate);set(engine,ParameterId::Waveform,0);set(engine,ParameterId::Sustain,1);engine.reset();
        check(engine.noteOn(note,.8f),"note accepted");const auto output=render(engine,static_cast<std::size_t>(rate));
        check(energy(output)>.01,"audible output");
        std::vector<std::size_t> crossings;
        for(std::size_t i=static_cast<std::size_t>(rate/4)+1;i<output.size();++i) if(output[i-1]<=0 && output[i]>0) crossings.push_back(i);
        check(crossings.size()>100,"pitch crossings");const double frequency=rate*double(crossings.size()-1)/double(crossings.back()-crossings.front());
        check(std::abs(frequency-dsp::midiFrequency(note))<.1,"rendered MIDI frequency");
        engine.noteOff(note);render(engine,static_cast<std::size_t>(rate));check(engine.activeVoiceCount()==0,"release eventually inactive");check(energy(render(engine,128))==0,"release silence");
    }
    OrigamiEngine engine;prepare(engine);engine.noteOn(60,1);const auto reference=render(engine,4000,4000);
    for(std::size_t block:{1u,7u,127u,128u,257u,511u,1024u}) {engine.reset();engine.noteOn(60,1);check(render(engine,4000,block)==reference,"block partition invariance");}
    engine.reset();check(engine.activeVoiceCount()==0 && energy(render(engine,321))==0,"reset clears all state");
    check(!engine.noteOn(128,1) && !engine.noteOn(-1,1) && !engine.noteOn(60,NAN),"invalid notes rejected");
    check(engine.noteOn(0,1) && engine.noteOn(127,1),"full MIDI range");
}
void voicesAndRealtime() {
    OrigamiEngine engine;prepare(engine);
    for(int i=0;i<16;++i) engine.noteOn(48+i,.5f);
    check(engine.activeVoiceCount()==16,"16 voices");engine.noteOn(90,.8f);check(engine.voiceInfo(0).address.note==90,"oldest voice stolen");
    engine.noteOff(55);engine.noteOn(91,.8f);check(engine.voiceInfo(7).address.note==91,"releasing voice stolen first");
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
void signalBehavior() {
    OrigamiEngine engine;
    float empty[8]; std::fill_n(empty,8,1.f); float* emptyPointer=empty;
    check(!engine.process(&emptyPointer,1,8) && std::all_of(std::begin(empty),std::end(empty),[](float v){return v==0;}),"unprepared output silent");
    check(!engine.prepare(NAN,256,2) && !engine.prepare(48000,0,2) && !engine.prepare(48000,256,3),"invalid preparation rejected");
    prepare(engine);
    for(int waveform=0;waveform<4;++waveform) {
        set(engine,ParameterId::Waveform,static_cast<float>(waveform));engine.reset();engine.noteOn(69,1);
        check(energy(render(engine,4000))>.001,"each waveform audible");
    }
    engine.reset();engine.noteOn(69,1);const auto loud=energy(render(engine,5000));
    engine.reset();engine.noteOn(69,.5f);const auto quiet=energy(render(engine,5000));
    check(std::abs(quiet/loud-.25)<1e-5,"linear velocity amplitude");
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
int main() {
    try {std::cerr<<"registry and patches\n";registryAndPatches();std::cerr<<"envelope timing\n";envelopeTiming();std::cerr<<"pitch and blocks\n";pitchAndBlocks();std::cerr<<"voices and realtime\n";voicesAndRealtime();std::cerr<<"signal behavior\n";signalBehavior();std::cerr<<"oscillator and filter\n";oscillatorAndFilter();std::cout<<"PASS: "<<checks<<" checks\n";return 0;}
    catch(const std::exception& error) {guardAllocations.store(false);std::cerr<<"FAIL: "<<error.what()<<'\n';return 1;}
}
