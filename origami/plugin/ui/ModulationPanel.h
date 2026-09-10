#pragma once
#include "OrigamiStyle.h"
#include "core/ParameterRegistry.h"
namespace mct::origami::ui {
class ModulationPanel final : public Panel {
public:
    using ParameterSetter=std::function<bool(mct::origami::ParameterId,float)>;
    using ParameterGetter=std::function<float(mct::origami::ParameterId)>;
    // mct-origami-core-controls-v18.2
    ModulationPanel(ParameterSetter setter={},ParameterGetter getter={});
    void resized() override;
private:
    void paintContent(juce::Graphics&,juce::Rectangle<int>) override;
    std::array<juce::TextButton,9> tabs_;
    int selected_=0;
    ParameterSetter setter_;
    ParameterGetter getter_;
    std::array<juce::Slider,4> envSliders_;
    std::array<juce::Label,4> envLabels_;
};
class MacroPanel final : public Panel {
public: MacroPanel():Panel("MACROS") {}
private: void paintContent(juce::Graphics&,juce::Rectangle<int>) override;
};
}
