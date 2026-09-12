// mct-origami-v32.2.1-scroll-drag-matrix-hotfix
// mct-origami-v32.1.1-extended-mod-sources-hotfix
// mct-origami-v32.0.0-dynamic-mod-filter-collections
// mct-origami-v31.2.1-mod-ring-retrigger-refine
// mct-origami-v31.1.0-mod-source-visual-matrix-controls
// mct-origami-v30.1.0-env-sync-native-menus-retrigger
// mct-origami-v30.0.0-dynamic-source-layout-scaffold
// mct-origami-v28.1.0-env-hold-live-tracer
// mct-origami-v28.0.0-compile-repair
// mct-origami-v28.0.0-interactive-envelope-editor
// mct-origami-v33.1.0-lfo-mseg-editing-tools
// mct-origami-v33.0.2-lfo-mseg-editor-foundation
// mct-origami-v34.0.0-random-lfo
// mct-origami-v34.1.0-mod-scroll-clip-mseg-audio
// mct-origami-v34.3.0-lfo-interaction-mod-properties
#pragma once
#include "OrigamiStyle.h"
#include "ModulationBindings.h"
#include <deque>
#include <optional>

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
    bool revealSourceAtParentPoint(juce::Point<int> parentPoint);

    void mouseDown(const juce::MouseEvent&) override;
    void mouseDrag(const juce::MouseEvent&) override;
    void mouseUp(const juce::MouseEvent&) override;
    void mouseDoubleClick(const juce::MouseEvent&) override;
    void mouseMove(const juce::MouseEvent&) override;
    void mouseExit(const juce::MouseEvent&) override;
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

    static ModSource sourceForTab(std::size_t) noexcept;
    bool sourceTabActive(std::size_t) const noexcept;
    void showAddSourceMenu();
    void allocateSource(int sourceType);
    void removeSelectedSource();
    std::optional<std::uint32_t> routeDotAt(juce::Point<float>) const noexcept;
    juce::Rectangle<float> routeDotBounds(std::size_t tabIndex,
                                          std::size_t dotIndex,
                                          std::size_t dotCount) const noexcept;
    void setRouteAmount(std::uint32_t routeId,float amount);
    void updateSourceHistory(float dt);
    void paintSourceHistoryBackgrounds(juce::Graphics&);
    void paintSourceRouteOverlays(juce::Graphics&);
    void paintEnvelopeTimeMarkers(juce::Graphics&) const;
    void paintOverChildren(juce::Graphics&) override;
    juce::String routeTargetLabel(std::uint32_t routeId) const;

    std::array<juce::TextButton,14> tabs_;
    juce::TextButton sourceAdd_{"+"},sourceRemove_{"-"};
    juce::Viewport sourceViewport_;
    juce::Component sourceContent_;
    juce::Rectangle<int> sourceRail_{};
    int sourceDragTab_=-1;
    juce::Point<float> sourceDragStart_{};
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
    juce::Slider randomSmooth_,randomHold_,randomDelay_;
    juce::Label randomSmoothLabel_,randomHoldLabel_,randomDelayLabel_;
    juce::Slider chaosAmount_,chaosFlow_,chaosDamping_,chaosWarp_,chaosSmooth_;
    juce::Label chaosAmountLabel_,chaosFlowLabel_,chaosDampingLabel_,chaosWarpLabel_,chaosSmoothLabel_;
    NativeComboBox chaosAxis_,chaosMethod_;
    NativeComboBox shape_,mode_;
    juce::ToggleButton lfoLoop_{"LOOP"};
    juce::TextButton lfoTools_{"TOOLS"};

    struct MsegPoint { float x=0.0f,y=0.0f,curve=0.0f; };
    struct MsegShape {
        std::array<MsegPoint,16> points{};
        std::size_t count=5;
    };
    std::array<MsegShape,4> lfoMseg_{};
    int lfoPointDrag_=-1,lfoCurveDrag_=-1;
    MsegShape lfoDragStartShape_{};

    void resetMsegShape(MsegShape&) noexcept;
    void loadMsegShapeFromSettings(MsegShape&,const LfoSettings&) noexcept;
    bool commitMsegShape();
    void showLfoToolsMenu();
    float msegValue(const MsegShape&,float) const noexcept;
    juce::Point<float> msegPixel(const MsegPoint&) const noexcept;
    int hitMsegPoint(juce::Point<float>) const noexcept;
    int hitMsegCurve(juce::Point<float>) const noexcept;
    float curveForHandleY(const MsegShape&,std::size_t,float) const noexcept;

    int selected_=0;
    ModulationState cached_{};

    GridMode gridModeValue_=GridMode::Tempo;
    float pixelsPerSecond_=190.0f;
    double scrollSeconds_=0.0;
    std::array<double,3> visualHoldSeconds_{{0.50,0.50,0.50}};
    juce::Rectangle<float> envCanvas_{};
    juce::Rectangle<float> performanceCurveCanvas_{};
    int performancePointDrag_=-1,performanceCurveDrag_=-1;
    MsegShape performanceDragStartShape_{};
    std::array<MsegShape,2> performanceMseg_{};
    juce::TextButton performanceTools_{"TOOLS"};
    juce::ToggleButton performanceSnap_{"SNAP"};
    juce::Label performanceInputLabel_;
    void loadPerformanceShape(MsegShape&,const PerformanceSourceCurve&) noexcept;
    bool commitPerformanceShape();
    void resetPerformanceShape(MsegShape&) noexcept;
    float performanceMsegValue(const MsegShape&,float) const noexcept;
    juce::Point<float> performancePixel(const MsegPoint&) const noexcept;
    int hitPerformancePoint(juce::Point<float>) const noexcept;
    int hitPerformanceCurve(juce::Point<float>) const noexcept;
    float performanceCurveForHandleY(const MsegShape&,std::size_t,float) const noexcept;
    void showPerformanceToolsMenu();
    void paintPerformanceCurve(juce::Graphics&);
    struct TraceSample {juce::Point<float> point{}; float age=0.0f;};
    EnvelopeTraceSnapshot trace_{};
    std::deque<TraceSample> traceTail_;
    std::uint64_t lastTraceOrder_=0;
    // UI-only ENV supersampling state. Audio telemetry remains rate-limited;
    // the visualizer reconstructs canonical editor-path motion between
    // consecutive runtime snapshots without feeding anything back to DSP.
    std::array<EnvelopeRuntimeInfo,3> previousVisualEnvelopeRuntime_{};
    std::array<bool,3> havePreviousVisualEnvelopeRuntime_{{false,false,false}};

    // Selected-LFO playback tracer. Maintained only while the LFO editor is
    // visible, keeping this visual feature off the audio thread.
    std::deque<TraceSample> lfoTraceTail_;
    float lfoTracePhase_=0.0f;
    float lastLfoTracePhase_=-1.0f;
    static constexpr int visualTraceSubsteps_=64;
    static constexpr std::size_t visualTraceMaxPoints_=768;

    static constexpr std::size_t sourceHistoryLength_=72;
    std::array<std::deque<float>,14> sourceHistory_{};
    // Signed Random output history for the large Random-LFO viewport.
    // Oldest is at the front/left; newest enters on the right and pushes the
    // existing trace leftward.
    static constexpr std::size_t randomHistoryLength_=240;
    std::deque<float> randomViewportHistory_{};
    // V38.2: 0.75 s of the UI-only 1920 Hz chaos trajectory.
    // Keep this history entirely in the visualization pipeline.
    static constexpr std::size_t chaosHistoryLength_=1440;
    std::deque<juce::Point<float>> chaosViewportHistory_{};
    EnvelopeTraceSnapshot sourceTrace_{};
    std::uint64_t sourceTraceOrder_=0;
    std::array<Lfo,4> sourceMonitorLfos_{};
    RandomGenerator sourceMonitorRandom_{};
    FunctionGenerator sourceMonitorFunction_{};
    ChaosGenerator sourceMonitorChaos_{};
    DriftGenerator sourceMonitorDrift_{};
    SequencerGenerator sourceMonitorSequencer_{};

    std::uint32_t routeDragId_=0;
    float routeDragStartY_=0.0f;
    float routeDragStartAmount_=0.0f;
    std::uint32_t routeHoverId_=0;
    juce::Point<float> routeHoverPoint_{};

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
