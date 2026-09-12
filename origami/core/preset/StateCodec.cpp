// mct-origami-v32.1.1-extended-mod-sources-hotfix
// mct-origami-v32.0.0-dynamic-mod-filter-collections
// mct-origami-v29.0.0-spectral-process-native-routing
// mct-origami-v28.0.0-interactive-envelope-editor
// mct-origami-v27.0.0-cross-osc-routing-foundation
// mct-origami-v26.0.0-osc-process-foundation
// mct-origami-modulation-completion-v24.0.1
// mct-origami-glide-mono-legato-v23.4.3
// mct-origami-pitch-mod-real-v23.3
// mct-origami-v34.0.0-random-lfo
// mct-origami-v33.1.2-osc-blend-engine
// mct-origami-v34.1.0-mod-scroll-clip-mseg-audio
#include "StateCodec.h"
#include <cstring>
#include <stdexcept>
#include <algorithm>
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
    Writer w;w.word(magic);w.word(18);w.word(static_cast<std::uint32_t>(parameterCount));
    for(float v:s.parameters) w.real(v);
    w.word(s.nextId);
    std::uint32_t count=0;for(const auto& m:s.oscillators) if(m.id) ++count;
    w.word(count);
    for(const auto& m:s.oscillators) if(m.id) {
        w.word(m.id);w.word(m.enabled?1:0);w.word(m.tableId);
        w.real(m.wtPosition);w.real(m.waveform);w.real(m.octave);w.real(m.semitone);
        w.real(m.fineCents);w.word(m.unison);w.real(m.detuneCents);w.real(m.pan);w.real(m.level);
        w.real(m.blend);
        w.word(static_cast<std::uint32_t>(m.process1));w.real(m.process1Amount);
        w.word(static_cast<std::uint32_t>(m.process2));w.real(m.process2Amount);
        w.word(m.process1Seed);w.word(m.process2Seed);
        w.word(m.route1SourceId);w.word(static_cast<std::uint32_t>(m.route1Type));w.real(m.route1Amount);
        w.word(m.route2SourceId);w.word(static_cast<std::uint32_t>(m.route2Type));w.real(m.route2Amount);
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
    for(const auto* e:{&mod.env2,&mod.env3}){w.real(e->attack);w.real(e->decay);w.real(e->sustain);w.real(e->release);}
    for(std::size_t i=1;i<4;++i){const auto& l=lfoSettings(mod,i);w.word(static_cast<std::uint32_t>(l.shape));w.word(static_cast<std::uint32_t>(l.mode));w.real(l.rateHz);}
    w.real(mod.random.rateHz);w.real(mod.function.rateHz);w.real(mod.function.curve);
    w.real(s.performance.pitchBendRangeSemitones);
    w.word(static_cast<std::uint32_t>(s.performance.voiceMode));
    w.word(static_cast<std::uint32_t>(s.performance.notePriority));
    w.word(s.performance.legato?1u:0u);
    w.real(s.performance.glideSeconds);
    for(float c:mod.env1Curves) w.real(c);
    for(const auto* e:{&mod.env2,&mod.env3}) {
        w.real(e->attackCurve);w.real(e->decayCurve);w.real(e->releaseCurve);
    }
    w.word(mod.envActiveMask);
    w.word(mod.lfoActiveMask);
    w.word(mod.filterEnabled?1u:0u);
    w.word(mod.generatorActiveMask);
    w.real(mod.chaos.rateHz);
    w.real(mod.drift.rateHz);
    w.real(mod.sequencer.rateHz);
    for(float step:mod.sequencer.steps) w.real(step);
    // V14: extended Random LFO controls. Appended so v1-v13 layouts remain intact.
    w.real(mod.random.smoothing);
    w.real(mod.random.hold);
    w.real(mod.random.delaySeconds);
    for(std::size_t i=0;i<4;++i) {
        const auto& l=lfoSettings(mod,i);
        w.word(l.pointCount);
        for(std::size_t p=0;p<l.pointCount;++p) {
            w.real(l.points[p].x);
            w.real(l.points[p].y);
            w.real(l.points[p].curve);
        }
    }
    // V16: route polarity, appended so v1-v15 layouts remain readable.
    for(const auto& route:mod.routes) if(route.id) w.word(route.bipolar?1u:0u);
    // V17 compatibility fields. V18 readers ignore these midpoint values in
    // favour of the full MSEG data appended below.
    w.real(0.5f);
    w.real(0.5f);
    w.word(mod.performanceSourceActiveMask);
    // V18: full editable Velocity / Note MSEG curves.
    for(const auto* curve:{&mod.velocityCurve,&mod.noteCurve}) {
        w.word(curve->pointCount);
        for(std::size_t i=0;i<curve->pointCount;++i) {
            w.real(curve->points[i].x);w.real(curve->points[i].y);w.real(curve->points[i].curve);
        }
    }
    return w.bytes;
}
bool decodeInstrumentState(const void* data,std::size_t size,InstrumentState& output) noexcept {
    if(!data || size<12 || size>8192) return false;
    Reader r{static_cast<const std::uint8_t*>(data),size};
    if(r.word()!=magic) return false;
    const auto version=r.word(),count=r.word();
    if(version<1 || version>18) return false;
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
            m.blend=version>=13 ? r.real() : 1.0f;
            if(version>=7) {
                m.process1=static_cast<dsp::OscProcessType>(r.word());m.process1Amount=r.real();
                m.process2=static_cast<dsp::OscProcessType>(r.word());m.process2Amount=r.real();
            }
            if(version>=10) {
                m.process1Seed=r.word();m.process2Seed=r.word();
            }
            if(version>=8) {
                m.route1SourceId=r.word();m.route1Type=static_cast<OscRouteType>(r.word());m.route1Amount=r.real();
                m.route2SourceId=r.word();m.route2Type=static_cast<OscRouteType>(r.word());m.route2Amount=r.real();
            }
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
    if(version>=6) {
        for(auto* e:{&s.modulation.env2,&s.modulation.env3}){e->attack=r.real();e->decay=r.real();e->sustain=r.real();e->release=r.real();}
        for(std::size_t i=1;i<4;++i){auto& l=lfoSettings(s.modulation,i);l.shape=static_cast<LfoShape>(r.word());l.mode=static_cast<LfoMode>(r.word());l.rateHz=r.real();}
        s.modulation.random.rateHz=r.real();s.modulation.function.rateHz=r.real();s.modulation.function.curve=r.real();
    }
    if(version>=4) s.performance.pitchBendRangeSemitones=r.real();
    if(version>=5) {
        s.performance.voiceMode=static_cast<VoiceMode>(r.word());
        s.performance.notePriority=static_cast<NotePriority>(r.word());
        const auto legato=r.word();if(legato>1) return false;s.performance.legato=legato==1;
        s.performance.glideSeconds=r.real();
    }
    if(version>=9) {
        for(auto& c:s.modulation.env1Curves) c=r.real();
        for(auto* e:{&s.modulation.env2,&s.modulation.env3}) {
            e->attackCurve=r.real();e->decayCurve=r.real();e->releaseCurve=r.real();
        }
    }
    if(version>=11) {
        s.modulation.envActiveMask=r.word();
        s.modulation.lfoActiveMask=r.word();
        const auto filterEnabled=r.word();
        if(filterEnabled>1u) return false;
        s.modulation.filterEnabled=filterEnabled==1u;
    }
    if(version>=12) {
        s.modulation.generatorActiveMask=r.word();
        s.modulation.chaos.rateHz=r.real();
        s.modulation.drift.rateHz=r.real();
        s.modulation.sequencer.rateHz=r.real();
        for(auto& step:s.modulation.sequencer.steps) step=r.real();
    }
    if(version>=14) {
        s.modulation.random.smoothing=r.real();
        s.modulation.random.hold=r.real();
        s.modulation.random.delaySeconds=r.real();
    }
    if(version>=15) {
        for(std::size_t i=0;i<4;++i) {
            auto& l=lfoSettings(s.modulation,i);
            l.pointCount=r.word();
            if(l.pointCount>l.points.size() || l.pointCount==1) return false;
            for(std::size_t p=0;p<l.pointCount;++p) {
                l.points[p].x=r.real();
                l.points[p].y=r.real();
                l.points[p].curve=r.real();
            }
        }
    }
    if(version>=16) {
        for(auto& route:s.modulation.routes) if(route.id) {
            const auto bipolar=r.word();
            if(bipolar>1u) return false;
            route.bipolar=bipolar==1u;
        }
    }
    if(version>=17) {
        const float legacyVelocityMid=r.real();
        const float legacyNoteMid=r.real();
        s.modulation.performanceSourceActiveMask=r.word();
        if(version==17) {
            s.modulation.velocityCurve.points[1].y=std::clamp(legacyVelocityMid,0.0f,1.0f);
            s.modulation.noteCurve.points[1].y=std::clamp(legacyNoteMid,0.0f,1.0f);
        }
    }
    if(version>=18) {
        for(auto* curve:{&s.modulation.velocityCurve,&s.modulation.noteCurve}) {
            curve->pointCount=r.word();
            if(curve->pointCount<2 || curve->pointCount>curve->points.size()) return false;
            for(std::size_t i=0;i<curve->pointCount;++i) {
                curve->points[i].x=r.real();curve->points[i].y=r.real();curve->points[i].curve=r.real();
            }
        }
    }
    if(!r.ok || r.pos!=size || !validInstrumentState(s)) return false;
    output=s;return true;
}
}
