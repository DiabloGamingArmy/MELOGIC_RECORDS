// B01: deterministic adversarial tests of production DSP and host boundaries.
// No timing-based correctness gates, no test-only reductions of requested load.
#include "plugin/PluginProcessor.h"
#include "plugin/ui/UserPreferences.h"
#include "core/preset/StateCodec.h"
#include "core/dsp/Unison.h"
#include "tests/NodesScenarios.h"
#include <algorithm>
#include <chrono>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <iostream>
#include <limits>
#include <memory>
#include <new>
#include <stdexcept>
#include <string>
#include <vector>
#if defined(__APPLE__)
#include <dlfcn.h>
#include <mach/mach.h>
#endif
using namespace mct::origami;
namespace probe {
thread_local bool enabled=false;
thread_local unsigned allocations=0,frees=0;
#if defined(__APPLE__) && !defined(ORIGAMI_SANITIZED)
// Optional test-process-only libmalloc observation. Includes JUCE's C realloc,
// which a C++ operator-new guard alone misses. ABI: Apple's libmalloc malloc.c.
// https://github.com/apple-oss-distributions/libmalloc/blob/main/src/malloc.c
using Logger=void(*)(std::uint32_t,std::uintptr_t,std::uintptr_t,std::uintptr_t,std::uintptr_t,std::uint32_t);
Logger* slot=nullptr;Logger previous=nullptr;
void logger(std::uint32_t type,std::uintptr_t a,std::uintptr_t b,std::uintptr_t c,std::uintptr_t result,std::uint32_t skip) {
    if(enabled){allocations+=(type&2)!=0;frees+=(type&4)!=0;}
    if(previous)previous(type,a,b,c,result,skip);
}
struct Install {
    Install(){slot=reinterpret_cast<Logger*>(dlsym(RTLD_DEFAULT,"malloc_logger"));if(slot){previous=*slot;*slot=&logger;}}
    ~Install(){if(slot)*slot=previous;}
};
#else
struct Install {};
#endif
struct Guard {Guard(){allocations=frees=0;enabled=true;}~Guard(){enabled=false;}};
}
#ifndef ORIGAMI_SANITIZED
void* operator new(std::size_t n){if(probe::enabled)++probe::allocations;if(void* p=std::malloc(n?n:1))return p;throw std::bad_alloc();}
void* operator new[](std::size_t n){return ::operator new(n);}
void operator delete(void* p) noexcept {if(p && probe::enabled)++probe::frees;std::free(p);}
void operator delete[](void* p) noexcept {::operator delete(p);}
void operator delete(void* p,std::size_t) noexcept {::operator delete(p);}
void operator delete[](void* p,std::size_t) noexcept {::operator delete(p);}
#endif
namespace {
constexpr double rates[]{44100,48000,88200,96000,192000};
constexpr int blocks[]{1,2,3,8,16,17,32,63,64,127,128,256,257,512,1024,2048};
std::uint64_t checks=0,samples=0,callbacks=0;
std::string context;
void require(bool value,const std::string& message){++checks;if(!value)throw std::runtime_error(context+": "+message);}
struct Random {std::uint32_t seed=0xb010cafe;unsigned next(unsigned n){seed=seed*1664525u+1013904223u;return n?(seed>>8)%n:0;}float unit(){return float(next(65536))/65535.f;}};
struct Stats {
    double peak=0,power=0,sum=0;std::uint64_t count=0;
    void inspect(const float* l,const float* r,int n,double bound){
        bool finite=true,normal=true;double maximum=0;
        for(int i=0;i<n;++i)for(float x:{l[i],r[i]}){finite&=std::isfinite(x);normal&=std::fpclassify(x)!=FP_SUBNORMAL;maximum=std::max(maximum,std::abs(double(x)));sum+=x;power+=double(x)*x;++count;}
        samples+=std::uint64_t(n)*2;peak=std::max(peak,maximum);
        require(finite,"every sample finite");require(normal,"no subnormal output under production FTZ policy");require(maximum<=bound,"amplitude "+std::to_string(maximum)+" exceeds fixture bound "+std::to_string(bound));
    }
    double rms()const{return count?std::sqrt(power/double(count)):0;}
};
void noHeap(){
#ifndef ORIGAMI_SANITIZED
    require(probe::allocations==0 && probe::frees==0,"callback heap activity alloc="+std::to_string(probe::allocations)+" free="+std::to_string(probe::frees));
#endif
}
InstrumentState sine(unsigned oscillators=1,unsigned unison=1){auto s=canonicalInitState();s.parameters[std::size_t(ParameterId::Waveform)]=0;s.parameters[std::size_t(ParameterId::OscUnison)]=float(unison);s.parameters[std::size_t(ParameterId::OscDetune)]=0;s.parameters[std::size_t(ParameterId::MasterGain)]=.1f;s.parameters[std::size_t(ParameterId::Release)]=.005f;
    for(unsigned i=0;i<oscillators;++i){auto& o=s.oscillators[i];o=s.oscillators[0];o.id=i+1;o.enabled=true;o.wtPosition=o.waveform=0;o.phaseMode=OscillatorPhaseMode::Fixed;o.unison=unison;o.detuneCents=0;o.blend=1;}s.nextId=oscillators+1;return s;}
void engineBlock(OrigamiEngine& e,float* l,float* r,int n,Stats& stats,double bound=16){float* out[]{l,r};bool ok;{probe::Guard g;ok=e.process(out,2,std::size_t(n));}noHeap();require(ok,"engine renders");++callbacks;stats.inspect(l,r,n,bound);}
void hostBlock(OrigamiAudioProcessor& p,juce::AudioBuffer<float>& audio,juce::MidiBuffer& midi,Stats& stats,double bound=32){audio.clear();{probe::Guard g;p.processBlock(audio,midi);}noHeap();++callbacks;stats.inspect(audio.getReadPointer(0),audio.getReadPointer(1),audio.getNumSamples(),bound);}
void matrix(){
    for(double rate:rates){
        // Strict sine reference after attack/decay; normalized least-squares
        // tone residual detects crunch/noise/harmonics without phase assumptions.
        auto e=std::make_unique<OrigamiEngine>();require(e->prepare(rate,2048,2),"prepare sine");require(e->restoreInstrumentState(sine()),"restore sine");require(e->noteOn(69,.8f),"sine note");
        std::array<float,2048> l{},r{};Stats stats;double ss=0,cc=0,sc=0,xs=0,xc=0,xx=0,dc=0;std::uint64_t used=0,position=0;
        for(int b=0;position<std::uint64_t(rate*2);++b){const int n=blocks[b%16];context="sine rate="+std::to_string(rate)+" block="+std::to_string(n);engineBlock(*e,l.data(),r.data(),n,stats,.2);
            for(int i=0;i<n;++i,++position)if(position>=std::uint64_t(rate)){const double a=2*juce::MathConstants<double>::pi*440*double(position)/rate,s=std::sin(a),c=std::cos(a),x=l[std::size_t(i)];ss+=s*s;cc+=c*c;sc+=s*c;xs+=x*s;xc+=x*c;xx+=x*x;dc+=x;++used;}}
        const double determinant=ss*cc-sc*sc,a=(xs*cc-xc*sc)/determinant,b=(xc*ss-xs*sc)/determinant,residual=std::max(0.,xx-a*xs-b*xc)/xx;
        require(residual<1e-7,"pure sine spectral residual "+std::to_string(residual));require(std::abs(dc/double(used))<1e-4,"sine DC");require(stats.rms()>.02,"sine audible");
        for(int block:blocks){context="matrix rate="+std::to_string(rate)+" block="+std::to_string(block);require(e->prepare(rate,std::size_t(block),2),"reprepare");require(e->restoreInstrumentState(sine(3,16)),"three OSC sixteen unison");for(int note=0;note<16;++note)require(e->noteOn(40+note,.2f),"admit MIDI voice");require(e->activeVoiceCount()==16,"full requested polyphony");
            for(int k=0;k<16;++k){require(e->setParameter(ParameterId::OscUnison,float(std::array<int,7>{1,2,3,4,8,12,16}[std::size_t(k)%7])),"count automation");require(e->setParameter(ParameterId::OscDetune,float(k%3)*50),"detune automation");e->pitchWheel(std::uint8_t(k%16),k%2?0:16383);engineBlock(*e,l.data(),r.data(),block,stats);}
            e->allNotesOff();for(int k=0;k<int(rate*.03/block)+1;++k)engineBlock(*e,l.data(),r.data(),block,stats);require(e->activeVoiceCount()==0,"release has no stuck voices");engineBlock(*e,l.data(),r.data(),block,stats);require(std::all_of(l.begin(),l.begin()+block,[](float x){return x==0;}),"release reaches exact silence");
        }
    }
}
void oscillator(){
    std::array<float,2048> l{},r{};Stats stats;
    for(auto phase:{OscillatorPhaseMode::Natural,OscillatorPhaseMode::Fixed,OscillatorPhaseMode::Random,OscillatorPhaseMode::Free})for(unsigned count:{1u,2u,3u,4u,8u,12u,16u})for(float detune:{0.f,50.f,100.f}){
        context="unison count="+std::to_string(count)+" phase="+std::to_string(unsigned(phase))+" detune="+std::to_string(detune);auto e=std::make_unique<OrigamiEngine>();require(e->prepare(192000,2048,2),"prepare");auto s=sine(1,count);s.parameters[std::size_t(ParameterId::OscDetune)]=detune;s.oscillators[0].detuneCents=detune;s.oscillators[0].phaseMode=phase;s.oscillators[0].phaseDegrees=360;s.oscillators[0].randomPhaseDegrees=count%2?0:360;s.oscillators[0].phasePerUnison=count%2==0;require(e->restoreInstrumentState(s),"restore");
        double logSum=0;for(unsigned u=0;u<count;++u)logSum+=std::log2(dsp::unisonRatio(u,count,detune));require(std::abs(logSum)<1e-6,"geometric tuning centered");
        for(int note:{0,60,127}){require(e->noteOn(note,.8f),"extreme note");for(int b=0;b<4;++b){require(e->setParameter(ParameterId::OscPan,b%2?-1:1),"hard pan");require(e->setParameter(ParameterId::Waveform,float(b)),"Basic Shapes frame");engineBlock(*e,l.data(),r.data(),2048,stats,1);}e->allNotesOff();}
    }
    // All implemented OSC CHAIN types, both endpoint amounts; actual voice path.
    for(unsigned type=0;type<unsigned(dsp::OscProcessType::Count);++type){context="OSC CHAIN type="+std::to_string(type);auto e=std::make_unique<OrigamiEngine>();require(e->prepare(48000,2048,2),"prepare chain");auto s=sine();auto& o=s.oscillators[0];o.processCount=1;o.nextProcessId=2;o.processes[0]={1,static_cast<dsp::OscProcessType>(type),dsp::oscProcessAmountMinimum(static_cast<dsp::OscProcessType>(type)),0xb01u,true};require(e->restoreInstrumentState(s),"restore chain min");e->noteOn(127,.8f);engineBlock(*e,l.data(),r.data(),2048,stats,1);o.processes[0].amount=1;require(e->restoreInstrumentState(s),"restore chain max");e->noteOn(0,.8f);for(int b=0;b<4;++b)engineBlock(*e,l.data(),r.data(),2048,stats,1);}
    // Maximum supported 16 x 16 x 16 = 4096 oscillator lanes. Core engine has
    // no time-dependent admission policy, so verify the exact requested load.
    for(unsigned oscillators:{1u,4u,16u})for(unsigned voices:{1u,8u,16u}){
        context="scaling OSC="+std::to_string(oscillators)+" voices="+std::to_string(voices);
        auto e=std::make_unique<OrigamiEngine>();require(e->prepare(48000,2048,2),"prepare maximum");require(e->restoreInstrumentState(sine(oscillators,16)),"maximum restore");for(unsigned i=0;i<voices;++i)require(e->noteOn(48+i,.1f),"admit scaling voice");
        for(int b=0;b<8;++b)engineBlock(*e,l.data(),r.data(),2048,stats,32);
        std::array<double,64> times{};float* out[]{l.data(),r.data()};
        for(auto& time:times){bool ok;{probe::Guard g;const auto start=std::chrono::steady_clock::now();ok=e->process(out,2,2048);time=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-start).count();}noHeap();require(ok,"scaling renders");++callbacks;stats.inspect(l.data(),r.data(),2048,32);}
        const auto load=e->renderLoad();require(load.activeVoices==voices && load.activeModules==oscillators && load.totalUnison==16*oscillators,"requested workload remains admitted");std::sort(times.begin(),times.end());
        std::cout<<"  scaling "<<voices<<" voices x "<<oscillators<<" OSC x 16 unison = "<<voices*oscillators*16<<" lanes: median="<<times[32]<<" p99="<<times[63]<<" ms/2048 (48k deadline=42.667ms)\n";
    }
}
void filters(){
    juce::ScopedNoDenormals ftz;Random random;
    for(double rate:rates)for(const auto& type:dsp::filterTypes){context="filter "+std::string(type.name)+" rate="+std::to_string(rate);dsp::LowPassFilter filter;dsp::CombState comb;std::vector<float> ring(std::size_t(rate/20)+4);comb.bind(ring.data(),ring.size());Stats stats;std::array<float,257> l{},r{};
        for(int b=0;b<256;++b){const float freq=b%4==0?20:b%4==1?20000:20+random.unit()*19980,res=b%2?1.f:0.f,gain=b%2?24.f:-24.f;const auto base=dsp::LowPassCoefficients::make(rate,freq,res);const auto c=dsp::filterDesign(type.id,base,gain);const auto cc=dsp::combDesign(rate,freq,dsp::combFeedback(res));
            for(int i=0;i<257;++i){const float x=b<128?float(std::sin((b*257+i)*.013)):.0f;l[std::size_t(i)]=type.id==dsp::FilterType::Comb?comb.next(x,cc):filter.next(x,c);r[std::size_t(i)]=l[std::size_t(i)];}stats.inspect(l.data(),r.data(),257,256);}
        require(stats.peak>0,"filter has processed input");
    }
}
// Independent double-state oracle for extreme EQ gain. Eight valid resonant
// sections can exceed an arbitrary full-scale ceiling without being unstable.
// Compare the actual waveform to the linear transfer recurrence instead of
// clipping it or treating requested amplification as numerical corruption.
struct EqReference {
    struct Band {float f=0,g=0,q=0;int type=-1;bool on=false;double state[2][2]{};double a1=0,a2=0,a3=0,m0=0,m1=0,m2=0;};
    std::array<Band,8> bands{};bool primed=false;double rate=48000;float alpha=0;
    explicit EqReference(double sr):rate(sr),alpha(float(std::exp(-1/(sr*.03)))){}
    void process(const fx::FxEffectDescriptor& d,const float* params,const float* inL,const float* inR,double* outL,double* outR,int n){
        for(std::size_t i=0;i<8;++i){auto& b=bands[i];const auto base=i*5;const bool on=fx::fxChoiceIndex(d.parameters[base],params[base])==1;const int type=fx::fxChoiceIndex(d.parameters[base+1],params[base+1]);if(on!=b.on || type!=b.type)std::memset(b.state,0,sizeof(b.state));b.on=on;b.type=type;
            if(!primed){b.f=std::log(fx::fxParameterValue(d.parameters[base+2],params[base+2]));b.g=fx::fxParameterValue(d.parameters[base+3],params[base+3]);b.q=fx::fxParameterValue(d.parameters[base+4],params[base+4]);}}
        primed=true;const auto smooth=[&](float& v,float t){v=t+(v-t)*alpha;if(std::abs(v-t)<1e-7f)v=t;};
        for(int sample=0;sample<n;++sample){double x[2]{inL[sample],inR[sample]};
            for(std::size_t i=0;i<8;++i){auto& b=bands[i];const auto base=i*5;smooth(b.f,std::log(fx::fxParameterValue(d.parameters[base+2],params[base+2])));smooth(b.g,fx::fxParameterValue(d.parameters[base+3],params[base+3]));smooth(b.q,fx::fxParameterValue(d.parameters[base+4],params[base+4]));if(!b.on)continue;
                if((sample&31)==0){const double f=std::clamp(double(std::exp(b.f)),10.,rate*.49),A=std::pow(10.,double(b.g)/40),q=std::clamp(double(b.q),.1,40.);double g=std::tan(juce::MathConstants<double>::pi*f/rate),k=1/q;b.m0=0;b.m1=0;b.m2=1;
                    switch(b.type){case 0:b.m0=1;b.m1=-k;b.m2=-1;break;case 1:g/=std::sqrt(A);b.m0=1;b.m1=k*(A-1);b.m2=A*A-1;break;case 2:k/=A;b.m0=1;b.m1=k*(A*A-1);b.m2=0;break;case 3:b.m0=1;b.m1=-k;b.m2=0;break;case 4:g*=std::sqrt(A);b.m0=A*A;b.m1=k*(1-A)*A;b.m2=1-A*A;break;default:break;}
                    b.a1=1/(1+g*(g+k));b.a2=g*b.a1;b.a3=g*g*b.a1;}
                for(int c=0;c<2;++c){const double v3=x[c]-b.state[c][1],v1=b.a1*b.state[c][0]+b.a2*v3,v2=b.state[c][1]+b.a2*b.state[c][0]+b.a3*v3;b.state[c][0]=2*v1-b.state[c][0];b.state[c][1]=2*v2-b.state[c][1];x[c]=b.m0*x[c]+b.m1*v1+b.m2*v2;}}
            outL[sample]=x[0];outR[sample]=x[1];}
    }
};
void effects(){
    juce::ScopedNoDenormals ftz;Random random;
    for(double rate:rates)for(const auto& d:fx::fxEffectCatalog())if(d.processesAudio){context="effect "+std::string(d.key)+" rate="+std::to_string(rate);auto processor=d.create();processor->prepare(rate);processor->reset();std::array<float,fx::maxFxParameters> p{};for(std::size_t i=0;i<d.parameterCount;++i)p[i]=d.parameters[i].defaultValue;
        std::array<float,2048> l{},r{};std::array<double,2048> referenceL{},referenceR{};EqReference reference(rate);Stats stats;std::uint64_t offset=0;
        // Defaults, all min/max, alternating corners, random; then every
        // enumerated mode individually with other parameters at defaults.
        std::vector<std::array<float,fx::maxFxParameters>> settings{p};for(int k=0;k<4;++k){auto v=p;for(std::size_t i=0;i<d.parameterCount;++i)v[i]=k==0?0:k==1?1:k==2?float(i%2):random.unit();settings.push_back(v);}for(std::size_t i=0;i<d.parameterCount;++i)for(int choice=0;choice<d.parameters[i].choices;++choice){auto v=p;v[i]=fx::fxChoiceNormalized(d.parameters[i],choice);settings.push_back(v);}
        for(const auto& values:settings)for(int n:blocks){for(int i=0;i<n;++i){l[std::size_t(i)]=offset%4==0?0:offset%4==1?float(std::sin(double(offset+i)*.03))*.25f:offset%4==2?8.f*float(std::sin(double(offset+i)*.27)):0; r[std::size_t(i)]=-l[std::size_t(i)]*.5f;}
            if(d.type==fx::FxEffectType::Equalizer)reference.process(d,values.data(),l.data(),r.data(),referenceL.data(),referenceR.data(),n);
            {probe::Guard g;processor->process(l.data(),r.data(),n,values.data());}noHeap();++callbacks;
            double bound=65536;
            if(d.type==fx::FxEffectType::Equalizer){double expected=0,error=0;for(int i=0;i<n;++i){expected=std::max({expected,std::abs(referenceL[std::size_t(i)]),std::abs(referenceR[std::size_t(i)])});error=std::max({error,std::abs(double(l[std::size_t(i)])-referenceL[std::size_t(i)]),std::abs(double(r[std::size_t(i)])-referenceR[std::size_t(i)])});}
                require(error<=expected*.005+1e-5,"EQ waveform matches double-state reference (0.5% / 1e-5 absolute), error="+std::to_string(error)+" reference peak="+std::to_string(expected));bound=expected*1.005+1e-5;}
            stats.inspect(l.data(),r.data(),n,bound);offset+=std::uint64_t(n);}
        processor->reset();for(int b=0;b<int(rate*2/2048)+1;++b){l.fill(0);r.fill(0);processor->process(l.data(),r.data(),2048,p.data());stats.inspect(l.data(),r.data(),2048,65536);}Stats settled;settled.inspect(l.data(),r.data(),2048,1e-7);
        std::cout<<"  "<<d.key<<" @ "<<rate<<" peak="<<stats.peak<<" settings="<<settings.size()<<'\n';
    }
}
juce::MemoryBlock state(OrigamiAudioProcessor& p){juce::MemoryBlock s;p.getStateInformation(s);return s;}
void midi(){
    auto owner=std::make_unique<OrigamiAudioProcessor>();auto& p=*owner;p.prepareToPlay(48000,128);require(p.setUiParameter(ParameterId::Release,.005f),"short release");Stats stats;juce::AudioBuffer<float> audio(2,257);juce::MidiBuffer messages;
    for(int b=0;b<256;++b){context="host MIDI flood block="+std::to_string(b);messages.clear();for(int k=0;k<128;++k){const int channel=1+(k%16),note=(b+k)%128,at=k*2;messages.addEvent(k%3?juce::MidiMessage::noteOn(channel,note,.1f):juce::MidiMessage::noteOff(channel,note),at);messages.addEvent(juce::MidiMessage::pitchWheel(channel,k%2?0:16383),at);messages.addEvent(juce::MidiMessage::controllerEvent(channel,64,k%2?127:0),at);}hostBlock(p,audio,messages,stats);require(p.getUiRenderBudgetSnapshot().load.activeVoices<=16,"bounded voice count");}
    messages.clear();for(int c=1;c<=16;++c)messages.addEvent(juce::MidiMessage::allNotesOff(c),0);hostBlock(p,audio,messages,stats);messages.clear();for(int b=0;b<32;++b)hostBlock(p,audio,messages,stats);require(p.getUiRenderBudgetSnapshot().load.activeVoices==0 && audio.getMagnitude(0,audio.getNumSamples())==0,"flood releases to silence");
    // Large valid host input must not grow MIDI scratch storage in the callback.
    context="oversized MIDI input";messages.ensureSize(4*1024*1024);for(int k=0;k<100000;++k)messages.addEvent(juce::MidiMessage::noteOff(1,k%128),0);messages.addEvent(juce::MidiMessage::noteOn(1,60,.7f),256);const auto eventCount=messages.getNumEvents();hostBlock(p,audio,messages,stats);
    require(messages.getNumEvents()==eventCount,"host MIDI remains unchanged");require(p.getUiRenderBudgetSnapshot().load.activeVoices==1,"last event of oversized input is delivered");messages.clear();hostBlock(p,audio,messages,stats);require(audio.getMagnitude(0,257)>0,"oversized input final note renders");
    context="long SysEx input";messages.clear();std::vector<juce::uint8> sysex(3000000,1);messages.addEvent(juce::MidiMessage::createSysExMessage(sysex.data(),int(sysex.size())),0);hostBlock(p,audio,messages,stats);
    context="panic/recovery";messages.clear();messages.addEvent(juce::MidiMessage::noteOn(16,127,.7f),0);hostBlock(p,audio,messages,stats);p.requestPanic();hostBlock(p,audio,messages,stats);require(audio.getMagnitude(0,audio.getNumSamples())==0,"panic ignores queued note");hostBlock(p,audio,messages,stats);require(audio.getMagnitude(0,audio.getNumSamples())>0,"note after panic works");
}
void arpStop(){
    for(bool soundOff:{false,true}){
    context="ARP all-notes-off";auto owner=std::make_unique<OrigamiAudioProcessor>();auto& p=*owner;p.prepareToPlay(48000,2048);require(p.setUiParameter(ParameterId::Release,.005f),"release");auto arp=p.getUiArpeggiatorState();arp.enabled=true;arp.latch=true;arp.syncToDaw=false;arp.internalTempo=400;require(p.setUiArpeggiatorState(arp),"latched ARP");Stats stats;juce::AudioBuffer<float> audio(2,2048);juce::MidiBuffer midi;midi.addEvent(juce::MidiMessage::noteOn(1,60,.3f),0);hostBlock(p,audio,midi,stats);midi.clear();midi.addEvent(soundOff?juce::MidiMessage::allSoundOff(1):juce::MidiMessage::allNotesOff(1),0);hostBlock(p,audio,midi,stats);midi.clear();for(int b=0;b<48;++b)hostBlock(p,audio,midi,stats);require(p.getUiRenderBudgetSnapshot().load.activeVoices==0 && audio.getMagnitude(0,2048)==0,"all-notes/sound-off clears latched ARP and cannot retrigger");
    midi.ensureSize(4*1024*1024);for(int k=0;k<100000;++k)midi.addEvent(juce::MidiMessage::noteOff(1,k%128),0);midi.addEvent(juce::MidiMessage::noteOn(1,64,.5f),1);const auto count=midi.getNumEvents();hostBlock(p,audio,midi,stats);require(midi.getNumEvents()==count,"ARP host MIDI unchanged");midi.clear();for(int b=0;b<8;++b)hostBlock(p,audio,midi,stats);require(audio.getMagnitude(0,2048)>0,"ARP admits last oversized MIDI event after stop");
    }
}
void complex(OrigamiAudioProcessor& p){
    for(int i=1;i<4;++i)require(p.addUiOscillator()!=0,"add oscillator");require(p.setUiParameter(ParameterId::OscUnison,16),"unison");require(p.setUiParameter(ParameterId::Release,.005f),"release");
    auto m=scenarios::maximal();m.macroMask=p.getUiInstrumentState().modulation.macroMask;require(p.setUiModulationState(m),"maximal Nodes");
    const auto bus=p.addUiBus();require(bus!=0,"add bus");auto osc=p.getUiOscillatorState(2);osc.busRouteCount=1;osc.busRoutes[0]={bus,.5f};osc.unison=16;osc.phaseMode=OscillatorPhaseMode::Random;require(p.setUiOscillatorState(2,osc),"route OSC to bus");
    require(p.getUiFxWorkspace().document(bus).edit([](auto& graph){return graph.insertEffectBeforeOutput(fx::FxEffectType::Delay)!=0;}),"insert bus FX");require(p.getUiFxDocument().edit([](auto& graph){return graph.insertEffectBeforeOutput(fx::FxEffectType::Compressor)!=0;}),"insert main FX");require(p.setUiFinalOutput(.5f),"master");
}
void states(){
    auto owner=std::make_unique<OrigamiAudioProcessor>();auto& p=*owner;p.prepareToPlay(48000,257);context="complex state";complex(p);const auto a=state(p);Stats stats;juce::AudioBuffer<float> audio(2,257);juce::MidiBuffer midi;
    for(int pass=0;pass<200;++pass){context="state restore pass="+std::to_string(pass);require(p.setUiParameter(ParameterId::OscUnison,float(1+pass%16)),"mutate unison");require(p.setUiFinalOutput(float(pass%11)/10),"mutate master");auto osc=p.getUiOscillatorState(2);osc.pan=pass%2?-1:1;require(p.setUiOscillatorState(2,osc),"mutate oscillator");p.setStateInformation(a.getData(),int(a.getSize()));require(state(p)==a,"complete state equivalence");midi.clear();midi.addEvent(juce::MidiMessage::noteOn(1,pass%128,.1f),0);hostBlock(p,audio,midi,stats);midi.clear();hostBlock(p,audio,midi,stats);}
    for(int cut:{0,1,7,11,int(a.getSize()/2),int(a.getSize()-1)}){context="truncated host state";p.setStateInformation(a.getData(),cut);require(state(p)==a,"malformed state leaves canonical state unchanged");}
    const auto fullMod=p.getUiInstrumentState().modulation;
    for(int round=0;round<16;++round){
        context="history round="+std::to_string(round);p.clearUiHistory();std::vector<juce::MemoryBlock> snapshots{state(p)};
        for(int edit=0;edit<36;++edit){
            p.beginUiTransaction("B01 structural edit");
            switch(edit%12){
            case 0:require(p.setUiFinalOutput(float((edit+round)%29+1)/31),"master edit");break;
            case 1:{auto perf=p.getUiPerformanceState();perf.glideSeconds=float(edit+round)*.01f;require(p.setUiPerformanceState(perf),"glide edit");break;}
            case 2:require(p.addUiOscillator()!=0,"oscillator add");break;
            case 3:require(p.removeUiOscillator(p.getUiInstrumentState().nextId-1),"oscillator remove");break;
            case 4:require(p.addUiBus()!=0,"bus add");break;
            case 5:{const auto buses=p.getUiInstrumentState().buses;require(p.removeUiBus(buses.buses[buses.count-1].id),"bus remove");break;}
            case 6:{auto empty=canonicalInitState().modulation;empty.macroMask=fullMod.macroMask;require(p.setUiModulationState(empty),"empty Nodes/Matrix");break;}
            case 7:require(p.setUiModulationState(fullMod),"restore Nodes/Matrix");break;
            case 8:require(p.getUiFxDocument().edit([](auto& g){return g.insertEffectBeforeOutput(fx::FxEffectType::Gain)!=0;}),"FX insert");break;
            case 9:require(p.getUiFxDocument().edit([](auto& g){fx::FxNodeId id=0;for(const auto& n:g.nodes())if(n.kind==fx::FxNodeKind::Effect)id=n.id;return g.removeNodeBridging(id)==fx::FxEditResult::Ok;}),"FX remove");break;
            case 10:require(p.setUiParameter(ParameterId::OscUnison,p.getUiParameter(ParameterId::OscUnison)>8?1.f:16.f),"unison edit");break;
            case 11:{auto osc=p.getUiOscillatorState(2);osc.busRoutes[0].level=float(edit+round+1)/100;require(p.setUiOscillatorState(2,osc),"routing edit");break;}
            }
            p.endUiTransaction();require(p.uiHistorySize()==std::size_t(edit+1),"each fixture edit changes state and creates exactly one entry");snapshots.push_back(state(p));midi.clear();hostBlock(p,audio,midi,stats);
        }
        for(std::size_t i=snapshots.size()-1;i>0;--i){require(p.undoUi() && state(p)==snapshots[i-1],"exact structural Undo");hostBlock(p,audio,midi,stats);}
        for(std::size_t i=1;i<snapshots.size();++i){require(p.redoUi() && state(p)==snapshots[i],"exact structural Redo");hostBlock(p,audio,midi,stats);}
        require(p.undoUi(),"branch Undo");require(p.setUiFinalOutput(.333f),"branch edit");require(!p.canRedoUi(),"abandoned redo cannot return");require(p.uiHistorySize()<=64 && p.uiHistoryBytes()<=128u*1024u*1024u,"history bounded");p.setStateInformation(a.getData(),int(a.getSize()));
    }
}
void routing(){
    context="graph mutations";fx::FxRenderer renderer;renderer.prepare(48000);auto graph=fx::makeDefaultFxGraph();std::array<float,257> l{},r{};Stats stats;
    for(int i=0;i<512;++i){const auto id=graph.insertEffectBeforeOutput(i%2?fx::FxEffectType::Gain:fx::FxEffectType::Filter);require(id!=0,"insert FX");require(renderer.sync(graph),"publish graph");l.fill(.1f);r.fill(-.1f);{probe::Guard g;renderer.process(l.data(),r.data(),257);}noHeap();stats.inspect(l.data(),r.data(),257,8);require(graph.setEnabled(id,false)==fx::FxEditResult::Ok,"bypass");require(renderer.sync(graph),"publish bypass");require(graph.removeNodeBridging(id)==fx::FxEditResult::Ok && renderer.sync(graph),"delete/recompile");{probe::Guard g;renderer.process(l.data(),r.data(),257);}noHeap();stats.inspect(l.data(),r.data(),257,8);}
    auto x=graph.addEffect(fx::FxEffectType::Gain,{0,0}),y=graph.addEffect(fx::FxEffectType::Gain,{0,0});require(graph.connect({x,0},{y,0})==fx::FxEditResult::Ok,"edge");const auto before=fx::encodeFxGraph(graph);require(graph.connect({y,0},{x,0})==fx::FxEditResult::WouldCreateCycle && fx::encodeFxGraph(graph)==before,"cycle rejected transactionally");
    auto owner=std::make_unique<OrigamiAudioProcessor>();auto& p=*owner;p.prepareToPlay(48000,257);juce::AudioBuffer<float> audio(2,257);juce::MidiBuffer midi;
    for(int i=0;i<128;++i){context="bus mutation="+std::to_string(i);const auto bus=p.addUiBus();require(bus!=0,"create bus");auto osc=p.getUiOscillatorState(1);osc.busRouteCount=1;osc.busRoutes[0]={bus,.5f};require(p.setUiOscillatorState(1,osc),"reroute oscillator");require(p.getUiFxWorkspace().document(bus).edit([](auto& g){return g.insertEffectBeforeOutput(fx::FxEffectType::Gain)!=0;}),"bus effect");midi.clear();midi.addEvent(juce::MidiMessage::noteOn(1,60,.2f),0);hostBlock(p,audio,midi,stats);require(p.removeUiBus(bus),"delete sounding bus");midi.clear();hostBlock(p,audio,midi,stats);require(validInstrumentState(p.getUiInstrumentState()),"no dangling sends");}
}
void lifecycle(){
    Stats stats;for(int instance=0;instance<20;++instance){context="lifecycle instance="+std::to_string(instance);auto owner=std::make_unique<OrigamiAudioProcessor>();auto other=std::make_unique<OrigamiAudioProcessor>();other->prepareToPlay(48000,128);const auto untouched=state(*other);
        for(double rate:rates){owner->prepareToPlay(rate,17);juce::AudioBuffer<float> audio(2,257);juce::MidiBuffer midi;midi.addEvent(juce::MidiMessage::noteOn(1,69,.2f),0);hostBlock(*owner,audio,midi,stats);owner->releaseResources();owner->prepareToPlay(rate,2048);audio.setSize(2,3);midi.clear();owner->requestPanic();hostBlock(*owner,audio,midi,stats);require(audio.getMagnitude(0,3)==0,"lifecycle Panic silence");require(state(*other)==untouched,"independent instances");}}
}
void modulation(){
    std::array<float,257> l{},r{};Stats stats;
    const std::array<ModSource,13> sources{ModSource::Env1,ModSource::Env2,ModSource::Env3,ModSource::Lfo1,ModSource::Lfo2,ModSource::Lfo3,ModSource::Lfo4,ModSource::Random,ModSource::Function,ModSource::Chaos,ModSource::Drift,ModSource::Sequencer,ModSource::Macro1};
    const std::array<ModDestination,8> destinations{ModDestination::Level,ModDestination::Pan,ModDestination::WtPosition,ModDestination::Fine,ModDestination::Detune,ModDestination::Octave,ModDestination::Semitone,ModDestination::Cutoff};
    for(double rate:rates){context="modulation rate="+std::to_string(rate);auto e=std::make_unique<OrigamiEngine>();require(e->prepare(rate,257,2),"modulation prepare");auto s=sine(4,4);auto mod=scenarios::maximal();mod.macroMask=s.modulation.macroMask;
        for(std::size_t i=7;i<mod.routes.size();++i){const auto d=destinations[(i-7)/sources.size()];mod.routes[i]={mod.nextRouteId++,true,sources[(i-7)%sources.size()],{d,d==ModDestination::Cutoff?0u:1u,0},i%2?-1.f:1.f,true};}
        for(int k=0;k<4;++k)lfoSettings(mod,std::size_t(k)).rateHz=20;mod.random.rateHz=20;mod.function.rateHz=20;mod.chaos.rateHz=20;mod.drift.rateHz=5;mod.sequencer.rateHz=20;
        s.modulation=mod;require(e->restoreInstrumentState(s),"max-depth sources and 32-node graph");for(int i=0;i<16;++i)e->noteOn(40+i,.1f);
        for(int block=0;block<128;++block){require(e->setParameter(ParameterId::Waveform,float(block%4)),"host-style base automation");if(block%8==0){auto edit=mod;edit.routes[std::size_t(7+block%25)].enabled=block%16==0;require(e->setModulationState(edit),"route publication");}engineBlock(*e,l.data(),r.data(),257,stats,32);}
        auto bad=mod;bad.operators[0].inputs[0]=scenarios::opIn(1);require(!e->setModulationState(bad),"self-cycle rejected safely");engineBlock(*e,l.data(),r.data(),257,stats,32);
    }
}
void master(){
    for(double rate:rates){context="Master rate="+std::to_string(rate);FinalOutputStage stage;stage.prepare(rate,FinalOutputGain::unity);std::array<float,2048> l{},r{};Stats stats;
        for(int b=0;b<256;++b){const int n=blocks[b%16];l.fill(.5f);r.fill(.125f);const float target=std::array<float,5>{0,.0001f,.5f,FinalOutputGain::unity,1}[std::size_t(b)%5];{probe::Guard g;stage.process(l.data(),r.data(),n,target);}noHeap();stats.inspect(l.data(),r.data(),n,1.0);for(int i=0;i<n;++i)require(l[std::size_t(i)]==4*r[std::size_t(i)],"Master preserves L/R ratio");}
        for(int b=0;b<int(rate*.025/2048)+2;++b){l.fill(.5f);r.fill(.125f);stage.process(l.data(),r.data(),2048,0);}require(std::all_of(l.begin(),l.end(),[](float v){return v==0;}),"Master true zero after 20ms smoothing");
        stage.prepare(rate,.5f);l.fill(.5f);r.fill(0);stage.process(l.data(),r.data(),2048,.5f);const auto m=stage.meters();require(std::abs(m.level[0]-.5f*FinalOutputGain::linear(.5f))<1e-7f && m.level[1]==0,"independent post-Master tap");
    }
}
void tails(){
    juce::ScopedNoDenormals ftz;
    for(auto type:{fx::FxEffectType::Delay,fx::FxEffectType::Reverb,fx::FxEffectType::Flanger,fx::FxEffectType::Phaser,fx::FxEffectType::Filter}){const auto* d=fx::findFxEffect(type);context="feedback decay "+std::string(d->key);auto processor=d->create();processor->prepare(48000);std::array<float,fx::maxFxParameters> p{};
        for(std::size_t i=0;i<d->parameterCount;++i){const auto& parameter=d->parameters[i];p[i]=parameter.defaultValue;if(std::string(parameter.key)=="feedback" || std::string(parameter.key)=="decay" || std::string(parameter.key)=="mix")p[i]=1;if(type==fx::FxEffectType::Filter && std::string(parameter.key)=="type")p[i]=1;}
        std::array<float,2048> l{},r{};Stats stats;double finalPeak=0;for(int b=0;b<48000*90/2048+1;++b){l.fill(0);r.fill(0);if(b==0)l[0]=r[0]=.5f;{probe::Guard g;processor->process(l.data(),r.data(),2048,p.data());}noHeap();stats.inspect(l.data(),r.data(),2048,32);if(b>48000*89/2048)for(float x:l)finalPeak=std::max(finalPeak,std::abs(double(x)));}
        require(finalPeak<1e-5,"90-second maximum-feedback tail decays, last second peak="+std::to_string(finalPeak));std::cout<<"  tail "<<d->key<<" peak="<<stats.peak<<" final="<<finalPeak<<'\n';
    }
}
std::uint64_t residentBytes(){
#if defined(__APPLE__)
    mach_task_basic_info_data_t info{};mach_msg_type_number_t count=MACH_TASK_BASIC_INFO_COUNT;
    if(task_info(mach_task_self(),MACH_TASK_BASIC_INFO,reinterpret_cast<task_info_t>(&info),&count)==KERN_SUCCESS)return info.resident_size;
#endif
    return 0;
}
void longRender(){
    context="long render";auto owner=std::make_unique<OrigamiAudioProcessor>();auto& p=*owner;p.prepareToPlay(48000,2048);complex(p);Stats stats;juce::AudioBuffer<float> audio(2,2048);juce::MidiBuffer midi;Random random;
    // Five minutes of sample time, independent of machine wall-clock speed.
    std::uint64_t warmResident=0;const std::uint64_t total=48000u*300u;for(std::uint64_t offset=0;offset<total;offset+=2048){if(!warmResident && offset>=48000u*60u)warmResident=residentBytes();midi.clear();if(offset%65536==0){midi.addEvent(juce::MidiMessage::allNotesOff(1),0);for(int n=0;n<8;++n)midi.addEvent(juce::MidiMessage::noteOn(1,36+int(random.next(60)),.1f),1);require(p.setUiParameter(ParameterId::OscDetune,float(random.next(101))),"long detune");}hostBlock(p,audio,midi,stats,32);}
    p.requestPanic();midi.clear();hostBlock(p,audio,midi,stats);for(int b=0;b<256;++b)hostBlock(p,audio,midi,stats);require(audio.getMagnitude(0,2048)==0 && p.getUiRenderBudgetSnapshot().load.activeVoices==0,"long render ends silent");std::cout<<"  five minutes / "<<total<<" frames; peak="<<stats.peak<<" rms="<<stats.rms()<<" resident warm/end bytes="<<warmResident<<"/"<<residentBytes()<<'\n';
}
}
int main(int argc,char** argv){juce::ScopedJuceInitialiser_GUI gui;ui::UserPreferences::useVolatileStorageForTesting();probe::Install install;
#if defined(__APPLE__) && !defined(ORIGAMI_SANITIZED)
    std::cout<<"libmalloc probe: "<<(probe::slot?"available":"unavailable (C++ only)")<<'\n';
    if(probe::slot){void* p;{probe::Guard g;auto* volatile allocate=&std::malloc;p=allocate(131073);}const bool observed=probe::allocations>0;std::free(p);if(!observed){std::cerr<<"FAIL allocation probe self-test\n";return 1;}}
#endif
    const std::pair<const char*,void(*)()> suites[]={{"matrix",matrix},{"oscillator",oscillator},{"filters",filters},{"effects",effects},{"midi",midi},{"arpStop",arpStop},{"modulation",modulation},{"master",master},{"tails",tails},{"states",states},{"routing",routing},{"lifecycle",lifecycle},{"long",longRender}};unsigned failures=0,selected=0;
    for(const auto& suite:suites){if(argc>1 && std::string(suite.first).find(argv[1])==std::string::npos)continue;++selected;context=suite.first;const auto start=std::chrono::steady_clock::now();try{suite.second();std::cout<<"PASS "<<suite.first<<" ("<<std::chrono::duration<double>(std::chrono::steady_clock::now()-start).count()<<" s)\n";}catch(const std::exception& e){++failures;std::cerr<<"FAIL "<<suite.first<<": "<<e.what()<<'\n';}std::cout.flush();}
    std::cout<<"B01 seed=0xb010cafe checks="<<checks<<" samples="<<samples<<" callbacks="<<callbacks<<" failures="<<failures<<'\n';if(!selected){std::cerr<<"No torture sections matched\n";return 2;}return failures?1:0;
}
