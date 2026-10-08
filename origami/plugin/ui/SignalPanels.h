// mct-origami-v32.2.1-scroll-drag-matrix-hotfix
// mct-origami-v32.0.0-dynamic-mod-filter-collections
// mct-origami-v31.2.0-mod-visuals-wavetable-spectral
// mct-origami-v30.0.0-dynamic-source-layout-scaffold
#pragma once
#include "OrigamiStyle.h"
#include "SourceEntity.h"
#include "ModulationBindings.h"
#include "core/ParameterRegistry.h"
namespace mct::origami::ui {
class MixerPanel final : public Panel {
public: MixerPanel():Panel("MIXER") {}
private: void paintContent(juce::Graphics&,juce::Rectangle<int>) override;
};
class FilterPanel final : public Panel,public juce::DragAndDropTarget {
public:
    using ParameterSetter=std::function<bool(ParameterId,float)>;
    using ParameterGetter=std::function<float(ParameterId)>;
    FilterPanel(ParameterSetter setter={},ParameterGetter getter={},ModulationBindings bindings={});
    void resized() override;
    void syncFromModel();
    SynthFilterId addFilter();
    bool removeFilter(SynthFilterId);
    bool dropFilterOnOscillator(SynthFilterId,OscillatorModuleId);
    bool dropFilterAfter(SynthFilterId,SynthFilterId);
    juce::Rectangle<int> sourceRailBounds() const noexcept {return sourceRailLayout(contentBounds()).rail;}
    struct EditorRegions {juce::Rectangle<int> header,routing,response,parameters;};
    EditorRegions editorRegions() const noexcept;
    juce::Rectangle<int> responseBounds() const noexcept {return editorRegions().response;}
    std::vector<juce::String> typeChoices() const {return {"LOW-PASS"};}
    SynthFilterId selectedFilter() const noexcept {return selectedId_;}
    bool isInterestedInDragSource(const SourceDetails&) override;
    void itemDragEnter(const SourceDetails&) override;
    void itemDragExit(const SourceDetails&) override;
    void itemDropped(const SourceDetails&) override;
private:
    void paintContent(juce::Graphics&,juce::Rectangle<int>) override;
    void paintOverChildren(juce::Graphics&) override;
    void mouseDown(const juce::MouseEvent&) override;
    void mouseDrag(const juce::MouseEvent&) override;
    void editValues();
    void showOutputMenu();
    bool commit(ModulationState);
    ParameterSetter setter_;ParameterGetter getter_;ModulationBindings bindings_;
    InstrumentState state_{};
    SynthFilterId selectedId_=0,revealedId_=0;
    juce::Point<int> revealedViewportSize_{};
    bool legacy_=false,dragStarted_=false,dropOver_=false,syncing_=false;
    std::array<SourceEntityButton,maxSynthFilters+1> tabs_{};
    std::array<SynthFilterId,maxSynthFilters+1> tabIds_{};
    std::size_t tabCount_=0;
    std::array<juce::Slider,5> knobs_{};
    std::array<juce::Label,5> labels_{};
    juce::TextButton add_{"+"},remove_{"-"},output_{"MAIN"},power_{"ON"},type_{"LOW-PASS"};
    juce::Viewport viewport_;juce::Component railContent_;
    dsp::LowPassCoefficientTable responseTable_;
    double responseRate_=0;
};
class FxPanel final : public Panel {
public: explicit FxPanel(bool pre):Panel(pre?"FX PRE":"FX POST"),pre_(pre) {}
private: void paintContent(juce::Graphics&,juce::Rectangle<int>) override;bool pre_;
};
}
