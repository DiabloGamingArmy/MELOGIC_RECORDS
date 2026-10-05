// mct-origami-v31.0.0-matrix-routing-expansion
// mct-origami-modulation-completion-v24.0.1
#include <memory>
#include "core/Engine.h"
#include "core/modulation/Modulation.h"
#include "core/preset/StateCodec.h"
#include <array>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <vector>
#include <algorithm>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <string>
#include <thread>

using namespace mct::origami;

namespace {
unsigned checks=0;
void check(bool ok,const char* label) {
    ++checks;
    if(!ok) throw std::runtime_error(label);
}
bool near(float a,float b,float eps=1.0e-4f) {
    return std::abs(a-b)<=eps;
}

std::array<OscillatorModuleState,16> modules() {
    std::array<OscillatorModuleState,16> m{};
    m[0].id=1;m[0].enabled=true;m[0].tableId=dsp::BuiltinWavetableId::BasicShapes;
    m[0].wtPosition=.25f;m[0].waveform=.75f;m[0].unison=1;m[0].level=.7f;
    m[1].id=2;m[1].enabled=true;m[1].tableId=dsp::BuiltinWavetableId::BasicShapes;
    m[1].wtPosition=.75f;m[1].waveform=2.25f;m[1].unison=1;m[1].level=.5f;
    return m;
}

ModRoute route(std::uint32_t id,ModSource source,ModDestination destination,
               float amount,OscillatorModuleId osc=0) {
    ModRoute r;
    r.id=id;r.enabled=true;r.source=source;
    r.destination={destination,osc};r.amount=amount;
    return r;
}

void identitiesAndValidation() {
    auto m=modules();
    ModulationState state;
    state.nextRouteId=3;
    state.routes[0]=route(1,ModSource::Lfo1,ModDestination::Cutoff,.5f);
    state.routes[1]=route(2,ModSource::Macro1,ModDestination::WtPosition,-.25f,2);
    check(validModulation(state,m),"valid mixed global/local routes");

    auto bad=state;
    bad.routes[1].destination.oscillator=99;
    check(!validModulation(bad,m),"missing oscillator destination rejected");

    bad=state;bad.routes[0].destination.oscillator=1;
    check(!validModulation(bad,m),"global destination cannot carry oscillator id");

    bad=state;bad.routes[0].amount=1.01f;
    check(!validModulation(bad,m),"route amount bounded");

    bad=state;bad.routes[1].id=1;
    check(!validModulation(bad,m),"route IDs must remain strictly ordered");

    bad=state;bad.nextRouteId=2;
    check(!validModulation(bad,m),"next route id must exceed live IDs");
}

void lfoContract() {
    for(auto shape:{LfoShape::Sine,LfoShape::Triangle,LfoShape::Saw,LfoShape::Square}) {
        for(int i=0;i<=128;++i) {
            const float v=Lfo::shape(shape,double(i)/128.0);
            check(std::isfinite(v) && v>=-1.0001f && v<=1.0001f,"LFO shape remains bipolar and finite");
        }
    }
    check(near(Lfo::shape(LfoShape::Sine,0),0),"sine reset phase");
    check(near(Lfo::shape(LfoShape::Square,0),1),"square reset phase");

    Lfo a,b;
    LfoSettings s;s.shape=LfoShape::Saw;s.rateHz=2;
    for(int i=0;i<500;++i)
        check(near(a.next(s,48000),b.next(s,48000),1e-7f),"LFO deterministic from reset");
}

void normalizationContract() {
    for(auto d:{ModDestination::Resonance,ModDestination::MasterGain,
                ModDestination::WtPosition,ModDestination::Fine,
                ModDestination::Detune,ModDestination::Pan,ModDestination::Level}) {
        for(float n:{0.f,.2f,.5f,.8f,1.f}) {
            const float physical=modulationFromNormalized(d,n);
            check(near(modulationToNormalized(d,physical),n,2e-4f),"normalized destination round trip");
        }
    }
    for(float n:{0.f,.1f,.5f,.9f,1.f}) {
        const float physical=modulationFromNormalized(ModDestination::Cutoff,n);
        check(near(modulationToNormalized(ModDestination::Cutoff,physical),n,2e-4f),"log cutoff round trip");
    }
}

void compiledRoutes() {
    auto m=modules();

    ModulationState state;
    state.macros[0]=.5f;
    state.nextRouteId=2;
    state.routes[0]=route(1,ModSource::Macro1,ModDestination::WtPosition,.4f,2);

    CompiledModulation compiled;
    compiled.compile(state,m,true);
    ModulationFrame frame;frame.modules=m;
    std::array<float,CompiledModulation::globalSourceCount> sources{};sources[4]=.5f;
    compiled.globalFrame(frame,sources,48000);

    check(near(m[1].wtPosition,.75f),"stored oscillator base remains unchanged");
    check(near(frame.modules[0].wtPosition,.25f),"OSC1 unaffected by OSC2 route");
    check(near(frame.modules[1].wtPosition,.95f),"OSC2 local route applied independently");

    state.routes[0].amount=-.5f;
    compiled.compile(state,m,true);
    frame={};frame.modules=m;
    compiled.globalFrame(frame,sources,48000);
    check(near(frame.modules[1].wtPosition,.5f),"negative modulation amount subtracts");

    state.nextRouteId=3;
    state.routes[0]=route(1,ModSource::Macro1,ModDestination::Pan,.25f,1);
    state.routes[1]=route(2,ModSource::Macro2,ModDestination::Pan,.25f,1);
    compiled.compile(state,m,true);
    frame={};frame.modules=m;
    std::array<float,CompiledModulation::globalSourceCount> summed{};summed[4]=1;summed[5]=1;
    compiled.globalFrame(frame,summed,48000);
    check(near(frame.modules[0].pan,1.f),"same destination routes sum then clamp");

    state.routes[0]=route(1,ModSource::Macro1,ModDestination::WtPosition,1.f,1);
    state.routes[1]={};state.nextRouteId=2;
    compiled.compile(state,m,true);
    frame={};frame.modules=m;
    compiled.globalFrame(frame,summed,48000);
    check(near(frame.modules[0].wtPosition,1.f),"effective modulation clamps at destination limit");

    state.routes[0]=route(1,ModSource::Macro1,ModDestination::Cutoff,.1f);
    compiled.compile(state,m,true);
    frame={};frame.modules=m;frame.cutoff=1000;frame.resonance=.1f;frame.master=.2f;
    std::array<float,CompiledModulation::globalSourceCount> cutoffSource{};cutoffSource[4]=1;
    compiled.globalFrame(frame,cutoffSource,48000);
    check(frame.cutoff>1000 && frame.cutoff<=20000,"global cutoff route increases effective cutoff");
}


void expandedSources() {
    auto m=modules();ModulationState state;state.nextRouteId=9;
    state.routes[0]=route(1,ModSource::Lfo2,ModDestination::Pan,.2f,1);
    state.routes[1]=route(2,ModSource::Env2,ModDestination::Level,.3f,1);
    state.routes[2]=route(3,ModSource::Velocity,ModDestination::WtPosition,.2f,1);
    state.routes[3]=route(4,ModSource::Keytrack,ModDestination::Fine,.1f,1);
    state.routes[4]=route(5,ModSource::Aftertouch,ModDestination::Cutoff,.2f);
    state.routes[5]=route(6,ModSource::Random,ModDestination::Resonance,.1f);
    state.routes[6]=route(7,ModSource::PitchBend,ModDestination::Process1Amount,.4f,1);
    state.routes[7]=route(8,ModSource::NoteGate,ModDestination::Route1Amount,.5f,1);
    check(validModulation(state,m),"expanded sources validate");
    CompiledModulation compiled;compiled.compile(state,m,true);
    ModulationFrame frame;frame.modules=m;frame.cutoff=1000;frame.resonance=.1f;frame.master=.2f;
    std::array<float,CompiledModulation::globalSourceCount> global{};global[1]=1;global[8]=1;
    compiled.globalFrame(frame,global,48000);
    std::array<float,CompiledModulation::voiceSourceCount> voice{};
    voice[1]=1;voice[7]=1;voice[9]=.75f;voice[10]=1;voice[11]=1;voice[12]=1;
    compiled.voiceFrame(frame,voice,48000);
    check(frame.modules[0].pan>m[0].pan,"LFO2 route reaches destination");
    check(frame.modules[0].level>m[0].level,"ENV2 route reaches destination");
    check(frame.modules[0].wtPosition>m[0].wtPosition,"velocity route reaches destination");
    check(frame.cutoff>1000,"aftertouch route reaches filter");
    check(frame.modules[0].process1Amount>m[0].process1Amount,"pitch bend reaches OSC process amount");
    check(frame.modules[0].route1Amount>m[0].route1Amount,"note gate reaches OSC routing amount");
}

void stateV3RoundTrip() {
    auto engineOwner=std::make_unique<OrigamiEngine>();auto& engine=*engineOwner;
    const auto osc2=engine.addOscillatorModule();
    check(osc2==2,"second oscillator stable id");

    auto state=engine.instrumentState();
    state.modulation.lfo1.shape=LfoShape::Triangle;
    state.modulation.lfo1.mode=LfoMode::Loop;
    state.modulation.lfo1.rateHz=3.5f;
    state.modulation.lfo2.shape=LfoShape::Square;state.modulation.lfo2.mode=LfoMode::Loop;state.modulation.lfo2.rateHz=7.0f;
    state.modulation.env2={.02f,.3f,.4f,.5f};state.modulation.env3={.03f,.2f,.6f,.7f};
    state.modulation.random.rateHz=5.0f;state.modulation.function.rateHz=2.5f;state.modulation.function.curve=.4f;
    state.modulation.macros={.1f,.2f,.3f,.4f};
    state.modulation.nextRouteId=3;
    state.modulation.routes[0]=route(1,ModSource::Lfo1,ModDestination::WtPosition,.7f,osc2);
    state.modulation.routes[1]=route(2,ModSource::Macro4,ModDestination::Cutoff,-.3f);

    check(engine.setModulationState(state.modulation),"engine accepts valid modulation state");
    const auto encoded=encodeInstrumentState(engine.instrumentState());
    check(!encoded.empty(),"state v3 encoded");

    InstrumentState decoded;
    check(decodeInstrumentState(encoded.data(),encoded.size(),decoded),"state v3 decoded");
    check(decoded.modulation.lfo1.shape==LfoShape::Triangle,"LFO shape persisted");
    check(decoded.modulation.lfo1.mode==LfoMode::Loop,"LFO mode persisted");
    check(near(decoded.modulation.lfo1.rateHz,3.5f),"LFO rate persisted");
    check(decoded.modulation.lfo2.shape==LfoShape::Square && decoded.modulation.lfo2.mode==LfoMode::Loop && near(decoded.modulation.lfo2.rateHz,7.0f),"LFO2 persisted");
    check(near(decoded.modulation.env2.attack,.02f) && near(decoded.modulation.env3.release,.7f),"ENV2/3 persisted");
    check(near(decoded.modulation.random.rateHz,5.0f) && near(decoded.modulation.function.curve,.4f),"random/function persisted");
    check(decoded.modulation.macros==std::array<float,maxMacros>{.1f,.2f,.3f,.4f},"macro values persisted");
    check(decoded.modulation.routes[0].destination.oscillator==osc2,"stable oscillator destination persisted");
    check(decoded.modulation.routes[1].destination.parameter==ModDestination::Cutoff,"global destination persisted");

    auto restoredOwner=std::make_unique<OrigamiEngine>();auto& restored=*restoredOwner;
    check(restored.restoreInstrumentState(decoded),"engine restores v3 modulation state");
    check(encodeInstrumentState(restored.instrumentState())==encoded,"v3 modulation state exact round trip");

    for(std::size_t n=0;n<encoded.size();++n) {
        InstrumentState unchanged=decoded;
        check(!decodeInstrumentState(encoded.data(),n,unchanged),"truncated v3 state rejected");
        check(encodeInstrumentState(unchanged)==encoded,"failed v3 decode is transactional");
    }
}

void renderSeparation() {
    auto dryOwner=std::make_unique<OrigamiEngine>();auto& dry=*dryOwner;auto modOwner=std::make_unique<OrigamiEngine>();auto& mod=*modOwner;
    check(dry.prepare(48000,256,2) && mod.prepare(48000,256,2),"engines prepared");

    auto ms=mod.instrumentState().modulation;
    ms.macros[0]=1;
    ms.nextRouteId=2;
    ms.routes[0]=route(1,ModSource::Macro1,ModDestination::WtPosition,.3f,1);
    check(mod.setModulationState(ms),"render modulation installed");
    check(near(dry.parameterState()[0],mod.parameterState()[0]),"base WT parameter remains equal");

    dry.noteOn(60,.8f);mod.noteOn(60,.8f);
    std::array<float,256> dl{},dr{},ml{},mr{};
    float* dp[]{dl.data(),dr.data()};float* mp[]{ml.data(),mr.data()};
    check(dry.process(dp,2,256) && mod.process(mp,2,256),"render paths succeed");

    bool different=false;
    for(std::size_t i=0;i<dl.size();++i)
        if(std::abs(dl[i]-ml[i])>1e-6f || std::abs(dr[i]-mr[i])>1e-6f) {different=true;break;}
    check(different,"modulation changes effective audio without changing base state");
}
// ---- mct-origami-lfo-function-processing --------------------------------
// The accepted pre-FUNC LFO, frozen here as the neutral-identity reference.
struct LegacyLfo {
    double phase=0;
    float next(const LfoSettings& s,double sampleRate) noexcept {
        if(s.mode==LfoMode::Envelope && phase>=1.0) {
            if(s.pointCount>=2 && s.pointCount<=s.points.size()) return s.points[s.pointCount-1].y;
            return Lfo::shape(s.shape,0.999999);
        }
        const float out=Lfo::mseg(s,phase);
        if(std::isfinite(sampleRate) && sampleRate>0 && std::isfinite(s.rateHz)) {
            phase+=std::clamp(double(s.rateHz),.01,40.)/sampleRate;
            if(s.mode==LfoMode::Envelope) phase=std::min(1.0,phase); else phase-=std::floor(phase);
        }
        return out;
    }
};
LfoSettings curveLfo(std::initializer_list<LfoPoint> pts,LfoMode mode=LfoMode::Loop,float rate=1.0f) {
    LfoSettings s; s.mode=mode; s.rateHz=rate; s.pointCount=0;
    for(const auto& p:pts) s.points[s.pointCount++]=p;
    return s;
}
std::vector<float> run(const LfoSettings& s,std::size_t n,double sr=48000.0,std::uint32_t stream=Lfo::globalStream(0)) {
    Lfo l; l.reset(); l.setStreams(stream,Lfo::fractureSeed(0));
    std::vector<float> out(n); for(auto& v:out) v=l.next(s,sr); return out;
}
double totalVariation(const std::vector<float>& y,std::size_t from,std::size_t to) {
    double tv=0; for(std::size_t i=from+1;i<to;++i) tv+=std::abs(double(y[i])-double(y[i-1])); return tv;
}
float maxStep(const std::vector<float>& y,std::size_t from=1) { float m=0; for(std::size_t i=std::max<std::size_t>(1,from);i<y.size();++i) m=std::max(m,std::abs(y[i]-y[i-1])); return m; }
bool allFinite(const std::vector<float>& y) { for(float v:y) if(!std::isfinite(v) || v<-1.0f || v>1.0f) return false; return true; }

void lfoFunctionProcessing() {
    const auto ramp=curveLfo({{0,-1,0},{1,1,0}});
    const auto custom=curveLfo({{0,0,0},{.2f,.9f,.3f},{.35f,-.2f,-.4f},{.6f,1,0},{.8f,-.8f,.5f},{1,0,0}});
    LfoSettings sine; sine.mode=LfoMode::Loop; sine.rateHz=2.0f;
    LfoSettings square=sine; square.shape=LfoShape::Square;

    // ---- neutral identity: bit-identical to the accepted LFO ---------------
    {
        std::vector<LfoSettings> cases;
        for(auto mode:{LfoMode::Free,LfoMode::Loop,LfoMode::Envelope})
            for(auto base:{sine,square,custom,ramp})
                for(float rate:{.01f,.37f,2.0f,13.0f,40.0f}) { auto c=base; c.mode=mode; c.rateHz=rate; cases.push_back(c); }
        for(auto c:cases) for(auto sh:{LfoShape::Saw,LfoShape::Triangle}) if(c.pointCount==0) { c.shape=sh; cases.push_back(c); break; }
        bool identical=true;
        for(const auto& c:cases) {
            check(lfoFunctionsNeutral(c),"defaults are neutral");
            Lfo a; LegacyLfo b; a.reset();
            for(int i=0;i<96000;++i) { const float x=a.next(c,48000.0),y=b.next(c,48000.0); identical&=std::memcmp(&x,&y,sizeof(float))==0; }
            Lfo r; LegacyLfo q; r.reset();
            for(int i=0;i<4410;++i) { const float x=r.next(c,44100.0),y=q.next(c,44100.0); identical&=std::memcmp(&x,&y,sizeof(float))==0; }
        }
        check(identical,"all-neutral FUNC: bit-identical to the pre-FUNC LFO (Free/Loop/Envelope x shapes x rates x sample rates)");
    }

    // ---- PING-PONG ------------------------------------------------------------
    {
        auto pp=ramp; pp.pingPong=true;           // ramp: curve(r) = 2r - 1
        const auto y=run(pp,4000,1000.0);         // 1 Hz @ 1 kHz: period = 1000 samples
        check(near(y[0],-1.0f,1e-6f) && near(y[250],0.0f,1e-4f) && y[500]==1.0f && near(y[750],0.0f,1e-4f) && near(y[1000],-1.0f,1e-4f),
              "PING-PONG: left end, forward half, right end (exactly once), reverse half, left end");
        bool forward=true,reverse=true; for(int i=1;i<=500;++i) forward&=y[i]>y[i-1]; for(int i=501;i<=1000;++i) reverse&=y[i]<y[i-1];
        check(forward && reverse,"PING-PONG: strictly forward for half a period, strictly reverse for the other half");
        check(y[499]<1.0f && y[501]<1.0f && near(y[499],y[501],1e-5f),"PING-PONG: the boundary sample is not held or duplicated (symmetric neighbours)");
        bool periodic=true; for(int i=0;i<3000;++i) periodic&=near(y[i],y[i+1000],2e-5f);
        check(periodic,"PING-PONG period = 1/rate (one full 0 -> 1 -> 0 round trip per cycle), multiple cycles");
        auto pp2=pp; pp2.rateHz=4.0f; const auto z=run(pp2,1000,1000.0);
        check(z[125]==1.0f && near(z[250],-1.0f,1e-4f),"PING-PONG at 4 Hz: right end at 1/8 s, back at 1/4 s");
        Lfo l; l.reset(); for(int i=0;i<700;++i) l.next(pp,1000.0);
        l.reset(); const float a=l.next(pp,1000.0),b=l.next(pp,1000.0);
        check(near(a,-1.0f,1e-6f) && b>a,"PING-PONG retrigger restarts at the left end, moving forward");
        auto pc=custom; pc.pingPong=true; const auto c=run(pc,1000,1000.0);
        bool follows=true; for(int i=0;i<1000;++i) follows&=near(c[i],Lfo::mseg(custom,Lfo::pingPongPhase(i/1000.0)),1e-4f) || (i==500 && near(c[i],0.0f,1e-6f));
        check(follows,"PING-PONG reads the custom curve through the reflected position (no copied points)");
        auto pe=pp; pe.mode=LfoMode::Envelope; const auto e=run(pe,3000,1000.0);
        check(e[500]==1.0f && near(e[999],-1.0f,.01f) && e[1500]==e[2999],"ENVELOPE + PING-PONG: one round trip, then holds (no loop)");
    }

    // ---- SMOOTH ----------------------------------------------------------------
    {
        auto sq=square; const auto raw=run(sq,24000);
        sq.smooth=.5f; const auto soft=run(sq,24000);
        check(maxStep(raw)>1.9f && maxStep(soft)<.05f,"SMOOTH softens square edges (max step 2 -> < 0.05)");
        bool moving=true; for(std::size_t i=12000;i<24000;++i) moving&=std::isfinite(soft[i]);
        check(moving && allFinite(soft),"SMOOTH output bounded and finite");
        auto stepped=curveLfo({{0,-1,0},{.25f,-1,0},{.2501f,.5f,0},{.5f,.5f,0},{.5001f,1,0},{1,1,0}},LfoMode::Loop,2.0f);
        const auto s0=run(stepped,24000); stepped.smooth=.4f; const auto s1=run(stepped,24000);
        check(maxStep(s1)<maxStep(s0)*.1f,"SMOOTH rounds a stepped custom curve");
        auto at=[&](double sr){ auto s=square; s.smooth=.6f; Lfo l; l.reset(); float v=0; const auto n=static_cast<std::size_t>(sr*.3); for(std::size_t i=0;i<n;++i) v=l.next(s,sr); return v; };
        check(near(at(48000.0),at(96000.0),.01f) && near(at(44100.0),at(96000.0),.01f),"SMOOTH is sample-rate independent (same value at 0.3 s at 44.1 / 48 / 96 kHz)");
        auto s=square; s.smooth=.7f;
        Lfo a,b,solo; a.reset(); b.reset(); solo.reset();
        std::vector<float> ya,ys;
        for(int i=0;i<20000;++i) { ya.push_back(a.next(s,48000.0)); if(i%3==0) b.reset(); b.next(s,48000.0); ys.push_back(solo.next(s,48000.0)); }
        check(ya==ys,"per-voice SMOOTH history is independent (another voice's retriggers never leak in)");
    }

    // ---- DELAY / ATTACK --------------------------------------------------------
    {
        LfoSettings sq=square; sq.delaySeconds=.01f;       // 480 samples
        const auto y=run(sq,2000);
        bool silent=true; for(int i=0;i<480;++i) silent&=y[i]==0.0f;
        check(silent && y[480]==1.0f,"DELAY: exact onset (0 for 480 samples, then the cycle starts at its beginning)");
        auto flat=curveLfo({{0,1,0},{1,1,0}}); flat.delaySeconds=.01f; flat.attackSeconds=.01f;
        const auto g=run(flat,2000);
        bool mono=true; for(int i=481;i<=960;++i) mono&=g[i]>=g[i-1];
        check(g[479]==0.0f && g[480]==0.0f && near(g[720],.5f,1e-3f) && g[960]==1.0f && g[1500]==1.0f && mono,
              "DELAY then ATTACK: fade starts at onset, monotonic, half at mid-attack, full depth after");
        auto nod=flat; nod.delaySeconds=0; nod.attackSeconds=0; check(run(nod,10)[0]==1.0f,"ATTACK 0 = full depth immediately");
        Lfo l; l.reset(); for(int i=0;i<1500;++i) l.next(flat,48000.0);
        l.reset(); float first=l.next(flat,48000.0); bool again=first==0.0f; for(int i=1;i<480;++i) again&=l.next(flat,48000.0)==0.0f;
        check(again,"RETRIGGER restarts DELAY and ATTACK");
        auto env=ramp; env.mode=LfoMode::Envelope; env.rateHz=10.0f; env.delaySeconds=.01f;
        const auto e=run(env,48000);
        check(e[479]==0.0f && near(e[480],-1.0f,1e-6f) && e[480+4800+10]==1.0f && e[30000]==1.0f,"DELAY + ENVELOPE: one-shot starts after the delay, then holds the end");
        auto ppd=ramp; ppd.pingPong=true; ppd.delaySeconds=.01f; const auto p=run(ppd,48000*1);
        check(p[479]==0.0f && near(p[480],-1.0f,1e-6f) && p[480+24000]==1.0f,"DELAY + PING-PONG: traversal starts at the left end after the delay");
        // FREE: the same runtime, owned by the engine; only engine reset restarts it (see engine checks).
    }

    // ---- PHASE -----------------------------------------------------------------
    {
        const std::size_t period=1000;
        const auto base=run(custom,4000,1000.0);
        for(float deg:{0.0f,90.0f,180.0f,270.0f}) {
            auto s=custom; s.phase=deg/360.0f; const auto y=run(s,3000,1000.0);
            const auto shift=static_cast<std::size_t>(std::lround(deg/360.0f*period));
            bool ok=true; for(std::size_t i=0;i<2000;++i) ok&=near(y[i],base[i+shift],2e-4f);
            check(ok,(std::string("PHASE ")+std::to_string(int(deg))+" deg = the base curve read a quarter-multiple later").c_str());
        }
        auto full=custom; full.phase=1.0f; const auto w=run(full,3000,1000.0);
        bool wraps=true; for(std::size_t i=0;i<3000;++i) wraps&=near(w[i],base[i],1e-5f);
        check(wraps,"PHASE 360 deg wraps to 0 deg");
        auto env=ramp; env.mode=LfoMode::Envelope; env.phase=.25f; const auto e=run(env,3000,1000.0);
        check(near(e[0],-.5f,1e-4f) && near(e[740],.98f,.01f) && near(e[760],-.98f,.01f) && near(e[1500],-.5f,1e-4f) && e[1500]==e[2999],
              "ENVELOPE + PHASE: one cycle starting at 90 deg, ends where it began and holds (never loops)");
        auto pp=ramp; pp.pingPong=true; pp.phase=.5f; const auto p=run(pp,1000,1000.0);
        check(p[0]==1.0f && near(p[500],-1.0f,1e-4f),"PING-PONG + PHASE 180 deg starts at the right end");
        auto fr=custom; fr.mode=LfoMode::Free; fr.phase=.25f; const auto f=run(fr,2000,1000.0);
        bool same=true; for(std::size_t i=0;i<1500;++i) same&=near(f[i],base[i+250],2e-4f);
        check(same,"PHASE on a FREE LFO");
        check(custom.points[1].x==.2f && custom.points[1].y==.9f,"FUNC never moves the user's points");
    }

    // ---- SKEW -----------------------------------------------------------------
    {
        bool exact=true; for(int i=0;i<=1000;++i) exact&=Lfo::skewPhase(i/1000.0,0.0f)==i/1000.0;
        check(exact,"SKEW 0 = exact identity");
        for(float k:{-1.0f,-.999f,-.5f,-.1f,.1f,.5f,.999f,1.0f}) {
            bool mono=true,finite=true; double prev=-1;
            for(int i=0;i<=10000;++i) { const double v=Lfo::skewPhase(i/10000.0,k); finite&=std::isfinite(v) && v>=0 && v<=1; mono&=v>prev; prev=v; }
            check(Lfo::skewPhase(0,k)==0.0 && Lfo::skewPhase(1,k)==1.0 && mono && finite,(std::string("SKEW ")+std::to_string(k)+": f(0)=0, f(1)=1, strictly monotonic, finite").c_str());
        }
        check(near(float(Lfo::skewPhase(.725,.5f)),.5f,1e-6f) && near(float(Lfo::skewPhase(.275,-.5f)),.5f,1e-6f),"SKEW moves the half-cycle point (+50% -> 0.725, -50% -> 0.275)");
        auto tri=curveLfo({{0,-1,0},{.5f,1,0},{1,-1,0}}); tri.skew=.5f;
        const auto y=run(tri,1000,1000.0);
        const auto peak=static_cast<int>(std::max_element(y.begin(),y.end())-y.begin());
        check(std::abs(peak-725)<=1 && near(*std::max_element(y.begin(),y.end()),1.0f,1e-3f) && near(*std::min_element(y.begin(),y.end()),-1.0f,1e-3f),
              "SKEW +50%: slow rise / fast fall, peak moves to 72.5% with the same extrema");
    }

    // ---- QUANTIZE ----------------------------------------------------------------
    {
        check(Lfo::quantizeLevels(0)==0 && Lfo::quantizeLevels(1)==2 && Lfo::quantizeLevels(.2f)==32 && Lfo::quantizeLevels(.6f)==8 && Lfo::quantizeLevels(.8f)==4,
              "QUANTIZE mapping: off, 32 @ 20%, 8 @ 60%, 4 @ 80%, 2 @ 100%");
        bool decreasing=true; int last=1000; for(int i=1;i<=100;++i) { const int L=Lfo::quantizeLevels(i/100.0f); decreasing&=L<=last && L>=2; last=L; }
        check(decreasing,"QUANTIZE levels fall monotonically over the knob travel");
        for(float q:{.2f,.6f,.8f,1.0f}) {
            auto s=sine; s.quantize=q; const auto y=run(s,48000);
            std::vector<float> levels(y.begin(),y.end()); std::sort(levels.begin(),levels.end()); levels.erase(std::unique(levels.begin(),levels.end()),levels.end());
            check(int(levels.size())==Lfo::quantizeLevels(q) && allFinite(y) && levels.front()==-1.0f && levels.back()==1.0f,
                  (std::string("QUANTIZE ")+std::to_string(q)+": exactly the level count, both polarities, bounded").c_str());
        }
        auto three=custom; three.quantize=.85f; const int L=Lfo::quantizeLevels(.85f);
        const auto c=run(three,2000,1000.0); bool onGrid=true;
        for(float v:c) { const float t=(v+1.0f)*.5f*float(L-1); onGrid&=near(t,std::round(t),1e-4f); }
        check(onGrid,"QUANTIZE on a custom curve lands on the level grid");
        auto qs=sine; qs.quantize=.8f; const auto hard=run(qs,24000); qs.smooth=.4f; const auto soft=run(qs,24000);
        check(maxStep(soft)<maxStep(hard)*.2f,"QUANTIZE + SMOOTH: steps are slewed");
        auto qf=sine; qf.quantize=.8f; qf.fracture=.8f; const auto qfy=run(qf,24000);
        std::vector<float> lv(qfy.begin(),qfy.end()); std::sort(lv.begin(),lv.end()); lv.erase(std::unique(lv.begin(),lv.end()),lv.end());
        check(int(lv.size())<=4 && allFinite(qfy),"QUANTIZE + FRACTURE stays on 4 levels");
    }

    // ---- ENTROPY ----------------------------------------------------------------
    std::vector<float> entropyOut,fractureOut;
    {
        auto e=sine; e.entropy=.6f;
        const auto a=run(e,96000),b=run(e,96000);
        check(a==b,"ENTROPY deterministic: same state + same stream = identical output");
        const auto other=run(e,96000,48000.0,Lfo::voiceStream(1234u,0));
        double diff=0; for(std::size_t i=0;i<a.size();++i) diff=std::max(diff,double(std::abs(a[i]-other[i])));
        check(diff>.1,"ENTROPY: a different voice stream gives a different trajectory");
        check(allFinite(a),"ENTROPY bounded / finite");
        const auto base=run(sine,96000);
        auto lo=sine; lo.entropy=.2f; const auto l=run(lo,96000);
        check(maxStep(l)<maxStep(base)*1.6f,"ENTROPY low: no sample-level jitter (max step stays near the base curve's)");
        double dev=0; for(std::size_t i=0;i<l.size();++i) dev=std::max(dev,double(std::abs(l[i]-base[i])));
        check(dev>.005 && dev<.35,"ENTROPY low: subtle but present");
        // Evolving: cycles differ from each other (2 Hz -> 24000 samples per cycle).
        double cycleDiff=0; for(std::size_t i=0;i<24000;++i) cycleDiff=std::max(cycleDiff,double(std::abs(a[24000+i]-a[72000+i])));
        check(cycleDiff>.1,"ENTROPY evolves from cycle to cycle");
        check(Lfo::voiceStream(1u,0)!=Lfo::voiceStream(2u,0) && Lfo::voiceStream(1u,0)!=Lfo::voiceStream(1u,1) && Lfo::globalStream(0)!=Lfo::globalStream(1),
              "distinct deterministic streams per voice lifecycle and per LFO");
        entropyOut=a;
    }

    // ---- FRACTURE ---------------------------------------------------------------
    {
        bool identity=true; for(int i=0;i<1000;++i) identity&=Lfo::fracturePhase(i/1000.0,0.0f,7u)==i/1000.0;
        check(identity,"FRACTURE 0 = exact identity");
        std::vector<double> tv;
        for(float f:{0.0f,.33f,.66f,1.0f}) { auto s=sine; s.rateHz=1.0f; s.fracture=f; const auto y=run(s,4800,4800.0); tv.push_back(totalVariation(y,0,4800)); check(allFinite(y),"FRACTURE bounded / finite"); }
        check(tv[0]<tv[1] && tv[1]<tv[2] && tv[2]<tv[3] && tv[3]>3.0*tv[0],"FRACTURE: structure (total variation per cycle) rises with the knob");
        auto s=sine; s.fracture=.8f; check(run(s,48000)==run(s,48000),"FRACTURE deterministic");
        auto c=custom; c.fracture=.9f; check(allFinite(run(c,48000)),"FRACTURE on a custom curve stays valid");
        bool inRange=true; for(int i=0;i<10000;++i) { const double r=Lfo::fracturePhase(i/10000.0,1.0f,Lfo::fractureSeed(2)); inRange&=r>=0.0 && r<1.0; }
        check(inRange,"FRACTURE read position stays inside the cycle");
        auto f=sine; f.fracture=.6f; fractureOut=run(f,96000);
    }

    // ---- ENTROPY vs FRACTURE: different transforms --------------------------
    {
        const auto base=run(sine,96000);
        const auto cycleChange=[](const std::vector<float>& y){ double d=0; for(std::size_t i=0;i<24000;++i) d=std::max(d,double(std::abs(y[24000+i]-y[72000+i]))); return d; };
        const double tvBase=totalVariation(base,24000,48000),tvE=totalVariation(entropyOut,24000,48000),tvF=totalVariation(fractureOut,24000,48000);
        check(cycleChange(entropyOut)>.1 && cycleChange(fractureOut)<1e-4,"ENTROPY evolves cycle to cycle; FRACTURE repeats its structure exactly");
        check(tvF>2.0*tvBase && tvE<1.5*tvBase,"FRACTURE multiplies structure (total variation); ENTROPY keeps the base's smoothness");
        check(maxStep(fractureOut)>.2f && maxStep(entropyOut)<.01f,"FRACTURE fragments (jumps); ENTROPY stays continuous");
    }

    // ---- everything at once -------------------------------------------------
    {
        auto all=custom; all.rateHz=3.0f; all.pingPong=true; all.phase=.3f; all.skew=-.4f; all.entropy=.5f; all.fracture=.5f;
        all.quantize=.5f; all.smooth=.3f; all.delaySeconds=.02f; all.attackSeconds=.05f;
        for(auto mode:{LfoMode::Free,LfoMode::Loop,LfoMode::Envelope}) {
            all.mode=mode;
            const auto a=run(all,96000),b=run(all,96000);
            check(a==b && allFinite(a),"all FUNC + PING-PONG: deterministic, bounded, finite");
        }
    }

    // ---- engine: block-size independence, recompiles, routed source --------
    {
        const auto render=[&](const ModulationState& ms,int block,std::size_t total) {
            auto e=std::make_unique<OrigamiEngine>(); e->prepare(48000,1024,2); e->setModulationState(ms); e->reset();
            std::vector<float> outL; outL.reserve(total);
            std::array<float,1024> l{},r{};
            std::size_t done=0; bool second=false;
            e->noteOn(60,.8f);
            while(done<total) {
                if(!second && done>=total/2) { e->noteOn(67,.7f); second=true; }
                const auto n=static_cast<int>(std::min<std::size_t>(block,total-done));
                float* p[]{l.data(),r.data()}; e->process(p,2,n);
                outL.insert(outL.end(),l.begin(),l.begin()+n); done+=static_cast<std::size_t>(n);
            }
            return outL;
        };
        auto e0=std::make_unique<OrigamiEngine>();
        auto ms=e0->instrumentState().modulation;
        ms.lfo1=custom; ms.lfo1.mode=LfoMode::Loop; ms.lfo1.rateHz=5.0f; ms.lfo1.pingPong=true; ms.lfo1.phase=.2f; ms.lfo1.skew=.3f;
        ms.lfo1.entropy=.5f; ms.lfo1.fracture=.4f; ms.lfo1.quantize=.4f; ms.lfo1.smooth=.2f; ms.lfo1.delaySeconds=.01f; ms.lfo1.attackSeconds=.03f;
        ms.lfo2=sine; ms.lfo2.mode=LfoMode::Free; ms.lfo2.rateHz=3.0f; ms.lfo2.entropy=.4f; ms.lfo2.attackSeconds=.02f;
        ms.nextRouteId=3;
        ms.routes[0]=route(1,ModSource::Lfo1,ModDestination::Level,.6f,1);
        ms.routes[1]=route(2,ModSource::Lfo2,ModDestination::Cutoff,.5f);
        const auto ref=render(ms,256,24576);
        for(int block:{32,64,128,512,1024}) {
            const auto y=render(ms,block,24576);
            check(y==ref,(std::string("FUNC LFOs render identically at block size ")+std::to_string(block)).c_str());
        }
        auto ms2=ms; ms2.lfo1.pingPong=false;
        const auto pp=render(ms2,256,24576);
        bool differs=false; for(std::size_t i=0;i<pp.size();++i) differs|=pp[i]!=ref[i];
        check(differs,"the routed LFO source is the processed LFO (PING-PONG changes the render)");

        // FUNC changes never recompile the modulation plan.
        auto e=std::make_unique<OrigamiEngine>(); e->prepare(48000,256,2); e->setModulationState(ms); e->reset();
        std::array<float,256> l{},r{}; float* p[]{l.data(),r.data()};
        e->process(p,2,256);
        const auto before=e->nodesDiagnostics();
        for(int i=1;i<=20;++i) { auto m=ms; m.lfo1.smooth=i/40.0f; m.lfo1.skew=-i/40.0f; m.lfo1.phase=i/41.0f; m.lfo1.pingPong=i%2==0; e->setModulationState(m); e->process(p,2,256); }
        const auto after=e->nodesDiagnostics();
        check(after.compiles==before.compiles,"FUNC / PING-PONG edits never recompile the modulation plan");

        // Matrix / NODES consume the same processed source: a NODES operator
        // fed by LFO 1 sees the DELAY (0 until onset) exactly like a route.
        auto mn=ms; mn.lfo1=curveLfo({{0,1,0},{1,1,0}}); mn.lfo1.mode=LfoMode::Loop; mn.lfo1.delaySeconds=.1f;
        mn.operators[0]=makeControlOperator(ControlOpType::ScaleOffset,mn.nextOperatorId++);
        mn.operators[0].inputs[0]={ControlInput::Kind::Source,ModSource::Lfo1,0};
        mn.routes[2]=route(mn.nextRouteId++,operatorSource(mn.operators[0].id),ModDestination::WtPosition,.5f,1);
        auto en=std::make_unique<OrigamiEngine>(); check(en->prepare(48000,256,2) && en->setModulationState(mn),"LFO 1 -> route + NODES operator");
        en->reset(); en->noteOn(60,.8f);
        en->process(p,2,256);
        const auto& v1=en->runtimeVisualizationSnapshot();
        const float duringDelay=v1.sourceValues[3];
        const float opDuring=v1.routeSources[CompiledModulation::sourceSlotCount+0];
        for(int i=0;i<30;++i) en->process(p,2,256);
        const auto& v2=en->runtimeVisualizationSnapshot();
        check(duringDelay==0.0f && opDuring==0.0f && near(v2.sourceValues[3],1.0f,1e-6f) && near(v2.routeSources[CompiledModulation::sourceSlotCount+0],1.0f,1e-4f),
              "Matrix route and NODES operator both read the one processed LFO 1 (0 during DELAY, 1 after)");
    }

    // ---- state: v32 only when used; old states load neutral -------------------
    {
        auto e=std::make_unique<OrigamiEngine>();
        auto st=e->instrumentState();
        const auto plain=encodeInstrumentState(st);
        check(plain[7]<32,"all-neutral LFOs keep the older save version (byte-identical saves)");
        InstrumentState old; check(decodeInstrumentState(plain.data(),plain.size(),old),"old state decodes");
        bool neutral=true; for(std::size_t i=0;i<4;++i) neutral&=lfoFunctionsNeutral(lfoSettings(old.modulation,i));
        check(neutral && encodeInstrumentState(old)==plain,"old state: PING-PONG off, every FUNC value neutral, re-encodes identically");
        auto& l=st.modulation.lfo3; l.pingPong=true; l.smooth=.25f; l.attackSeconds=1.5f; l.delaySeconds=.75f; l.phase=.125f; l.skew=-.5f; l.quantize=.4f; l.entropy=.3f; l.fracture=.6f;
        const auto v32=encodeInstrumentState(st);
        InstrumentState back; check(v32[7]==32 && decodeInstrumentState(v32.data(),v32.size(),back),"FUNC state saves as v32");
        const auto& b=back.modulation.lfo3;
        check(b.pingPong && b.smooth==.25f && b.attackSeconds==1.5f && b.delaySeconds==.75f && b.phase==.125f && b.skew==-.5f && b.quantize==.4f && b.entropy==.3f && b.fracture==.6f &&
              lfoFunctionsNeutral(back.modulation.lfo1) && encodeInstrumentState(back)==v32,"v32 round trip (exact)");
        for(std::size_t n=0;n<v32.size();n+=7) { InstrumentState t; check(!decodeInstrumentState(v32.data(),n,t),"truncated v32 rejected"); }
        auto badState=st; badState.modulation.lfo3.skew=2.0f;
        auto e2=std::make_unique<OrigamiEngine>(); check(!e2->setModulationState(badState.modulation),"out-of-range FUNC values are rejected");
    }
}

// ---- mct-origami-stereo-modulation ----------------------------------------
std::pair<std::vector<float>,std::vector<float>> runStereo(const LfoSettings& s,std::size_t n,double sr=48000.0,std::uint32_t stream=Lfo::globalStream(0)) {
    Lfo l; l.reset(); l.setStreams(stream,Lfo::fractureSeed(0));
    std::vector<float> left(n),right(n);
    for(std::size_t i=0;i<n;++i) left[i]=l.nextStereo(s,sr,right[i]);
    return {left,right};
}
void lfoStereoModulation() {
    const auto ramp=curveLfo({{0,-1,0},{1,1,0}});
    const auto custom=curveLfo({{0,0,0},{.2f,.9f,.3f},{.35f,-.2f,-.4f},{.6f,1,0},{.8f,-.8f,.5f},{1,0,0}});
    LfoSettings sine; sine.mode=LfoMode::Loop; sine.rateHz=1.0f;
    auto tri=sine; tri.shape=LfoShape::Triangle; auto square=sine; square.shape=LfoShape::Square;

    // ---- source: STEREO 0 is mono, LEFT never changes -----------------------
    {
        bool same=true,leftSame=true;
        for(auto base:{sine,tri,square,custom,ramp}) for(auto mode:{LfoMode::Free,LfoMode::Loop,LfoMode::Envelope}) for(bool processed:{false,true}) {
            auto s=base; s.mode=mode; s.rateHz=3.0f; if(processed) { s.skew=.3f; s.entropy=.4f; s.smooth=.2f; s.pingPong=true; }
            const auto [l,r]=runStereo(s,24000);
            same&=std::memcmp(l.data(),r.data(),l.size()*sizeof(float))==0;
            const auto mono=run(s,24000);
            leftSame&=std::memcmp(l.data(),mono.data(),l.size()*sizeof(float))==0;
            auto st=s; st.stereo=.73f;
            const auto [ls,rs]=runStereo(st,24000);
            leftSame&=std::memcmp(ls.data(),mono.data(),ls.size()*sizeof(float))==0; // turning STEREO never moves LEFT
        }
        check(same,"STEREO 0: RIGHT == LEFT bit for bit (every shape, mode, FUNC path)");
        check(leftSame,"LEFT is bit-identical to the mono LFO at any STEREO amount");
    }
    // ---- source: phase separation ------------------------------------------
    for(const auto& [name,base]:std::initializer_list<std::pair<const char*,LfoSettings>>{{"sine",sine},{"triangle",tri},{"square",square},{"custom",custom}}) {
        for(float amount:{.25f,.5f,1.0f}) {
            auto s=base; s.stereo=amount; s.mode=LfoMode::Loop;
            const auto [l,r]=runStereo(s,3000,1000.0); // 1 Hz @ 1 kHz: 1000 samples per cycle
            const auto shift=static_cast<std::size_t>(std::lround(amount*500.0)); // amount * 180 deg
            int mismatches=0;
            for(std::size_t i=0;i<1500;++i) if(!near(r[i],l[i+shift],2e-3f)) ++mismatches;
            check(mismatches<=4,(std::string("STEREO ")+std::to_string(int(amount*100))+"% on "+name+": RIGHT = LEFT "+std::to_string(int(amount*180))+" deg later").c_str());
        }
    }
    for(auto mode:{LfoMode::Free,LfoMode::Loop}) {
        auto s=sine; s.mode=mode; s.stereo=.5f;
        const auto [l,r]=runStereo(s,2000,1000.0);
        bool ok=true; for(std::size_t i=0;i<1500;++i) ok&=near(r[i],l[i+250],2e-3f);
        check(ok,"STEREO 50% = 90 deg in FREE and RETRIGGER");
    }
    {   // ENVELOPE: one-shot RIGHT reads its cycle from +90 deg and holds; never loops.
        auto e=ramp; e.mode=LfoMode::Envelope; e.stereo=.5f;
        const auto [l,r]=runStereo(e,3000,1000.0);
        check(near(r[0],-.5f,1e-4f) && near(r[740],.98f,.01f) && near(r[760],-.98f,.01f) && r[1500]==r[2999] && l[1500]==1.0f,
              "ENVELOPE + STEREO: RIGHT is the same one-shot read from 90 deg; both hold");
    }
    {   // PING-PONG 180 deg: RIGHT starts at the right end, same period, no duplicated endpoint.
        auto pp=ramp; pp.pingPong=true; pp.stereo=1.0f;
        const auto [l,r]=runStereo(pp,3000,1000.0);
        bool periodic=true; for(std::size_t i=0;i<2000;++i) periodic&=near(r[i],r[i+1000],2e-5f);
        check(r[0]==1.0f && near(r[500],-1.0f,1e-4f) && periodic && r[1]<1.0f && near(r[1],r[999],1e-4f),"PING-PONG + STEREO 100%: RIGHT is half a cycle on, same period, endpoints read once");
        bool mirror=true; for(std::size_t i=0;i<1000;++i) mirror&=near(r[i],l[(i+500)%1000],2e-4f) || i==500;
        check(mirror,"PING-PONG + STEREO: RIGHT traverses the same reflected path (no reversal artefact)");
    }
    {   // One processed system: RIGHT == a mono LFO whose PHASE is offset by
        // stereo * 0.5, with every FUNC processor on (same ENTROPY trajectory,
        // same FRACTURE structure, same QUANTIZE / SMOOTH / DELAY / ATTACK).
        auto s=custom; s.rateHz=2.0f; s.pingPong=true; s.phase=.1f; s.skew=-.3f; s.entropy=.6f; s.fracture=.5f;
        s.quantize=.3f; s.smooth=.25f; s.delaySeconds=.01f; s.attackSeconds=.05f; s.stereo=.6f;
        auto shifted=s; shifted.stereo=0.0f; shifted.phase=s.phase+0.5f*s.stereo;
        for(auto mode:{LfoMode::Free,LfoMode::Loop,LfoMode::Envelope}) {
            s.mode=shifted.mode=mode;
            const auto [l,r]=runStereo(s,48000);
            const auto ref=run(shifted,48000);
            int mismatches=0; for(std::size_t i=0;i<r.size();++i) if(!near(r[i],ref[i],1e-3f)) ++mismatches;
            check(mismatches<48,"RIGHT is the SAME processed LFO read at its phase offset (ENTROPY / FRACTURE coherent, shared lifecycle)");
            bool delayShared=true; for(std::size_t i=0;i<480;++i) delayShared&=l[i]==0.0f && r[i]==0.0f;
            check(delayShared,"DELAY is shared: both channels start together");
        }
    }
    {   // SMOOTH: independent RIGHT history; enabling STEREO mid-note never jumps.
        auto s=square; s.rateHz=4.0f; s.smooth=.5f;
        Lfo l; l.reset(); l.setStreams(1,Lfo::fractureSeed(0));
        float r=0.0f; for(int i=0;i<6000;++i) l.nextStereo(s,48000.0,r);
        s.stereo=1.0f;
        float prevR=r; float maxJump=0.0f;
        for(int i=0;i<200;++i) { l.nextStereo(s,48000.0,r); maxJump=std::max(maxJump,std::abs(r-prevR)); prevR=r; }
        check(maxJump<.05f,"SMOOTH: RIGHT continues from LEFT's history when STEREO turns on (no jump)");
    }
    {   // Entropy stays deterministic; RIGHT does not get its own random pattern.
        auto s=sine; s.entropy=.8f; s.stereo=1.0f;
        const auto a=runStereo(s,48000),b=runStereo(s,48000);
        check(a==b,"STEREO + ENTROPY deterministic");
    }

    // ---- routes / destinations (the compiled plan, directly) ---------------
    const auto mods=modules();
    const auto compileFrame=[&](const ModulationState& st,CompiledModulation& c){ c.prepare(48000.0); c.compile(st,mods,true); };
    const auto globalSources=[&](float lfo1,float lfo2=0.0f,float macro1=0.0f){ std::array<float,CompiledModulation::globalSourceCount> s{}; s[0]=lfo1; s[1]=lfo2; s[CompiledModulation::macroSlot(1)]=macro1; return s; };
    const auto frameFor=[&](CompiledModulation& c,const std::array<float,CompiledModulation::globalSourceCount>& src,std::uint8_t mask,std::array<float,4> right) {
        auto f=std::make_unique<ModulationFrame>(); f->modules=mods; f->cutoff=1200.0f; f->resonance=.3f;
        f->stereo.globalLfo.mask=mask; f->stereo.globalLfo.lfo=right;
        c.globalFrame(*f,src,48000.0); return f;
    };
    {
        ModulationState st; st.lfoActiveMask=0xF; st.nextRouteId=10;
        st.routes[0]=route(1,ModSource::Lfo1,ModDestination::Cutoff,.4f);
        st.routes[1]=route(2,ModSource::Macro1,ModDestination::Cutoff,.2f);
        st.routes[2]=route(3,ModSource::Lfo1,ModDestination::Pan,.5f,1);
        st.routes[3]=route(4,ModSource::Lfo1,ModDestination::Level,.6f,2);
        st.routes[4]=route(5,ModSource::Lfo2,ModDestination::Level,.3f,2);
        st.routes[5]=route(6,ModSource::Lfo1,ModDestination::WtPosition,.5f,1);
        auto c=std::make_unique<CompiledModulation>(); compileFrame(st,*c);
        check(c->hasStereoPlan(),"LFO -> CUTOFF / LEVEL makes a stereo plan");
        const float L=.2f,R=-.6f,L2=.5f,R2=.1f,M=.7f;
        auto stereoF=frameFor(*c,globalSources(L,L2,M),0x3,{R,R2,0,0});
        auto monoF=frameFor(*c,globalSources(L,L2,M),0x0,{R,R2,0,0});
        auto rightAsLeft=frameFor(*c,globalSources(R,R2,M),0x0,{});
        // LEFT never moves; scalar destinations follow LEFT exactly.
        check(stereoF->cutoff==monoF->cutoff && stereoF->modules[0].pan==monoF->modules[0].pan && stereoF->modules[1].level==monoF->modules[1].level &&
              stereoF->modules[0].wtPosition==monoF->modules[0].wtPosition,"stereo source: every LEFT value is unchanged");
        check(!monoF->stereo.cutoffSplit && monoF->stereo.levelMask==0,"mono sources never produce a right channel");
        check(stereoF->stereo.cutoffSplit && std::abs(stereoF->stereo.cutoff-rightAsLeft->cutoff)<=rightAsLeft->cutoff*1e-4f,
              "mixed mono + stereo -> CUTOFF: RIGHT = base + MACRO*a1 + LFO_R*a2 (macro promoted to both channels)");
        check(((stereoF->stereo.levelMask>>1)&1u) && std::abs(stereoF->stereo.level[1]-rightAsLeft->modules[1].level)<1e-5f,
              "two stereo sources -> LEVEL: both RIGHT values summed");
        check(stereoF->modules[0].pan==monoF->modules[0].pan && (stereoF->stereo.levelMask&1u)==0,"PAN (scalar) uses LEFT; no right value exists for it");
        check(stereoF->modules[0].wtPosition==monoF->modules[0].wtPosition && (stereoF->stereo.rightMask&c->moduleReadStereoGroups(0))!=0,
              "WT POSITION: LEFT unchanged, RIGHT prepared for the oscillator's second read");
        check(stereoF->stereo.filter.g!=stereoF->filter.g,"RIGHT gets its own filter coefficients when CUTOFF differs");
        // per-channel clamping: drive RIGHT past the top; LEFT stays inside.
        auto clampF=frameFor(*c,globalSources(0.0f,0.0f,0.0f),0x1,{1.0f,0,0,0});
        auto clampRef=frameFor(*c,globalSources(1.0f,0.0f,0.0f),0x0,{});
        check(std::abs(clampF->stereo.cutoff-clampRef->cutoff)<=clampRef->cutoff*1e-4f,"each channel is mapped and clamped on its own");
        // Turning STEREO only changes stereo-capable destinations.
        auto noStereoPlan=st; noStereoPlan.routes[0]={}; noStereoPlan.routes[3]={}; noStereoPlan.routes[4]={}; noStereoPlan.routes[5]={};
        auto c2=std::make_unique<CompiledModulation>(); compileFrame(noStereoPlan,*c2);
        check(!c2->hasStereoPlan(),"stereo LFO routed only to scalar destinations: mono plan (fast path)");
    }
    {   // Per-voice (RETRIGGER) LFO -> LEVEL through voiceFrame.
        ModulationState st; st.lfoActiveMask=0xF; st.lfo1.mode=LfoMode::Loop; st.nextRouteId=10;
        st.routes[0]=route(1,ModSource::Lfo1,ModDestination::Level,.5f,1);
        auto c=std::make_unique<CompiledModulation>(); compileFrame(st,*c);
        auto g=std::make_unique<ModulationFrame>(); g->modules=mods; c->globalFrame(*g,{},48000.0);
        auto v=std::make_unique<ModulationFrame>(*g);
        std::array<float,CompiledModulation::voiceSourceCount> vs{}; vs[3]=.4f;
        StereoSourceValues vst; vst.lfo[0]=-.4f; vst.mask=1;
        c->voiceFrame(*v,vs,48000.0,&vst);
        auto ref=std::make_unique<ModulationFrame>(*g); auto vs2=vs; vs2[3]=-.4f; c->voiceFrame(*ref,vs2,48000.0,nullptr);
        check(c->hasStereoPlan() && ((v->stereo.levelMask>>0)&1u) && std::abs(v->stereo.level[0]-ref->modules[0].level)<1e-5f,"per-voice stereo LFO -> LEVEL (voice frame)");
        vst.mask=0; auto v0=std::make_unique<ModulationFrame>(*g); c->voiceFrame(*v0,vs,48000.0,&vst);
        check((v0->stereo.levelMask&1u)==0,"voice LFO at STEREO 0: no right value");
    }
    {   // NODES: component-wise continuous operators; EVENT / GATE stay scalar.
        for(auto type:{ControlOpType::Add,ControlOpType::Multiply,ControlOpType::Clamp,ControlOpType::Curve,ControlOpType::ScaleOffset,ControlOpType::Remap,ControlOpType::Max,ControlOpType::Smooth,ControlOpType::Threshold}) {
            ModulationState st; st.lfoActiveMask=0xF; st.nextRouteId=10;
            st.operators[0]=makeControlOperator(type,st.nextOperatorId++);
            st.operators[0].inputs[0]={ControlInput::Kind::Source,ModSource::Lfo1,0};
            st.operators[0].inputs[1]={ControlInput::Kind::Source,ModSource::Macro1,0}; // mono operand: promoted (x, x)
            st.routes[0]=route(1,operatorSource(st.operators[0].id),ModDestination::Level,.5f,1);
            auto c=std::make_unique<CompiledModulation>(); compileFrame(st,*c);
            const bool scalarOp=type==ControlOpType::Threshold;
            check(c->hasStereoPlan()!=scalarOp,"continuous operator fed by an LFO makes the route stereo; EVENT / GATE operators never do");
            const float L=.3f,R=.8f,M=.4f;
            auto f=std::make_unique<ModulationFrame>(); f->modules=mods; f->stereo.globalLfo.mask=1; f->stereo.globalLfo.lfo[0]=R;
            const auto src=globalSources(L,0.0f,M);
            auto fr=std::make_unique<ModulationFrame>(); fr->modules=mods;
            const auto srcR=globalSources(R,0.0f,M);
            auto cR=std::make_unique<CompiledModulation>(); compileFrame(st,*cR);
            for(int i=0;i<3;++i) { c->evaluateGlobalOperators(*f,src); cR->evaluateGlobalOperators(*fr,srcR); } // SMOOTH settles alike
            if(scalarOp) { check((f->stereo.operatorMask&1u)==0,"THRESHOLD (GATE) output stays scalar"); continue; }
            if(type==ControlOpType::Smooth) {
                // SMOOTH's RIGHT history starts from LEFT (no jump) and follows RIGHT's input.
                const float first=f->stereo.operatorRight[0];
                for(int i=0;i<48000;++i) c->evaluateGlobalOperators(*f,src);
                check((f->stereo.operatorMask&1u)!=0 && first>L && first<R && std::abs(f->stereo.operatorRight[0]-R)<1e-3f && std::abs(f->operatorOutputs[0]-L)<1e-3f,
                      "SMOOTH: independent RIGHT history, starting from LEFT and settling on RIGHT's input");
                continue;
            }
            check((f->stereo.operatorMask&1u)!=0 && std::abs(f->stereo.operatorRight[0]-fr->operatorOutputs[0])<1e-5f,
                  "operator RIGHT = the same operator on RIGHT inputs (component-wise; mono operand promoted)");
            c->globalFrame(*f,src,48000.0);
            check((f->stereo.levelMask&1u)!=0,"stereo operator output -> LEVEL keeps its right channel");
        }
    }

    // ---- engine: audio, block size, recompiles, state ------------------------
    {
        const auto render=[&](const ModulationState& ms,int block,std::size_t total,std::vector<float>* rightOut=nullptr) {
            auto e=std::make_unique<OrigamiEngine>(); e->prepare(48000,1024,2); e->setModulationState(ms); e->reset();
            std::vector<float> outL; outL.reserve(total); if(rightOut) rightOut->clear();
            std::array<float,1024> l{},r{};
            e->noteOn(57,.8f);
            for(std::size_t done=0;done<total;) {
                const auto n=static_cast<int>(std::min<std::size_t>(block,total-done));
                float* p[]{l.data(),r.data()}; e->process(p,2,n);
                outL.insert(outL.end(),l.begin(),l.begin()+n); if(rightOut) rightOut->insert(rightOut->end(),r.begin(),r.begin()+n);
                done+=static_cast<std::size_t>(n);
            }
            return outL;
        };
        const auto envelopeOf=[](const std::vector<float>& x,std::size_t window){ std::vector<float> env; for(std::size_t i=0;i+window<=x.size();i+=window){ double s=0; for(std::size_t k=0;k<window;++k) s+=double(x[i+k])*x[i+k]; env.push_back(float(std::sqrt(s/window))); } return env; };
        auto e0=std::make_unique<OrigamiEngine>();
        auto base=e0->instrumentState().modulation;
        base.lfo1=sine; base.lfo1.mode=LfoMode::Loop; base.lfo1.rateHz=4.0f; base.nextRouteId=5;
        base.routes[0]=route(1,ModSource::Lfo1,ModDestination::Level,.6f,1); base.routes[0].bipolar=true; // 0.7 +/- 0.3: never clipped
        // STEREO 0 -> LEVEL: identical channels (centre pan).
        auto s0=base; std::vector<float> r0; const auto l0=render(s0,256,24576,&r0);
        check(l0==r0,"LFO STEREO 0 -> LEVEL: left and right outputs identical");
        // STEREO 100% -> LEVEL: phase-separated amplitude trajectories.
        auto s1=base; s1.lfo1.stereo=1.0f; std::vector<float> r1; const auto l1=render(s1,256,24576,&r1);
        check(l1==l0,"turning STEREO never changes the LEFT channel");
        const auto envL=envelopeOf(l1,480),envR=envelopeOf(r1,480); // 10 ms windows, 4 Hz LFO = 25 windows per cycle
        double corr=0,ml=0,mr=0; for(std::size_t i=0;i<envL.size();++i){ ml+=envL[i]; mr+=envR[i]; } ml/=envL.size(); mr/=envR.size();
        double sl=0,sr=0; for(std::size_t i=0;i<envL.size();++i){ corr+=(envL[i]-ml)*(envR[i]-mr); sl+=(envL[i]-ml)*(envL[i]-ml); sr+=(envR[i]-mr)*(envR[i]-mr); }
        corr/=std::sqrt(sl*sr+1e-30);
        check(corr<-0.6,("STEREO 100% -> LEVEL: left / right amplitude move in anti-phase (corr "+std::to_string(corr)+")").c_str());
        // Block-size independence of both channels.
        for(int block:{64,1024}) { std::vector<float> rb; const auto lb=render(s1,block,24576,&rb); check(lb==l1 && rb==r1,"stereo modulation renders identically at any block size"); }
        // CUTOFF: stereo spectral motion, LEFT unchanged.
        auto c0=base; c0.routes[0]=route(1,ModSource::Lfo1,ModDestination::Cutoff,.8f); std::vector<float> rc0; const auto lc0=render(c0,256,12288,&rc0);
        auto c1=c0; c1.lfo1.stereo=1.0f; std::vector<float> rc1; const auto lc1=render(c1,256,12288,&rc1);
        bool differ=false; for(std::size_t i=0;i<rc1.size();++i) differ|=std::abs(rc1[i]-lc1[i])>1e-4f;
        check(lc0==rc0 && lc1==lc0 && differ,"CUTOFF: STEREO 0 identical channels; STEREO 100% RIGHT filters differently, LEFT unchanged");
        // Scalar destinations never change with STEREO (PAN, WT POSITION, FINE).
        for(auto dest:{ModDestination::Pan,ModDestination::Fine,ModDestination::Detune}) {
            auto a=base; a.routes[0]=route(1,ModSource::Lfo1,dest,.6f,1); auto b=a; b.lfo1.stereo=1.0f;
            std::vector<float> ra,rb; const auto la=render(a,256,8192,&ra),lb=render(b,256,8192,&rb);
            check(la==lb && ra==rb,"scalar destination: turning STEREO changes nothing");
        }
        // STEREO edits never recompile the plan.
        auto e=std::make_unique<OrigamiEngine>(); e->prepare(48000,256,2); e->setModulationState(s1); e->reset();
        std::array<float,256> l{},r{}; float* p[]{l.data(),r.data()}; e->process(p,2,256);
        const auto before=e->nodesDiagnostics();
        for(int i=0;i<10;++i) { auto m=s1; m.lfo1.stereo=float(i)/10.0f; e->setModulationState(m); e->process(p,2,256); }
        check(e->nodesDiagnostics().compiles==before.compiles,"STEREO knob changes never recompile");
    }
    {   // State: v33 only when STEREO is used; older states load mono.
        auto e=std::make_unique<OrigamiEngine>();
        auto st=e->instrumentState();
        const auto plain=encodeInstrumentState(st);
        InstrumentState old; check(decodeInstrumentState(plain.data(),plain.size(),old) && old.modulation.lfo2.stereo==0.0f && encodeInstrumentState(old)==plain,"old state: STEREO 0, byte-identical re-save");
        st.modulation.lfo2.stereo=.5f;
        const auto v33=encodeInstrumentState(st);
        InstrumentState back; check(v33[7]==33 && decodeInstrumentState(v33.data(),v33.size(),back) && back.modulation.lfo2.stereo==.5f && encodeInstrumentState(back)==v33,"STEREO saves as v33, exact round trip");
        auto bad=st; bad.modulation.lfo2.stereo=1.5f;
        auto e2=std::make_unique<OrigamiEngine>(); check(!e2->setModulationState(bad.modulation),"out-of-range STEREO rejected");
    }
}
// ---- mct-origami-dsp-performance-stereo-chain: OSC CHAIN stereo -------------
struct ChainRender { std::vector<float> left,right; };
ChainRender renderChain(OrigamiEngine& e,const InstrumentState& st,int block,std::size_t total) {
    e.restoreInstrumentState(st); e.reset();
    ChainRender out; out.left.reserve(total); out.right.reserve(total);
    std::array<float,1024> l{},r{};
    e.noteOn(57,.8f);
    for(std::size_t done=0;done<total;) {
        const auto n=static_cast<int>(std::min<std::size_t>(block,total-done));
        float* p[]{l.data(),r.data()}; e.process(p,2,n);
        out.left.insert(out.left.end(),l.begin(),l.begin()+n); out.right.insert(out.right.end(),r.begin(),r.begin()+n);
        done+=static_cast<std::size_t>(n);
    }
    return out;
}
// Spectral processes are compiled by a worker: render until a whole pass is
// served from the cache (no fallback reads), so measured renders are exact.
bool settleSpectral(OrigamiEngine& e,const InstrumentState& st,std::size_t total) {
    for(int attempt=0;attempt<400;++attempt) {
        const auto before=dsp::spectralCompilerStats().fallbackReads;
        renderChain(e,st,256,total);
        if(dsp::spectralCompilerStats().fallbackReads==before) return true;
        std::this_thread::sleep_for(std::chrono::milliseconds(4));
    }
    return false;
}
double matchFraction(const std::vector<float>& a,const std::vector<float>& b,float tolerance) {
    std::size_t ok=0; for(std::size_t i=0;i<a.size();++i) ok+=std::abs(a[i]-b[i])<=tolerance; return double(ok)/double(a.size());
}
void oscChainStereo() {
    check(dsp::prepareSpectralCompiler(),"spectral worker running");
    constexpr std::size_t total=9600;
    // ---- RAND AMP (the acceptance case) ------------------------------------
    {
        auto e=std::make_unique<OrigamiEngine>(); check(e->prepare(48000,1024,2),"chain engine");
        auto base=e->instrumentState();
        auto& osc=base.oscillators[0];
        osc.processCount=1; osc.nextProcessId=2;
        osc.processes[0]={1,dsp::OscProcessType::RandAmp,0.5f,0x1234u,true};
        base.modulation.nextRouteId=2;
        base.modulation.routes[0]={1,true,ModSource::Lfo1,{ModDestination::ProcessAmount,osc.id,1},0.9f,true};
        const auto custom=curveLfo({{0,0,0},{.2f,.9f,.3f},{.35f,-.2f,-.4f},{.6f,1,0},{.8f,-.8f,.5f},{1,0,0}});
        struct Shape { const char* name; LfoSettings lfo; };
        LfoSettings sine; LfoSettings tri; tri.shape=LfoShape::Triangle;
        const std::array<Shape,3> shapes{{{"sine",sine},{"triangle",tri},{"custom",custom}}};
        int configs=0;
        for(const auto& shape:shapes) for(int mode=0;mode<4;++mode) {
            auto st=base;
            st.modulation.lfo1=shape.lfo; st.modulation.lfo1.rateHz=6.0f;
            st.modulation.lfo1.mode=mode==0 ? LfoMode::Free : mode==2 ? LfoMode::Envelope : LfoMode::Loop;
            st.modulation.lfo1.pingPong=mode==3;
            const char* modeName=mode==0 ? "FREE" : mode==1 ? "RETRIGGER" : mode==2 ? "ENVELOPE" : "PING-PONG";
            auto mono=st; mono.modulation.lfo1.stereo=0.0f;
            check(settleSpectral(*e,mono,total),"spectral cache settles (mono)");
            const auto m0=renderChain(*e,mono,256,total);
            check(m0.left==m0.right,(std::string("RAND AMP STEREO 0 (")+shape.name+", "+modeName+"): L == R").c_str());
            for(int angle:{45,90,135,180}) {
                auto s=st; s.modulation.lfo1.stereo=float(angle)/180.0f;
                auto ref=st; ref.modulation.lfo1.stereo=0.0f; ref.modulation.lfo1.phase=float(angle)/360.0f;
                check(settleSpectral(*e,s,total) && settleSpectral(*e,ref,total),"spectral cache settles (stereo)");
                const auto a=renderChain(*e,s,256,total),b=renderChain(*e,s,256,total);
                const auto rr=renderChain(*e,ref,256,total);
                const std::string label=std::string(" (")+shape.name+", "+modeName+", "+std::to_string(angle)+" deg)";
                check(a.left==b.left && a.right==b.right,("RAND AMP stereo deterministic"+label).c_str());
                check(a.left==m0.left,("RAND AMP LEFT unchanged by STEREO"+label).c_str());
                const double match=matchFraction(a.right,rr.left,2e-3f);
                check(match>=0.97,("RAND AMP RIGHT = the chain at LFO phase + "+std::to_string(angle)+" deg (match "+std::to_string(match)+")"+label).c_str());
                bool differs=false; for(std::size_t i=0;i<a.left.size();++i) differs|=std::abs(a.left[i]-a.right[i])>1e-3f;
                // A triangle read by PING-PONG at 180 deg is its own mirror image
                // (tri(r) == tri(1 - r)): LEFT == RIGHT is the correct result there.
                const bool mirrorSymmetric=std::string(shape.name)=="triangle" && mode==3 && angle==180;
                check(differs!=mirrorSymmetric || mode==2,("RAND AMP: LEFT and RIGHT differ (or are a mirror-symmetric case)"+label).c_str());
                ++configs;
            }
        }
        check(configs==48,"RAND AMP matrix: 3 shapes x 4 modes x 4 angles");
        auto s=base; s.modulation.lfo1.mode=LfoMode::Loop; s.modulation.lfo1.rateHz=5.0f; s.modulation.lfo1.stereo=1.0f;
        check(settleSpectral(*e,s,total),"spectral settles");
        const auto b256=renderChain(*e,s,256,total),b64=renderChain(*e,s,64,total),b1024=renderChain(*e,s,1024,total);
        check(b64.left==b256.left && b64.right==b256.right && b1024.left==b256.left && b1024.right==b256.right,"RAND AMP stereo: block-size independent (64 / 256 / 1024)");
    }
    // ---- every other stereo-capable chain parameter -------------------------
    {
        auto e=std::make_unique<OrigamiEngine>(); check(e->prepare(48000,1024,2),"chain engine 2");
        const auto osc2=e->addOscillatorModule();
        check(osc2!=0,"second oscillator");
        auto base=e->instrumentState();
        auto& osc=base.oscillators[0];
        base.modulation.lfo1.mode=LfoMode::Loop; base.modulation.lfo1.rateHz=4.0f;
        base.modulation.nextRouteId=2;
        struct Case { const char* name; std::function<void(InstrumentState&)> setup; bool stereo; };
        const auto withProcess=[&](dsp::OscProcessType type){ return [type,id=osc.id](InstrumentState& st){
            auto& o=st.oscillators[0]; o.processCount=1; o.nextProcessId=2; o.processes[0]={1,type,0.4f,7u,true};
            st.modulation.routes[0]={1,true,ModSource::Lfo1,{ModDestination::ProcessAmount,id,1},0.8f,true}; }; };
        const auto withRoute=[&](OscRouteType type){ return [type,id=osc.id,src=osc2](InstrumentState& st){
            auto& o=st.oscillators[0]; o.routeCount=1; o.nextRouteId=2; o.routes[0]={1,src,type,0.4f,true};
            st.modulation.routes[0]={1,true,ModSource::Lfo1,{ModDestination::RouteAmount,id,1},0.8f,true}; }; };
        const std::vector<Case> cases{
            {"WT POSITION",[id=osc.id](InstrumentState& st){ st.modulation.routes[0]={1,true,ModSource::Lfo1,{ModDestination::WtPosition,id,0},0.8f,true}; },true},
            {"BEND+ (phase warp)",withProcess(dsp::OscProcessType::BendPlus),true},
            {"FOLD (phase warp)",withProcess(dsp::OscProcessType::Fold),true},
            {"SINE WARP (bipolar warp)",withProcess(dsp::OscProcessType::SineWarp),true},
            {"RING MOD (post route)",withRoute(OscRouteType::RingMod),true},
            {"WAVE FOLD (post route)",withRoute(OscRouteType::WaveFold),true},
            {"PM (pre route)",withRoute(OscRouteType::PhaseMod),true},
            {"PSK (pre route)",withRoute(OscRouteType::PhaseSkew),true},
            {"FM (pre route, scalar)",withRoute(OscRouteType::FrequencyMod),false}};
        for(const auto& c:cases) {
            auto st=base; c.setup(st);
            auto mono=st; const auto m0=renderChain(*e,mono,256,total);
            auto s=st; s.modulation.lfo1.stereo=1.0f;
            auto ref=st; ref.modulation.lfo1.phase=0.5f;
            const auto a=renderChain(*e,s,256,total),rr=renderChain(*e,ref,256,total);
            check(m0.left==m0.right && a.left==m0.left,(std::string(c.name)+": STEREO 0 is mono; LEFT unchanged by STEREO").c_str());
            if(c.stereo) {
                const double match=matchFraction(a.right,rr.left,1e-3f);
                check(match>=0.99,(std::string(c.name)+": RIGHT = LFO at +180 deg (match "+std::to_string(match)+")").c_str());
                bool differs=false; for(std::size_t i=0;i<a.left.size();++i) differs|=std::abs(a.left[i]-a.right[i])>1e-3f;
                check(differs,(std::string(c.name)+": channels differ at 180 deg").c_str());
            } else check(a.right==a.left,(std::string(c.name)+": scalar (FM changes the phase increment): RIGHT follows LEFT").c_str());
        }
    }
}

// Hot-path benchmark (printed; not a pass/fail gate).
void lfoFunctionBenchmark() {
    using clock_t=std::chrono::steady_clock;
    const auto custom=curveLfo({{0,0,0},{.2f,.9f,.3f},{.35f,-.2f,-.4f},{.6f,1,0},{.8f,-.8f,.5f},{1,0,0}});
    struct Case { const char* name; std::function<void(LfoSettings&)> edit; };
    const std::vector<Case> cases{
        {"neutral",[](LfoSettings&){}},{"SMOOTH",[](LfoSettings& s){s.smooth=.5f;}},{"ATTACK",[](LfoSettings& s){s.attackSeconds=5;}},
        {"DELAY",[](LfoSettings& s){s.delaySeconds=1e-4f;}},{"PHASE",[](LfoSettings& s){s.phase=.3f;}},{"SKEW",[](LfoSettings& s){s.skew=.5f;}},
        {"PING-PONG",[](LfoSettings& s){s.pingPong=true;}},{"QUANTIZE",[](LfoSettings& s){s.quantize=.5f;}},{"ENTROPY",[](LfoSettings& s){s.entropy=.5f;}},
        {"FRACTURE",[](LfoSettings& s){s.fracture=.7f;}},
        {"ALL",[](LfoSettings& s){s.smooth=.5f;s.attackSeconds=5;s.delaySeconds=1e-4f;s.phase=.3f;s.skew=.5f;s.pingPong=true;s.quantize=.5f;s.entropy=.5f;s.fracture=.7f;}}};
    std::cout<<"[lfo bench] ns per LFO sample (single runtime, 2M samples):\n";
    volatile float sink=0;
    for(const auto& c:cases) {
        auto s=custom; s.rateHz=3.0f; c.edit(s);
        Lfo l; l.reset(); l.setStreams(Lfo::globalStream(0),Lfo::fractureSeed(0));
        const auto t0=clock_t::now(); float acc=0; for(int i=0;i<2000000;++i) acc+=l.next(s,48000.0); sink=sink+acc;
        std::cout<<"[lfo bench]   "<<c.name<<" "<<std::chrono::duration<double,std::nano>(clock_t::now()-t0).count()/2e6<<"\n";
    }
    std::cout<<"[lfo bench] engine us per block (4 per-voice LFOs routed, 64-sample blocks / 256-sample blocks):\n";
    for(const auto& c:std::vector<Case>{cases.front(),cases.back()}) for(int voices:{1,8,16}) for(int block:{64,256}) {
        auto e=std::make_unique<OrigamiEngine>(); e->prepare(48000,256,2);
        auto ms=e->instrumentState().modulation; ms.nextRouteId=1;
        const std::array<ModDestination,4> dest{ModDestination::Level,ModDestination::WtPosition,ModDestination::Cutoff,ModDestination::Pan};
        for(std::size_t i=0;i<4;++i) { auto& l=lfoSettings(ms,i); l=custom; l.mode=LfoMode::Loop; l.rateHz=2.0f+float(i); c.edit(l);
            ms.routes[i]=route(ms.nextRouteId++,static_cast<ModSource>(101+i),dest[i],.3f,dest[i]==ModDestination::Cutoff ? 0 : 1); }
        e->setModulationState(ms); e->reset();
        for(int v=0;v<voices;++v) e->noteOn(48+v,.7f);
        std::array<float,256> l{},r{}; float* p[]{l.data(),r.data()};
        for(int i=0;i<20;++i) e->process(p,2,block);
        const int blocks=block==64 ? 2000 : 500;
        const auto t0=clock_t::now(); for(int i=0;i<blocks;++i) e->process(p,2,block);
        std::cout<<"[lfo bench]   "<<c.name<<" voices="<<voices<<" block="<<block<<" "<<std::chrono::duration<double,std::micro>(clock_t::now()-t0).count()/blocks<<"\n";
    }
}
}

int main() {
    try {
        identitiesAndValidation();
        lfoContract();
        normalizationContract();
        compiledRoutes();
        expandedSources();
        stateV3RoundTrip();
        renderSeparation();
        lfoFunctionProcessing();
        lfoStereoModulation();
        oscChainStereo();
        if(std::getenv("ORIGAMI_LFO_BENCH")) lfoFunctionBenchmark();
        std::cout<<"PASS: "<<checks<<" modulation foundation checks\\n";
        return 0;
    } catch(const std::exception& e) {
        std::cerr<<"FAIL: "<<e.what()<<'\\n';
        return 1;
    }
}
