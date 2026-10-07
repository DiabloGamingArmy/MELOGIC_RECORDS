// mct-origami-unified-routing-core-fx-p04
// mct-origami-fx-modulation-graph-ux-p03
// mct-origami-fx-graph-dsp-bus-routing-p02
// mct-origami-fx-page-foundation-p01
#pragma once
#include "OrigamiStyle.h"
#include "ModulationBindings.h"
#include "ModulationSourceRow.h"
#include "ModulationMatrix.h"
#include "ModulationDestinations.h"
#include "core/nodes/ControlGraph.h"
#include "NativeChoiceMenu.h"
#include "core/fx/FxGraph.h"
#include "core/fx/FxRenderer.h"
#include "core/fx/FxWorkspace.h"
#include <array>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <vector>

// FX workspace: ROUTING TOOLBAR / SIDEBAR + ZOOMABLE GRAPH / INSPECTOR.
//
// The canonical FxGraphDocument (owned by the processor, message thread only)
// is the single source of truth for the graph; FX parameter modulation lives
// in Origami's one ModulationState (ModDestination::FxParameter). Components
// refer to nodes by stable ID and are reconciled on document revisions.
//
// Coordinates: node positions are graph units. FxCanvas children live in
// graph units; FxGraphView maps them to the screen with one transform
// (scale(zoom) then translate(-pan)), so ports, cables, hit tests, drops and
// right-click insertion all stay in graph space under any zoom/pan.
namespace mct::origami::ui {

class FxCanvas;
class FxPage;

// Fixed-size catalog shared by every graph-construction entry point.
struct FxModuleMenu {
    static constexpr int splitId=1001,mergeId=1002,sendId=1003,returnId=1004;
    static constexpr int externalId=1999,busBase=2000;
    // mct-origami-nodes-n03-control: CONTROL entries (never FxModuleSpecs).
    static constexpr int parameterPickerId=(1<<20)-1,controlSourceBase=1<<20;
    // N04: CONTROL processing operators (controlOperatorBase + ControlOpType).
    static constexpr int controlOperatorBase=controlSourceBase+0x8000;
    static std::optional<fx::FxModuleSpec> decode(int id);
};

class FxNodeComponent final : public juce::Component {
public:
    FxNodeComponent(FxPage&,fx::FxNodeId);
    ~FxNodeComponent() override;
    fx::FxNodeId id() const noexcept { return id_; }
    void update(const fx::FxNode&,bool selected);
    void setMeter(float left,float right);
    void setTelemetry(const fx::FxRenderer::NodeTelemetrySnapshot&);
    void updateDetail();
    void mouseEnter(const juce::MouseEvent&) override;
    void mouseExit(const juce::MouseEvent&) override;
    void mouseMove(const juce::MouseEvent&) override;
    juce::Point<float> portCentre(bool input,std::uint8_t port) const noexcept;
    std::optional<std::pair<bool,std::uint8_t>> portAt(juce::Point<float>) const noexcept;
    static juce::Rectangle<int> sizeFor(const fx::FxNode&) noexcept;
    juce::TextButton* accessory() noexcept { return node_.kind==fx::FxNodeKind::Output ? &accessory_ : nullptr; }
    static constexpr float portRadius=5.0f;

