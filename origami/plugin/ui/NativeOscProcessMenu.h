// mct-origami-v29.0.0-spectral-process-native-routing
// mct-origami-v26.2.0-native-process-library
#pragma once
#include <JuceHeader.h>
#include "core/dsp/Wavetable.h"
#include "core/OscillatorModule.h"
#include "core/InstrumentState.h"
#include <functional>
namespace mct::origami::ui {
void showNativeOscProcessMenu(
    juce::Component& anchor,
    mct::origami::dsp::OscProcessType current,
    std::function<void(mct::origami::dsp::OscProcessType)> onSelected);
void showNativeOscRouteMenu(
    juce::Component& anchor,
    mct::origami::OscillatorModuleId target,
    mct::origami::OscillatorModuleId currentSource,
    mct::origami::OscRouteType currentType,
    const mct::origami::InstrumentState& state,
    std::function<void(mct::origami::OscillatorModuleId,mct::origami::OscRouteType)> onSelected);
}
