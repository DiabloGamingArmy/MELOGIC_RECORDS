// mct-origami-v30.1.0-env-sync-native-menus-retrigger
// mct-origami-v30.0.0-dynamic-source-layout-scaffold
// mct-origami-v28.1.0-env-hold-live-tracer
// mct-origami-v28.0.0-compile-repair
// mct-origami-v28.0.0-interactive-envelope-editor
#pragma once
#include "OrigamiStyle.h"
#include "ModulationBindings.h"
#include <deque>

namespace mct::origami::ui {

class ModulationPanel final : public Panel,
                              private juce::ScrollBar::Listener,
                              private juce::Timer {
public:
    using ParameterSetter=std::function<bool(ParameterId,float)>;
    using ParameterGetter=std::function<float(ParameterId)>;
    ModulationPanel(ParameterSetter={},ParameterGetter={},ModulationBindings={});
    ~ModulationPanel() override;

    void resized() override;
    void syncFromModel();

    void mouseDown(const juce::MouseEvent&) override;
    void mouseDrag(const juce::MouseEvent&) override;
    void mouseUp(const juce::MouseEvent&) override;
    void mouseWheelMove(const juce::MouseEvent&,const juce::MouseWheelDetails&) override;

private:
    enum class GridMode { Tempo, Seconds, Daw };
    enum class DragTarget {
        None, Attack, Decay, Sustain, SustainHold, Release,
        AttackCurve, DecayCurve, ReleaseCurve
    };

    void paintContent(juce::Graphics&,juce::Rectangle<int>) override;
    void scrollBarMoved(juce::ScrollBar*,double) override;
    void timerCallback() override;

    void commitEnvelope();
    void commitGenerator();
    void updateVisibleControls();

    dsp::EnvelopeSettings currentEnvelope() const;
    std::array<float,3> currentCurves() const;
    void setCurrentCurves(const std::array<float,3>&);

    double gridStepSeconds() const noexcept;
    double visualHoldSeconds() const noexcept;
    double totalEnvelopeSeconds(const dsp::EnvelopeSettings&) const noexcept;
    float timeToX(double) const noexcept;
    double xToTime(float) const noexcept;
    double snapped(double) const noexcept;
    float curveShape(float,float) const noexcept;

    std::array<juce::Point<float>,4> envelopeNodes(const dsp::EnvelopeSettings&) const;
    std::array<juce::Point<float>,3> curveNodes(const dsp::EnvelopeSettings&,
                                                const std::array<float,3>&) const;
    juce::Path envelopePath(const dsp::EnvelopeSettings&,const std::array<float,3>&) const;

    DragTarget hitHandle(juce::Point<float>) const noexcept;
    juce::Point<float> tracerPoint(const EnvelopeRuntimeInfo&,const dsp::EnvelopeSettings&) const noexcept;
    void updateScrollbar();
    void zoomBy(float,juce::Point<float> anchor = {});

    std::array<juce::TextButton,9> tabs_;
    juce::TextButton sourceAdd_{"+"},sourceRemove_{"-"};
    juce::Rectangle<int> sourceRail_{};
    ParameterSetter setter_;
    ParameterGetter getter_;
    ModulationBindings bindings_;

    std::array<juce::Slider,4> envSliders_;
    std::array<juce::Label,4> envLabels_;

    juce::ToggleButton snap_{"SNAP"};
    NativeComboBox gridMode_,division_;
    juce::Slider tempo_;
    juce::TextButton zoomOut_{"-"},zoomIn_{"+"};
    juce::ScrollBar envScroll_{false};

    juce::Slider rate_,curve_;
    juce::Label rateLabel_,curveLabel_;
    NativeComboBox shape_,mode_;

    int selected_=0;
    ModulationState cached_{};

    GridMode gridModeValue_=GridMode::Tempo;
    float pixelsPerSecond_=190.0f;
    double scrollSeconds_=0.0;
    std::array<double,3> visualHoldSeconds_{{0.50,0.50,0.50}};
    juce::Rectangle<float> envCanvas_{};
    struct TraceSample {juce::Point<float> point{}; float age=0.0f;};
    EnvelopeTraceSnapshot trace_{};
    std::deque<TraceSample> traceTail_;
    std::uint64_t lastTraceOrder_=0;

    DragTarget dragTarget_=DragTarget::None;
    juce::Point<float> dragStart_{};
    dsp::EnvelopeSettings dragEnvelope_{};
    std::array<float,3> dragCurves_{};
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
