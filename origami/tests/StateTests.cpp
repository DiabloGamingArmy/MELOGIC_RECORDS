// mct-origami-v32.1.1-extended-mod-sources-hotfix
// mct-origami-v32.0.0-dynamic-mod-filter-collections
// mct-origami-v27.1.0-expanded-cross-osc-routing
// mct-origami-v27.0.0-cross-osc-routing-foundation
// mct-origami-v26.0.0-osc-process-foundation
// mct-origami-glide-mono-legato-v23.4.3
#include <memory>
#include "core/Engine.h"
#include "core/preset/StateCodec.h"
#include "core/preset/Patch.h"
#include <iostream>
#include <stdexcept>
#include <limits>
#include <algorithm>
#include <iterator>
using namespace mct::origami;
namespace {
unsigned checks=0;
void check(bool b,const char* label) {++checks;if(!b) throw std::runtime_error(label);}
void word(std::vector<std::uint8_t>& b,std::size_t offset,std::uint32_t n) {
    for(int i=0;i<4;++i) b[offset+static_cast<std::size_t>(i)]=static_cast<std::uint8_t>(n>>(24-i*8));
}
void states() {
    auto aOwner=std::make_unique<OrigamiEngine>();auto& a=*aOwner;
    a.setParameter(ParameterId::Waveform,.73f);
    const auto removed=a.addOscillatorModule();
    const auto third=a.addOscillatorModule();
    auto m=a.oscillatorModuleState(third);
    check(m.wtPosition==.73f/3.0f,"new oscillator clones continuous position");
    m.wtPosition=.8125f;m.octave=-2;m.semitone=7;m.fineCents=-23.25f;
    m.unison=5;m.detuneCents=34.5f;m.pan=.42f;m.level=.37f;
    m.process1=dsp::OscProcessType::Sync;m.process1Amount=.625f;
    m.process2=dsp::OscProcessType::Mirror;m.process2Amount=.375f;
    m.route1SourceId=1;m.route1Type=OscRouteType::PhaseMod;m.route1Amount=.5f;
    m.route2SourceId=1;m.route2Type=OscRouteType::WaveFold;m.route2Amount=-.25f;
    check(a.setOscillatorModuleState(third,m),"independent module controls");
    check(a.oscillatorModuleState(third).process1==dsp::OscProcessType::Sync &&
          a.oscillatorModuleState(third).process1Amount==.625f &&
          a.oscillatorModuleState(third).process2==dsp::OscProcessType::Mirror &&
          a.oscillatorModuleState(third).process2Amount==.375f,
          "oscillator process slots persist in module state");
    check(a.oscillatorModuleState(third).route1SourceId==1 &&
          a.oscillatorModuleState(third).route1Type==OscRouteType::PhaseMod &&
          a.oscillatorModuleState(third).route1Amount==.5f &&
          a.oscillatorModuleState(third).route2Type==OscRouteType::WaveFold &&
          a.oscillatorModuleState(third).route2Amount==-.25f,
          "expanded cross oscillator routing persists in module state");
    check(validOscRouteType(OscRouteType::RectifyMod) &&
          !validOscRouteType(OscRouteType::Count),
          "expanded routing enum bounds");

    auto firstModule=a.oscillatorModuleState(1);
    firstModule.process1=dsp::OscProcessType::BendBoth;firstModule.process1Amount=.5f;
    firstModule.process2=dsp::OscProcessType::Asym;firstModule.process2Amount=.25f;
    check(a.setOscillatorModuleState(1,firstModule),"OSC1 accepts module-local process state");
    check(a.oscillatorModuleState(1).process1==dsp::OscProcessType::BendBoth,
          "OSC1 process state survives legacy parameter overlay");
    check(a.parameterState()[0]==.73f,"OSC2+ never changes global OSC1");
    check(a.oscillatorModuleState(third).waveform==.8125f*3,"WT position owns alias");
    m=a.oscillatorModuleState(third);m.waveform=.9f;
    check(a.setOscillatorModuleState(third,m) && a.oscillatorModuleState(third).wtPosition==.9f/3,"legacy waveform setter migration");
    a.setOscillatorModuleEnabled(1,false);a.setOscillatorModuleEnabled(third,false);
    a.removeOscillatorModule(removed);const auto fourth=a.addOscillatorModule();
    check(fourth>third,"monotonic identities after hole reuse");
    auto dynamic=a.instrumentState();
    dynamic.modulation.envActiveMask=0x3u;
    dynamic.modulation.lfoActiveMask=0x5u;
    dynamic.modulation.filterEnabled=false;
    check(a.restoreInstrumentState(dynamic),"dynamic source/filter allocation state accepted");

    const auto saved=a.instrumentState();
    check(saved.oscillators[1].id==third && saved.oscillators[2].id==fourth,"creation order independent of slots");
    const auto bytes=encodeInstrumentState(saved);
    InstrumentState decoded;check(decodeInstrumentState(bytes.data(),bytes.size(),decoded),"decode v2");
    auto bOwner=std::make_unique<OrigamiEngine>();auto& b=*bOwner;check(b.restoreInstrumentState(decoded),"restore full engine state");
    check(decoded.modulation.envActiveMask==0x3u &&
          decoded.modulation.lfoActiveMask==0x5u &&
          !decoded.modulation.filterEnabled,
          "dynamic source/filter allocation survives StateCodec v12");
    check(decoded.modulation.generatorActiveMask==dynamic.modulation.generatorActiveMask,
          "generator allocation survives StateCodec v12");
    check(encodeInstrumentState(b.instrumentState())==bytes,"exact full model round trip");
    check(!b.oscillatorModuleEnabled(1) && !b.oscillatorModuleEnabled(third),"disabled modules preserved");
    check(!b.oscillatorModuleState(removed).id,"removed module absent");
    check(b.addOscillatorModule()==saved.nextId,"next ID survives reload");
    for(std::size_t n=0;n<bytes.size();++n) {
        auto out=decoded;check(!decodeInstrumentState(bytes.data(),n,out),"all truncations rejected");
        check(encodeInstrumentState(out)==bytes,"decode failure leaves output unchanged");
    }
    auto rejects=[&](std::size_t offset,std::uint32_t value) {
        auto bad=bytes;word(bad,offset,value);InstrumentState out=decoded;
        check(!decodeInstrumentState(bad.data(),bad.size(),out),"malformed state rejected");
        check(encodeInstrumentState(out)==bytes,"malformed decode transactional");
    };
    constexpr std::size_t first=20+parameterCount*4;
    rejects(0,0);rejects(4,99);rejects(8,10);rejects(12,0x7fc00000); // magic/unsupported-version/count/NaN
    rejects(12+4*parameterCount,1);rejects(16+4*parameterCount,17); // next ID/count
    rejects(first,2);rejects(first+4,2);rejects(first+8,99); // OSC1/boolean/table
    rejects(first+12,0x7f800000);rejects(first+88,1); // infinity/duplicate ID in V8
    auto extra=bytes;extra.push_back(0);check(!decodeInstrumentState(extra.data(),extra.size(),decoded),"trailing bytes rejected");
    auto invalid=saved;invalid.oscillators[1].level=std::numeric_limits<float>::quiet_NaN();
    check(!a.restoreInstrumentState(invalid) && encodeInstrumentState(a.instrumentState())==bytes,"engine restore transactional");
    // The historical host stream is the same big-endian header and parameter prefix.
    for(unsigned count:{10u,13u,15u}) {
        auto old=bytes;old.resize(12+count*4);word(old,4,1);word(old,8,count);
        check(decodeInstrumentState(old.data(),old.size(),decoded),"legacy host state loads");
        check(decoded.oscillators[0].enabled && decoded.oscillators[1].id==0 && decoded.nextId==2,"legacy topology deterministic");
        check(decoded.parameters==saved.parameters,"legacy appended defaults and fractional morph");
    }
    for(int i=0;i<200;++i) {const auto id=a.addOscillatorModule();check(id>fourth,"IDs never reused");check(a.removeOscillatorModule(id),"repeated add/remove");}
    while(a.addOscillatorModule()) {}
    const auto next=a.instrumentState().nextId;
    check(a.oscillatorModuleCount()==16 && a.addOscillatorModule()==0 && a.instrumentState().nextId==next,"capacity failure does not consume IDs");
    // Render round trip, including active OSC1/OSC2+ and fractional shape positions.
    a.setOscillatorModuleEnabled(1,true);a.setOscillatorModuleEnabled(third,true);
    check(b.restoreInstrumentState(a.instrumentState()),"restore populated bank");
    a.prepare(48000,256,2);b.prepare(48000,256,2);a.noteOn(60,.8f);b.noteOn(60,.8f);
    std::array<float,256> al{},ar{},bl{},br{};float* ap[]{al.data(),ar.data()};float* bp[]{bl.data(),br.data()};
    a.process(ap,2,256);b.process(bp,2,256);check(al==bl && ar==br,"restored instrument renders identically");
}
// mct-origami-nested-modulation-manual-qa: v34 (nested routes by stable id,
// macro names, signed bend endpoints, +/-48 st MAIN TUNING): exact round
// trip, and malformed v34 input is rejected without touching the state.
void nestedStateV34() {
    auto eOwner=std::make_unique<OrigamiEngine>();auto& e=*eOwner;
    auto s=e.instrumentState();
    check(encodeInstrumentState(s)[7]<34,"Init keeps its older format (no v34 feature used)");
    auto& m=s.modulation;
    const auto osc=s.oscillators[0].id;
    m.routes[0]={1,true,ModSource::Lfo2,{ModDestination::Level,osc,0},0.4f,true};
    m.routes[1]={2,true,ModSource::Macro1,routeDepthAddress(1),0.3f,false};
    m.routes[2]={3,true,ModSource::Lfo3,lfoRateAddress(1),0.2f,true};
    m.routes[3]={4,true,ModSource::Macro1,macroValueAddress(2),0.5f,false};
    m.routes[4]={5,true,ModSource::ModWheel,{ModDestination::MainTuning,0,0},0.125f,false};
    m.nextRouteId=6;
    const char wobble[]="Wobble";
    std::copy(std::begin(wobble),std::end(wobble),m.macroNames[1].begin());
    s.performance.pitchBendRangeSemitones=-3.0f; s.performance.pitchBendDownSemitones=5.0f;
    check(validInstrumentState(s),"v34 rig is valid");
    const auto bytes=encodeInstrumentState(s);
    check(bytes[7]==34,"nested routes, a macro name and signed bend endpoints save as v34");
    const auto sameRoutes=[](const ModulationState& a,const ModulationState& b) {
        for(std::size_t i=0;i<a.routes.size();++i) {
            const auto& x=a.routes[i]; const auto& y=b.routes[i];
            if(x.id!=y.id || x.enabled!=y.enabled || x.source!=y.source || !(x.destination==y.destination) || x.amount!=y.amount || x.bipolar!=y.bipolar) return false;
        }
        return true;
    };
    InstrumentState out;
    check(decodeInstrumentState(bytes.data(),bytes.size(),out) && sameRoutes(out.modulation,s.modulation)
          && out.modulation.macroNames==s.modulation.macroNames && out.performance.pitchBendRangeSemitones==-3.0f
          && out.performance.pitchBendDownSemitones==5.0f && encodeInstrumentState(out)==bytes,"v34 exact round trip");
    bool truncated=true;
    for(std::size_t n=0;n<bytes.size();++n) { InstrumentState t; truncated&=!decodeInstrumentState(bytes.data(),n,t); }
    check(truncated,"every truncation of a v34 state is rejected");
    { auto future=bytes; word(future,4,39); check(!decodeInstrumentState(future.data(),future.size(),out),"an unknown future version (39) is rejected"); }
    // The state ends with the names: per macro a length word and one word per
    // character. MACRO 2 is "Wobble" (6), MACRO 3..16 are empty (14 words).
    const std::size_t tail=14*4,name2=bytes.size()-tail-6*4;
    { auto bad=bytes; word(bad,bad.size()-4,30); check(!decodeInstrumentState(bad.data(),bad.size(),out),"a macro name longer than its capacity is rejected"); }
    { auto bad=bytes; word(bad,name2,7); check(!decodeInstrumentState(bad.data(),bad.size(),out),"a control character in a macro name is rejected"); }
    { auto bad=bytes; word(bad,name2,0); check(!decodeInstrumentState(bad.data(),bad.size(),out),"an embedded NUL in a macro name is rejected"); }
    { auto bad=bytes; word(bad,name2,0x141); check(!decodeInstrumentState(bad.data(),bad.size(),out),"a non-byte macro name character is rejected"); }
    {
        auto good=bytes; word(good,name2,'B');
        check(decodeInstrumentState(good.data(),good.size(),out) && out.modulation.macroNames[1][0]=='B',"a printable edit decodes (the offsets above are the name)");
    }
    // Graph-level corruption. The encoder refuses invalid states, so a valid
    // state is stored and its route destination ids are patched: the itemIds
    // are one word per route, in route order (here 0, 1, 2, 2, 0, 4).
    {
        auto g=s;
        g.modulation.routes[5]={6,true,ModSource::Lfo2,lfoRateAddress(3),0.2f,true}; // LFO 2 -> LFO 4 RATE
        g.modulation.nextRouteId=7;
        check(validInstrumentState(g),"graph rig valid");
        const auto b=encodeInstrumentState(g);
        const std::uint32_t ids[]{0,1,2,2,0,4};
        std::size_t at=0;
        for(std::size_t o=0;o+24<=b.size() && !at;o+=4) {
            bool match=true;
            for(std::size_t k=0;k<6 && match;++k)
                match=b[o+4*k]==0 && b[o+4*k+1]==0 && b[o+4*k+2]==0 && b[o+4*k+3]==ids[k];
            if(match) at=o;
        }
        check(at!=0 && decodeInstrumentState(b.data(),b.size(),out),"the route destination ids are located");
        auto cyc=b; word(cyc,at+5*4,3); // LFO 2 -> LFO 3 RATE while LFO 3 -> LFO 2 RATE
        check(!decodeInstrumentState(cyc.data(),cyc.size(),out),"a stored feedback loop is rejected on load");
        auto self=b; word(self,at+1*4,2); // route 2 modulating its own depth
        check(!decodeInstrumentState(self.data(),self.size(),out),"a route modulating its own depth is rejected on load");
        auto dangling=b; word(dangling,at+1*4,99);
        check(!decodeInstrumentState(dangling.data(),dangling.size(),out),"a depth route to a missing route is rejected on load");
        auto lfo=b; word(lfo,at+2*4,9);
        check(!decodeInstrumentState(lfo.data(),lfo.size(),out),"LFO RATE of a nonexistent LFO is rejected on load");
        auto macro=b; word(macro,at+3*4,12);
        check(!decodeInstrumentState(macro.data(),macro.size(),out),"a MACRO destination that does not exist is rejected on load");
    }
    // Byte flips anywhere: never a crash; whatever loads is a valid state.
    bool safe=true;
    for(std::size_t i=12;i<bytes.size();++i) for(std::uint8_t mask:{std::uint8_t(0x01),std::uint8_t(0x80),std::uint8_t(0xff)}) {
        auto f=bytes; f[i]^=mask; InstrumentState t;
        if(decodeInstrumentState(f.data(),f.size(),t)) safe&=validInstrumentState(t);
    }
    check(safe,"bit-flipped v34 states load only when valid");
}
void instanceStateV35() {
    auto e=std::make_unique<OrigamiEngine>();auto state=e->instrumentState();
    check(!state.modulation.filterEnabled,"fresh engine has no filter");
    auto old=encodeInstrumentState(state);InstrumentState restored;
    check(decodeInstrumentState(old.data(),old.size(),restored) && restored.modulation.nextInstanceId==1,"pre-v35 state migrates with empty pool");
    auto& m=state.modulation;
    std::array<ModSource,maxSourceInstances> sources{};
    for(std::size_t i=0;i<sources.size();++i) sources[i]=addSourceInstance(m,static_cast<SourceFamily>(i%7+1));
    check(addSourceInstance(m,SourceFamily::Envelope)==ModSource::None,"shared capacity is bounded");
    auto& l=m.instances[1].lfo;l.rateHz=3.7f;l.stereo=.8f;l.entropy=.4f;l.pointCount=2;l.points[0]={0,-.6f,.2f};l.points[1]={1,.7f,-.3f};
    m.instances[2].random.smoothing=.6f;m.instances[5].sequencer.probability[3]=.4f;
    m.routes[0]={m.nextRouteId++,true,sources[0],{ModDestination::Level,1,0},.5f,false};
    m.routes[1]={m.nextRouteId++,true,sources[1],{ModDestination::LfoRate,0,std::uint32_t(sources[8])},.1f,true};
    auto& op=m.operators[0];op.id=m.nextOperatorId++;op.type=ControlOpType::Add;
    op.inputs[0]={ControlInput::Kind::Source,sources[2],0};
    check(validInstrumentState(state),"full pool and Nodes source inputs valid");
    const auto bytes=encodeInstrumentState(state);
    check(bytes[7]==35,"instances select schema v35");
    check(decodeInstrumentState(bytes.data(),bytes.size(),restored) && encodeInstrumentState(restored)==bytes,"v35 settings, routes, Nodes inputs and pool holes round trip");
    for(std::size_t n=bytes.size()-16;n<bytes.size();++n) check(!decodeInstrumentState(bytes.data(),n,restored),"truncated pool is transactional");
    const auto removed=sources[2];check(removeSourceInstance(m,removed),"remove instance");
    const auto replacement=addSourceInstance(m,SourceFamily::Random);
    check(replacement!=removed && sourceInstanceSlot(m,replacement)==2,"slot reuse gets a new identity");
    check(m.operators[0].inputs[0].kind==ControlInput::Kind::None,"deletion disconnects Nodes input");
    check(!findSourceInstance(m,removed),"removed identity stays absent");
    const auto again=encodeInstrumentState(state);check(decodeInstrumentState(again.data(),again.size(),restored),"deletion/recreation persists");
    m.filterEnabled=true;const auto authored=encodeInstrumentState(state);
    check(decodeInstrumentState(authored.data(),authored.size(),restored) && restored.modulation.filterEnabled,"authored v35 filter restores");
    auto legacy=e->instrumentState();legacy.modulation.filterEnabled=true;const auto legacyBytes=encodeInstrumentState(legacy);
    check(legacyBytes[7]<35 && decodeInstrumentState(legacyBytes.data(),legacyBytes.size(),restored) && restored.modulation.filterEnabled,"legacy filter flag preserves authored topology");
}
void synthFiltersV36() {
    auto e=std::make_unique<OrigamiEngine>();check(e->addOscillatorModule()!=0,"second oscillator");auto state=e->instrumentState();auto& mod=state.modulation;
    const auto bus=addBus(state.buses);state.oscillators[0].busRoutes[0]={bus,1};
    const auto a=addSynthFilter(mod),b=addSynthFilter(mod),c=addSynthFilter(mod);
    check(insertSynthFilter(mod,state.oscillators,a,1),"exclusive insertion");
    auto routing=oscillatorOutputRouting(mod,state.oscillators[0]);
    check(routing.busRouteCount==2 && routing.busRoutes[0].level==0 && routing.busRoutes[1].filter && routing.busRoutes[1].level==1,"drop zeros existing bus and enables filter");
    check(mod.synthFilters.filters[0].buses[0].bus==mainBusId,"drop leaves filter output untouched");
    check(insertSynthFilter(mod,state.oscillators,b,1) && !mod.synthFilters.filters[1].next,"second drop does not prepend chain");
    check(insertSynthFilter(mod,state.oscillators,b,2),"shared filter permits distinct oscillator routes");
    check(insertSynthFilterAfter(mod,c,b),"explicit serial insertion");
    routing=oscillatorOutputRouting(mod,state.oscillators[0]);routing.busRoutes[0].level=.4f;
    routing.busRoutes[routing.busRouteCount++]={mainBusId,.25f};check(setOscillatorOutputRouting(mod,routing),"parallel authored sends");
    mod.synthFilters.filters[1].values={1234,.78f,8,.6f,.5f};
    const auto source=addSourceInstance(mod,SourceFamily::Envelope);mod.routes[0]={mod.nextRouteId++,true,source,{ModDestination::SynthCutoff,0,b},.4f,false};
    auto roundtrip=[&] {const auto bytes=encodeInstrumentState(state);InstrumentState out;check(bytes[7]==37,"typed mixer selects v37");check(decodeInstrumentState(bytes.data(),bytes.size(),out) && encodeInstrumentState(out)==bytes,"exact typed gain/chain/modulation roundtrip");return bytes;};
    {auto mixed=state;mixed.modulation.synthFilters.inputs[1].filter=b;mixed.modulation.synthFilters.inputs[1].busCount=0;const auto encoded=encodeInstrumentState(mixed);InstrumentState out;check(decodeInstrumentState(encoded.data(),encoded.size(),out) && out.modulation.synthFilters.inputs[1].buses[0].filter && out.modulation.synthFilters.inputs[1].buses[0].bus==b,"mixed legacy and typed authoring serializes canonically");}
    auto bytes=roundtrip();std::size_t tail=8;for(const auto& f:mod.synthFilters.filters) tail+=f.id?36+8*f.busCount:4;for(const auto& in:mod.synthFilters.inputs) tail+=12+12*in.busCount;
    const auto first=bytes.size()-tail+8;std::size_t inputs=first;for(const auto& f:mod.synthFilters.filters) inputs+=f.id?36+8*f.busCount:4;
    {auto bad=bytes;word(bad,first+44,a);InstrumentState out;check(!decodeInstrumentState(bad.data(),bad.size(),out),"duplicate filter decoder rejection");}
    {auto bad=bytes;word(bad,first+44+8,b);InstrumentState out;check(!decodeInstrumentState(bad.data(),bad.size(),out),"serial cycle decoder rejection");}
    {auto bad=bytes;word(bad,inputs+12+12,999);InstrumentState out;check(!decodeInstrumentState(bad.data(),bad.size(),out),"dangling typed filter decoder rejection");}
    {auto bad=bytes;word(bad,inputs+12+8,2);InstrumentState out;check(!decodeInstrumentState(bad.data(),bad.size(),out),"unknown destination kind rejection");}
    for(std::size_t n=bytes.size()-32;n<bytes.size();++n) {InstrumentState out;check(!decodeInstrumentState(bytes.data(),n,out),"truncation rejects");}
    auto invalid=state;invalid.modulation.synthFilters.filters[2].next=b;check(!validInstrumentState(invalid),"cycle rejects");
    invalid=state;invalid.modulation.synthFilters.inputs[0].buses[1].bus=999;check(!validInstrumentState(invalid),"dangling filter rejects");
    check(removeSynthFilter(mod,b) && !mod.routes[0].id,"delete removes filter modulation");routing=oscillatorOutputRouting(mod,state.oscillators[0]);
    check(routing.busRoutes[0].level==.4f && routing.busRoutes[routing.busRouteCount-1].level==.25f,"delete preserves other positive gains");
    const auto other=oscillatorOutputRouting(mod,state.oscillators[1]);check(other.busRouteCount==1 && other.busRoutes[0].bus==mainBusId && other.busRoutes[0].level==1,"delete restores MAIN only for otherwise silent oscillator");roundtrip();
    check(removeSynthFilter(mod,a) && removeSynthFilter(mod,c),"remaining filters delete");const auto fresh=addSynthFilter(mod);check(fresh>c,"filter IDs never reused");
    for(std::size_t n=1;n<maxSynthFilters;++n) check(addSynthFilter(mod)!=0,"bounded capacity");check(!addSynthFilter(mod),"capacity rejects");
    check(removeBus(state,bus) && validInstrumentState(state),"bus deletion preserves typed filters");roundtrip();
}

void synthFilterTypesV38() {
    OrigamiEngine e;auto state=e.instrumentState();const auto f=addSynthFilter(state.modulation);check(insertSynthFilter(state.modulation,state.oscillators,f,1),"typed state route");
    for(const auto& info:dsp::filterTypes) if(info.synth) {auto& filter=state.modulation.synthFilters.filters[0];filter.type=info.id;filter.values.gain=info.gain?6.f:0.f;const auto bytes=encodeInstrumentState(state);InstrumentState decoded;check(decodeInstrumentState(bytes.data(),bytes.size(),decoded) && decoded.modulation.synthFilters.filters[0].type==info.id && decoded.modulation.synthFilters.filters[0].values.gain==filter.values.gain && encodeInstrumentState(decoded)==bytes,"each canonical Synth type and gain roundtrips");if(info.id!=dsp::FilterType::LowPass) {check(bytes[7]==38,"type requires schema38");const auto first=bytes.size()-(8+52+7*4+16*12+24)+8;for(unsigned badType:{8u,9u,0xffffffffu}) {auto bad=bytes;word(bad,first+32,badType);auto before=encodeInstrumentState(decoded);check(!decodeInstrumentState(bad.data(),bad.size(),decoded) && encodeInstrumentState(decoded)==before,"unsupported Synth type rejects atomically");}}}
    state.modulation.synthFilters.filters[0].type=dsp::FilterType::Comb;check(!validInstrumentState(state),"Comb unavailable until independently budgeted runtime exists");
}

void patches() {
    Patch p,out;std::string error;
    p.parameters[0]=.625f;
    const auto json=serializePatch(p);
    check(parsePatch(json,out,error) && out.parameters==p.parameters,"fractional patch round trip");
    for(const auto* firstMissing:{"osc.1.octave","osc.1.unison"}) {
        auto old=json;const auto end=old.find(std::string("    \"")+firstMissing);
        old.erase(end);old.erase(old.find_last_of(','));old+="\n  }\n}\n";
        check(parsePatch(old,out,error) && out.parameters==p.parameters,"legacy preset defaults migration");
    }
    auto partial=json;auto pos=partial.find("    \"osc.1.fine\"");partial.erase(pos,partial.find('\n',pos)-pos+1);
    check(!parsePatch(partial,out,error),"partial historical set rejected");
}
}
int main() {try {states();nestedStateV34();instanceStateV35();synthFiltersV36();synthFilterTypesV38();patches();std::cout<<"PASS: "<<checks<<" state checks\n";return 0;}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
