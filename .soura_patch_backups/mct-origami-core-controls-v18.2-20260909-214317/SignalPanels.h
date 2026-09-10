#pragma once
#include "OrigamiStyle.h"
namespace mct::origami::ui {
class MixerPanel final : public Panel {
public: MixerPanel():Panel("MIXER") {}
private: void paintContent(juce::Graphics&,juce::Rectangle<int>) override;
};
class FilterPanel final : public Panel {
public: FilterPanel():Panel("FILTER") {}
private: void paintContent(juce::Graphics&,juce::Rectangle<int>) override;
};
class FxPanel final : public Panel {
public: explicit FxPanel(bool pre):Panel(pre?"FX PRE":"FX POST"),pre_(pre) {}
private: void paintContent(juce::Graphics&,juce::Rectangle<int>) override;bool pre_;
};
}
