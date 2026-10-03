// mct-origami-fx-graph-dsp-bus-routing-p02
// mct-origami-fx-page-foundation-p01
#pragma once
#include "OrigamiStyle.h"
#include "ModulationBindings.h"
#include "core/fx/FxGraph.h"
#include <array>
#include <functional>
#include <map>
#include <memory>
#include <optional>
#include <vector>

// FX page: ROUTING TOOLBAR / SOURCE RAIL + ROUTING CANVAS / INSPECTOR.
//
// The canonical FxGraphDocument (owned by the processor, message thread only)
// is the single source of truth. Components refer to nodes by stable ID and
// are reconciled only when the document revision changes; dragging moves the
// component live and commits one undoable model edit on release.
//
// Layering inside the canvas: grid -> connections -> routing points (all
// painted by the canvas) -> node components (children; the active node is
// brought to the front). Z-order is UI-only and never affects DSP order.
namespace mct::origami::ui {

class FxCanvas;
class FxPage;

class FxNodeComponent final : public juce::Component {
public:
    FxNodeComponent(FxPage&,fx::FxNodeId);
    ~FxNodeComponent() override;
    fx::FxNodeId id() const noexcept { return id_; }
    void update(const fx::FxNode&,bool selected);
    void setMeter(float left,float right);
    // Port centre in this component's coordinates.
    juce::Point<float> portCentre(bool input,std::uint8_t port) const noexcept;
    std::optional<std::pair<bool,std::uint8_t>> portAt(juce::Point<float>) const noexcept;
    static juce::Rectangle<int> sizeFor(const fx::FxNode&) noexcept;
    static constexpr float portRadius=5.0f;
    static constexpr float portHitRadius=14.0f;

    void paint(juce::Graphics&) override;
    void resized() override;
    void mouseDown(const juce::MouseEvent&) override;
    void mouseDrag(const juce::MouseEvent&) override;
    void mouseUp(const juce::MouseEvent&) override;
private:
    void showMenu();
    FxPage& page_;
    fx::FxNodeId id_;
    fx::FxNode node_;
    bool selected_=false;
    float meterLeft_=0.0f,meterRight_=0.0f;
    juce::TextButton power_{"PWR"},menu_{"..."},remove_{"X"};
    std::vector<std::unique_ptr<juce::Slider>> quick_;
    std::vector<fx::FxParameterId> quickIds_;
    enum class Drag { None,Move,Wire };
    Drag drag_=Drag::None;
    juce::Point<int> dragOrigin_;
    std::uint8_t wirePort_=0;
};

class FxCanvas final : public juce::Component {
public:
    static constexpr float wireHitRadius=10.0f;   // invisible interaction corridor
    static constexpr float pointHitRadius=9.0f;
    explicit FxCanvas(FxPage&);
    void rebuild(const fx::FxGraph&,fx::FxNodeId selected,int minWidth,int minHeight);
    FxNodeComponent* nodeComponent(fx::FxNodeId) const noexcept;
    std::size_t nodeComponentCount() const noexcept { return nodes_.size(); }
    std::size_t connectionPathCount() const noexcept { return wires_.size(); }
    // Node components in paint order (back to front).
    std::vector<fx::FxNodeId> nodeZOrder() const;
    void bringToFront(fx::FxNodeId);
    // Canvas pixels -> graph canvas units (identity today; zoom-ready).
    fx::FxPoint toGraph(juce::Point<float>) const noexcept;
    std::optional<fx::FxConnectionId> connectionAt(juce::Point<float>) const noexcept;
    std::optional<std::pair<fx::FxConnectionId,std::size_t>> layoutPointAt(juce::Point<float>) const noexcept;
    // Index at which a new routing point at p keeps the points in path order.
    std::size_t layoutInsertIndex(fx::FxConnectionId,juce::Point<float>) const noexcept;
    // Live drag support: recompute only wires touching this node.
    void nodeMoved(fx::FxNodeId);
    void beginWire(fx::FxNodeId,std::uint8_t port);
    void dragWire(juce::Point<int> canvasPoint);
    void endWire(juce::Point<int> canvasPoint);

