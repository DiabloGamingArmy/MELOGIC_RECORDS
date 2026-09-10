#include "core/Engine.h"
#include "core/modulation/Modulation.h"
#include "core/preset/StateCodec.h"
#include <array>
#include <cmath>
#include <iostream>
#include <stdexcept>
#include <vector>

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
    std::array<float,5> sources{0,.5f,0,0,0};
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
    std::array<float,5> summed{0,1,1,0,0};
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
    std::array<float,5> cutoffSource{0,1,0,0,0};
    compiled.globalFrame(frame,cutoffSource,48000);
    check(frame.cutoff>1000 && frame.cutoff<=20000,"global cutoff route increases effective cutoff");
}

void stateV3RoundTrip() {
    OrigamiEngine engine;
    const auto osc2=engine.addOscillatorModule();
    check(osc2==2,"second oscillator stable id");

    auto state=engine.instrumentState();
    state.modulation.lfo1.shape=LfoShape::Triangle;
    state.modulation.lfo1.mode=LfoMode::NoteRetrigger;
    state.modulation.lfo1.rateHz=3.5f;
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
    check(decoded.modulation.lfo1.mode==LfoMode::NoteRetrigger,"LFO mode persisted");
    check(near(decoded.modulation.lfo1.rateHz,3.5f),"LFO rate persisted");
    check(decoded.modulation.macros==std::array<float,4>{.1f,.2f,.3f,.4f},"macro values persisted");
    check(decoded.modulation.routes[0].destination.oscillator==osc2,"stable oscillator destination persisted");
    check(decoded.modulation.routes[1].destination.parameter==ModDestination::Cutoff,"global destination persisted");

    OrigamiEngine restored;
    check(restored.restoreInstrumentState(decoded),"engine restores v3 modulation state");
    check(encodeInstrumentState(restored.instrumentState())==encoded,"v3 modulation state exact round trip");

    for(std::size_t n=0;n<encoded.size();++n) {
        InstrumentState unchanged=decoded;
        check(!decodeInstrumentState(encoded.data(),n,unchanged),"truncated v3 state rejected");
        check(encodeInstrumentState(unchanged)==encoded,"failed v3 decode is transactional");
    }
}

void renderSeparation() {
    OrigamiEngine dry,mod;
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
}

int main() {
    try {
        identitiesAndValidation();
        lfoContract();
        normalizationContract();
        compiledRoutes();
        stateV3RoundTrip();
        renderSeparation();
        std::cout<<"PASS: "<<checks<<" modulation foundation checks\\n";
        return 0;
    } catch(const std::exception& e) {
        std::cerr<<"FAIL: "<<e.what()<<'\\n';
        return 1;
    }
}