    void paint(juce::Graphics&) override;
    void resized() override;
    void mouseDown(const juce::MouseEvent&) override;
    void mouseDrag(const juce::MouseEvent&) override;
    void mouseUp(const juce::MouseEvent&) override;
private:
    void showMenu();
    float hitRadius() const noexcept;
    FxPage& page_;
    fx::FxNodeId id_;
    fx::FxNode node_;
    juce::Image previewImage_;
    bool previewDirty_=true;
    bool selected_=false,hovered_=false;
    std::optional<std::pair<bool,std::uint8_t>> hoveredPort_;
    float meterLeft_=0.0f,meterRight_=0.0f;
    fx::FxRenderer::NodeTelemetrySnapshot telemetry_{};
    juce::TextButton power_{"PWR"},menu_{"..."},remove_{"X"};
    juce::TextButton accessory_{"+ ADD MODULE"}; // MASTER OUT only: moves with the node
    std::vector<std::unique_ptr<juce::Slider>> quick_;
    std::vector<fx::FxParameterId> quickIds_;
    enum class Drag { None,Move,Wire };
    Drag drag_=Drag::None;
    juce::Point<int> dragOrigin_;
};

// mct-origami-nodes-n03-control / n04-control-processing
// CONTROL-layer view data (never modulation state): what the canvas shows.
struct ControlNodeView {
    nodes::ControlNodeKey key;
    float x=0.0f,y=0.0f;
    juce::String title,detail;
    nodes::NodeExecutionDomain domain=nodes::NodeExecutionDomain::Global;
    bool selected=false,linked=false,removable=false;
    // Operators: inputs (IN or A/B) and the one inline control.
    std::uint8_t inputs=0;
    std::array<juce::String,3> inputNames{};
    int primaryParameter=-1;
    juce::String primaryLabel;
    float primaryValue=0.0f,primaryMinimum=0.0f,primaryMaximum=1.0f;
    bool primaryInteger=false;
    // N05: the signal of each port (CONTROL diamond, EVENT square, GATE bar).
    std::array<ControlSignal,3> inputSignals{{ControlSignal::Control,ControlSignal::Control,ControlSignal::Control}};
    ControlSignal outputSignal=ControlSignal::Control;
    ControlOpType opType=ControlOpType::None;
    std::array<bool,3> inputConnected{};
    // N06: typed outputs at stable port indices (port 0 == outputSignal).
    std::uint8_t outputs=1;
    std::array<ControlSignal,maxControlOutputs> outputSignals{{ControlSignal::Control,ControlSignal::None,ControlSignal::None,ControlSignal::None}};
    std::array<juce::String,maxControlOutputs> outputNames{};
    // N06 previews: SEQUENCER steps (values -1..1, current step from the
    // engine snapshot), PATTERN / EUCLIDEAN cells (0 / 1; PATTERN cells click).
    enum class Preview : std::uint8_t { None,Sequencer,Pattern,Euclidean };
    Preview preview=Preview::None;
    std::array<float,32> cells{};
    int cellCount=0;
};
struct ControlLinkView {
    std::uint32_t route=0;               // route link (direct or processed)
    nodes::ControlNodeKey from,to;
    std::uint32_t targetOperator=0;      // operator-input edge (route == 0)
    std::uint8_t targetInput=0;
    bool supported=true,enabled=true,selected=false;
    ControlSignal signal=ControlSignal::Control; // drawn style (solid / short / long dashes)
    std::uint8_t sourcePort=0;           // N06: the output port it leaves from
};

// A CONTROL node on the canvas: a canonical SOURCE, a PARAMETER (both views
// of existing objects) or a processing OPERATOR. Inputs sit on the left,
// outputs on the right; every CONTROL socket is a diamond.
class ControlNodeComponent final : public juce::Component {
public:
    ControlNodeComponent(FxPage&,nodes::ControlNodeKey);
    const nodes::ControlNodeKey& key() const noexcept { return view_.key; }
    void update(const ControlNodeView&);
    juce::Point<float> portCentre(nodes::PortDirection,std::uint8_t index=0) const noexcept;
    std::optional<std::pair<nodes::PortDirection,std::uint8_t>> portAt(juce::Point<float>) const noexcept;
    // The authoring endpoint of one of this node's ports.
    std::optional<nodes::ControlEndpoint> endpoint(nodes::PortDirection,std::uint8_t index) const noexcept;
    bool removable() const noexcept { return view_.removable; }
    // N05 monitoring: event activity (decays on the UI timer) and gate state.
    void setActivity(float activity,bool gateOpen);
    // N06: the canonical sequencer's current step (SEQUENCER preview).
    void setSequencerStep(int step);
    int sequencerStep() const noexcept { return sequencerStep_; }
    std::uint8_t outputCount() const noexcept;
    juce::Rectangle<float> previewBounds() const noexcept;
    std::optional<int> previewCellAt(juce::Point<float>) const noexcept;
    const ControlNodeView& view() const noexcept { return view_; }
    static int heightFor(const ControlNodeView&) noexcept;
    static int widthFor(const ControlNodeView&) noexcept; // N07: long PATTERNs get a wider node
    static constexpr int width=220;
    // N07 semantic zoom: what a node draws at the current zoom. Hit targets
    // keep their graph size; secondary text, previews and inline controls are
    // hidden when they would be unreadable, and the title keeps a minimum
    // on-screen size.
    enum class Detail : std::uint8_t { Full,Reduced,Minimal };
    static Detail detailFor(float zoom) noexcept { return zoom>=0.6f ? Detail::Full : zoom>=0.45f ? Detail::Reduced : Detail::Minimal; }
    void setDetail(Detail);
    Detail detail() const noexcept { return detail_; }
    void paint(juce::Graphics&) override;
    void paintOverChildren(juce::Graphics&) override;
    void resized() override;
    void mouseEnter(const juce::MouseEvent&) override { hovered_=true; repaint(); }
    void mouseExit(const juce::MouseEvent&) override { hovered_=false; repaint(); }
    void mouseDown(const juce::MouseEvent&) override;
    void mouseDrag(const juce::MouseEvent&) override;
    void mouseUp(const juce::MouseEvent&) override;
private:
    void showMenu();
    std::uint8_t inputCount() const noexcept;
    bool hasOutput() const noexcept { return view_.key.kind!=nodes::ControlNodeKind::Parameter && view_.outputSignal!=ControlSignal::None; }
    FxPage& page_;
    ControlNodeView view_;
    float activity_=0.0f;
    bool gateOpen_=false,hovered_=false;
    int sequencerStep_=-1;
    Detail detail_=Detail::Full;
    juce::Point<int> groupDragOrigin_{};
    juce::TextButton remove_{"X"};
    juce::Slider primary_;
    bool primaryInitialised_=false;
    enum class Drag { None,Move,Wire,Group };
    Drag drag_=Drag::None;
    juce::Point<int> dragOrigin_;
};

class FxCanvas final : public juce::Component, public juce::DragAndDropTarget {
public:
    static constexpr float pointHitRadius=9.0f;
    explicit FxCanvas(FxPage&);
    void rebuild(const fx::FxGraph&,fx::FxNodeId selected,int minWidth,int minHeight);
    FxNodeComponent* nodeComponent(fx::FxNodeId) const noexcept;
    std::size_t nodeComponentCount() const noexcept { return nodes_.size(); }
    std::size_t connectionPathCount() const noexcept { return wires_.size(); }
    std::vector<fx::FxNodeId> nodeZOrder() const;
    void bringToFront(fx::FxNodeId);
    juce::Rectangle<int> contentBounds() const;
    // Canvas-local coordinates ARE graph coordinates.
    fx::FxPoint toGraph(juce::Point<float> p) const noexcept { return {p.x,p.y}; }
    float wireHitRadius() const noexcept;
    std::optional<fx::FxConnectionId> connectionAt(juce::Point<float>) const noexcept;
    std::optional<std::pair<fx::FxConnectionId,std::size_t>> layoutPointAt(juce::Point<float>) const noexcept;
    std::size_t layoutInsertIndex(fx::FxConnectionId,juce::Point<float>) const noexcept;
    void nodeMoved(fx::FxNodeId);
    void beginWire(fx::FxNodeId,std::uint8_t port);
    void dragWire(juce::Point<int>);
    void endWire(juce::Point<int>);
    void cancelWire();
    void clearNodes(); // bus switch: node IDs are per-graph, never reuse components
    std::optional<fx::FxPortRef> wireSource() const noexcept { return wireActive_ ? std::optional<fx::FxPortRef>(wireFrom_) : std::nullopt; }

