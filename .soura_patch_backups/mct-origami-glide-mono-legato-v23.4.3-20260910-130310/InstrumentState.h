// mct-origami-pitch-mod-real-v23.3
#pragma once
#include "ParameterRegistry.h"
#include "OscillatorModule.h"
#include "modulation/Modulation.h"
namespace mct::origami {
// Fixed-size model snapshot. Codec and host locking live outside the realtime core.
struct PerformanceState { float pitchBendRangeSemitones=2.0f; };
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
