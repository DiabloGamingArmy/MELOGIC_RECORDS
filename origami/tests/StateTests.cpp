#include "core/Engine.h"
#include "core/preset/StateCodec.h"
#include "core/preset/Patch.h"
#include <iostream>
#include <stdexcept>
#include <limits>
using namespace mct::origami;
namespace {
unsigned checks=0;
void check(bool b,const char* label) {++checks;if(!b) throw std::runtime_error(label);}
void word(std::vector<std::uint8_t>& b,std::size_t offset,std::uint32_t n) {
    for(int i=0;i<4;++i) b[offset+static_cast<std::size_t>(i)]=static_cast<std::uint8_t>(n>>(24-i*8));
}
void states() {
    OrigamiEngine a;
    a.setParameter(ParameterId::Waveform,.73f);
    const auto removed=a.addOscillatorModule();
    const auto third=a.addOscillatorModule();
    auto m=a.oscillatorModuleState(third);
    check(m.wtPosition==.73f/3.0f,"new oscillator clones continuous position");
    m.wtPosition=.8125f;m.octave=-2;m.semitone=7;m.fineCents=-23.25f;
    m.unison=5;m.detuneCents=34.5f;m.pan=.42f;m.level=.37f;
    check(a.setOscillatorModuleState(third,m),"independent module controls");
    check(a.parameterState()[0]==.73f,"OSC2+ never changes global OSC1");
    check(a.oscillatorModuleState(third).waveform==.8125f*3,"WT position owns alias");
    m=a.oscillatorModuleState(third);m.waveform=.9f;
    check(a.setOscillatorModuleState(third,m) && a.oscillatorModuleState(third).wtPosition==.9f/3,"legacy waveform setter migration");
    a.setOscillatorModuleEnabled(1,false);a.setOscillatorModuleEnabled(third,false);
    a.removeOscillatorModule(removed);const auto fourth=a.addOscillatorModule();
    check(fourth>third,"monotonic identities after hole reuse");
    const auto saved=a.instrumentState();
    check(saved.oscillators[1].id==third && saved.oscillators[2].id==fourth,"creation order independent of slots");
    const auto bytes=encodeInstrumentState(saved);
    InstrumentState decoded;check(decodeInstrumentState(bytes.data(),bytes.size(),decoded),"decode v2");
    OrigamiEngine b;check(b.restoreInstrumentState(decoded),"restore full engine state");
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
    rejects(0,0);rejects(4,3);rejects(8,10);rejects(12,0x7fc00000); // magic/version/count/NaN
    rejects(12+4*parameterCount,1);rejects(16+4*parameterCount,17); // next ID/count
    rejects(first,2);rejects(first+4,2);rejects(first+8,99); // OSC1/boolean/table
    rejects(first+12,0x7f800000);rejects(first+48,1); // infinity/duplicate ID
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
int main() {try {states();patches();std::cout<<"PASS: "<<checks<<" state checks\n";return 0;}catch(const std::exception& e){std::cerr<<"FAIL: "<<e.what()<<'\n';return 1;}}
