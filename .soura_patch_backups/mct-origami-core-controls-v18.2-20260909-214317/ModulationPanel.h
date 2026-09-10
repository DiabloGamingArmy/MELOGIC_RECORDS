#pragma once
#include "OrigamiStyle.h"
namespace mct::origami::ui {
class ModulationPanel final : public Panel {
public:
    ModulationPanel();
    void resized() override;
private:
    void paintContent(juce::Graphics&,juce::Rectangle<int>) override;
    std::array<juce::TextButton,9> tabs_;
    int selected_=0;
};
class MacroPanel final : public Panel {
public: MacroPanel():Panel("MACROS") {}
private: void paintContent(juce::Graphics&,juce::Rectangle<int>) override;
};
}
