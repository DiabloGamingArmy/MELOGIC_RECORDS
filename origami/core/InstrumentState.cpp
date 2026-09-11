// mct-origami-v27.0.0-cross-osc-routing-foundation
// mct-origami-v26.3.0-bipolar-osc-process-amounts
// mct-origami-v26.0.0-osc-process-foundation
// mct-origami-glide-mono-legato-v23.4.3
// mct-origami-pitch-mod-real-v23.3
// mct-origami-v33.1.2-osc-blend-engine
#include "InstrumentState.h"
namespace mct::origami {
void applyLegacyOscillatorParameters(OscillatorModuleState& m,const ParameterValues& p) noexcept {
    auto v=[&](ParameterId id){return p[static_cast<std::size_t>(id)];};
    m.waveform=v(ParameterId::Waveform);m.wtPosition=m.waveform/3.0f;
    m.octave=v(ParameterId::OscOctave);m.semitone=v(ParameterId::OscSemitone);
    m.fineCents=v(ParameterId::OscFine);m.unison=static_cast<unsigned>(v(ParameterId::OscUnison));
    m.detuneCents=v(ParameterId::OscDetune);m.pan=v(ParameterId::OscPan);m.level=v(ParameterId::OscLevel);
}
bool validInstrumentState(const InstrumentState& s) noexcept {
    for(const auto& p:parameterRegistry()) {
        const float v=s.parameters[static_cast<std::size_t>(p.id)];
        if(!std::isfinite(v) || v<p.minimum || v>p.maximum ||
           (p.scale==ParameterScale::Choice && v!=std::round(v))) return false;
    }
    if(s.oscillators[0].id!=1 || !validModulation(s.modulation,s.oscillators)) return false;
    if(!std::isfinite(s.performance.pitchBendRangeSemitones) || s.performance.pitchBendRangeSemitones<1.0f || s.performance.pitchBendRangeSemitones>48.0f) return false;
    if(s.performance.voiceMode!=VoiceMode::Poly && s.performance.voiceMode!=VoiceMode::Mono) return false;
    if(s.performance.notePriority!=NotePriority::Last && s.performance.notePriority!=NotePriority::High && s.performance.notePriority!=NotePriority::Low) return false;
    if(!std::isfinite(s.performance.glideSeconds) || s.performance.glideSeconds<0.0f || s.performance.glideSeconds>5.0f) return false;
    OscillatorModuleId previous=0;bool empty=false;
    auto range=[](float v,float lo,float hi){return std::isfinite(v) && v>=lo && v<=hi;};
    for(const auto& m:s.oscillators) {
        if(!m.id) {empty=true;if(m.enabled) return false;continue;}
        if(empty || m.id<=previous || m.id>=s.nextId || m.tableId!=dsp::BuiltinWavetableId::BasicShapes) return false;
        previous=m.id;
        if(!range(m.wtPosition,0,1) || !range(m.waveform,0,3) ||
           std::abs(m.waveform-m.wtPosition*3.0f)>1e-6f ||
           !range(m.octave,-4,4) || m.octave!=std::round(m.octave) ||
           !range(m.semitone,-12,12) || m.semitone!=std::round(m.semitone) ||
           !range(m.fineCents,-100,100) || m.unison<1 || m.unison>16 ||
           !range(m.detuneCents,0,100) || !range(m.blend,0,1) ||
           !range(m.pan,-1,1) || !range(m.level,0,1) ||
           !dsp::validOscProcessType(m.process1) ||
           !range(m.process1Amount,dsp::oscProcessAmountMinimum(m.process1),1) ||
           !dsp::validOscProcessType(m.process2) ||
           !range(m.process2Amount,dsp::oscProcessAmountMinimum(m.process2),1) ||
           !validOscRouteType(m.route1Type) || !range(m.route1Amount,-1,1) ||
           !validOscRouteType(m.route2Type) || !range(m.route2Amount,-1,1)) return false;

        const auto validRoute=[&](OscillatorModuleId source,OscRouteType type) {
            if(type==OscRouteType::Off) return source==0;
            if(source==0 || source==m.id) return false;
            for(const auto& candidate:s.oscillators)
                if(candidate.id==source) return true;
            return false;
        };
        if(!validRoute(m.route1SourceId,m.route1Type) ||
           !validRoute(m.route2SourceId,m.route2Type)) return false;
    }
    auto first=s.oscillators[0];applyLegacyOscillatorParameters(first,s.parameters);
    const auto& m=s.oscillators[0];
    return first.waveform==m.waveform && first.wtPosition==m.wtPosition &&
        first.octave==m.octave && first.semitone==m.semitone && first.fineCents==m.fineCents &&
        first.unison==m.unison && first.detuneCents==m.detuneCents && first.pan==m.pan && first.level==m.level;
}
}