    void paint(juce::Graphics&) override;
    void mouseDown(const juce::MouseEvent&) override;
    void mouseDrag(const juce::MouseEvent&) override;
    void mouseUp(const juce::MouseEvent&) override;
    void mouseMove(const juce::MouseEvent&) override;
    void mouseExit(const juce::MouseEvent&) override;
    void mouseDoubleClick(const juce::MouseEvent&) override;
private:
    struct Wire {
        fx::FxConnection connection;
        std::vector<juce::Point<float>> handles; // layout points (canvas px)
        juce::Path path;
        juce::Rectangle<int> area;
    };
    juce::Point<float> portInCanvas(fx::FxNodeId,bool input,std::uint8_t port) const noexcept;
    void computeWire(Wire&) const;
    void repaintWire(const Wire&);
    static juce::Path curve(juce::Point<float>,juce::Point<float>);
    static juce::Path curveThrough(const std::vector<juce::Point<float>>&);
    FxPage& page_;
    std::map<fx::FxNodeId,std::unique_ptr<FxNodeComponent>> nodes_;
    std::vector<Wire> wires_;
    juce::TextButton addGhost_{"+ ADD EFFECT"};
    bool wireActive_=false;
    fx::FxPortRef wireFrom_{};
    juce::Point<float> wireEnd_{};
    juce::Point<int> panOrigin_;
    bool panning_=false;
    std::optional<std::pair<fx::FxConnectionId,std::size_t>> hoverPoint_,dragPoint_;
};

// Dynamic source list: the instrument's named audio buses, then concept-level
// sources. Control sources are listed separately and are never routable audio.
class FxSourceRail final : public juce::Component {
public:
    struct Entry { BusId bus=0; juce::String label; bool inGraph=false; };
    void setBuses(std::vector<Entry>);
    std::function<void(BusId)> onBusClicked;
    void paint(juce::Graphics&) override;
    void mouseDown(const juce::MouseEvent&) override;
    static constexpr int rowHeight=32;
private:
    juce::Rectangle<int> rowBounds(std::size_t index) const noexcept;
    std::vector<Entry> buses_;
};

class FxPage final : public juce::Component, private juce::Timer {
public:
    using PeakSource=std::function<std::pair<float,float>()>;
    FxPage(fx::FxGraphDocument&,ModulationBindings,PeakSource peaks={});
    ~FxPage() override;
    void resized() override;
    void paint(juce::Graphics&) override;
    bool keyPressed(const juce::KeyPress&) override;
    void visibilityChanged() override;
    // Cheap when nothing changed: compares the document revision first.
    void syncFromModel();

    // Interaction API (used by node components, canvas, toolbar, inspector, tests).
    fx::FxGraphDocument& document() noexcept { return document_; }
    const fx::FxGraph& graph() const noexcept { return document_.graph(); }
    fx::FxNodeId selectedNode() const noexcept { return selected_; }
    void selectNode(fx::FxNodeId);
    bool deleteNode(fx::FxNodeId);
    fx::FxNodeId addEffect(fx::FxEffectType);
    fx::FxNodeId addEffectAt(fx::FxEffectType,fx::FxPoint);
    fx::FxNodeId insertEffectOnConnection(fx::FxConnectionId,fx::FxEffectType,fx::FxPoint);
    bool addLayoutPoint(fx::FxConnectionId,fx::FxPoint);
    bool moveLayoutPoint(fx::FxConnectionId,std::size_t,fx::FxPoint,bool live);
    bool removeLayoutPoint(fx::FxConnectionId,std::size_t);
    void setRoutingMode(fx::FxRoutingMode);
    void clearGraph();
    void undo();
    void redo();
    void commitMove(fx::FxNodeId,juce::Point<int> topLeft);
    bool connectPorts(fx::FxPortRef from,fx::FxPortRef to);
    void disconnectPort(fx::FxNodeId,bool input,std::uint8_t port);
    void setNodeEnabled(fx::FxNodeId,bool);
    void beginParameterGesture();
    void setParameter(fx::FxNodeId,fx::FxParameterId,float);
    void setGlobals(const fx::FxGlobalSettings&);
    void endParameterGesture();
    // One effect menu (the native catalog menu) for every add/insert gesture.
    void showAddEffectMenu(juce::Component& anchor,std::function<void(fx::FxEffectType)> chosen={});
    void showTemplatesMenu(juce::Component& anchor);
    FxCanvas& canvas() noexcept { return canvas_; }
    FxSourceRail& sourceRail() noexcept { return rail_; }
    juce::Viewport& viewport() noexcept { return viewport_; }
    juce::String inspectorHeadline() const;
    juce::String parameterTabName() const;
    void selectParameterTab(int);
    std::pair<float,float> meterLevels() const noexcept { return {meterLeft_,meterRight_}; }
    void updateMeters(); // pulls peak telemetry; repaints only MASTER OUT

private:
    class SelectedPanel;
    class ParametersPanel;
    class FxMacrosPanel;
    class GlobalFxPanel;
    void refresh(bool force=false);
    void refreshToolbar();
    void refreshRail();
    void timerCallback() override { updateMeters(); }

    fx::FxGraphDocument& document_;
    ModulationBindings bindings_;
    PeakSource peaks_;
    fx::FxNodeId selected_=fx::invalidFxNodeId;
    std::uint64_t lastRevision_=0;
    float meterLeft_=0.0f,meterRight_=0.0f;

    std::array<juce::TextButton,5> modes_;
    juce::TextButton undo_{"UNDO"},redo_{"REDO"},clear_{"CLEAR"},templates_{"TEMPLATES"},add_{"+ ADD EFFECT"};
    FxSourceRail rail_;
    juce::Viewport viewport_;
    FxCanvas canvas_;
    std::unique_ptr<SelectedPanel> selectedPanel_;
    std::unique_ptr<ParametersPanel> parametersPanel_;
    std::unique_ptr<FxMacrosPanel> macrosPanel_;
    std::unique_ptr<GlobalFxPanel> globalPanel_;
    bool gestureActive_=false;
};

}
