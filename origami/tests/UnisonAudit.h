#pragma once
// Included by EngineTests.cpp: uses its allocation guard and check helper.
#include <chrono>
namespace unison_audit {
using namespace mct::origami;
struct Audio {std::vector<float> left,right;};
InstrumentState patch(unsigned count,OscillatorPhaseMode phase=OscillatorPhaseMode::Fixed,float cents=24) {
    auto s=canonicalInitState();auto& m=s.oscillators[0];
    m.unison=count;m.detuneCents=cents;m.blend=1;m.phaseMode=phase;m.wtPosition=m.waveform=0;
    s.parameters[std::size_t(ParameterId::Waveform)]=0;
    s.parameters[std::size_t(ParameterId::OscUnison)]=float(count);
    s.parameters[std::size_t(ParameterId::OscDetune)]=cents;
    s.parameters[std::size_t(ParameterId::MasterGain)]=.1f;
    return s;
}
Audio render(const InstrumentState& s,double rate=48000,unsigned block=128,unsigned notes=1,unsigned seconds=1) {
    auto e=std::make_unique<OrigamiEngine>();check(e->prepare(rate,1024,2) && e->restoreInstrumentState(s),"unison render fixture");
    for(unsigned n=0;n<notes;++n)e->noteOn(69+int(n),.8f);
    Audio a;a.left.resize(std::size_t(rate)*seconds);a.right.resize(a.left.size());
    for(std::size_t n=0;n<a.left.size();n+=block) {float* out[]{a.left.data()+n,a.right.data()+n};check(e->process(out,2,std::min<std::size_t>(block,a.left.size()-n)),"unison renders");}
    return a;
}
double rms(const std::vector<float>& a) {double power=0;for(std::size_t n=2400;n<a.size();++n)power+=double(a[n])*a[n];return std::sqrt(power/double(a.size()-2400));}
double tone(const Audio& a,double frequency) {
    double real=0,imag=0;
    for(std::size_t n=0;n<a.left.size();++n) {const double window=.5-.5*std::cos(2*3.141592653589793*double(n)/double(a.left.size()-1));const double phase=2*3.141592653589793*frequency*double(n)/48000;const double x=(a.left[n]+a.right[n])*window;real+=x*std::cos(phase);imag+=x*std::sin(phase);}
    return std::hypot(real,imag)/double(a.left.size());
}
void run() {
    for(unsigned count=1;count<=16;++count) {
        double sum=0,logSum=0;for(unsigned u=0;u<count;++u) {const double p=dsp::unisonPosition(u,count);sum+=p;const double ratio=dsp::unisonRatio(u,count,100);logSum+=std::log2(ratio);check(std::abs(p+dsp::unisonPosition(count-1-u,count))<1e-12,"unison cents/pan symmetry");}
        check(std::abs(sum)<1e-12 && std::abs(logSum)<1e-7,"zero geometric tuning bias");
        dsp::UnisonMixer m;m.prepare(count,1,24,true,48000);double l=0,r=0;for(unsigned u=0;u<count;++u){l+=m.left[u]*m.left[u];r+=m.right[u]*m.right[u];}
        check(std::abs(l-r)<1e-6 && std::abs(l-1)<1e-6,"symmetric stereo power and RMS normalization");
    }
    dsp::UnisonMixer transition;transition.prepare(1,1,24,true,48000);transition.prepare(16,1,24,true,48000);
    check(transition.remaining==960 && transition.left[1]==0,"new lanes start silent with twenty ms fade");
    for(int n=0;n<960;++n)transition.advance();check(transition.renderCount==16 && !transition.remaining,"count fade reaches sixteen");
    transition.prepare(1,1,24,true,48000);for(int n=0;n<960;++n)transition.advance();check(transition.renderCount==1 && transition.right[15]==0,"departing lanes stop rendering");
    for(unsigned count:{1u,2u,4u,8u,16u})for(auto phase:{OscillatorPhaseMode::Fixed,OscillatorPhaseMode::Random}) {
        auto s=patch(count,phase);const auto a=render(s);const auto repeat=render(s,48000,17);
        check(a.left==repeat.left && a.right==repeat.right,"phase streams and unison are repeatable/block independent");
        double peak=0,dc=0,side=0,mono=0;for(std::size_t n=2400;n<a.left.size();++n){check(std::isfinite(a.left[n]) && std::isfinite(a.right[n]),"unison finite audio");peak=std::max({peak,std::abs(double(a.left[n])),std::abs(double(a.right[n]))});dc+=a.left[n];side+=std::pow(a.left[n]-a.right[n],2);mono+=std::pow(a.left[n]+a.right[n],2);}
        const double l=rms(a.left),r=rms(a.right);std::cout<<"Unison count="<<count<<" phase="<<unsigned(phase)<<" peak="<<peak<<" rms="<<l<<","<<r<<'\n';
        check(peak<.4 && l>.012 && l<.08,"unison peak/RMS does not explode or collapse");
        check(std::abs(l-r)/std::max(l,r)<.16,"unison long-term stereo energy centered");
        check(std::abs(dc/double(a.left.size()-2400))<.001,"unison negligible DC");
        if(count>1)check(side>mono*.015 && mono>side*.5,"audible stereo width and useful mono fold-down");
        auto coherent=render(patch(count,OscillatorPhaseMode::Fixed,0));check(rms(coherent.left)<.041 && rms(coherent.left)>.035,"zero-detune fixed-phase peak compensation");
    }
    // The spectrum must contain the requested independently detuned voices,
    // not merely a changed output gain. Full BLEND excludes the center lane.
    for(unsigned count:{2u,4u,8u,16u}) {
        auto a=render(patch(count,OscillatorPhaseMode::Fixed,100),48000,128,1,4);
        for(unsigned u=0;u<count;++u) {const double hz=440*std::exp2(dsp::unisonPosition(u,count)*100/1200);check(tone(a,hz)>.001,"each detuned spectral line is present");}
        check(tone(a,440)<.0005,"even-count ensemble has no hidden center oscillator");
    }
    const auto sustained=render(patch(16),48000,128,1,4);
    std::cout<<"Unison fixed-phase sustained four-second RMS="<<rms(sustained.left)<<","<<rms(sustained.right)<<'\n';
    check(rms(sustained.left)>.025 && rms(sustained.left)<.06,"fixed-phase beat cycle has compensated sustained RMS");
    auto randomZero=patch(8,OscillatorPhaseMode::Random);randomZero.oscillators[0].randomPhaseDegrees=0;
    check(render(randomZero).left==render(patch(8)).left,"zero random range equals fixed zero phase");
    auto shifted=patch(1);shifted.oscillators[0].phaseDegrees=90;
    check(render(shifted).left!=render(patch(1)).left,"fixed phase parameter affects actual oscillator phase");
    auto common=patch(8,OscillatorPhaseMode::Random);common.oscillators[0].phasePerUnison=false;
    check(render(common).left!=render(patch(8,OscillatorPhaseMode::Random)).left,"per-unison phase switch changes independent phase starts");
    // FREE continues the reused voice slot; FIXED retriggers. Re-rendering the
    // entire sequence must still be deterministic.
    const auto twoNotes=[](OscillatorPhaseMode mode) {
        auto e=std::make_unique<OrigamiEngine>();e->prepare(48000,256,2);auto state=patch(4,mode);e->restoreInstrumentState(state);
        std::array<float,256> l{},r{};float* out[]{l.data(),r.data()};e->noteOn(69,.8f);e->process(out,2,256);e->noteOff(69);e->process(out,2,256);e->noteOn(69,.8f);e->process(out,2,256);return l;
    };
    check(twoNotes(OscillatorPhaseMode::Free)!=twoNotes(OscillatorPhaseMode::Fixed) && twoNotes(OscillatorPhaseMode::Free)==twoNotes(OscillatorPhaseMode::Free),"free slot phase continues and remains repeatable");
    for(auto process:{dsp::OscProcessType::BendPlus,dsp::OscProcessType::RandAmp}) {
        auto e=std::make_unique<OrigamiEngine>();e->prepare(48000,128,2);auto state=patch(16,OscillatorPhaseMode::Random);auto& osc=state.oscillators[0];
        osc.waveform=.371f*3;osc.wtPosition=osc.waveform/3;state.parameters[std::size_t(ParameterId::Waveform)]=osc.waveform;osc.processCount=1;osc.nextProcessId=2;osc.processes[0]={1,process,.35f,0x13579bdfu,true};
        check(e->restoreInstrumentState(state),"unison phase/spectral OSC CHAIN state");e->noteOn(69,.6f);std::array<float,128> l{},r{};float* out[]{l.data(),r.data()};double total=0;
        for(int b=0;b<128;++b){check(e->process(out,2,128),"unison phase/spectral chain renders");for(unsigned n=0;n<128;++n){check(std::isfinite(l[n]) && std::isfinite(r[n]) && std::abs(l[n])<1 && std::abs(r[n])<1,"unison phase/spectral chain finite and bounded");total+=l[n]*l[n]+r[n]*r[n];}}
        check(total>.01,"unison phase/spectral chain remains audible");
    }
    auto panned=patch(16,OscillatorPhaseMode::Random);panned.oscillators[0].pan=-1;panned.parameters[std::size_t(ParameterId::OscPan)]=-1;
    const auto hardLeft=render(panned);check(rms(hardLeft.left)>.01 && std::all_of(hardLeft.right.begin(),hardLeft.right.end(),[](float v){return std::abs(v)<1e-7f;}),"overall hard pan retains channel isolation with unison");
    panned.oscillators[0].level=0;panned.parameters[std::size_t(ParameterId::OscLevel)]=0;check(rms(render(panned).left)==0,"oscillator level still silences ensemble");
    // State schema and legacy zero migration are explicit, not silent topology changes.
    auto s=patch(16,OscillatorPhaseMode::Random);s.oscillators[0].phaseDegrees=37;s.oscillators[0].randomPhaseDegrees=180;s.oscillators[0].phaseRetrigger=false;s.oscillators[0].phasePerUnison=false;
    auto bytes=encodeInstrumentState(s);InstrumentState decoded;check(bytes[7]==39 && decodeInstrumentState(bytes.data(),bytes.size(),decoded) && encodeInstrumentState(decoded)==bytes,"unison/phase canonical state roundtrip");
    auto legacy=encodeInstrumentState(canonicalInitState());auto word=[](auto& b,std::size_t n,unsigned v){for(unsigned i=0;i<4;++i)b[n+i]=std::uint8_t(v>>(24-i*8));};
    word(legacy,12+4*std::size_t(ParameterId::OscUnison),0);word(legacy,12+4*parameterCount+8+32,0);
    auto malformed=bytes;word(malformed,12+4*parameterCount+8+52,256);check(!decodeInstrumentState(malformed.data(),malformed.size(),decoded),"phase mode rejects overflow before enum conversion");
    malformed=bytes;word(malformed,12+4*parameterCount+8+64,2);check(!decodeInstrumentState(malformed.data(),malformed.size(),decoded),"phase boolean rejects malformed values");
    check(decodeInstrumentState(legacy.data(),legacy.size(),decoded) && decoded.oscillators[0].unison==1 && decoded.parameters[std::size_t(ParameterId::OscUnison)]==1,"legacy zero migrates to one");
    s=patch(16);s.oscillators[0].unison=17;check(!validInstrumentState(s),"state rejects unison above sixteen");
    s=patch(1);s.oscillators[0].unison=0;check(!validInstrumentState(s),"new state rejects zero count");
    // 16 MIDI voices x 3 oscillators x 16 lanes = 768 oscillator lanes.
    // Live controls, stealing, note release and state replacement; no callback allocations.
    for(double rate:{44100.,48000.,96000.})for(unsigned block:{1u,17u,128u,1024u}) {
        auto e=std::make_unique<OrigamiEngine>();check(e->prepare(rate,1024,2),"stress prepares sample rate");s=patch(16,OscillatorPhaseMode::Random);s.oscillators[1]=s.oscillators[0];s.oscillators[1].id=2;s.oscillators[2]=s.oscillators[0];s.oscillators[2].id=3;s.nextId=4;
        check(e->restoreInstrumentState(s),"stress restores three oscillators");for(int n=0;n<16;++n)e->noteOn(48+n,.2f);
        std::array<float,1024> l{},r{};float* out[]{l.data(),r.data()};
        for(int b=0;b<40;++b) {
            set(*e,ParameterId::OscUnison,float(1+(b*7)%16));set(*e,ParameterId::OscDetune,float((b*13)%101));
            if(b%4==0){e->noteOff(48+b%16);e->noteOn(48+(b+5)%24,.2f);}
            if(b==20){check(e->restoreInstrumentState(s),"stress preset replacement");for(int n=0;n<16;++n)e->noteOn(48+n,.2f);}
            allocations.store(0);frees.store(0);guardAllocations.store(true);const bool ok=e->process(out,2,block);guardAllocations.store(false);
            check(ok,"stress processes");
#ifndef ORIGAMI_SANITIZED
            check(!allocations.load() && !frees.load(),"unison audio callback has zero allocations/frees");
#endif
            for(unsigned n=0;n<block;++n)check(std::isfinite(l[n]) && std::isfinite(r[n]) && std::abs(l[n])<4 && std::abs(r[n])<4,"rapid count/detune/note stress finite and bounded");
        }
    }
    for(unsigned count:{1u,2u,4u,8u,16u}) {
        auto e=std::make_unique<OrigamiEngine>();e->prepare(48000,256,2);s=patch(count);for(unsigned m=1;m<3;++m){s.oscillators[m]=s.oscillators[0];s.oscillators[m].id=m+1;}s.nextId=4;e->restoreInstrumentState(s);for(int n=0;n<16;++n)e->noteOn(48+n,.2f);check(e->activeVoiceCount()==16,"benchmark really admits sixteen MIDI voices");
        std::array<float,256> l{},r{};float* out[]{l.data(),r.data()};for(int b=0;b<20;++b)e->process(out,2,256);
        const auto start=std::chrono::steady_clock::now();for(int b=0;b<80;++b)e->process(out,2,256);const double ms=std::chrono::duration<double,std::milli>(std::chrono::steady_clock::now()-start).count()/80;
        std::cout<<"Unison CPU: 16 MIDI voices x 3 oscillators x "<<count<<" lanes: "<<ms<<" ms/256; deadline 5.333 ms\n";
    }
}
}