    // ---- CONTROL layer (N03/N04): views of canonical modulation relationships.
    using ControlNodeView=ui::ControlNodeView;
    using ControlLinkView=ui::ControlLinkView;
    struct ControlHit { std::uint32_t route=0,op=0; std::uint8_t input=0; };
    void rebuildControl(const std::vector<ControlNodeView>&,const std::vector<ControlLinkView>&);
    ControlNodeComponent* controlNode(const nodes::ControlNodeKey&) const noexcept;
    std::size_t controlNodeCount() const noexcept { return controlNodes_.size(); }
    std::size_t controlLinkCount() const noexcept { return controlWires_.size(); }
    std::optional<ControlHit> controlLinkAt(juce::Point<float>) const noexcept;
    void controlNodeMoved(const nodes::ControlNodeKey&);
    // Drags start from any CONTROL OUTPUT (source or operator).
    void beginControlWire(const nodes::ControlEndpoint& from,juce::Point<float> start);
    // N06: a cable picked up from an unconnected INPUT (drawn backwards).
    void beginControlWireFromInput(const nodes::ControlEndpoint& to,juce::Point<float> start);
    std::optional<nodes::ControlEndpoint> controlWireTarget() const noexcept { return controlWireActive_ && controlWireReverse_ ? std::optional<nodes::ControlEndpoint>(controlWireTo_) : std::nullopt; }
    void dragControlWire(juce::Point<int>);
    void endControlWire(juce::Point<int>);
    std::optional<nodes::ControlEndpoint> controlWireSource() const noexcept { return controlWireActive_ && !controlWireReverse_ ? std::optional<nodes::ControlEndpoint>(controlWireFrom_) : std::nullopt; }
    std::uint32_t paintCount() const noexcept { return paints_; }
    // N07 marquee selection (left-drag on empty canvas; Shift adds).
    juce::Rectangle<float> marquee() const noexcept { return marqueeActive_ ? marquee_ : juce::Rectangle<float>{}; }
    void beginMarquee(juce::Point<float>,bool additive);
    void dragMarquee(juce::Point<float>);
    void endMarquee();
    std::vector<ControlNodeComponent*> controlNodes() const;
    void setControlDetail(ControlNodeComponent::Detail);

