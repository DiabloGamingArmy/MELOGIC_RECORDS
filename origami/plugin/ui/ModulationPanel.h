// mct-origami-v40.3.1-sequence-expression-ui
// mct-origami-v40.1.0-sequencer-per-step-editor
// mct-origami-v40.0.0-sequencer-structural-redesign\n// mct-origami-v32.2.1-scroll-drag-matrix-hotfix
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
#include "ModulationSourceRow.h"
#include "VisualizationSettings.h"
#include <deque>
#include <memory>
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
    // The rail's card for a source (null when the source has no card).
    const ModulationSourceRow* sourceRow(ModSource) const noexcept;

    void mouseDown(const juce::MouseEvent&) override;
    void mouseDrag(const juce::MouseEvent&) override;
    void mouseUp(const juce::MouseEvent&) override;
    void mouseDoubleClick(const juce::MouseEvent&) override;
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
    // Single entry for every model refresh: updates the cache and re-lays out
    // the source rail whenever a card's height or presence changes.
    void applyModulationState(const ModulationState&);
    void layoutSourceRail();
    void setRouteAmount(std::uint32_t routeId,float amount);
    void removeRoute(std::uint32_t routeId);
    void updateSourceHistory(float dt);
    void paintSourceHistoryBackgrounds(juce::Graphics&);
    void paintEnvelopeTimeMarkers(juce::Graphics&) const;
    void paintOverChildren(juce::Graphics&) override;

    std::array<std::unique_ptr<ModulationSourceRow>,14> tabs_;
    juce::TextButton sourceAdd_{"+"},sourceRemove_{"-"};
    juce::Viewport sourceViewport_;
    juce::Component sourceContent_;
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
    juce::Slider randomSmooth_,randomHold_,randomDelay_;
    juce::Label randomSmoothLabel_,randomHoldLabel_,randomDelayLabel_;
    juce::Slider chaosAmount_,chaosFlow_,chaosDamping_,chaosWarp_,chaosSmooth_;
    juce::Label chaosAmountLabel_,chaosFlowLabel_,chaosDampingLabel_,chaosWarpLabel_,chaosSmoothLabel_;
    NativeComboBox chaosAxis_,chaosMethod_;
    // V39 Sequence editor: JUCE controls stay entirely in the UI layer while
    // DSP consumes the existing fixed, allocation-free SequencerSettings.
    std::array<juce::Slider,8> sequenceSteps_{};
    std::array<juce::Label,8> sequenceStepLabels_{};
    // V39.1 editor-only workflow state. PWR is intentionally implemented as
    // non-destructive value muting: the DSP contract remains the audited
    // fixed 8-step SequencerSettings until the dedicated timing-engine pass.
    std::array<juce::ToggleButton,8> sequencePower_{};
    std::array<float,8> sequenceStoredValue_{{-1.0f,-0.25f,0.65f,0.15f,1.0f,-0.55f,0.35f,0.0f}};
    std::array<juce::Slider,8> sequenceGatePreview_{};
    std::array<NativeComboBox,8> sequenceRatchet_{};
    juce::Slider sequenceHumanize_{};
    juce::Label sequenceHumanizeLabel_{};
    juce::TextButton sequenceRandomize_{"RANDOMIZE"};
    juce::TextButton sequenceInvert_{"INVERT"};
    juce::TextButton sequenceClear_{"CLEAR"};
    juce::TextButton sequenceAllOn_{"ALL ON"};
    juce::TextButton sequenceAlternate_{"ALT"};
    juce::Rectangle<float> sequenceCanvas_{};
    // V40 concept-art sequencer. Viewport painting is UI/message-thread only.
    struct SequenceContent final : juce::Component {
        std::function<void(juce::Graphics&)> painter;
        void paint(juce::Graphics& g) override { if(painter) painter(g); }
    };
    juce::Viewport sequenceViewport_{};
    SequenceContent sequenceContent_{};
    juce::Label sequenceStepsCaption_{},sequenceDirectionCaption_{},sequenceLoopCaption_{};
    NativeComboBox sequenceStepCount_{},sequenceDirection_{},sequenceLoopMode_{};
    juce::ToggleButton sequenceSync_{"SYNC"};
    bool commitSequenceSteps();
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
    bool visualizationEnabled(VisualizationEffect) const noexcept;
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
    RuntimeVisualizationSnapshot runtimeVisualization_{};
    std::uint32_t visualizationMask_=defaultVisualizationMask;
    juce::Point<float> previousChaosPoint_{};
    bool havePreviousChaosPoint_=false;
    // UI-only high-density Chaos monitor. Restores the V38.2 genuine ODE
    // trajectory used by the large Chaos viewport; it never feeds audio DSP.
    ChaosGenerator sourceMonitorChaos_{};

    DragTarget dragTarget_=DragTarget::None;
    juce::Point<float> dragStart_{};
    dsp::EnvelopeSettings dragEnvelope_{};
    std::array<float,3> dragCurves_{};
};

