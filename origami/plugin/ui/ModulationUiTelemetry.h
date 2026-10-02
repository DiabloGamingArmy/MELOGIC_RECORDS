// mct-origami-v32.1.1-extended-mod-sources-hotfix
// mct-origami-v31.2.1-mod-ring-retrigger-refine
// mct-origami-v31.2.0-mod-visuals-wavetable-spectral
#pragma once
#include "core/modulation/Modulation.h"
#include "core/Engine.h"
#include "VisualizationSettings.h"
#include <array>
#include <cmath>

namespace mct::origami::ui {

struct ModulationUiTelemetry {
    ModulationState state{};
    ModSource selectedSource=ModSource::Env1;
    std::array<float,12> sourceValues{};
    float velocityValue=0.0f;
    float keytrackValue=0.0f;
    bool performanceInputActive=false;
    bool synthActive=false;
    RuntimeVisualizationSnapshot runtime{};
    std::uint32_t visualizationMask=defaultVisualizationMask;
};

inline ModulationUiTelemetry& modulationUiTelemetry() noexcept {
    static ModulationUiTelemetry telemetry;
    return telemetry;
}

inline int modulationUiSourceIndex(ModSource source) noexcept {
    switch(source) {
        case ModSource::Env1:return 0;
        case ModSource::Env2:return 1;
        case ModSource::Env3:return 2;
        case ModSource::Lfo1:return 3;
        case ModSource::Lfo2:return 4;
        case ModSource::Lfo3:return 5;
        case ModSource::Lfo4:return 6;
        case ModSource::Function:return 7;
        case ModSource::Random:return 8;
        case ModSource::Chaos:return 9;
        case ModSource::Drift:return 10;
        case ModSource::Sequencer:return 11;
        case ModSource::Macro1:
        case ModSource::Macro2:
        case ModSource::Macro3:
        case ModSource::Macro4:
        case ModSource::ModWheel:
        case ModSource::Velocity:
        case ModSource::Keytrack:
        case ModSource::Aftertouch:
        case ModSource::PitchBend:
        case ModSource::NoteGate:
            return -1;
    }
    return -1;
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
        case ModSource::Velocity:return telemetry.performanceInputActive ? telemetry.velocityValue : 0.0f;
        case ModSource::Keytrack:return telemetry.performanceInputActive ? telemetry.keytrackValue : 0.0f;
        case ModSource::ModWheel:return telemetry.runtime.performanceSources[0];
        case ModSource::Aftertouch:return telemetry.runtime.performanceSources[1];
        case ModSource::PitchBend:return telemetry.runtime.performanceSources[2];
        case ModSource::NoteGate:return telemetry.runtime.performanceSources[3];

        case ModSource::Env1:
        case ModSource::Env2:
        case ModSource::Env3:
        case ModSource::Lfo1:
        case ModSource::Lfo2:
        case ModSource::Lfo3:
        case ModSource::Lfo4:
        case ModSource::Random:
        case ModSource::Function:
        case ModSource::Chaos:
        case ModSource::Drift:
        case ModSource::Sequencer:
            return 0.0f;
    }
    return 0.0f;
}

inline bool modulationUiSourceIsBipolar(ModSource source) noexcept {
    switch(source) {
        case ModSource::Lfo1:
        case ModSource::Lfo2:
        case ModSource::Lfo3:
        case ModSource::Lfo4:
        case ModSource::Function:
        case ModSource::Random:
        case ModSource::Chaos:
        case ModSource::Drift:
        case ModSource::Sequencer:
        case ModSource::PitchBend:
            return true;

        case ModSource::Env1:
        case ModSource::Env2:
        case ModSource::Env3:
        case ModSource::Macro1:
        case ModSource::Macro2:
        case ModSource::Macro3:
        case ModSource::Macro4:
        case ModSource::ModWheel:
        case ModSource::Velocity:
        case ModSource::Keytrack:
        case ModSource::Aftertouch:
        case ModSource::NoteGate:
            return false;
    }
    return false;
}

inline bool modulationUiSelectedRouteIsBipolar(ModDestination destination,
                                                OscillatorModuleId oscillator=0,
                                                std::uint32_t itemId=0) noexcept {
    const auto& telemetry=modulationUiTelemetry();
    bool found=false;
    bool bipolar=false;
    for(const auto& route:telemetry.state.routes) {
        if(route.id==0 || !route.enabled || route.source!=telemetry.selectedSource) continue;
        if(route.destination.parameter!=destination || route.destination.oscillator!=oscillator) continue;
        if(itemId!=0 && route.destination.itemId!=itemId) continue;
        if(!found) {
            bipolar=route.bipolar;
            found=true;
        } else if(route.bipolar!=bipolar) {
            return true;
        }
    }
    return found && bipolar;
}

inline float modulationUiRouteDisplaySourceValue(ModSource source,bool bipolar) noexcept {
    const float raw=modulationUiSourceValue(source);
    if(bipolar || !modulationUiSourceIsBipolar(source)) return raw;
    return juce::jlimit(0.0f,1.0f,raw*0.5f+0.5f);
}

