// mct-origami-unified-routing-core-fx-p04
// mct-origami-fx-modulation-graph-ux-p03
// mct-origami-fx-graph-dsp-bus-routing-p02
// mct-origami-fx-page-foundation-p01
#pragma once
#include "OrigamiStyle.h"
#include "ModulationBindings.h"
#include "NativeChoiceMenu.h"
#include "core/fx/FxGraph.h"
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
    static std::optional<fx::FxModuleSpec> decode(int id);
};

class FxNodeComponent final : public juce::Component {
public:
    FxNodeComponent(FxPage&,fx::FxNodeId);
    ~FxNodeComponent() override;
    fx::FxNodeId id() const noexcept { return id_; }
    void update(const fx::FxNode&,bool selected);
    void setMeter(float left,float right);
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
    bool selected_=false;
    float meterLeft_=0.0f,meterRight_=0.0f;
    juce::TextButton power_{"PWR"},menu_{"..."},remove_{"X"};
    juce::TextButton accessory_{"+ ADD MODULE"}; // MASTER OUT only: moves with the node
    std::vector<std::unique_ptr<juce::Slider>> quick_;
    std::vector<fx::FxParameterId> quickIds_;
    enum class Drag { None,Move,Wire };
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
    static constexpr float minZoom=0.4f,maxZoom=2.5f;
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

// Resource browser: SOURCES / MODULATORS / FILTERS / BUSES. Every row is a
// reference to a canonical Origami object, never a duplicate of it, painted
// with the shared source-entity vocabulary (SourceEntity.h).
class FxSidebar final : public juce::Component {
public:
    enum class Tab { Sources=0,Modulators=1,Filters=2,Buses=3 };
    struct Magnitude { std::uint32_t routeId=0; float amount=0.0f; };
    struct Row {
        juce::String label,badge,detail;
        juce::String dragDescription; // empty: not draggable
        bool enabled=true,active=false,header=false;
        std::function<void()> onClick;
        std::function<void()> onSecondaryClick; // right-click
        std::vector<Magnitude> magnitudes;       // canonical route amounts (rings)
        std::function<void(std::uint32_t,float)> onMagnitude; // drag a ring
    };
    FxSidebar();
    ~FxSidebar() override;
    void setTab(Tab);
    Tab tab() const noexcept { return tab_; }
    void setRows(Tab,std::vector<Row>);
    const std::vector<Row>& rows(Tab t) const noexcept { return rows_[static_cast<std::size_t>(t)]; }
    std::function<void(Tab)> onTabChanged;
    void paint(juce::Graphics&) override;
    void resized() override;
    static constexpr int rowHeight=36;
    static constexpr int width=236;
private:
    class List;
    Tab tab_=Tab::Sources;
    std::array<juce::TextButton,4> tabs_;
    std::array<std::vector<Row>,4> rows_;
    std::array<juce::String,4> signatures_;
    juce::Viewport viewport_;
    std::unique_ptr<List> list_;
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
    void syncFromModel();
    std::function<void()> onOpenSynthFilter;

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
    void showModuleMenu(juce::Component& anchor,bool allowSources,std::function<void(fx::FxModuleSpec)> chosen);
    void showAddEffectMenu(juce::Component& anchor) { showModuleMenu(anchor,true,[this](fx::FxModuleSpec s){addModule(s);}); }
    std::vector<NativeChoiceItem> moduleMenuItems(bool allowSources) const;
    std::vector<int> moduleMenuIds(bool allowSources) const;
    void showTemplatesMenu(juce::Component& anchor);
    FxCanvas& canvas() noexcept { return canvas_; }
    FxGraphView& graphView() noexcept { return view_; }
    FxSidebar& sidebar() noexcept { return sidebar_; }
    float graphZoom() const noexcept { return view_.zoom(); }
    juce::String inspectorHeadline() const;
    juce::String parameterTabName() const;
    void selectParameterTab(int);
    std::size_t modulationRowCount() const;
    std::pair<float,float> meterLevels() const noexcept { return {meterLeft_,meterRight_}; }
    void updateMeters();
    void zoomIn();
    void zoomOut();
    void zoomReset();
    void zoomToFit();

private:
    class SelectedPanel;
    class ParametersPanel;
    class FxMacrosPanel;
    class ConfirmPanel;
    void refresh(bool force=false);
    void refreshToolbar();
    void refreshSidebar();
    void storeView();
    void timerCallback() override { updateMeters(); }
    fx::FxPoint viewCentre() const;

    fx::FxWorkspace& workspace_;
    BusId bus_=mainBusId;
    fx::FxGraphDocument* document_=nullptr;
    ModulationBindings bindings_;
    PeakSource peaks_;
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
    std::unique_ptr<FxMacrosPanel> macrosPanel_;
    std::unique_ptr<ConfirmPanel> confirmPanel_;
    FxModalOverlay overlay_;
    bool gestureActive_=false;
};

}
