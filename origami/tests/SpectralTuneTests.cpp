#include "core/fx/SpectralTune.h"
#include "core/fx/FxEnvironment.h"
#include <algorithm>
#include <atomic>
#include <chrono>
#include <cmath>
#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <iostream>
#include <limits>
#include <new>
#include <vector>
using namespace mct::origami;
using namespace mct::origami::fx;
namespace { bool realtime=false; unsigned rtAllocations=0,rtDeletes=0; }
#ifndef ORIGAMI_SANITIZED
void* operator new(std::size_t n) { if(realtime) ++rtAllocations; if(auto* p=std::malloc(n?n:1)) return p; throw std::bad_alloc(); }
void* operator new[](std::size_t n) { return ::operator new(n); }
void operator delete(void* p) noexcept { if(realtime && p) ++rtDeletes; std::free(p); }
void operator delete[](void* p) noexcept { ::operator delete(p); }
void operator delete(void* p,std::size_t) noexcept { ::operator delete(p); }
void operator delete[](void* p,std::size_t) noexcept { ::operator delete(p); }
#endif
#if defined(__APPLE__) && !defined(ORIGAMI_SANITIZED)
extern "C" void origamiSpectralHeapGuard(bool);
extern "C" void origamiSpectralHeapCounts(unsigned*,unsigned*,bool);
#endif
namespace {
unsigned rtMallocs=0,rtFrees=0;
void setRealtime(bool enabled){
#if defined(__APPLE__) && !defined(ORIGAMI_SANITIZED)
    origamiSpectralHeapGuard(enabled);
#endif
    realtime=enabled;
}
void readHeapCounters(bool reset=false){
#if defined(__APPLE__) && !defined(ORIGAMI_SANITIZED)
    origamiSpectralHeapCounts(&rtMallocs,&rtFrees,reset);
#endif
}
}
namespace {
constexpr double tau=6.28318530717958647692;
int failures=0,checks=0;
void check(bool yes,const char* message) { ++checks; if(!yes) { ++failures; std::cerr<<"FAIL: "<<message<<'\n'; } }
using Params=std::array<float,spectral::parameterCount>;
Params parameters() { Params p; for(std::size_t i=0;i<p.size();++i) p[i]=spectral::parameters()[i].defaultValue; return p; }
void physical(Params& p,int index,float value) { const auto& d=spectral::parameters()[index]; p[index]=d.curve==FxParameterCurve::Exponential ? std::log(value/d.minimum)/std::log(d.maximum/d.minimum) : (value-d.minimum)/(d.maximum-d.minimum); }
std::vector<float> process(SpectralTune& fx,const std::vector<float>& input,const Params& p,int block,bool opposite=false) {
    auto l=input,r=input; if(opposite)for(auto& x:r)x=-x;
    for(int at=0;at<int(l.size());at+=block) { setRealtime(true); fx.process(l.data()+at,r.data()+at,std::min(block,int(l.size())-at),p.data()); setRealtime(false); }
    for(std::size_t i=0;i<l.size();++i) check(std::isfinite(l[i]) && std::isfinite(r[i]),"finite output");
    if(opposite)for(std::size_t i=0;i<l.size();++i)check(std::abs(l[i]+r[i])<1.e-5f,"linked anti-correlated phase preserved");
    return l;
}
std::vector<float> sine(double hz,double rate,double seconds=1.0) { std::vector<float> x(std::size_t(rate*seconds)); for(std::size_t i=0;i<x.size();++i) x[i]=float(.2*std::sin(tau*hz*i/rate)); return x; }
double amplitude(const std::vector<float>& x,double hz,double rate) {
    double re=0,im=0; const std::size_t start=x.size()/2;
    for(std::size_t i=start;i<x.size();++i) { re+=x[i]*std::cos(tau*hz*i/rate); im-=x[i]*std::sin(tau*hz*i/rate); }
    return 2*std::hypot(re,im)/(x.size()-start);
}
double dominant(const std::vector<float>& x,double around,double rate) {
    double best=0,hz=0; for(double f=around-4;f<=around+4;f+=.25) { const double a=amplitude(x,f,rate); if(a>best){best=a;hz=f;} } return hz;
}
void neutralTests() {
    for(double rate:{44100.,48000.,96000.,192000.})for(int fixture=0;fixture<6;++fixture) {
        auto p=parameters();p[0]=0;p[3]=0; SpectralTune fx;fx.prepare(rate);
        auto x=sine(261.625565,rate,.25); unsigned noise=1234;
        for(std::size_t i=0;i<x.size();++i) {
            if(fixture==1) x[i]=float(.2*(2*std::fmod(130.8128*i/rate,1.)-1));
            if(fixture==2) x[i]=i==100 ? 1.f : 0.f;
            if(fixture==3){noise=noise*1664525u+1013904223u;x[i]=float((double(noise)/4294967296.-.5)*.4);}
            if(fixture==4)x[i]+=float(.12*std::sin(tau*329.6276*i/rate)+.1*std::sin(tau*391.9954*i/rate));
            if(fixture==5)x[i]=float(.2*std::sin(tau*55*i/rate)*(1+.5*std::sin(tau*4*i/rate))+.07*std::sin(tau*165*i/rate));
        }
        auto y=process(fx,x,p,127);double error=0,peak=0;
        for(std::size_t i=fx.latencySamples();i<y.size();++i){error+=std::pow(y[i]-x[i-fx.latencySamples()],2);peak=std::max(peak,double(std::abs(y[i]-x[i-fx.latencySamples()])));}
        error=std::sqrt(error/(y.size()-fx.latencySamples()));check(error<1.e-6 && peak<1.e-5,"neutral delayed reconstruction");
        std::cout<<"neutral rate="<<rate<<" fixture="<<fixture<<" RMS error="<<error<<" peak error="<<peak<<" latency="<<fx.latencySamples()<<" bytes="<<fx.storageBytes()<<'\n';
    }
}
void tuningTests() {
    for(int pc=0;pc<12;++pc)for(float snap:{0.f,.5f,1.f}) {
        auto p=parameters();p[0]=snap;p[3]=0;p[4]=0;p[12]=float(1u<<pc)/4095;
        const double target=440*std::exp2((60+pc-69)/12.0),input=target*std::exp2(.7/12.),expected=input*std::exp2(-.7*snap/12.);
        SpectralTune fx;fx.prepare(48000);auto out=process(fx,sine(input,48000),p,128);
        const double observed=dominant(out,expected,48000);check(std::abs(observed-expected)<.51,"all twelve pitch classes / intermediate logarithmic snap");
        check(amplitude(out,expected,48000)>.12,"tuned sine retains useful energy");
    }
    for(double shift:{-12.,0.,7.,12.,3.5}) {
        auto p=parameters();p[0]=0;p[3]=0;p[4]=0;physical(p,1,float(shift));SpectralTune fx;fx.prepare(48000);
        const double expected=330*std::exp2(shift/12);auto y=process(fx,sine(330,48000),p,64);
        check(std::abs(dominant(y,expected,48000)-expected)<.6,"musical shift including fractional");
    }
    auto p=parameters();p[0]=0;p[3]=0;p[4]=0;p[13]=1;physical(p,1,17);SpectralTune hz;hz.prepare(48000);
    check(std::abs(dominant(process(hz,sine(330,48000),p,256),347,48000)-347)<.6,"Hz offset independent from semitone mode");
    p=parameters();p[0]=1;p[3]=0;p[4]=0;p[12]=1.f/4095;physical(p,6,200);physical(p,7,800);
    auto x=sine(55,48000);for(std::size_t i=0;i<x.size();++i)x[i]+=float(.15*std::sin(tau*280*i/48000)+.12*std::sin(tau*5000*i/48000));
    SpectralTune range;range.prepare(48000);auto y=process(range,x,p,512);
    check(std::abs(amplitude(y,55,48000)-.2)<.003,"FX region preserves sub amplitude");
    check(std::abs(amplitude(y,5000,48000)-.12)<.003,"FX region preserves highs");
    check(amplitude(y,261.625565,48000)>.09 && amplitude(y,280,48000)<.01,"only eligible mid component remaps");
    std::cout<<"region low="<<amplitude(y,55,48000)<<" mid target="<<amplitude(y,261.625565,48000)<<" mid source="<<amplitude(y,280,48000)<<" high="<<amplitude(y,5000,48000)<<'\n';
    p=parameters();p[0]=1;p[12]=0;SpectralTune empty;empty.prepare(48000);y=process(empty,sine(280,48000),p,128);check(amplitude(y,280,48000)>.199,"empty mask is neutral");
    p[12]=1.f/4095;physical(p,2,.1f);SpectralTune attraction;attraction.prepare(48000);y=process(attraction,sine(280,48000),p,128);check(amplitude(y,280,48000)>.199,"distant components outside Range stay unmapped");
}
void stateAndStreamingTests() {
    for(int root=0;root<12;++root)for(int scale=0;scale<10;++scale){const auto mask=spectral::scaleMask(root,scale);check(mask && mask<=4095 && (mask&(1u<<root)),"preset root and bounded mask");}
    check(spectral::nearestMidi(71.7f,1)==72 && spectral::nearestMidi(60.3f,1u<<11)==59,"octave boundary nearest target");
    auto graph=makeDefaultFxGraph();const auto id=graph.insertEffectBeforeOutput(FxEffectType::SpectralTune);
    graph.setParameter(id,spectral::Scale,1.f/10);graph.setParameter(id,spectral::Root,2.f/11);
    check(unsigned(std::round(*graph.findNode(id)->parameter(spectral::Mask)*4095))==spectral::scaleMask(2,1),"root transposes active scale");
    graph.setParameter(id,spectral::Mask,1.f/4095);check(*graph.findNode(id)->parameter(spectral::Scale)==1,"keyboard switches Custom");
    graph.setParameter(id,spectral::Root,8.f/11);check(std::round(*graph.findNode(id)->parameter(spectral::Mask)*4095)==1,"Custom root leaves absolute mask");
    graph.setParameter(id,spectral::Low,.9f);graph.setParameter(id,spectral::High,.3f);check(*graph.findNode(id)->parameter(spectral::Low)<=*graph.findNode(id)->parameter(spectral::High),"authored FX bounds ordered");
    auto encoded=encodeFxGraph(graph);FxGraph decoded;check(decodeFxGraph(encoded.data(),encoded.size(),decoded) && decoded==graph,"effect localized state round-trip");
    check(graph.setParameter(id,spectral::Snap,std::numeric_limits<float>::quiet_NaN())==FxEditResult::InvalidValue,"invalid authored state rejected");
    auto x=sine(280,48000,.5);auto p=parameters();p[12]=1.f/4095;
    SpectralTune a,b;a.prepare(48000);b.prepare(48000);auto one=process(a,x,p,64),two=process(b,x,p,511);
    check(one==two,"block partition deterministic");
    for(float mix:{0.f,.25f,.5f,1.f}) {SpectralTune f;f.prepare(48000);p[0]=0;p[9]=mix;auto y=process(f,x,p,128);double max=0;for(std::size_t i=f.latencySamples();i<y.size();++i)max=std::max(max,double(std::abs(y[i]-x[i-f.latencySamples()])));check(max<1.e-6,"neutral Mix is latency aligned at every setting");}
    p=parameters();p[12]=1.f/4095;SpectralTune anti;anti.prepare(48000);process(anti,x,p,128,true);
    anti.setSpectrumTelemetryEnabled(true);process(anti,x,p,128);FxSpectrumSnapshot snapshot;check(anti.spectrumSnapshot(snapshot) && snapshot.sequence>0,"actual DSP spectrum snapshot");
    setRealtime(true);anti.reset();setRealtime(false);check(!anti.spectrumSnapshot(snapshot),"Panic invalidates spectrum");
    std::vector<float> silence(8192);auto tail=process(anti,silence,p,128);check(std::all_of(tail.begin(),tail.end(),[](float v){return v==0;}),"populated reset clears all OLA and phase state");
    for(double rate:{44100.,48000.,96000.,192000.})for(int block:{64,128,256,512}){
        SpectralTune f;f.prepare(rate);auto extreme=parameters();for(auto& v:extreme)v=1;auto input=sine(400,rate,.1);if(input.size()>1){input[0]=std::nanf("");input[1]=std::numeric_limits<float>::infinity();}process(f,input,extreme,block);}
}
void motionAndBypassTests() {
    for(bool clearMask:{false,true}){SpectralTune f;f.prepare(48000);auto p=parameters();p[12]=1.f/4095;float last=0,maxJump=0;double error=0;for(int block=0;block<400;++block){if(block==150){if(clearMask)p[12]=0;else p[0]=0;}float l[128],r[128];for(int i=0;i<128;++i)l[i]=r[i]=float(.2*std::sin(tau*280*(block*128+i)/48000));setRealtime(true);f.process(l,r,128,p.data());setRealtime(false);for(int i=0;i<128;++i){maxJump=std::max(maxJump,std::abs(l[i]-last));last=l[i];if(block>300)error=std::max(error,std::abs(l[i]-.2*std::sin(tau*280*(block*128+i-2048)/48000)));}}check(maxJump<.03 && error<1.e-6,"warm Snap zero / empty mask transition restores neutral phase without clicks");std::cout<<"neutral transition clearMask="<<clearMask<<" max sample jump="<<maxJump<<" settled error="<<error<<'\n';}

    auto x=sine(280,48000);double phase=0;
    for(std::size_t i=0;i<x.size();++i){const double hz=i<x.size()/2 ? 280 : 440;
        // Cross the C-only lattice boundary: Smooth acts on target movement.
        phase+=tau*hz/48000;x[i]=float(.2*std::sin(phase)+.07*std::sin(phase*3));}
    auto base=parameters();base[12]=1.f/4095;base[0]=1;base[3]=0;base[4]=0;
    SpectralTune a;a.prepare(48000);auto reference=process(a,x,base,128);
    for(int index:{3,4,5}){auto p=base;p[index]=1;SpectralTune f;f.prepare(48000);auto y=process(f,x,p,128);double difference=0;for(std::size_t i=x.size()/2;i<x.size();++i)difference+=std::pow(y[i]-reference[i],2);check(difference>.001,"Smooth / Response / Formant each have a real, distinct DSP effect");}
    auto graph=makeDefaultFxGraph();const auto id=graph.insertEffectBeforeOutput(FxEffectType::SpectralTune);graph.setParameter(id,spectral::Mask,1.f/4095);graph.setParameter(id,spectral::Snap,1);
    for(auto mode:{FxBypassMode::Hard,FxBypassMode::Crossfade,FxBypassMode::TailPreserve}) {
        FxRenderer renderer;renderer.prepare(48000);renderer.setBypassMode(mode);renderer.sync(graph);float previous=0,maxJump=0;
        for(int block=0;block<300;++block){if(block==100 || block==200){graph.setEnabled(id,block==200);renderer.sync(graph);}float l[128],r[128];for(int i=0;i<128;++i)l[i]=r[i]=float(.2*std::sin(tau*280*(block*128+i)/48000));
            setRealtime(true);renderer.process(l,r,128);setRealtime(false);
            for(int i=0;i<128;++i){maxJump=std::max(maxJump,std::abs(l[i]-previous));previous=l[i];check(std::isfinite(l[i]),"PWR transitions finite");if(block==199)check(std::abs(l[i]-.2*std::sin(tau*280*(block*128+i-2048)/48000))<1.e-6,"settled PWR bypass equals latency-aligned dry");}
        }
        check(maxJump<.03f,"PWR changes declick without stale-tail bursts");graph.setEnabled(id,true);
        std::cout<<"bypass mode="<<int(mode)<<" max sample jump="<<maxJump<<'\n';
    }
    for(int index=0;index<10;++index){FxRenderer dry,modulated;dry.prepare(48000);modulated.prepare(48000);dry.sync(graph);modulated.sync(graph);auto dl=x,dr=x,wl=x,wr=x;FxModulationOutput frame;frame.count=1;frame.generation=1;frame.bus[0]=1;frame.node[0]=id;frame.parameter[0]=spectral::parameters()[index].id;if(index==8)dr=wr=sine(286,48000);frame.offset[0]=(index==0 || index==2 || index==7 || index==9) ? -.95f : .7f;
        setRealtime(true);dry.process(dl.data(),dr.data(),int(x.size()));modulated.process(wl.data(),wr.data(),int(x.size()),&frame);setRealtime(false);double difference=0;for(std::size_t i=x.size()/2;i<x.size();++i){check(std::isfinite(wl[i]),"all ten modulation destinations render finite");difference+=std::pow(wl[i]-dl[i],2);}check(difference>.00001,"continuous FX modulation reaches Spectral DSP");
    }
    SpectralTune linked,independent;linked.prepare(48000);independent.prepare(48000);auto l=sine(280,48000),r=sine(286,48000),il=l,ir=r;auto p=base;p[8]=0;
    linked.process(l.data(),r.data(),int(l.size()),p.data());p[8]=1;independent.process(il.data(),ir.data(),int(il.size()),p.data());double stereoDifference=0;for(std::size_t i=l.size()/2;i<l.size();++i)stereoDifference+=std::pow(l[i]-il[i],2)+std::pow(r[i]-ir[i],2);check(stereoDifference>.001,"linked / independent stereo mapping differs on wide components");
}

void graphLatencyTests() {
    auto g=makeDefaultFxGraph();auto id=g.insertEffectBeforeOutput(FxEffectType::SpectralTune);g.setParameter(id,spectral::Snap,0);
    for(auto mode:{FxBypassMode::Hard,FxBypassMode::Crossfade,FxBypassMode::TailPreserve}) {
        FxRenderer r;r.prepare(48000);r.setBypassMode(mode);r.setTelemetryEnabled(true);r.sync(g);auto x=sine(300,48000,.2),l=x,rr=x;
        setRealtime(true);r.process(l.data(),rr.data(),int(l.size()));setRealtime(false);
        check(r.latencySamples()==2048,"graph reports processor latency");
        for(int i=2048;i<int(l.size());++i)check(std::abs(l[i]-x[i-2048])<1.e-6,"neutral graph unity after latency");
        g.setEnabled(id,false);r.sync(g);l=x;rr=x;setRealtime(true);r.process(l.data(),rr.data(),int(l.size()));r.emergencyResetRuntime();setRealtime(false);
        check(!r.consumeNodeTelemetry(id).valid,"Panic invalidates renderer spectrum/waveform telemetry");
        g.setEnabled(id,true);
    }
    FxNodeId source,out;FxGraph parallel;source=parallel.addBusSource(1,{0,0});out=parallel.addOutput({900,0});auto split=parallel.addSplit({100,0},2),merge=parallel.addMerge({700,0},2);id=parallel.addEffect(FxEffectType::SpectralTune,{350,0});parallel.setParameter(id,spectral::Snap,0);
    parallel.connect({source,0},{split,0});parallel.connect({split,0},{id,0});parallel.connect({id,0},{merge,0});parallel.connect({split,1},{merge,1});parallel.connect({merge,0},{out,0});
    FxRenderer r;r.prepare(48000);r.sync(parallel);auto x=sine(300,48000,.2),l=x,rr=x;setRealtime(true);r.process(l.data(),rr.data(),int(l.size()));setRealtime(false);
    for(int i=2048;i<int(l.size());++i)check(std::abs(l[i]-x[i-2048])<1.e-6,"parallel merge aligns dry branch");
    FxEnvironment env;env.prepare(48000);auto bypass=makeDefaultFxGraph(7);FxGlobalSettings settings;settings.dryWet=.5;env.sync({{1,&g},{7,&bypass}},settings);l=x;rr=x;auto al=x,ar=x;float* aux[]{al.data(),ar.data()};setRealtime(true);env.process(l.data(),rr.data(),aux,2,int(l.size()));setRealtime(false);
    check(env.latencySamples()==2048,"bus environment reports maximum latency");
    for(int i=2048;i<int(l.size());++i)check(std::abs(l[i]-2*x[i-2048])<2.e-6,"global Mix and bus outputs align");
    setRealtime(true);env.emergencyResetRuntime();setRealtime(false);std::fill(l.begin(),l.end(),0);std::fill(rr.begin(),rr.end(),0);std::fill(al.begin(),al.end(),0);std::fill(ar.begin(),ar.end(),0);setRealtime(true);env.process(l.data(),rr.data(),aux,2,int(l.size()));setRealtime(false);check(std::all_of(l.begin(),l.end(),[](float x){return x==0;}),"Panic clears graph/bus compensation histories");
    // Churn plans while rendering: adoption and retirement never allocate/delete.
    for(int i=0;i<40;++i){g=makeDefaultFxGraph();if(i&1)g.insertEffectBeforeOutput(FxEffectType::SpectralTune);env.sync({{1,&g},{7,&bypass}},settings);std::fill(l.begin(),l.end(),0);std::fill(rr.begin(),rr.end(),0);setRealtime(true);env.process(l.data(),rr.data(),aux,2,64);setRealtime(false);}
}
void writeFloatWave(const std::string& path,const std::vector<float>& audio) {
    std::ofstream file(path,std::ios::binary);
    const auto u16=[&](unsigned v){const char bytes[]{char(v),char(v>>8)};file.write(bytes,2);};
    const auto u32=[&](unsigned v){const char bytes[]{char(v),char(v>>8),char(v>>16),char(v>>24)};file.write(bytes,4);};
    file.write("RIFF",4);u32(48+unsigned(audio.size()*4));file.write("WAVEfmt ",8);u32(16);u16(3);u16(1);u32(48000);u32(192000);u16(4);u16(32);
    file.write("fact",4);u32(4);u32(unsigned(audio.size()));file.write("data",4);u32(unsigned(audio.size()*4));file.write(reinterpret_cast<const char*>(audio.data()),std::streamsize(audio.size()*sizeof(float)));
}
void audioFixtures(const char* folder) {
    constexpr int rate=48000,length=48000;
    const char* names[]{"saw","supersaw-chord","growl","color-bass","drums","full-mix"};
    std::ofstream metrics(std::string(folder)+"/audio-metrics.csv");metrics<<"fixture,input_peak,wet_peak,input_rms,wet_rms,peak_gain_db,rms_gain_db\n";
    for(int fixture=0;fixture<6;++fixture) {
        auto p=parameters();p[0]=1;p[12]=float(spectral::scaleMask(0,2))/4095;physical(p,6,130);physical(p,7,10000);p[5]=.35f;p[8]=0;
        SpectralTune effect;effect.prepare(rate);std::vector<float> source(length+effect.latencySamples(),0),input(length+2*effect.latencySamples(),0);unsigned random=1234;
        const auto saw=[](double hz,double time){double sum=0;for(int harmonic=1;harmonic<=48;++harmonic)if(hz*harmonic<22000)sum+=std::sin(tau*hz*harmonic*time)/harmonic;return sum*.4;};
        for(int i=0;i<length;++i) {
            const double t=double(i)/rate,attack=std::min(1.0,std::max(0.0,(t-.05)/.01)),release=std::min(1.0,std::max(0.0,(.95-t)/.05)),envelope=attack*release;
            const double monoSaw=.25*saw(110,t);
            double chord=0;for(double hz:{130.8128,164.8138,195.9977,246.9417})for(double cents:{-7.,0.,7.})chord+=.025*saw(hz*std::exp2(cents/1200),t);
            double growl=0;for(int harmonic=1;harmonic<=32;++harmonic){const double emphasis=.2+std::exp(-std::pow((harmonic-(9+5*std::sin(tau*3*t)))/4,2));growl+=.08*emphasis*std::sin(tau*55*harmonic*t)/std::sqrt(double(harmonic));}
            const double color=.12*std::sin(tau*55*t)+.11*std::sin(tau*220*t+2.5*std::sin(tau*146.8324*t))+.06*saw(293.6648,t);
            random=random*1664525u+1013904223u;const double noise=double(random)/4294967296.-.5,beat=std::fmod(t,.25);
            const double drums=.25*std::sin(tau*(90+120*std::exp(-beat*70))*beat)*std::exp(-beat*35)+.12*noise*std::exp(-beat*75);
            const double signal=fixture==0 ? monoSaw : fixture==1 ? chord : fixture==2 ? growl : fixture==3 ? color : fixture==4 ? drums : .5*chord+.5*color+.5*drums;
            source[i]=input[i]=float(signal*envelope);
        }
        auto wet=process(effect,input,p,128);wet.erase(wet.begin(),wet.begin()+effect.latencySamples());
        double inputPeak=0,wetPeak=0,inputPower=0,wetPower=0;for(std::size_t i=0;i<source.size();++i){inputPeak=std::max(inputPeak,double(std::abs(source[i])));wetPeak=std::max(wetPeak,double(std::abs(wet[i])));inputPower+=source[i]*source[i];wetPower+=wet[i]*wet[i];}
        const double inRms=std::sqrt(inputPower/source.size()),outRms=std::sqrt(wetPower/wet.size());metrics<<names[fixture]<<','<<inputPeak<<','<<wetPeak<<','<<inRms<<','<<outRms<<','<<20*std::log10(wetPeak/inputPeak)<<','<<20*std::log10(outRms/inRms)<<'\n';
        writeFloatWave(std::string(folder)+"/"+names[fixture]+"-input.wav",source);writeFloatWave(std::string(folder)+"/"+names[fixture]+"-wet.wav",wet);
    }
}

void benchmark(const char* path) {
    std::ofstream csv(path);csv<<"fixture,rate,block,instances,mean_us,median_us,p99_us,max_us,p99_deadline_percent,bytes_per_instance\n";
    for(int fixture:{0,1})for(double rate:{44100.,48000.,96000.,192000.})for(int block:{64,128,256,512})for(int count:{1,2,4,8}) {
        FxRenderer renderer;renderer.prepare(rate);auto graph=makeDefaultFxGraph();
        for(int i=0;i<count;++i){const auto id=graph.insertEffectBeforeOutput(FxEffectType::SpectralTune);graph.setParameter(id,spectral::Mask,float(spectral::scaleMask(0,2))/4095);}
        renderer.sync(graph);renderer.setTelemetryEnabled(true);SpectralTune storage;storage.prepare(rate);unsigned random=1234;
        auto p=parameters();p[12]=float(spectral::scaleMask(0,2))/4095;std::vector<float> l(block),r(block);std::vector<double> times;times.reserve(1024);
        const int warmup=std::max(128,(count+2)*storage.latencySamples()/block);
        for(int callback=0;callback<warmup+1024;++callback) {
            for(int i=0;i<block;++i){const double t=(callback*block+i)/rate;l[i]=float(.15*std::sin(tau*55*t)+.12*std::sin(tau*280*t)+.1*std::sin(tau*399*t));r[i]=float(.2*std::sin(tau*280*t)+.1*std::sin(tau*440*t));if(fixture){random=random*1664525u+1013904223u;l[i]=float((double(random)/4294967296.-.5)*.4);random=random*1664525u+1013904223u;r[i]=float((double(random)/4294967296.-.5)*.4);}}
            const auto start=std::chrono::steady_clock::now();setRealtime(true);renderer.process(l.data(),r.data(),block);setRealtime(false);const double us=std::chrono::duration<double,std::micro>(std::chrono::steady_clock::now()-start).count();if(callback>=warmup)times.push_back(us);
        }
        double mean=0;for(auto time:times)mean+=time;mean/=times.size();std::sort(times.begin(),times.end());const double p99=times[std::size_t(times.size()*.99)];csv<<(fixture ? "broadband" : "tonal")<<','<<rate<<','<<block<<','<<count<<','<<mean<<','<<times[times.size()/2]<<','<<p99<<','<<times.back()<<','<<p99*rate/block/10000<<','<<storage.storageBytes()<<'\n';
    }
}
}
int main(int argc,char** argv) {
#if defined(__APPLE__) && !defined(ORIGAMI_SANITIZED)
    setRealtime(true);void* volatile proof=std::malloc(16);std::free(proof);setRealtime(false);
    readHeapCounters(true);check(rtMallocs==1 && rtFrees==1,"C heap interposition guard is active");rtMallocs=rtFrees=0;
#endif
    if(argc==3 && std::string(argv[1])=="--audio-fixtures"){audioFixtures(argv[2]);return failures ? 1 : 0;}
    if(argc==3 && std::string(argv[1])=="--benchmark") {benchmark(argv[2]);readHeapCounters();return rtAllocations || rtDeletes || rtMallocs || rtFrees ? 1 : 0;}
    neutralTests();tuningTests();stateAndStreamingTests();motionAndBypassTests();graphLatencyTests();readHeapCounters();check(rtAllocations==0 && rtDeletes==0 && rtMallocs==0 && rtFrees==0,"process, reset, adoption: zero realtime allocations/deletions");
    std::cout<<(failures ? "FAIL: " : "PASS: ")<<checks<<" spectral checks; RT allocations="<<rtAllocations<<" deletes="<<rtDeletes<<" C mallocs="<<rtMallocs<<" C frees="<<rtFrees<<'\n';return failures ? 1 : 0;
}
