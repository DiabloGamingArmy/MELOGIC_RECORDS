// mct-origami-glide-mono-legato-v23.4.3
// mct-origami-pitch-mod-real-v23.3
#pragma once
#include "ParameterRegistry.h"
#include "OscillatorModule.h"
#include "modulation/Modulation.h"
#include "BusModel.h"
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
    // mct-origami-fx-graph-dsp-bus-routing-p02: canonical named buses.
    BusState buses{};
};
// Removes a bus and every oscillator send to it in one step, so no oscillator
// is left with a dangling destination. BUS 1 is protected. An oscillator whose
// only route pointed at the removed bus falls back to BUS 1 at unity.
bool removeBus(InstrumentState&,BusId) noexcept;
void applyLegacyOscillatorParameters(OscillatorModuleState&,const ParameterValues&) noexcept;
bool validInstrumentState(const InstrumentState&) noexcept;
}
