// mct-origami-unified-routing-core-fx-p04
// mct-origami-fx-graph-dsp-bus-routing-p02
// mct-origami-v40.3.1-sequence-expression-state-v22
// mct-origami-v40.2.0-sequence-transport-state-v21
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
#include "core/nodes/ControlGraph.h"
#include <cstring>
#include <string>
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
void writeInstance(Writer& w,const SourceInstance& a) {
    w.word(a.id); if(!a.id) return;
    w.word(a.number);w.word(static_cast<std::uint32_t>(a.family));
    for(float v:{a.envelope.attack,a.envelope.decay,a.envelope.sustain,a.envelope.release,a.envelope.attackCurve,a.envelope.decayCurve,a.envelope.releaseCurve}) w.real(v);
    const auto& l=a.lfo;w.word(static_cast<std::uint32_t>(l.shape));w.word(static_cast<std::uint32_t>(l.mode));w.real(l.rateHz);w.word(l.pointCount);
    for(const auto& p:l.points) {w.real(p.x);w.real(p.y);w.real(p.curve);}
    w.word(l.pingPong ? 1 : 0);
    for(float v:{l.smooth,l.attackSeconds,l.delaySeconds,l.phase,l.skew,l.quantize,l.entropy,l.fracture,l.stereo}) w.real(v);
    for(float v:{a.random.rateHz,a.random.smoothing,a.random.hold,a.random.delaySeconds,a.function.rateHz,a.function.curve,
        a.chaos.rateHz,a.chaos.chaos,a.chaos.flow,a.chaos.damping,a.chaos.warp,a.chaos.smoothing,a.drift.rateHz,a.sequencer.rateHz}) w.real(v);
    w.word(static_cast<std::uint32_t>(a.chaos.axis));w.word(static_cast<std::uint32_t>(a.chaos.method));
    const auto& q=a.sequencer;w.word(q.activeSteps);w.word(static_cast<std::uint32_t>(q.direction));w.word(q.loop ? 1 : 0);w.real(q.humanize);
    for(float v:q.steps) w.real(v);for(float v:q.probability) w.real(v);for(auto v:q.ratchets) w.word(v);
}
bool readInstance(Reader& r,SourceInstance& a) {
    a={};a.id=r.word();if(!a.id) return r.ok;
    a.number=r.word();a.family=static_cast<SourceFamily>(r.word());
    for(float* v:{&a.envelope.attack,&a.envelope.decay,&a.envelope.sustain,&a.envelope.release,&a.envelope.attackCurve,&a.envelope.decayCurve,&a.envelope.releaseCurve}) *v=r.real();
    auto& l=a.lfo;l.shape=static_cast<LfoShape>(r.word());l.mode=static_cast<LfoMode>(r.word());l.rateHz=r.real();l.pointCount=r.word();
    for(auto& p:l.points) {p.x=r.real();p.y=r.real();p.curve=r.real();}
    auto flag=r.word();if(flag>1) return false;l.pingPong=flag==1;
    for(float* v:{&l.smooth,&l.attackSeconds,&l.delaySeconds,&l.phase,&l.skew,&l.quantize,&l.entropy,&l.fracture,&l.stereo}) *v=r.real();
    for(float* v:{&a.random.rateHz,&a.random.smoothing,&a.random.hold,&a.random.delaySeconds,&a.function.rateHz,&a.function.curve,
        &a.chaos.rateHz,&a.chaos.chaos,&a.chaos.flow,&a.chaos.damping,&a.chaos.warp,&a.chaos.smoothing,&a.drift.rateHz,&a.sequencer.rateHz}) *v=r.real();
    a.chaos.axis=static_cast<ChaosAxis>(r.word());a.chaos.method=static_cast<ChaosMethod>(r.word());
    auto& q=a.sequencer;q.activeSteps=r.word();q.direction=static_cast<SequenceDirection>(r.word());flag=r.word();if(flag>1) return false;q.loop=flag==1;q.humanize=r.real();
    for(auto& v:q.steps) v=r.real();for(auto& v:q.probability) v=r.real();for(auto& v:q.ratchets) v=r.word();return r.ok;
}

}
std::vector<std::uint8_t> encodeInstrumentState(const InstrumentState& s) {
    if(!validInstrumentState(s)) throw std::invalid_argument("Invalid Origami instrument state");
    // N04: v28 only when CONTROL operators exist; states without them are
    // written exactly as v27 (byte-identical to pre-N04 saves).
    bool operators=false,eventNodes=false,sequencing=false;
    for(const auto& op:s.modulation.operators) {
        if(!op.id) continue;
        operators=true;
        // N05: event/logic nodes or a third input need v29.
        eventNodes|=static_cast<int>(op.type)>=static_cast<int>(ControlOpType::Clock) || op.inputs[2].kind!=ControlInput::Kind::None;
        // N06: sequencing nodes, output ports, RESET inputs and PING-PONG need v30.
        sequencing|=static_cast<int>(op.type)>=static_cast<int>(ControlOpType::ClockDivider);
        for(const auto& in:op.inputs) sequencing|=in.port!=0;
        const bool resetInput=op.type==ControlOpType::Counter || op.type==ControlOpType::Toggle || op.type==ControlOpType::RandomTrigger;
        sequencing|=resetInput && op.inputs[1].kind!=ControlInput::Kind::None;
        sequencing|=op.type==ControlOpType::Counter && op.params[1]>1.5f;
    }
    for(const auto& r:s.modulation.routes) sequencing|=r.id!=0 && operatorPortOf(r.source)!=0;
    // Dynamic macros: v31 only when the macro set differs from Init's four;
    // otherwise saves are byte-identical to before.
    bool dynamicMacros=s.modulation.macroMask!=defaultMacroMask;
    for(std::size_t i=4;i<maxMacros;++i) dynamicMacros|=s.modulation.macros[i]!=0.0f;
    // LFO FUNC processing / PING-PONG: v32 only when some LFO uses them;
    // all-neutral LFOs keep saving in the older format, byte for byte.
    bool lfoFunctions=false;
    for(std::size_t i=0;i<4;++i) lfoFunctions|=!lfoFunctionsNeutral(lfoSettings(s.modulation,i));
    // LFO STEREO: v33 only when some LFO uses it (older formats otherwise).
    bool lfoStereo=false;
    for(std::size_t i=0;i<4;++i) lfoStereo|=lfoSettings(s.modulation,i).stereo!=0.0f;
    // mct-origami-nested-modulation-manual-qa: v34 when a state uses what
    // older formats cannot express: nested destinations (LFO RATE, MACRO,
    // ROUTE DEPTH), MAIN TUNING routes (now a +/-48 st span; older formats
    // meant +/-1 st), pitch-wheel endpoints that are not "UP 1..48 / DOWN
    // -48..-1" (older formats stored DOWN as a magnitude), macro names.
    bool v34=false;
    for(const auto& route:s.modulation.routes)
        v34|=route.id && (isNestedDestination(route.destination.parameter) || route.destination.parameter==ModDestination::MainTuning);
    const float up=s.performance.pitchBendRangeSemitones,down=s.performance.pitchBendDownSemitones;
    v34|=!(up>=1.0f && up<=48.0f && down<=-1.0f && down>=-48.0f);
    for(const auto& name:s.modulation.macroNames) v34|=name[0]!='\0';
    const std::uint32_t version=(s.modulation.synthFilters.nextId!=1 || std::any_of(s.modulation.synthFilters.inputs.begin(),s.modulation.synthFilters.inputs.end(),[](const auto& in){return in.oscillator!=0;})) ? 36u : s.modulation.nextInstanceId!=1 ? 35u : v34 ? 34u : lfoStereo ? 33u : lfoFunctions ? 32u : dynamicMacros ? 31u : sequencing ? 30u : eventNodes ? 29u : operators ? 28u : 27u;
    Writer w;w.word(magic);w.word(version);w.word(static_cast<std::uint32_t>(parameterCount));
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
    for(std::size_t i=0;i<4;++i) w.real(mod.macros[i]); // MACRO 1..4: the original fixed field
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
    // V19: Lorenz Chaos parameters. Rate remains in its original V12 field.
    w.real(mod.chaos.chaos);w.real(mod.chaos.flow);w.real(mod.chaos.damping);
    w.word(static_cast<std::uint32_t>(mod.chaos.axis));
    w.word(static_cast<std::uint32_t>(mod.chaos.method));
    w.real(mod.chaos.warp);w.real(mod.chaos.smoothing);
    w.word(mod.sequencer.activeSteps);w.word(static_cast<std::uint32_t>(mod.sequencer.direction));w.word(mod.sequencer.loop?1u:0u);
    for(float probability:mod.sequencer.probability) w.real(probability);
    for(auto ratchet:mod.sequencer.ratchets) w.word(ratchet);
    w.real(mod.sequencer.humanize);
    // V23: stable-ID oscillator child collections and modulation child IDs.
    // Legacy fixed slots remain in their original fields for backward-safe
    // runtime/UI migration; these collections are the authoritative future path.
    for(const auto& m:s.oscillators) if(m.id) {
        std::array<OscProcessSlot,maxOscProcesses> processes=m.processes;
        std::uint8_t processCount=m.processCount;
        OscProcessSlotId nextProcessId=m.nextProcessId;
        if(processCount==0) {
            if(m.process1!=dsp::OscProcessType::Off)
                processes[processCount++]={nextProcessId++,m.process1,m.process1Amount,m.process1Seed};
            if(m.process2!=dsp::OscProcessType::Off && processCount<maxOscProcesses)
                processes[processCount++]={nextProcessId++,m.process2,m.process2Amount,m.process2Seed};
        }
        w.word(processCount);w.word(nextProcessId);
        for(std::size_t i=0;i<processCount;++i) {
            const auto& p=processes[i];
            w.word(p.id);w.word(static_cast<std::uint32_t>(p.type));w.real(p.amount);w.word(p.seed);
        }
        std::array<OscRouteSlot,maxOscRoutes> routes=m.routes;
        std::uint8_t routeCount=m.routeCount;
        OscRouteSlotId nextRouteId=m.nextRouteId;
        if(routeCount==0) {
            if(m.route1Type!=OscRouteType::Off)
                routes[routeCount++]={nextRouteId++,m.route1SourceId,m.route1Type,m.route1Amount};
            if(m.route2Type!=OscRouteType::Off && routeCount<maxOscRoutes)
                routes[routeCount++]={nextRouteId++,m.route2SourceId,m.route2Type,m.route2Amount};
        }
        w.word(routeCount);w.word(nextRouteId);
        for(std::size_t i=0;i<routeCount;++i) {
            const auto& route=routes[i];
            w.word(route.id);w.word(route.sourceId);w.word(static_cast<std::uint32_t>(route.type));w.real(route.amount);
        }
    }
    for(const auto& route:mod.routes) if(route.id) w.word(route.destination.itemId);
    // V24: persistent per-child OSC CHAIN bypass state. Appended after the
    // complete V23 payload so every older preset remains byte-layout compatible.
    for(const auto& m:s.oscillators) if(m.id) {
        if(m.processCount>0) {
            for(std::size_t i=0;i<m.processCount;++i) w.word(m.processes[i].enabled?1u:0u);
        } else {
            if(m.process1!=dsp::OscProcessType::Off) w.word(1u);
            if(m.process2!=dsp::OscProcessType::Off) w.word(1u);
        }
        if(m.routeCount>0) {
            for(std::size_t i=0;i<m.routeCount;++i) w.word(m.routes[i].enabled?1u:0u);
        } else {
            if(m.route1Type!=OscRouteType::Off) w.word(1u);
            if(m.route2Type!=OscRouteType::Off) w.word(1u);
        }
    }
    // V25: asymmetric pitch bend. Original V4 field remains the UP range.
    // Before v34 DOWN is a magnitude ("down by N"); v34 stores the signed endpoint.
    w.real(version>=34 ? s.performance.pitchBendDownSemitones : -s.performance.pitchBendDownSemitones);
    // V26: named buses and per-oscillator bus sends.
    w.word(s.buses.count);w.word(s.buses.nextId);
    for(std::size_t i=0;i<s.buses.count;++i) {
        const auto& bus=s.buses.buses[i];
        w.word(bus.id);w.word(bus.active?1u:0u);
        const auto length=std::strlen(bus.name.data());
        w.word(static_cast<std::uint32_t>(length));
        for(std::size_t c=0;c<length;++c) w.word(static_cast<std::uint8_t>(bus.name[c]));
    }
    for(const auto& m:s.oscillators) if(m.id) {
        w.word(m.busRouteCount);
        for(std::size_t i=0;i<m.busRouteCount;++i) {w.word(m.busRoutes[i].bus);w.real(m.busRoutes[i].level);}
    }
    // V28: CONTROL operators by storage slot (holes kept so slots stay stable).
    if(version>=28) {
        w.word(s.modulation.nextOperatorId);
        w.word(static_cast<std::uint32_t>(s.modulation.operators.size()));
        for(const auto& op:s.modulation.operators) {
            w.word(op.id);
            if(!op.id) continue;
            w.word(static_cast<std::uint32_t>(op.type));
            for(float v:op.params) w.real(v);
            for(std::size_t k=0;k<(version>=29 ? 3u : 2u);++k) { // v28: inputs A, B; v29: + third input
                const auto& in=op.inputs[k];
                w.word(static_cast<std::uint32_t>(in.kind));
                w.word(static_cast<std::uint32_t>(in.source));
                w.word(in.op);
                if(version>=30) w.word(in.port); // v30: the upstream output port
            }
        }
    }
    // V31: the macro set (stable ids 1..16) and the values of macros 5..16.
    if(version>=31) {
        w.word(s.modulation.macroMask);
        for(std::size_t i=4;i<maxMacros;++i) w.real(s.modulation.macros[i]);
    }
    // V32: per LFO, PING-PONG flag + the eight FUNC values.
    if(version>=32) {
        for(std::size_t i=0;i<4;++i) {
            const auto& l=lfoSettings(s.modulation,i);
            w.word(l.pingPong ? 1u : 0u);
            for(float v:{l.smooth,l.attackSeconds,l.delaySeconds,l.phase,l.skew,l.quantize,l.entropy,l.fracture}) w.real(v);
        }
    }
    // V33: per LFO, STEREO.
    if(version>=33) for(std::size_t i=0;i<4;++i) w.real(lfoSettings(s.modulation,i).stereo);
    if(version>=34)
        for(const auto& name:s.modulation.macroNames) {
            std::uint32_t length=0; while(length<name.size() && name[length]!='\0') ++length;
            w.word(length);
            for(std::uint32_t c=0;c<length;++c) w.word(static_cast<unsigned char>(name[c]));
        }
    if(version>=35) {w.word(mod.nextInstanceId);w.word(maxSourceInstances);for(const auto& a:mod.instances) writeInstance(w,a);}
    if(version>=36) {
        const auto& c=mod.synthFilters;w.word(c.nextId);w.word(maxSynthFilters);
        for(const auto& f:c.filters) {w.word(f.id);if(!f.id) continue;w.word(f.power?1u:0u);w.word(f.next);
            for(float v:{f.values.cutoff,f.values.resonance,f.values.drive,f.values.mix,f.values.keytrack}) w.real(v);
            w.word(f.busCount);for(std::size_t b=0;b<f.busCount;++b) {w.word(f.buses[b].bus);w.real(f.buses[b].level);}}
        for(const auto& in:c.inputs) {w.word(in.oscillator);w.word(in.filter);w.word(in.busCount);for(std::size_t b=0;b<in.busCount;++b) {w.word(in.buses[b].bus);w.real(in.buses[b].level);}}
    }
    return w.bytes;
}
bool decodeInstrumentState(const void* data,std::size_t size,InstrumentState& output) noexcept {
    return decodeInstrumentState(data,size,output,nullptr);
}
bool decodeInstrumentState(const void* data,std::size_t size,InstrumentState& output,DecodeReport* report) noexcept {
    if(!data || size<12 || size>65536) return false;
    Reader r{static_cast<const std::uint8_t*>(data),size};
    if(r.word()!=magic) return false;
    const auto version=r.word(),count=r.word();
    if(version<1 || version>36) return false;
    if(version==1 ? (count!=10 && count!=13 && count!=parameterCount) : count!=parameterCount) return false;
    InstrumentState s;
    // Formats before collection flags implicitly contained the filter.
    s.modulation.filterEnabled=true;
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
        for(std::size_t i=0;i<4;++i) mod.macros[i]=r.real(); // MACRO 1..4
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
    if(version>=19) {
        s.modulation.chaos.chaos=r.real();s.modulation.chaos.flow=r.real();
        s.modulation.chaos.damping=r.real();
        s.modulation.chaos.axis=static_cast<ChaosAxis>(r.word());
    }
    if(version>=20) {
        s.modulation.chaos.method=static_cast<ChaosMethod>(r.word());
        s.modulation.chaos.warp=r.real();s.modulation.chaos.smoothing=r.real();
    }
    if(version>=21) { s.modulation.sequencer.activeSteps=r.word();s.modulation.sequencer.direction=static_cast<SequenceDirection>(r.word());const auto loop=r.word();if(loop>1u) return false;s.modulation.sequencer.loop=loop==1u; }
    if(version>=22) { for(auto& probability:s.modulation.sequencer.probability) probability=r.real(); for(auto& ratchet:s.modulation.sequencer.ratchets) ratchet=r.word(); s.modulation.sequencer.humanize=r.real(); }
    if(version>=23) {
        for(auto& m:s.oscillators) if(m.id) {
            const auto processCount=r.word();m.nextProcessId=r.word();
            if(processCount>maxOscProcesses || m.nextProcessId==0) return false;
            m.processCount=static_cast<std::uint8_t>(processCount);
            for(std::size_t i=0;i<m.processCount;++i) {
                auto& p=m.processes[i];p.id=r.word();p.type=static_cast<dsp::OscProcessType>(r.word());
                p.amount=r.real();p.seed=r.word();
            }
            const auto routeCount=r.word();m.nextRouteId=r.word();
            if(routeCount>maxOscRoutes || m.nextRouteId==0) return false;
            m.routeCount=static_cast<std::uint8_t>(routeCount);
            for(std::size_t i=0;i<m.routeCount;++i) {
                auto& route=m.routes[i];route.id=r.word();route.sourceId=r.word();
                route.type=static_cast<OscRouteType>(r.word());route.amount=r.real();
            }
        }
        for(auto& route:s.modulation.routes) if(route.id) route.destination.itemId=r.word();
        if(version>=24) {
            for(auto& m:s.oscillators) if(m.id) {
                for(std::size_t i=0;i<m.processCount;++i) {
                    const auto enabled=r.word(); if(enabled>1u) return false;
                    m.processes[i].enabled=enabled==1u;
                }
                for(std::size_t i=0;i<m.routeCount;++i) {
                    const auto enabled=r.word(); if(enabled>1u) return false;
                    m.routes[i].enabled=enabled==1u;
                }
            }
        }
    } else {
        // Materialize stable child IDs for every legacy preset without changing
        // its fixed-slot modulation semantics yet. Patch 4 can bind the new UI
        // directly to these IDs while old destinations continue to sound exact.
        for(auto& m:s.oscillators) if(m.id) {
            if(m.processCount==0) {
                if(m.process1!=dsp::OscProcessType::Off)
                    m.processes[m.processCount++]={m.nextProcessId++,m.process1,m.process1Amount,m.process1Seed};
                if(m.process2!=dsp::OscProcessType::Off && m.processCount<maxOscProcesses)
                    m.processes[m.processCount++]={m.nextProcessId++,m.process2,m.process2Amount,m.process2Seed};
            }
            if(m.routeCount==0) {
                if(m.route1Type!=OscRouteType::Off)
                    m.routes[m.routeCount++]={m.nextRouteId++,m.route1SourceId,m.route1Type,m.route1Amount};
                if(m.route2Type!=OscRouteType::Off && m.routeCount<maxOscRoutes)
                    m.routes[m.routeCount++]={m.nextRouteId++,m.route2SourceId,m.route2Type,m.route2Amount};
            }
        }
    }
    if(version>=25) s.performance.pitchBendDownSemitones=r.real();
    else s.performance.pitchBendDownSemitones=s.performance.pitchBendRangeSemitones;
    // Before v34 DOWN was a magnitude: the wheel went DOWN by it. As a signed
    // endpoint that is its negative (same sound).
    if(version<34) s.performance.pitchBendDownSemitones=-s.performance.pitchBendDownSemitones;
    if(version>=26) {
        const auto busCount=r.word();
        if(busCount<1 || busCount>BusState::capacity) return false;
        s.buses=BusState{};
        s.buses.count=static_cast<std::uint8_t>(busCount);
        s.buses.nextId=r.word();
        for(std::size_t i=0;i<busCount && r.ok;++i) {
            auto& bus=s.buses.buses[i];
            bus={};
            bus.id=r.word();
            const auto active=r.word();if(active>1u) return false;
            bus.active=active==1u;
            const auto length=r.word();if(length>Bus::maxNameBytes) return false;
            for(std::size_t c=0;c<length;++c) {
                const auto ch=r.word();if(ch==0 || ch>0xffu) return false;
                bus.name[c]=static_cast<char>(ch);
            }
        }
        for(auto& m:s.oscillators) if(m.id) {
            const auto routes=r.word();
            if(routes<1 || routes>maxOscBusRoutes) return false;
            m.busRouteCount=static_cast<std::uint8_t>(routes);
            for(std::size_t i=0;i<routes;++i) {m.busRoutes[i].bus=r.word();m.busRoutes[i].level=r.real();}
            for(std::size_t i=routes;i<maxOscBusRoutes;++i) m.busRoutes[i]={};
        }
    }
    // V27: the permanent default bus is presented as MAIN. Its stable id (1)
    // never changed, so routes and FX graphs migrate untouched.
    if(version<27 && s.buses.buses[0].id==mainBusId && std::string(s.buses.buses[0].name.data())=="BUS 1")
        BusState::setBusName(s.buses.buses[0],"MAIN");
    if(version>=28) {
        auto& m=s.modulation;
        m.nextOperatorId=r.word();
        const auto slots=r.word();
        if(slots!=m.operators.size()) return false;
        for(auto& op:m.operators) {
            op={};
            op.id=r.word();
            if(!op.id || !r.ok) continue;
            const auto type=r.word();
            if(type>0xffu) return false;
            op.type=static_cast<ControlOpType>(type);
            for(auto& v:op.params) v=r.real();
            for(std::size_t k=0;k<(version>=29 ? 3u : 2u);++k) {
                auto& in=op.inputs[k];
                const auto kind=r.word();
                if(kind>2u) return false;
                in.kind=static_cast<ControlInput::Kind>(kind);
                in.source=static_cast<ModSource>(r.word());
                in.op=r.word();
                if(version>=30) {
                    const auto port=r.word();
                    if(port>0xffu) return false; // structural; an unknown port is repaired below
                    in.port=static_cast<std::uint8_t>(port);
                }
            }
        }
    }
    if(version>=31) {
        const auto mask=r.word();
        if(mask>0xffffu) return false;
        s.modulation.macroMask=static_cast<std::uint16_t>(mask);
        for(std::size_t i=4;i<maxMacros;++i) s.modulation.macros[i]=r.real();
    }
    // Older states: every FUNC field stays at its neutral default.
    if(version>=32) {
        for(std::size_t i=0;i<4;++i) {
            auto& l=lfoSettings(s.modulation,i);
            const auto flags=r.word();
            if(flags>1u) return false;
            l.pingPong=flags==1u;
            for(float* v:{&l.smooth,&l.attackSeconds,&l.delaySeconds,&l.phase,&l.skew,&l.quantize,&l.entropy,&l.fracture}) *v=r.real();
        }
    }
    if(version>=33) for(std::size_t i=0;i<4;++i) lfoSettings(s.modulation,i).stereo=r.real(); // older: 0 (mono)
    // v34: MAIN TUNING spans +/-48 st (was +/-1 st): an older route's amount
    // (a fraction of the span) keeps its sound scaled by 2 / 96.
    if(version<34)
        for(auto& route:s.modulation.routes)
            if(route.id && route.destination.parameter==ModDestination::MainTuning) route.amount/=48.0f;
    if(version>=34) {
        // Macro names (stable id order): length byte + bytes.
        for(auto& name:s.modulation.macroNames) {
            const auto length=r.word();
            if(length>=name.size()) return false;
            name.fill('\0');
            for(std::uint32_t c=0;c<length;++c) { const auto ch=r.word(); if(ch==0u || ch>255u) return false; name[c]=static_cast<char>(ch); }
        }
    }
    if(version>=35) {s.modulation.nextInstanceId=r.word();if(r.word()!=maxSourceInstances) return false;for(auto& a:s.modulation.instances) if(!readInstance(r,a)) return false;}
    if(version>=36) {
        auto& c=s.modulation.synthFilters;c.nextId=r.word();if(r.word()!=maxSynthFilters) return false;
        for(auto& f:c.filters) {f={};f.id=r.word();if(!f.id) continue;const auto power=r.word();if(power>1) return false;f.power=power==1;f.next=r.word();
            for(float* v:{&f.values.cutoff,&f.values.resonance,&f.values.drive,&f.values.mix,&f.values.keytrack}) *v=r.real();
            const auto count=r.word();if(count>maxOscBusRoutes) return false;f.busCount=static_cast<std::uint8_t>(count);
            for(std::size_t b=0;b<f.busCount;++b) {f.buses[b].bus=r.word();f.buses[b].level=r.real();}}
        for(auto& in:c.inputs) {in={};in.oscillator=r.word();in.filter=r.word();const auto count=r.word();if(count>maxOscBusRoutes) return false;in.busCount=static_cast<std::uint8_t>(count);for(std::size_t b=0;b<in.busCount;++b) {in.buses[b].bus=r.word();in.buses[b].level=r.real();}}
    }
    // mct-origami-nodes-n01: (source, destination) pairs are unique. States
    // written before that rule may repeat a pair; merge them deterministically
    // (summed amount, as the compiler always did) instead of rejecting the load.
    mergeDuplicateRoutes(s.modulation);
    // N07: never execute (or reject wholesale) a malformed NODES graph: keep
    // its valid parts, deterministically drop the rest. Valid graphs: no-op.
    const auto repairs=r.ok ? nodes::repairControlGraph(s.modulation) : 0u;
    if(report!=nullptr) report->graphRepairs=repairs;
    // Older states: the default BusState plus every oscillator's default
    // BUS 1 @ unity reproduce the pre-bus signal path exactly.
    if(!r.ok || r.pos!=size || !validInstrumentState(s)) return false;
    output=s;return true;
}
}