    void paint(juce::Graphics&) override;
    void mouseDown(const juce::MouseEvent&) override;
    void mouseDrag(const juce::MouseEvent&) override;
    void mouseUp(const juce::MouseEvent&) override;
    void mouseMove(const juce::MouseEvent&) override;
    void mouseExit(const juce::MouseEvent&) override;
    void mouseDoubleClick(const juce::MouseEvent&) override;
    bool isInterestedInDragSource(const SourceDetails&) override;
    void itemDropped(const SourceDetails&) override;
private:
    struct Wire {
        fx::FxConnection connection;
        std::vector<juce::Point<float>> handles;
        juce::Path path;
        juce::Rectangle<int> area;
    };
    struct ControlWire {
        ControlLinkView link;
        juce::Path path;
        juce::Rectangle<int> area;
    };
    void computeControlWire(ControlWire&) const;
    void updateExtent();
    std::vector<std::unique_ptr<ControlNodeComponent>> controlNodes_;
    std::vector<ControlWire> controlWires_;
    void showControlLinkMenu(const ControlHit&);
    bool controlWireActive_=false;
    nodes::ControlEndpoint controlWireFrom_{};
    nodes::ControlEndpoint controlWireTo_{};
    bool controlWireReverse_=false;
    juce::Point<float> controlWireStart_{},controlWireEnd_{};
    int minWidth_=0,minHeight_=0;
    std::uint32_t paints_=0;
    bool marqueeActive_=false,marqueeAdditive_=false;
    juce::Point<float> marqueeStart_{};
    juce::Rectangle<float> marquee_{};
    juce::Point<float> portInCanvas(fx::FxNodeId,bool input,std::uint8_t port) const noexcept;
    void computeWire(Wire&) const;
    void showConnectionMenu(fx::FxConnectionId,juce::Point<float>);
    static juce::Path curve(juce::Point<float>,juce::Point<float>);
    static juce::Path curveThrough(const std::vector<juce::Point<float>>&);
    FxPage& page_;
    std::map<fx::FxNodeId,std::unique_ptr<FxNodeComponent>> nodes_;
    std::vector<Wire> wires_;
    bool wireActive_=false;
    fx::FxPortRef wireFrom_{};
    juce::Point<float> wireEnd_{};
    bool panning_=false;
    juce::Point<float> panMouseStart_,panViewStart_;
    std::optional<std::pair<fx::FxConnectionId,std::size_t>> hoverPoint_,dragPoint_;
};

// Zoom/pan host for the canvas. Graph <-> view: view = graph*zoom - pan.
class FxGraphView final : public juce::Component, private juce::ScrollBar::Listener {
public:
    // N07: 30% floor. Below 45% nodes draw identity + ports only, with titles
    // kept >= 9 px on screen (semantic zoom), so a deep graph fits readably.
    static constexpr float minZoom=0.3f,maxZoom=2.5f;
    explicit FxGraphView(FxCanvas&);
    ~FxGraphView() override;
    float zoom() const noexcept { return zoom_; }
    juce::Point<float> pan() const noexcept { return pan_; }
    void setView(float zoom,juce::Point<float> pan);
    void zoomAround(float zoom,juce::Point<float> viewPoint);
    void panBy(juce::Point<float> viewDelta);
    void fitTo(juce::Rectangle<int> graphBounds);
    void contentChanged();
    juce::Point<float> graphToView(fx::FxPoint) const noexcept;
    fx::FxPoint viewToGraph(juce::Point<float>) const noexcept;
    juce::Rectangle<int> viewport() const noexcept; // drawable area (excludes scrollbars)
    std::function<void()> onViewChanged;
    void resized() override;
    void mouseWheelMove(const juce::MouseEvent&,const juce::MouseWheelDetails&) override;
    void mouseMagnify(const juce::MouseEvent&,float scaleFactor) override;
private:
    void scrollBarMoved(juce::ScrollBar*,double) override;
    void apply();
    FxCanvas& canvas_;
    juce::ScrollBar horizontal_{false},vertical_{true};
    float zoom_=1.0f;
    juce::Point<float> pan_{};
    bool updating_=false;
};

// Resource browser: SOURCES / MODULATORS / FILTERS / BUSES / MATRIX. Every row is a
// reference to a canonical Origami object, never a duplicate of it. MODULATORS
// rows are the SYNTH page's own ModulationSourceRow cards; the other tabs are
// painted with the shared source-entity vocabulary (SourceEntity.h).
class FxSidebar final : public juce::Component {
public:
    enum class Tab { Sources=0,Modulators=1,Filters=2,Buses=3,Matrix=4 };
    static constexpr int tabCount=5;
    struct Magnitude { std::uint32_t routeId=0; float amount=0.0f; };
    struct Row {
        juce::String label,badge,detail;
        juce::String dragDescription; // empty: not draggable
        bool enabled=true,active=false,header=false;
        std::function<void()> onClick;
        std::function<void()> onSecondaryClick; // right-click
        std::vector<Magnitude> magnitudes;       // canonical route amounts (rings)
        std::function<void(std::uint32_t,float)> onMagnitude; // drag a ring
        std::optional<ModSource> modulationSource; // hosted as a ModulationSourceRow
        std::function<void(std::uint32_t)> onRemoveRoute; // double-click a ring
    };
    FxSidebar();
    ~FxSidebar() override;
    void setTab(Tab);
    Tab tab() const noexcept { return tab_; }
    void setRows(Tab,std::vector<Row>);
    const std::vector<Row>& rows(Tab t) const noexcept { return rows_[static_cast<std::size_t>(t)]; }
    // The hosted modulator card for a source (MODULATORS tab), or null.
    const ModulationSourceRow* modulatorRow(ModSource) const noexcept;
    // MATRIX tab content: the canonical Matrix view, owned by the page.
    void setMatrixView(juce::Component*);
    juce::String tabLabel(Tab t) const { return tabs_[static_cast<std::size_t>(t)].getButtonText(); }
    std::function<void(Tab)> onTabChanged;
    std::function<juce::String(std::uint32_t)> routeLabel; // ring hover label
    void paint(juce::Graphics&) override;
    void paintOverChildren(juce::Graphics&) override;
    void resized() override;
    static constexpr int rowHeight=36;
    static constexpr int width=268;
private:
    class List;
    bool syncModulatorRows();
    void layoutList();
    Tab tab_=Tab::Sources;
    std::vector<std::unique_ptr<ModulationSourceRow>> modulatorRows_;
    std::optional<ModSource> selectedModulator_;
    std::array<juce::TextButton,tabCount> tabs_;
    std::array<std::vector<Row>,tabCount> rows_;
    std::array<juce::String,tabCount> signatures_;
    juce::Component* matrixView_=nullptr;
    juce::Viewport viewport_;
    std::unique_ptr<List> list_;
};

// N07: Origami-native searchable node palette (Add Module, quick add, and
// cable drops). Typing filters by name, category and aliases ("prob", "s&h",
// "seq"); arrows + Return choose; Escape dismisses. Disabled entries show why.
class NodePalette final : public juce::Component {
public:
    struct Entry { int id=0; juce::String label,group,reason; bool enabled=true; };
    NodePalette();
    void open(std::vector<Entry>,juce::Point<int> at,const juce::String& title);
    void dismiss();
    bool isOpen() const noexcept { return isVisible(); }
    void setQuery(const juce::String&);
    juce::String query() const;
    // The current results, best match first (inspection / tests).
    std::vector<Entry> results() const;
    bool chooseSelected();
    void moveSelection(int delta);
    std::function<void(int id)> onChoose;
    static juce::String aliasesFor(const juce::String& label);
    void paint(juce::Graphics&) override;
    void resized() override;
    void mouseDown(const juce::MouseEvent&) override;
    void mouseWheelMove(const juce::MouseEvent&,const juce::MouseWheelDetails&) override;
    static constexpr int rowHeight=26,width=320,visibleRows=11;
private:
    class Field;
    void filter();
    std::vector<Entry> all_,shown_;
    juce::String title_;
    int selected_=0,scroll_=0;
    std::unique_ptr<Field> field_;
};

// Origami-native modal surface (never an OS alert/window).
class FxModalOverlay final : public juce::Component {
public:
    FxModalOverlay();
    void show(juce::Component& content,juce::Rectangle<int> panelSize);
    void dismiss();
    bool isShowing() const noexcept { return isVisible(); }
    std::function<void()> onDismissed;
    void paint(juce::Graphics&) override;
    void resized() override;
    void mouseDown(const juce::MouseEvent&) override;
    bool keyPressed(const juce::KeyPress&) override;
private:
    juce::Component* content_=nullptr;
    juce::Rectangle<int> panelSize_;
};

// GLOBAL FX editor: input -> graph -> dry/wet -> width -> output, plus FX
// ORDER and BYPASS MODE. Edits the canonical document directly.
class FxGlobalFxEditor final : public juce::Component {
public:
    explicit FxGlobalFxEditor(fx::FxWorkspace&);
    void sync();
    std::function<void()> onClose;
    void paint(juce::Graphics&) override;
    void resized() override;
private:
    void commit();
    fx::FxWorkspace& workspace_;
    std::array<juce::Slider,4> knobs_;
    juce::ComboBox order_,bypass_;
    juce::TextButton close_{"X"};
    bool syncing_=false;
};

// Processor-side services the FX workspace needs (bus editing, meters, view).
struct FxPageHost {
    std::function<std::pair<float,float>()> peaks;
    std::function<BusId()> addBus;
    std::function<bool(BusId)> removeBus;
    fx::FxViewState* view=nullptr;
    nodes::ControlLayout* controlLayout=nullptr; // N03 CONTROL view metadata (processor-owned)
    // mct-origami-manual-qa-ui-wavetable-fixes: peak (L, R) of the signal
    // entering a bus's graph (its IN node) since the last read.
    std::function<std::pair<float,float>(BusId)> inputPeaks;
    std::function<fx::FxRenderer::NodeTelemetrySnapshot(BusId,fx::FxNodeId)> nodeTelemetry;
    std::function<void(BusId,bool)> nodeTelemetryEnabled;
};

class FxPage final : public juce::Component, private juce::Timer {
public:
    using PeakSource=std::function<std::pair<float,float>()>;
    using HostBindings=FxPageHost;
    FxPage(fx::FxWorkspace&,ModulationBindings,FxPageHost host=FxPageHost{});
    ~FxPage() override;
    void resized() override;
    void paint(juce::Graphics&) override;
    bool keyPressed(const juce::KeyPress&) override;
    void visibilityChanged() override;
    // Read-only message-thread visualization. No renderer or parameter writes.
    void refreshVisualFeedback();
    const ModulationState& visualModulation() const noexcept { return controlModulation_; }
    const RuntimeVisualizationSnapshot& visualRuntime() const noexcept { return visualRuntime_; }
    const FxModulationOutput& visualFxFrame() const noexcept { return visualFxFrame_; }
    std::uint32_t visualRefreshCount() const noexcept { return visualRefreshCount_; }