inline float modulationUiSelectedRouteAmount(ModDestination destination,
                                             OscillatorModuleId oscillator=0,
                                             std::uint32_t itemId=0) noexcept {
    const auto& telemetry=modulationUiTelemetry();
    float total=0.0f;
    for(const auto& route:telemetry.state.routes) {
        if(route.id==0 || !route.enabled || route.source!=telemetry.selectedSource) continue;
        if(route.destination.parameter!=destination || route.destination.oscillator!=oscillator) continue;
        if(itemId!=0 && route.destination.itemId!=itemId) continue;
        total+=route.amount;
    }
    return juce::jlimit(-1.0f,1.0f,total);
}

inline bool modulationUiHasAnyRoute(ModDestination destination,
                                    OscillatorModuleId oscillator=0,
                                    std::uint32_t itemId=0) noexcept {
    const auto& telemetry=modulationUiTelemetry();
    for(const auto& route:telemetry.state.routes) {
        if(route.id==0 || !route.enabled) continue;
        if(route.destination.parameter==destination && route.destination.oscillator==oscillator &&
           (itemId==0 || route.destination.itemId==itemId))
            return true;
    }
    return false;
}


inline bool modulationUiRouteMatches(const ModRoute& route,ModDestination destination,
                                     OscillatorModuleId oscillator=0,std::uint32_t itemId=0) noexcept {
    if(route.id==0 || !route.enabled) return false;
    if(route.destination.parameter!=destination || route.destination.oscillator!=oscillator) return false;
    return itemId==0 || route.destination.itemId==itemId;
}

inline float modulationUiPersistentRouteAmount(ModDestination destination,
                                               OscillatorModuleId oscillator=0,
                                               std::uint32_t itemId=0) noexcept {
    const auto& telemetry=modulationUiTelemetry();
    float total=0.0f;
    for(const auto& route:telemetry.state.routes) {
        if(!modulationUiRouteMatches(route,destination,oscillator,itemId)) continue;
        total+=route.amount;
    }
    return juce::jlimit(-1.0f,1.0f,total);
}

inline bool modulationUiPersistentRoutesAreBipolar(ModDestination destination,
                                                   OscillatorModuleId oscillator=0,
                                                   std::uint32_t itemId=0) noexcept {
    const auto& telemetry=modulationUiTelemetry();
    bool found=false,bipolar=false;
    for(const auto& route:telemetry.state.routes) {
        if(!modulationUiRouteMatches(route,destination,oscillator,itemId)) continue;
        if(!found){bipolar=route.bipolar;found=true;}
        else if(route.bipolar!=bipolar)return true;
    }
    return found && bipolar;
}

inline float modulationUiEffectiveNormalizedOffset(ModDestination destination,
                                                   OscillatorModuleId oscillator=0,
                                                   std::uint32_t itemId=0) noexcept {
    const auto& telemetry=modulationUiTelemetry();
    if(!telemetry.synthActive) return 0.0f;
    float total=0.0f;
    for(const auto& route:telemetry.state.routes) {
        if(!modulationUiRouteMatches(route,destination,oscillator,itemId)) continue;
        float source=modulationUiSourceValue(route.source);
        if(modulationUiSourceIsBipolar(route.source)) {
            source=route.bipolar ? source*0.5f
                                 : juce::jlimit(0.0f,1.0f,source*0.5f+0.5f);
        }
        total+=route.amount*source;
    }
    return juce::jlimit(-4.0f,4.0f,total);
}

// Painting reads the base slider; effective values never flow back to setValue.
inline float modulationUiEffectiveSliderPosition(juce::Slider& slider,
                                                  ModDestination destination,
                                                  OscillatorModuleId oscillator=0,
                                                  std::uint32_t itemId=0) noexcept {
    const double minimum=slider.getMinimum(),maximum=slider.getMaximum();
    if(maximum<=minimum) return 0.0f;
    const double value=slider.getValue();
    const bool logarithmic=destination==ModDestination::Cutoff && minimum>0.0;
    const double base=logarithmic ? std::log(value/minimum)/std::log(maximum/minimum)
                                 : (value-minimum)/(maximum-minimum);
    const double effective=juce::jlimit(0.0,1.0,base+
        modulationUiEffectiveNormalizedOffset(destination,oscillator,itemId));
    const double physical=logarithmic ? minimum*std::pow(maximum/minimum,effective)
                                     : minimum+effective*(maximum-minimum);
    return static_cast<float>(slider.valueToProportionOfLength(physical));
}

inline float modulationUiAllRoutesValue(ModDestination destination,
                                        OscillatorModuleId oscillator=0,
                                        std::uint32_t itemId=0) noexcept {
    const auto& telemetry=modulationUiTelemetry();
    if(!telemetry.synthActive) return 0.0f;
    float total=0.0f;
    for(const auto& route:telemetry.state.routes) {
        if(route.id==0 || !route.enabled) continue;
        if(route.destination.parameter!=destination || route.destination.oscillator!=oscillator) continue;
        if(itemId!=0 && route.destination.itemId!=itemId) continue;
        total+=route.amount*modulationUiSourceValue(route.source);
    }
    return juce::jlimit(-1.0f,1.0f,total);
}

} // namespace mct::origami::ui
