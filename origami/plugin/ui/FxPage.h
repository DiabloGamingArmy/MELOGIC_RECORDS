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

// FX page: ROUTING TOOLBAR / ROUTING CANVAS / INSPECTOR.
//
// The canonical FxGraphDocument (owned by the processor, message thread only)
// is the single source of truth. Components refer to nodes by stable ID and
// are reconciled only when the document revision changes; dragging moves the
// component live and commits one undoable model edit on release.
namespace mct::origami::ui {

class FxCanvas;
class FxPage;

class FxNodeComponent final : public juce::Component {
public:
    FxNodeComponent(FxPage&,fx::FxNodeId);
    ~FxNodeComponent() override;
    fx::FxNodeId id() const noexcept { return id_; }
    void update(const fx::FxNode&,bool selected);
    // Port centre in this component's coordinates.
    juce::Point<float> portCentre(bool input,std::uint8_t port) const noexcept;
    std::optional<std::pair<bool,std::uint8_t>> portAt(juce::Point<float>) const noexcept;
    static juce::Rectangle<int> sizeFor(const fx::FxNode&) noexcept;

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
    explicit FxCanvas(FxPage&);
    void rebuild(const fx::FxGraph&,fx::FxNodeId selected,int minWidth,int minHeight);
    FxNodeComponent* nodeComponent(fx::FxNodeId) const noexcept;
    std::size_t nodeComponentCount() const noexcept { return nodes_.size(); }
    std::size_t connectionPathCount() const noexcept { return wires_.size(); }
    // Live drag support: recompute only wires touching this node.
    void nodeMoved(fx::FxNodeId);
    void beginWire(fx::FxNodeId,std::uint8_t port);
    void dragWire(juce::Point<int> canvasPoint);
    void endWire(juce::Point<int> canvasPoint);

    void paint(juce::Graphics&) override;
    void mouseDown(const juce::MouseEvent&) override;
    void mouseDrag(const juce::MouseEvent&) override;
private:
    struct Wire { fx::FxConnection connection; juce::Path path; juce::Rectangle<int> area; };
    juce::Point<float> portInCanvas(fx::FxNodeId,bool input,std::uint8_t port) const noexcept;
    void computeWire(Wire&) const;
    static juce::Path curve(juce::Point<float>,juce::Point<float>);
    FxPage& page_;
    std::map<fx::FxNodeId,std::unique_ptr<FxNodeComponent>> nodes_;
    std::vector<Wire> wires_;
    juce::TextButton addGhost_{"+ ADD EFFECT"};
    bool wireActive_=false;
    fx::FxPortRef wireFrom_{};
    juce::Point<float> wireEnd_{};
    juce::Point<int> panOrigin_;
};

class FxSourceRail final : public juce::Component {
public:
    void paint(juce::Graphics&) override;
};

class FxPage final : public juce::Component {
public:
    FxPage(fx::FxGraphDocument&,ModulationBindings);
    ~FxPage() override;
    void resized() override;
    void paint(juce::Graphics&) override;
    bool keyPressed(const juce::KeyPress&) override;
    // Cheap when nothing changed: compares the document revision first.
    void syncFromModel();

    // Interaction API (used by node components, toolbar, inspector, tests).
    fx::FxGraphDocument& document() noexcept { return document_; }
    const fx::FxGraph& graph() const noexcept { return document_.graph(); }
    fx::FxNodeId selectedNode() const noexcept { return selected_; }
    void selectNode(fx::FxNodeId);
    bool deleteNode(fx::FxNodeId);
    fx::FxNodeId addEffect(fx::FxEffectType);
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
    void showAddEffectMenu(juce::Component& anchor);
    void showTemplatesMenu(juce::Component& anchor);
    FxCanvas& canvas() noexcept { return canvas_; }
    juce::Viewport& viewport() noexcept { return viewport_; }
    juce::String inspectorHeadline() const;
    juce::String parameterTabName() const;
    void selectParameterTab(int);

private:
    class SelectedPanel;
    class ParametersPanel;
    class FxMacrosPanel;
    class GlobalFxPanel;
    void refresh(bool force=false);
    void refreshToolbar();

    fx::FxGraphDocument& document_;
    ModulationBindings bindings_;
    fx::FxNodeId selected_=fx::invalidFxNodeId;
    std::uint64_t lastRevision_=0;

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