    void syncFromModel();
    void modelChanged(); // N07: hidden-aware (stale flag) model-change notification
    std::function<void()> onOpenSynthFilter;
    // N07 UI diagnostics (bounded counters; development / tests / debug view).
    struct UiDiagnostics {
        std::uint32_t modelSyncs=0;      // sidebar + CONTROL view rebuilds from the model
        std::uint32_t skippedSyncs=0;    // timer syncs answered by "revision unchanged"
        std::uint32_t hiddenSyncs=0;     // syncs while the page is hidden (no work done)
        std::uint32_t controlRebuilds=0; // CONTROL graph derivations (refreshControl)
        std::uint32_t rejectedConnections=0;
    };
    const UiDiagnostics& uiDiagnostics() const noexcept { return uiDiagnostics_; }
    std::uint32_t canvasPaintCount() const noexcept;

    // Interaction API (node components, canvas, toolbar, sidebar, inspector, tests).
    fx::FxGraphDocument& document() noexcept { return *document_; }
    const fx::FxGraph& graph() const noexcept { return document_->graph(); }
    fx::FxWorkspace& workspace() noexcept { return workspace_; }
    // Bus selection: the graph workspace shows the selected bus's graph.
    // Every bus keeps processing regardless of which one is shown.
    BusId selectedBus() const noexcept { return bus_; }
    void selectBus(BusId);
    BusId addBus();
    void requestDeleteBus(BusId);
    bool deleteBus(BusId);
    juce::String busName(BusId) const;
    fx::FxNodeId addSynthFilterCopy(fx::FxPoint centre);
    fx::FxNodeId selectedNode() const noexcept { return selected_; }
    void selectNode(fx::FxNodeId);
    bool deleteNode(fx::FxNodeId);
    // Workflow-aware add (SERIAL / PARALLEL / SPLIT / CUSTOM semantics).
    fx::FxNodeId addModule(const fx::FxModuleSpec&);
    fx::FxNodeId addEffect(fx::FxEffectType type) { return addModule({fx::FxModuleKind::Effect,type,0}); }
    fx::FxNodeId addModuleAt(const fx::FxModuleSpec&,fx::FxPoint centre);
    fx::FxNodeId addEffectAt(fx::FxEffectType type,fx::FxPoint centre) { return addModuleAt({fx::FxModuleKind::Effect,type,0},centre); }
    fx::FxNodeId insertModuleOnConnection(fx::FxConnectionId,const fx::FxModuleSpec&,fx::FxPoint centre);
    fx::FxNodeId insertEffectOnConnection(fx::FxConnectionId c,fx::FxEffectType t,fx::FxPoint p) { return insertModuleOnConnection(c,{fx::FxModuleKind::Effect,t,0},p); }
    // MASTER OUT accessory: insert right before MASTER OUT (one input port, so
    // never ambiguous); unconnected MASTER OUT gets the module wired into it.
    fx::FxNodeId insertBeforeOutput(const fx::FxModuleSpec&);
    bool removeConnection(fx::FxConnectionId);
    bool resetConnectionRouting(fx::FxConnectionId);
    bool addLayoutPoint(fx::FxConnectionId,fx::FxPoint);
    bool moveLayoutPoint(fx::FxConnectionId,std::size_t,fx::FxPoint,bool live);
    bool removeLayoutPoint(fx::FxConnectionId,std::size_t);
    void setRoutingMode(fx::FxRoutingMode);
    void requestClear();   // shows the Origami-native confirmation (names the bus)
    void confirmClear();   // clears ONLY the selected bus graph; one undo step
    bool clearConfirmationVisible() const noexcept { return overlay_.isShowing(); }
    void undo();
    void redo();
    void commitMove(fx::FxNodeId,juce::Point<int> topLeft);
    bool connectPorts(fx::FxPortRef from,fx::FxPortRef to);
    void disconnectPort(fx::FxNodeId,bool input,std::uint8_t port);
    void setNodeEnabled(fx::FxNodeId,bool);
    void beginParameterGesture();
    void setParameter(fx::FxNodeId,fx::FxParameterId,float);
    void endParameterGesture();
    void applyTemplate(int templateId);
    // One module catalog / native menu for every entry point.
    // CONTROL items (sources, PARAMETER) are offered when allowSources and are
    // created at `at` (else at the view centre).
    void showModuleMenu(juce::Component& anchor,bool allowSources,std::function<void(fx::FxModuleSpec)> chosen,
                        std::optional<fx::FxPoint> at={});
    std::vector<NativeChoiceItem> moduleMenuItems(bool allowSources) const;
    std::vector<int> moduleMenuIds(bool allowSources) const;
    void showTemplatesMenu(juce::Component& anchor);
    FxCanvas& canvas() noexcept { return canvas_; }
    ModulationMatrix& matrix() noexcept { return *matrix_; }
    juce::Component& moduleParametersPanel() noexcept;
    juce::Component& macrosPanel() noexcept;
    FxGraphView& graphView() noexcept { return view_; }
    FxSidebar& sidebar() noexcept { return sidebar_; }
    float graphZoom() const noexcept { return view_.zoom(); }
    juce::String inspectorHeadline() const;
    juce::String parameterTabName() const;
    void selectParameterTab(int);
    std::size_t modulationRowCount() const;
    std::pair<float,float> meterLevels() const noexcept { return {meterLeft_,meterRight_}; }
    // The IN node meters (displayed L / R) and one telemetry tick (tests).
    std::pair<float,float> inputMeterLevels(fx::FxNodeId id) const { const auto it=inputMeters_.find(id); return it!=inputMeters_.end() ? it->second : std::pair<float,float>{0.0f,0.0f}; }
    void meterTickForTesting() { updateMeters(); }
    void updateMeters();
    fx::FxRenderer::NodeTelemetrySnapshot nodeTelemetry(fx::FxNodeId id) const { return host_.nodeTelemetry ? host_.nodeTelemetry(bus_,id) : fx::FxRenderer::NodeTelemetrySnapshot{}; }
    void zoomIn();
    void zoomOut();
    void zoomReset();
    void zoomToFit();