// mct-origami-synth-dynamic-macros: the SYNTH macro editor. Two columns of
// macro cards (name / remove, knob, assignment area) in a vertically
// scrolling list with its own scrollbar gutter, plus + ADD MACRO.
//
// Every card is a view of one canonical macro (stable id, ModSource 200+id);
// the assignment area is the SYNTH modulator row (drag grip + route rings),
// so assignments are ordinary ModRoutes shared with the Matrix and NODES.
class MacroPanel final : public Panel {
public:
    explicit MacroPanel(ModulationBindings={});
    ~MacroPanel() override;
    void resized() override;
    void syncFromModel();
    bool keyPressed(const juce::KeyPress&) override;
    void mouseDown(const juce::MouseEvent&) override;

    // Canonical edits (each one undo step). Removal deletes exactly the routes
    // sourced from that macro, in the same transaction.
    std::size_t addMacro();                  // new stable id, 0 when the limit is reached
    bool removeMacro(std::size_t id);        // immediate (the card asks first when routed)
    void requestRemoveMacro(std::size_t id); // routed: in-card confirmation; else immediate
    bool undo();
    bool redo();
    bool canUndo() const noexcept { return !undo_.empty(); }
    bool canRedo() const noexcept { return !redo_.empty(); }

    // Layout / inspection (tests, snapshots).
    static constexpr int columns=2,cardHeight=134,gap=4;
    std::size_t cardCount() const noexcept { return cards_.size(); }
    juce::Component* card(std::size_t index) const noexcept;
    std::size_t cardId(std::size_t index) const noexcept;
    juce::Viewport& viewport() noexcept { return viewport_; }
    juce::TextButton& addButton() noexcept { return add_; }
    juce::Slider* knob(std::size_t id) const noexcept;
    const ModulationSourceRow* assignment(std::size_t id) const noexcept;
    std::uint32_t rebuildCount() const noexcept { return rebuilds_; }
    class Card;
private:
    struct Step { bool added=false; std::size_t id=0; float value=0.0f; std::vector<ModRoute> routes;
                  std::vector<std::pair<std::uint32_t,std::uint8_t>> inputs; }; // NODES inputs it fed
    void paintContent(juce::Graphics&,juce::Rectangle<int>) override {}
    bool applyRemove(std::size_t id,Step&);
    bool applyAdd(const Step&);
    void rebuild(const ModulationState&);
    void layoutCards();
    void setRouteAmount(std::uint32_t,float);
    void removeRoute(std::uint32_t);
    ModulationBindings bindings_;
    juce::Viewport viewport_;
    juce::Component content_;
    juce::TextButton add_{"+ ADD MACRO"};
    std::vector<std::unique_ptr<Card>> cards_;
    // A card removed while one of its own buttons is running stays alive (off
    // screen) until that callback returns; never deleted mid-callback.
    std::vector<std::unique_ptr<Card>> retired_;
    int cardActions_=0;
    friend class Card;
    std::uint16_t shownMask_=0;
    std::uint64_t lastRevision_=0;
    std::uint32_t rebuilds_=0;
    std::vector<Step> undo_,redo_;
};

}
