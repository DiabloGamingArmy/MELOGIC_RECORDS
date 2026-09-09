#pragma once
#include "OrigamiStyle.h"
namespace mct::origami::ui {
class PerformanceKeyboard final : public juce::Component, public juce::SettableTooltipClient {
public:
    PerformanceKeyboard() {setName("Performance keyboard preview");setTooltip("Keyboard and wheels are layout placeholders. Play MIDI through the host to hear Origami.");}
    void paint(juce::Graphics&) override;
};
}
