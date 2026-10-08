// mct-origami-v32.1.1-extended-mod-sources-hotfix
// mct-origami-v31.2.1-mod-ring-retrigger-refine
// mct-origami-v31.2.0-mod-visuals-wavetable-spectral
#pragma once
#include "core/modulation/Modulation.h"
#include "core/Engine.h"
#include "VisualizationSettings.h"
#include "OrigamiStyle.h"
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
    if(isMacroSource(source)) return -1; // macros read the canonical value (any stable id)
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
        case ModSource::None:
            return -1;
    }
    return -1;
}

inline float modulationUiSourceValue(ModSource source) noexcept {
    auto& telemetry=modulationUiTelemetry();
    if(!telemetry.synthActive) return 0.0f;
    if(isInstanceSource(source)) {
        const auto i=sourceInstanceSlot(telemetry.state,source);
        if(i>=maxSourceInstances || telemetry.runtime.instanceIds[i]!=instanceIdOf(source)) return 0;
        return telemetry.runtime.routeSources[modulationSourceSlot(source,telemetry.state)];
    }
    // N04: an operator output, as published in the engine's slot snapshot.
    if(isOperatorSource(source)) {
        const auto slot=controlOperatorSlot(telemetry.state,operatorIdOf(source));
        return slot<ModulationState::maxControlOperators
            ? telemetry.runtime.routeSources[CompiledModulation::sourceSlotCount+operatorOutputIndex(slot,operatorPortOf(source))] : 0.0f;
    }

    const int index=modulationUiSourceIndex(source);
    if(index>=0) return telemetry.sourceValues[static_cast<std::size_t>(index)];
    if(const auto id=macroIdOf(source)) return telemetry.state.macros[id-1];

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
        case ModSource::None:
            return 0.0f;
    }
    return 0.0f;
}

