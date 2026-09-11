// mct-origami-v31.2.0-mod-visuals-wavetable-spectral
#pragma once
#include "core/modulation/Modulation.h"
#include <array>
#include <cmath>

namespace mct::origami::ui {

struct ModulationUiTelemetry {
    ModulationState state{};
    ModSource selectedSource=ModSource::Env1;
    std::array<float,9> sourceValues{};
    bool synthActive=false;
};

inline ModulationUiTelemetry& modulationUiTelemetry() noexcept {
    static ModulationUiTelemetry telemetry;
    return telemetry;
}

inline int modulationUiSourceIndex(ModSource source) noexcept {
    switch(source) {
        case ModSource::Env1:return 0; case ModSource::Env2:return 1; case ModSource::Env3:return 2;
        case ModSource::Lfo1:return 3; case ModSource::Lfo2:return 4; case ModSource::Lfo3:return 5; case ModSource::Lfo4:return 6;
        case ModSource::Function:return 7; case ModSource::Random:return 8;
        default:return -1;
    }
}

inline float modulationUiSourceValue(ModSource source) noexcept {
    auto& telemetry=modulationUiTelemetry();
    if(!telemetry.synthActive) return 0.0f;

    const int index=modulationUiSourceIndex(source);
    if(index>=0) return telemetry.sourceValues[static_cast<std::size_t>(index)];

    switch(source) {
        case ModSource::Macro1:return telemetry.state.macros[0];
        case ModSource::Macro2:return telemetry.state.macros[1];
        case ModSource::Macro3:return telemetry.state.macros[2];
        case ModSource::Macro4:return telemetry.state.macros[3];
        default:return 0.0f;
    }
}

inline bool modulationUiSourceIsBipolar(ModSource source) noexcept {
    switch(source) {
        case ModSource::Lfo1:case ModSource::Lfo2:case ModSource::Lfo3:case ModSource::Lfo4:
        case ModSource::Function:case ModSource::Random:case ModSource::PitchBend:
            return true;
        default:return false;
    }
}

inline float modulationUiSelectedRouteAmount(ModDestination destination,
                                             OscillatorModuleId oscillator=0) noexcept {
    const auto& telemetry=modulationUiTelemetry();
    float total=0.0f;
    for(const auto& route:telemetry.state.routes) {
        if(route.id==0 || !route.enabled || route.source!=telemetry.selectedSource) continue;
        if(route.destination.parameter!=destination || route.destination.oscillator!=oscillator) continue;
        total+=route.amount;
    }
    return juce::jlimit(-1.0f,1.0f,total);
}

inline float modulationUiAllRoutesValue(ModDestination destination,
                                        OscillatorModuleId oscillator=0) noexcept {
    const auto& telemetry=modulationUiTelemetry();
    if(!telemetry.synthActive) return 0.0f;
    float total=0.0f;
    for(const auto& route:telemetry.state.routes) {
        if(route.id==0 || !route.enabled) continue;
        if(route.destination.parameter!=destination || route.destination.oscillator!=oscillator) continue;
        total+=route.amount*modulationUiSourceValue(route.source);
    }
    return juce::jlimit(-1.0f,1.0f,total);
}

} // namespace mct::origami::ui
