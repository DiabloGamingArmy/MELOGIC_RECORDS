#pragma once
#include "OrigamiStyle.h"
#include "ModulationBindings.h"
namespace mct::origami::ui {
class ModulationPanel final : public Panel {
public:
    using ParameterSetter=std::function<bool(ParameterId,float)>;
    using ParameterGetter=std::function<float(ParameterId)>;
    ModulationPanel(ParameterSetter={},ParameterGetter={},ModulationBindings={});
    void resized() override;
    void syncFromModel();
private:
    void paintContent(juce::Graphics&,juce::Rectangle<int>) override;
    std::array<juce::TextButton,9> tabs_;
    ParameterSetter setter_;ParameterGetter getter_;ModulationBindings bindings_;
    std::array<juce::Slider,4> envSliders_;
    std::array<juce::Label,4> envLabels_;
    juce::Slider rate_;
    juce::Label rateLabel_;
    juce::ComboBox shape_,mode_;
    LfoSettings lfo_{};
};
class MacroPanel final : public Panel {
public:
    explicit MacroPanel(ModulationBindings={});
    void resized() override;
    void syncFromModel();
private:
    void paintContent(juce::Graphics&,juce::Rectangle<int>) override {}
    ModulationBindings bindings_;
    std::array<juce::Slider,4> sliders_;
    std::array<juce::Label,4> labels_;
};
}
