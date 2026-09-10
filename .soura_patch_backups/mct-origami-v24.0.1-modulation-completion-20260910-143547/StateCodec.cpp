// mct-origami-glide-mono-legato-v23.4.3
// mct-origami-pitch-mod-real-v23.3
#include "StateCodec.h"
#include <cstring>
#include <stdexcept>
namespace mct::origami {
namespace {
constexpr std::uint32_t magic=0x4d43544fu;
struct Writer {
    std::vector<std::uint8_t> bytes;
    void word(std::uint32_t n) {for(int shift=24;shift>=0;shift-=8) bytes.push_back(static_cast<std::uint8_t>(n>>shift));}
    void real(float f) {std::uint32_t n;std::memcpy(&n,&f,4);word(n);}
};
struct Reader {
    const std::uint8_t* data;std::size_t size,pos=0;bool ok=true;
    std::uint32_t word() {
        if(size-pos<4) {ok=false;return 0;}
        std::uint32_t n=0;for(int i=0;i<4;++i) n=(n<<8)|data[pos++];return n;
    }
    float real() {auto n=word();float f;std::memcpy(&f,&n,4);return f;}
};
}
std::vector<std::uint8_t> encodeInstrumentState(const InstrumentState& s) {
    if(!validInstrumentState(s)) throw std::invalid_argument("Invalid Origami instrument state");
    Writer w;w.word(magic);w.word(5);w.word(static_cast<std::uint32_t>(parameterCount));
    for(float v:s.parameters) w.real(v);
    w.word(s.nextId);
    std::uint32_t count=0;for(const auto& m:s.oscillators) if(m.id) ++count;
    w.word(count);
    for(const auto& m:s.oscillators) if(m.id) {
        w.word(m.id);w.word(m.enabled?1:0);w.word(m.tableId);
        w.real(m.wtPosition);w.real(m.waveform);w.real(m.octave);w.real(m.semitone);
        w.real(m.fineCents);w.word(m.unison);w.real(m.detuneCents);w.real(m.pan);w.real(m.level);
    }
    const auto& mod=s.modulation;
    w.word(static_cast<std::uint32_t>(mod.lfo1.shape));w.word(static_cast<std::uint32_t>(mod.lfo1.mode));w.real(mod.lfo1.rateHz);
    for(float v:mod.macros) w.real(v);
    w.word(mod.nextRouteId);
    std::uint32_t routes=0;for(const auto& r:mod.routes) if(r.id) ++routes;
    w.word(routes);
    for(const auto& r:mod.routes) if(r.id) {
        w.word(r.id);w.word(r.enabled?1:0);w.word(static_cast<std::uint32_t>(r.source));
        w.word(static_cast<std::uint32_t>(r.destination.parameter));w.word(r.destination.oscillator);w.real(r.amount);
    }
    w.real(s.performance.pitchBendRangeSemitones);
    w.word(static_cast<std::uint32_t>(s.performance.voiceMode));
    w.word(static_cast<std::uint32_t>(s.performance.notePriority));
    w.word(s.performance.legato?1u:0u);
    w.real(s.performance.glideSeconds);
    return w.bytes;
}
bool decodeInstrumentState(const void* data,std::size_t size,InstrumentState& output) noexcept {
    if(!data || size<12 || size>4096) return false;
    Reader r{static_cast<const std::uint8_t*>(data),size};
    if(r.word()!=magic) return false;
    const auto version=r.word(),count=r.word();
    if(version!=1 && version!=2 && version!=3 && version!=4 && version!=5) return false;
    if(version==1 ? (count!=10 && count!=13 && count!=parameterCount) : count!=parameterCount) return false;
    InstrumentState s;
    for(std::size_t i=0;i<count;++i) s.parameters[i]=r.real();
    // Validate before converting the legacy unison float to an integer.
    for(const auto& p:parameterRegistry()) {
        const auto v=s.parameters[static_cast<std::size_t>(p.id)];
        if(!std::isfinite(v) || v<p.minimum || v>p.maximum ||
           (p.scale==ParameterScale::Choice && v!=std::round(v))) return false;
    }
    if(version==1) {
        s.oscillators[0].id=1;s.oscillators[0].enabled=true;
        applyLegacyOscillatorParameters(s.oscillators[0],s.parameters);
    } else {
        s.nextId=r.word();const auto modules=r.word();
        if(modules<1 || modules>s.oscillators.size()) return false;
        for(std::size_t i=0;i<modules;++i) {
            auto& m=s.oscillators[i];m.id=r.word();const auto enabled=r.word();
            if(!m.id || enabled>1) return false;
            m.enabled=enabled==1;m.tableId=r.word();
            m.wtPosition=r.real();m.waveform=r.real();m.octave=r.real();m.semitone=r.real();
            m.fineCents=r.real();m.unison=r.word();m.detuneCents=r.real();m.pan=r.real();m.level=r.real();
        }
    }
    if(version>=3) {
        auto& mod=s.modulation;
        mod.lfo1.shape=static_cast<LfoShape>(r.word());mod.lfo1.mode=static_cast<LfoMode>(r.word());mod.lfo1.rateHz=r.real();
        for(auto& v:mod.macros) v=r.real();
        mod.nextRouteId=r.word();const auto routes=r.word();
        if(routes>mod.routes.size()) return false;
        for(std::size_t i=0;i<routes;++i) {
            auto& route=mod.routes[i];route.id=r.word();const auto enabled=r.word();
            if(!route.id || enabled>1) return false;
            route.enabled=enabled==1;route.source=static_cast<ModSource>(r.word());
            route.destination.parameter=static_cast<ModDestination>(r.word());
            route.destination.oscillator=r.word();route.amount=r.real();
        }
    }
    if(version>=4) s.performance.pitchBendRangeSemitones=r.real();
    if(version>=5) {
        s.performance.voiceMode=static_cast<VoiceMode>(r.word());
        s.performance.notePriority=static_cast<NotePriority>(r.word());
        const auto legato=r.word();if(legato>1) return false;s.performance.legato=legato==1;
        s.performance.glideSeconds=r.real();
    }
    if(!r.ok || r.pos!=size || !validInstrumentState(s)) return false;
    output=s;return true;
}
}
