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
    struct EditorMetrics {
        static constexpr int inset=4,gap=8,bottom=12,selectorHeight=24,typeWidth=104,outWidth=100,powerWidth=42,typeLabelWidth=32,outLabelWidth=28,minCellWidth=70;
        static constexpr int parameterHeight=80,axisHeight=16,levelWidth=36,plotInset=6,stackHeight=72,labelHeight=16,stackGap=2,valueWidth=64,valueHeight=16,parameterBottom=4;
        static constexpr float bankFraction=.90f,fillExposure=.32f,fillAlpha=.16f;
    };
    struct EditorRegions {juce::Rectangle<int> header,routing,response,parameters,plot,frequencyAxis,levelAxis,parameterBank,typeLabel,outputLabel;};
    EditorRegions editorRegions() const noexcept;
    juce::Rectangle<int> responseBounds() const noexcept {return editorRegions().response;}
    std::vector<juce::String> typeChoices() const;
    bool setFilterType(dsp::FilterType);
    bool editResponseHandle(juce::Point<float>);
    juce::Point<float> responseHandle() const;
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
    void mouseUp(const juce::MouseEvent&) override;
    void mouseMove(const juce::MouseEvent&) override;
    void mouseExit(const juce::MouseEvent&) override;
    void editValues();
    bool editResponseParameters(juce::Point<float>,float verticalValue);
    dsp::FilterHandleVertical handleVertical() const;
    SynthFilterValues responseValues(const RuntimeVisualizationSnapshot&) const;
    void showOutputMenu();
    bool commit(ModulationState);
    ParameterSetter setter_;ParameterGetter getter_;ModulationBindings bindings_;
    InstrumentState state_{};
    SynthFilterId selectedId_=0,revealedId_=0;
    juce::Point<int> revealedViewportSize_{};
    bool legacy_=false,dragStarted_=false,dropOver_=false,syncing_=false,handleDragging_=false,handleHovered_=false;
    juce::Point<float> handleDragStart_{};float handleDragValue_=0;
    std::array<SourceEntityButton,maxSynthFilters+1> tabs_{};
    std::array<SynthFilterId,maxSynthFilters+1> tabIds_{};
    std::size_t tabCount_=0;
    std::array<juce::Slider,6> knobs_{};
    std::array<juce::Label,6> labels_{};
    juce::TextButton add_{"+"},remove_{"-"},output_{"MAIN"},type_{};
    juce::ToggleButton power_{"ON"};
    juce::Viewport viewport_;juce::Component railContent_;
    mutable dsp::LowPassCoefficientTable responseTable_;
    mutable double responseRate_=0;
};
class FxPanel final : public Panel {
public: explicit FxPanel(bool pre):Panel(pre?"FX PRE":"FX POST"),pre_(pre) {}
private: void paintContent(juce::Graphics&,juce::Rectangle<int>) override;bool pre_;
};
}
