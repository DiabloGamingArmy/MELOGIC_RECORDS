// mct-origami-v26.2.0-native-process-library
#pragma once
#include <JuceHeader.h>
#include "core/dsp/Wavetable.h"
#include <functional>
namespace mct::origami::ui {
void showNativeOscProcessMenu(
    juce::Component& anchor,
    mct::origami::dsp::OscProcessType current,
    std::function<void(mct::origami::dsp::OscProcessType)> onSelected);
}
