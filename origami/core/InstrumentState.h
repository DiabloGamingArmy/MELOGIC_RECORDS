// mct-origami-glide-mono-legato-v23.4.3
// mct-origami-pitch-mod-real-v23.3
#pragma once
#include "ParameterRegistry.h"
#include "OscillatorModule.h"
#include "modulation/Modulation.h"
namespace mct::origami {
// Fixed-size model snapshot. Codec and host locking live outside the realtime core.
enum class VoiceMode : std::uint32_t { Poly=0, Mono=1 };
enum class NotePriority : std::uint32_t { Last=0, High=1, Low=2 };
struct PerformanceState {
    float pitchBendRangeSemitones=2.0f; // legacy/up range; retained for preset compatibility
    float pitchBendDownSemitones=2.0f;
    VoiceMode voiceMode=VoiceMode::Poly;
    NotePriority notePriority=NotePriority::Last;
    bool legato=true;
    float glideSeconds=0.0f;
};
struct InstrumentState {
    ParameterValues parameters=defaultParameters();
    std::array<OscillatorModuleState,OscillatorModuleBank::capacity> oscillators{};
    OscillatorModuleId nextId=2;
    ModulationState modulation{};
    PerformanceState performance{};
};
void applyLegacyOscillatorParameters(OscillatorModuleState&,const ParameterValues&) noexcept;
bool validInstrumentState(const InstrumentState&) noexcept;
}
