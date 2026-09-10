#pragma once
#include "OrigamiStyle.h"
namespace mct::origami::ui {
class OrigamiHeader final : public juce::Component {
public:
    OrigamiHeader();
    void paint(juce::Graphics&) override;
    void resized() override;
private:
    juce::TextButton previous_{"<"},next_{">"},preset_{"Init"},browse_{"BROWSE"},save_{"SAVE"},settings_{"..."};
    std::array<juce::TextButton,5> modes_;
    juce::Image logo_;
    juce::Image wordmark_;
};
}