inline bool modulationUiSourceIsBipolar(ModSource source) noexcept {
    if(isInstanceSource(source)) return sourceRange(source,modulationUiTelemetry().state)==ControlRange::Bipolar;
    if(isOperatorSource(source)) return sourceRange(source,modulationUiTelemetry().state)==ControlRange::Bipolar;
    if(isMacroSource(source)) return false;
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

        case ModSource::None:
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
    const bool logarithmic=(destination==ModDestination::Cutoff || destination==ModDestination::SynthCutoff) && minimum>0.0;
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

// mct-origami-nested-modulation-manual-qa: the knob modulation overlay of the
// SYNTH page (range arc around the knob + the effective-position dot), for
// any knob: positions are proportions of the knob's travel (0..1).
inline void paintKnobModulationOverlay(juce::Graphics& g,juce::Rectangle<float> knob,float lo,float hi,
                                       bool hasDepth,bool anyRoute,bool showEffective,float effective,bool selected) {
    // Modulation owns a distinct outer radial track. FxFeedbackSlider reserves
    // that lane by drawing its authored knob at 82% scale. Keep the modulation
    // centreline inside the component clip (including the 5 px effective dot)
    // while still outside the authored white arc.
    auto circle=knob.reduced(1.0f);
    const float d=juce::jmin(circle.getWidth(),circle.getHeight());
    circle=juce::Rectangle<float>(d,d).withCentre(circle.getCentre());
    constexpr float modulationRadiusScale=0.46f;
    const float start=juce::MathConstants<float>::pi*1.20f;
    const float end=juce::MathConstants<float>::pi*2.80f;
    const auto angle=[&](float n){ return start+juce::jlimit(0.0f,1.0f,n)*(end-start); };
    if(hasDepth) {
        juce::Path range;
        range.addCentredArc(circle.getCentreX(),circle.getCentreY(),circle.getWidth()*modulationRadiusScale,circle.getHeight()*modulationRadiusScale,0.0f,angle(lo),angle(hi),true);
        auto colour=signalSourceColour();
        float thickness=2.2f;
        if(!selected) { colour=colour.withSaturation(colour.getSaturation()*0.5f).withBrightness(colour.getBrightness()*0.5f); thickness=1.35f; }
        g.setColour(colour.withAlpha(.96f));
        g.strokePath(range,juce::PathStrokeType(thickness));
    } else if(anyRoute) {
        juce::Path automated;
        automated.addCentredArc(circle.getCentreX(),circle.getCentreY(),circle.getWidth()*modulationRadiusScale,circle.getHeight()*modulationRadiusScale,0.0f,start,end,true);
        g.setColour(signalSourceColour().darker(.72f).withAlpha(.88f));
        g.strokePath(automated,juce::PathStrokeType(1.7f));
    }
    if(anyRoute && showEffective) {
        const float a=angle(effective);
        const auto c=circle.getCentre();
        g.setColour(signalSourceColour());
        g.fillEllipse(juce::Rectangle<float>(5.0f,5.0f).withCentre({c.x+std::sin(a)*circle.getWidth()*modulationRadiusScale,c.y-std::cos(a)*circle.getHeight()*modulationRadiusScale}));
    }
}
// The route range (lo, hi) of a destination around a base position (all in
// the destination's normalized space), from the selected source's routes or
// else all routes, as the SYNTH knobs show it.
struct KnobModulationRange { float lo=0.0f,hi=0.0f; bool hasDepth=false,anyRoute=false,selected=false; };
// FX ranges sum each route's possible interval, never signed depths (which
// would hide two opposing sources). One aggregate arc, with selected-source
// emphasis; exact routes remain in Matrix. Polarity uses the canonical helper.
inline KnobModulationRange fxKnobModulationRange(float base,const ModAddress& address,
                                                const ModulationState& state,ModSource selected) noexcept {
    KnobModulationRange result;
    float lo=0.0f,hi=0.0f;
    ModulationSourceSlots extremes{};
    for(const auto& route:state.routes) {
        if(!route.id || !route.enabled || !routeComplete(route) || !(route.destination==address)) continue;
        result.anyRoute=true;
        result.selected|=route.source==selected;
        const auto slot=modulationSourceSlot(route.source,state);
        if(slot>=extremes.size()) continue;
        auto unit=route;
        bool nested=false;
        for(const auto& depth:state.routes)
            if(depth.id && depth.enabled && depth.destination==routeDepthAddress(route.id)) { nested=true; break; }
        // A modulated depth can span -1..1. Show its possible envelope rather
        // than promising the authored depth is its live limit.
        if(nested) unit.amount=1.0f;
        extremes[slot]=sourceRange(route.source,state)==ControlRange::Bipolar ? -1.0f : 0.0f;
        const float a=routeContribution(unit,state,extremes);
        extremes[slot]=1.0f;
        const float b=routeContribution(unit,state,extremes);
        if(nested) { const float extent=std::max(std::abs(a),std::abs(b)); lo-=extent; hi+=extent; }
        else { lo+=std::min(a,b); hi+=std::max(a,b); }
        extremes[slot]=0.0f;
    }
    result.lo=juce::jlimit(0.0f,1.0f,base+lo);
    result.hi=juce::jlimit(0.0f,1.0f,base+hi);
    result.hasDepth=result.hi-result.lo>=1.0e-4f;
    return result;
}

inline KnobModulationRange knobModulationRange(float base,ModDestination destination,OscillatorModuleId oscillator=0,std::uint32_t itemId=0) noexcept {
    KnobModulationRange r;
    const float selectedDepth=modulationUiSelectedRouteAmount(destination,oscillator,itemId);
    r.selected=std::abs(selectedDepth)>=1.0e-4f;
    const float depth=r.selected ? selectedDepth : modulationUiPersistentRouteAmount(destination,oscillator,itemId);
    r.anyRoute=modulationUiHasAnyRoute(destination,oscillator,itemId);
    r.hasDepth=std::abs(depth)>=1.0e-4f;
    const bool bipolar=r.selected ? modulationUiSelectedRouteIsBipolar(destination,oscillator,itemId)
                                  : modulationUiPersistentRoutesAreBipolar(destination,oscillator,itemId);
    const float extent=std::abs(depth);
    r.lo=juce::jlimit(0.0f,1.0f,bipolar ? base-extent : juce::jmin(base,base+depth));
    r.hi=juce::jlimit(0.0f,1.0f,bipolar ? base+extent : juce::jmax(base,base+depth));
    return r;
}

} // namespace mct::origami::ui
