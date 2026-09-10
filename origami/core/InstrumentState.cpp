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
    if(s.oscillators[0].id!=1) return false;
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
           !range(m.detuneCents,0,100) || !range(m.pan,-1,1) || !range(m.level,0,1)) return false;
    }
    auto first=s.oscillators[0];applyLegacyOscillatorParameters(first,s.parameters);
    const auto& m=s.oscillators[0];
    return first.waveform==m.waveform && first.wtPosition==m.wtPosition &&
        first.octave==m.octave && first.semitone==m.semitone && first.fineCents==m.fineCents &&
        first.unison==m.unison && first.detuneCents==m.detuneCents && first.pan==m.pan && first.level==m.level;
}
}