    // ---- NODES CONTROL layer (mct-origami-nodes-n03-control) ----------------
    // SOURCE -> PARAMETER links ARE canonical ModRoutes: they are created,
    // edited and removed through the same modulation bindings as SYNTH
    // drag-and-drop and the Matrix, and derived back from ModulationState.
    struct ControlSelection {
        enum class Kind { None,Node,Link,Edge } kind=Kind::None;
        nodes::ControlNodeKey key;
        std::uint32_t route=0;
        std::uint32_t op=0; std::uint8_t input=0; // Edge: an operator input
    };
    const nodes::ControlGraph& controlGraph() const noexcept { return controlGraph_; }
    bool controlNodeShown(const nodes::ControlNodeKey&) const noexcept;
    // Would connecting create (or find) a valid relationship?
    bool connectableControl(ModSource,const ModAddress&) const;
    bool controlLinkShown(std::uint32_t route) const noexcept;
    bool addControlSource(ModSource,std::optional<fx::FxPoint> at={});
    bool addParameterNode(const ModAddress&,std::optional<fx::FxPoint> at={});
    // Creates the canonical route (N01 defaults: ON / UNIPOLAR / 0%) or, when
    // the relationship already exists, recognizes and selects it. The route id
    // is returned in existingRoute in both cases.
    nodes::ControlLinkCheck connectControl(ModSource,const ModAddress&);
    bool deleteControlLink(std::uint32_t route);
    bool updateControlLink(const ModRoute&); // amount / polarity / enabled
    bool removeControlNode(const nodes::ControlNodeKey&); // only an unlinked node
    void moveControlNode(const nodes::ControlNodeKey&,fx::FxPoint,bool commit);
    // ---- N04 processing operators (state lives in ModulationState::operators).
    std::optional<std::uint32_t> addControlOperator(ControlOpType,std::optional<fx::FxPoint> at={});
    // Any OUTPUT (source / operator) -> any INPUT (operator input / PARAMETER).
    nodes::ControlLinkCheck connectControlEdge(const nodes::ControlEndpoint& from,const nodes::ControlEndpoint& to);
    bool canConnectControlEdge(const nodes::ControlEndpoint& from,const nodes::ControlEndpoint& to) const;
    bool disconnectControlInput(std::uint32_t op,std::uint8_t input);
    std::optional<std::uint32_t> insertControlOperatorOnRoute(std::uint32_t route,ControlOpType);
    std::optional<std::uint32_t> insertControlOperatorOnInput(std::uint32_t op,std::uint8_t input,ControlOpType);
    bool deleteControlOperator(std::uint32_t op);
    std::optional<std::uint32_t> duplicateControlOperator(std::uint32_t op);
    // ---- N06: typed menus / drag-to-create / sequencing editors ---------------
    // Node types that can be spliced into a CONTROL cable (route, or the edge
    // into op/input): first input takes the carried signal and an output port
    // matching the consumer can be chosen unambiguously.
    std::vector<ControlOpType> controlInsertTypes(std::uint32_t route,std::uint32_t op,std::uint8_t input) const;
    // A cable dropped on empty space: the node types that can terminate it
    // (from an OUTPUT) or feed it (from an INPUT), and whether PARAMETER /
    // SOURCES apply. Disabled items carry the reason.
    std::vector<NativeChoiceItem> controlCreateItems(const nodes::ControlEndpoint& dangling) const;
    void showControlCreateMenu(juce::Component& anchor,const nodes::ControlEndpoint& dangling,fx::FxPoint at);
    // Creates the node at `at` and connects it to the dangling endpoint in ONE
    // undo step. From an OUTPUT: into the first compatible input. From an INPUT:
    // from the unambiguous compatible output port.
    std::optional<std::uint32_t> createConnectedControlOperator(ControlOpType,const nodes::ControlEndpoint& dangling,std::optional<fx::FxPoint> at);
    bool togglePatternStep(std::uint32_t op,int step);
    // ---- N07: selection, layout utilities, palette, clipboard, diagnostics ----
    // Multi-selection of CONTROL nodes (Shift-click toggles, marquee selects).
    const std::vector<nodes::ControlNodeKey>& selectedControlNodes() const noexcept { return controlMulti_; }
    void setControlNodeSelection(std::vector<nodes::ControlNodeKey>);
    void toggleControlNodeSelection(const nodes::ControlNodeKey&);
    bool controlNodeSelected(const nodes::ControlNodeKey&) const noexcept;
    // Deletes the selected user-created nodes (canonical SOURCE / PARAMETER
    // nodes are only removed from the canvas when unlinked). One undo step.
    bool deleteSelectedControlNodes();
    // Moves a group of nodes by `delta` (graph units): one undo step.
    void moveControlNodes(const std::vector<nodes::ControlNodeKey>&,juce::Point<float> delta);
    enum class Align { Left,Center,Right,Top,DistributeHorizontally,DistributeVertically };
    bool alignControlNodes(Align);
    // AUTO LAYOUT (explicit command): layered left-to-right placement of the
    // whole CONTROL graph. Layout only (one undo step); never touches DSP.
    std::size_t autoLayoutControl();
    // The searchable palette. `dangling`: filtered for a cable dropped on empty
    // canvas (and auto-connected); otherwise the whole Add Module catalog.
    void showNodePalette(std::optional<fx::FxPoint> at,std::optional<nodes::ControlEndpoint> dangling={});
    NodePalette& nodePalette() noexcept { return palette_; }
    std::vector<NodePalette::Entry> paletteEntries(std::optional<nodes::ControlEndpoint> dangling) const;
    void addFromCatalog(int itemId,std::optional<fx::FxPoint> at); // one dispatch for every Add entry point
    // Clipboard: user-created processing nodes and the connections BETWEEN
    // them (never external connections, never canonical sources/parameters).
    std::size_t copySelectedControlNodes();
    std::vector<std::uint32_t> pasteControlNodes(std::optional<fx::FxPoint> at={});
    std::size_t clipboardSize() const noexcept { return clipboard_.operators.size(); }
    // Graph-authoring feedback (Origami-native, transient; never an OS alert).
    void showGraphFeedback(const juce::String&);
    juce::String graphFeedback() const { return feedback_; }
    // Developer inspector: ids, slots, ports, domains, revisions, telemetry and
    // the graph validator. Hidden by default (Cmd/Ctrl+Shift+D).
    void setDebugInspectorVisible(bool);
    bool debugInspectorVisible() const noexcept;
    juce::StringArray debugInspectorLines() const;
    juce::StringArray validateControlGraphReport() const;
    // The canonical sequence (SequencerSettings), edited from the SEQUENCER
    // node's inspector: one undo step per edit or per slider drag.
    bool setSequencerSettings(const SequencerSettings&);
    SequencerSettings sequencerSettings() const;
    void beginOperatorGesture();
    bool setOperatorParameter(std::uint32_t op,std::size_t index,float value);
    void endOperatorGesture();
    void selectControlEdge(std::uint32_t op,std::uint8_t input);
    // CONTROL undo / redo (NODES authoring transactions).
    const ModulationState& controlState() const noexcept { return controlModulation_; }
    bool canUndoControl() const noexcept { return !controlUndo_.empty(); }
    bool canRedoControl() const noexcept { return !controlRedo_.empty(); }
    void selectControlNode(const nodes::ControlNodeKey&);
    void selectControlLink(std::uint32_t route);
    const ControlSelection& controlSelection() const noexcept { return controlSelection_; }
    juce::String controlNodeTitle(const nodes::ControlNodeKey&) const;
    juce::String controlNodeDetail(const nodes::ControlNodeKey&) const;
    // PARAMETER picker: the shared destination catalog. With a source, items
    // that source cannot drive are disabled with the reason.
    std::vector<NativeChoiceItem> parameterPickerItems(std::optional<ModSource>) const;
    std::optional<ModAddress> parameterPickerAddress(int itemId) const;
    void showParameterPicker(juce::Component& anchor,std::optional<ModSource>,std::optional<fx::FxPoint> at);
    class ControlInspector;
    // Selected CONTROL link's shared route controls (inspection / tests).
    juce::Slider& controlAmountSlider() noexcept;
    juce::Button& controlEnabledButton() noexcept;
    juce::Button& controlPolarityButton() noexcept;
    juce::Slider* controlSequenceControl(std::size_t index) noexcept; // N06 SEQUENCER inspector

private:
    class SelectedPanel;
    class ParametersPanel;
    class ModuleParametersPanel;
    class FxMacrosPanel;
    class ConfirmPanel;
    void refresh(bool force=false);
    void refreshToolbar();
    void refreshSidebar(bool includeControl=true);
    void refreshControl();
    nodes::ControlLayout& controlLayout() noexcept { return host_.controlLayout!=nullptr ? *host_.controlLayout : localControlLayout_; }
    void sampleControlMonitor();
    struct ControlSnapshot {
        std::array<ModRoute,ModulationState::capacity> routes{};
        std::uint32_t nextRouteId=1;
        std::array<ControlOperator,ModulationState::maxControlOperators> operators{};
        std::uint32_t nextOperatorId=1;
        nodes::ControlLayout layout;
        std::uint64_t sequence=0;
        // N06: present only for sequence edits, so undoing a NODES edit never
        // rewinds a sequence edited elsewhere (SYNTH > SEQUENCER).
        bool hasSequencer=false;
        SequencerSettings sequencer{};
    };
    ControlSnapshot captureControl(bool withSequencer=false) const;
    struct Clipboard {
        std::vector<ControlOperator> operators;  // original ids (remapped on paste)
        std::vector<juce::Point<float>> offsets; // positions relative to the group's top-left
    };
    Clipboard clipboard_;
    std::vector<nodes::ControlNodeKey> controlMulti_;
    NodePalette palette_;
    juce::String feedback_;
    double feedbackUntil_=0.0;
    class DebugInspector;
    std::unique_ptr<DebugInspector> debugInspector_;
    juce::TextButton autoLayout_{"AUTO LAYOUT"};
    void paintOverChildren(juce::Graphics&) override;
    bool applyControl(const ControlSnapshot&);
    void pushControlUndo(bool withSequencer=false);
    bool commitControl(const ModulationState&); // records undo, then commits atomically
    bool undoControl();
    bool redoControl();
    void placeOperatorBetween(std::uint32_t id,const nodes::ControlNodeKey& from,const nodes::ControlNodeKey& to);
    void storeView();
    void timerCallback() override;
    fx::FxPoint viewCentre() const;

