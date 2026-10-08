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
    // mct-origami-nested-modulation-manual-qa: signed pitch-wheel ENDPOINTS
    // (semitones at full up / full down; centre is 0). Any sign is allowed:
    // UP +12 / DOWN +5 raise both ways, UP -12 / DOWN +12 reverse the wheel.
    // States before v34 stored DOWN as a magnitude ("down by N"): decoded as -N.
    float pitchBendRangeSemitones=2.0f;  // BEND UP endpoint (legacy name kept)
    float pitchBendDownSemitones=-2.0f;  // BEND DOWN endpoint
    static constexpr float maxBendSemitones=48.0f;
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
// Authored NEW/INIT content. Low-level defaults remain migration/fixture defaults.
InstrumentState canonicalInitState() noexcept;

// Removes a bus and every oscillator send to it in one step, so no oscillator
// is left with a dangling destination. BUS 1 is protected. An oscillator whose
// only route pointed at the removed bus falls back to BUS 1 at unity.
bool removeBus(InstrumentState&,BusId) noexcept;
void applyLegacyOscillatorParameters(OscillatorModuleState&,const ParameterValues&) noexcept;
bool validInstrumentState(const InstrumentState&) noexcept;
}
