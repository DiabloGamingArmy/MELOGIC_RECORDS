// mct-origami-modulation-row-consistency
#pragma once
#include "OrigamiStyle.h"
#include "SourceEntity.h"
#include "core/InstrumentState.h"
#include <functional>
#include <vector>

// The one modulation-source entity of Origami: the SYNTH MODULATORS card
// (title, six-dot grip, per-route magnitude rings). SYNTH and FX both host
// these rows inside their own scroll areas; neither keeps a private copy of
// the routes. Each row's height follows the number of routes it shows, and
// setRoutes() reports when that height changes so the owner can lay out again.
namespace mct::origami::ui {

struct ModulationSourceRoute { std::uint32_t id=0; float amount=0.0f; };

// Every enabled route from `source`, in canonical (Matrix) order. SYNTH and FX
// rows are fed from this one derivation of the same ModulationState.
std::vector<ModulationSourceRoute> modulationSourceRoutes(const ModulationState&,ModSource);
// Destination label for a route ("OSC 1 / LEVEL", "FILTER / CUTOFF", ...).
juce::String modulationRouteTargetLabel(const InstrumentState&,std::uint32_t routeId);
// Origami-native hover label, painted by the row's owner so it is not
// clipped to the row.
void paintModulationRouteTooltip(juce::Graphics&,const juce::String& label,
                                 juce::Point<float> at,juce::Rectangle<float> bounds);

class ModulationSourceRow final : public SourceEntityButton {
public:
    static constexpr int baseHeight=SourceEntityButton::baseHeight;
    static constexpr int routedHeight=54;
    static constexpr std::size_t maxRings=6;
    static int heightFor(std::size_t routeCount) noexcept { return routeCount==0 ? baseHeight : routedHeight; }

    ModulationSourceRow(ModSource,const juce::String& title,const juce::String& componentName);

    void setSource(ModSource s) noexcept { source_=s; }
    ModSource source() const noexcept { return source_; }
    // Returns true when the row's preferred height changed.
    bool setRoutes(std::vector<ModulationSourceRoute>);
    const std::vector<ModulationSourceRoute>& routes() const noexcept { return routes_; }
    int preferredHeight() const noexcept { return heightFor(routes_.size()); }

    juce::Rectangle<float> ringBounds(std::size_t index) const noexcept;
    std::size_t visibleRings() const noexcept;
    std::uint32_t routeAt(juce::Point<float>) const noexcept;
    std::uint32_t hoveredRoute() const noexcept { return hoverRoute_; }
    juce::Point<float> hoverPoint() const noexcept { return hoverPoint_; }

    // Wiring supplied by the owning view; all of it edits the canonical model.
    std::function<void(std::uint32_t,float)> onRouteAmount;
    std::function<void(std::uint32_t)> onRouteRemove;
    std::function<void()> onHoverChanged;
    std::function<void()> onPressed; // any mouse-down on the row

    void paintButton(juce::Graphics&,bool over,bool down) override;
    void mouseDown(const juce::MouseEvent&) override;
    void mouseDrag(const juce::MouseEvent&) override;
    void mouseUp(const juce::MouseEvent&) override;
    void mouseDoubleClick(const juce::MouseEvent&) override;
    void mouseMove(const juce::MouseEvent&) override;
    void mouseExit(const juce::MouseEvent&) override;

private:
    void setHover(std::uint32_t,juce::Point<float>);
    ModSource source_;
    std::vector<ModulationSourceRoute> routes_;
    std::uint32_t ringDrag_=0,hoverRoute_=0;
    float ringStartY_=0.0f,ringStartAmount_=0.0f;
    juce::Point<float> hoverPoint_{};
    bool sourceDragStarted_=false;
};

}
