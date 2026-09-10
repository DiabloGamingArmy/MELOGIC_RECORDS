#pragma once
#include "OrigamiStyle.h"
#include "core/ParameterRegistry.h"
namespace mct::origami::ui {
class MixerPanel final : public Panel {
public: MixerPanel():Panel("MIXER") {}
private: void paintContent(juce::Graphics&,juce::Rectangle<int>) override;
};
class FilterPanel final : public Panel {
public:
    using ParameterSetter=std::function<bool(mct::origami::ParameterId,float)>;
    using ParameterGetter=std::function<float(mct::origami::ParameterId)>;
    // mct-origami-core-controls-v18.2
    FilterPanel(ParameterSetter setter={},ParameterGetter getter={});
    void resized() override;
    void syncFromModel();
private:
    void paintContent(juce::Graphics&,juce::Rectangle<int>) override;
    ParameterSetter setter_;
    ParameterGetter getter_;
    juce::Slider cutoff_,resonance_;
    juce::Label cutoffLabel_,resonanceLabel_;
};
class FxPanel final : public Panel {
public: explicit FxPanel(bool pre):Panel(pre?"FX PRE":"FX POST"),pre_(pre) {}
private: void paintContent(juce::Graphics&,juce::Rectangle<int>) override;bool pre_;
};
}