    fx::FxWorkspace& workspace_;
    BusId bus_=mainBusId;
    fx::FxGraphDocument* document_=nullptr;
    ModulationBindings bindings_;
    std::unique_ptr<CompiledModulation> visualPlan_=std::make_unique<CompiledModulation>();
    FxModulationOutput visualFxFrame_{};
    RuntimeVisualizationSnapshot visualRuntime_{};
    std::uint32_t visualRefreshCount_=0;
    PeakSource peaks_;
    std::map<fx::FxNodeId,std::pair<float,float>> inputMeters_; // IN-node ballistics (UI thread)
    HostBindings host_;
    fx::FxViewState* viewState_=nullptr;
    std::vector<std::pair<BusId,juce::String>> busNames_;
    std::map<BusId,std::pair<float,juce::Point<float>>> busViews_;
    std::function<void()> pendingConfirm_;
    juce::String confirmTitle_,confirmBody_,confirmAction_;
    fx::FxNodeId selected_=fx::invalidFxNodeId;
    std::uint64_t lastRevision_=0;
    float meterLeft_=0.0f,meterRight_=0.0f;

    std::array<juce::TextButton,5> modes_;
    juce::TextButton undo_{"UNDO"},redo_{"REDO"},clear_{"CLEAR"},templates_{"TEMPLATES"},add_{"+ ADD MODULE"};
    juce::TextButton zoomOut_{"-"},zoomReset_{"100%"},zoomIn_{"+"},zoomFit_{"FIT"};
    FxSidebar sidebar_;
    FxCanvas canvas_;
    FxGraphView view_;
    std::unique_ptr<SelectedPanel> selectedPanel_;
    std::unique_ptr<ParametersPanel> parametersPanel_;
    std::unique_ptr<ModuleParametersPanel> modulePanel_;
    std::unique_ptr<FxMacrosPanel> macrosPanel_;
    std::unique_ptr<ModulationMatrix> matrix_; // NODES > MATRIX
    std::unique_ptr<ControlInspector> controlInspector_;
    nodes::ControlLayout localControlLayout_; // only when no processor host
    nodes::ControlGraph controlGraph_;
    std::vector<ModulationDestinationEntry> destinationCatalog_;
    std::vector<bool> controlNodeShown_,controlLinkShown_;
    ControlSelection controlSelection_;
    UiDiagnostics uiDiagnostics_{};
    std::uint64_t lastModelRevision_=0,lastSidebarGraphRevision_=0;
    bool modelDirty_=true;
    ModulationState controlModulation_{}; // as of the last refreshControl()
    std::array<std::uint32_t,ModulationState::maxControlOperators> lastEventCounts_{};
    std::array<float,ModulationState::maxControlOperators> eventActivity_{};
    std::vector<ControlSnapshot> controlUndo_,controlRedo_;
    std::uint64_t editSequence_=0;
    std::vector<std::uint64_t> graphSequences_,graphRedoSequences_; // graph edits, in the shared order
    bool operatorGesture_=false,lastUndoWasControl_=false,undoingGraph_=false;
    std::unique_ptr<ConfirmPanel> confirmPanel_;
    FxModalOverlay overlay_;
    bool gestureActive_=false;
};

}
