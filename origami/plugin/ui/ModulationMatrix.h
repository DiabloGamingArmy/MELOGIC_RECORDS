// mct-origami-nodes-n01
// mct-origami-v32.1.1-extended-mod-sources-hotfix
// mct-origami-v32.0.0-dynamic-mod-filter-collections
#pragma once
#include "OrigamiStyle.h"
#include "ModulationBindings.h"
#include <array>
#include <memory>
#include <utility>
#include <vector>
namespace mct::origami::ui {

// Live history of ONE route's normalized control contribution
// (source -> polarity -> amount, before destination mapping), -1..+1.
// Newest value enters on the right. Bounded, allocation-free after creation;
// fed from the UI timer, never from the audio thread.
class ModulationRouteMonitor final : public juce::Component {
public:
    static constexpr std::size_t historyLength=96;
    void push(float contribution,bool active) noexcept;
    void clear() noexcept;
    bool active() const noexcept { return active_; }
    float latest() const noexcept;
    std::size_t size() const noexcept { return count_; }
    void paint(juce::Graphics&) override;
private:
    std::array<float,historyLength> history_{};
    std::size_t head_=0,count_=0;
    bool active_=false;
};

// "WHAT IS MODULATING WHAT?" One view of the canonical ModulationState routes
// (the same routes drag-and-drop and NODES knobs create); it keeps no route
// state of its own. Page layout = the MATRIX page; Sidebar layout = the
// compact NODES > MATRIX tab. Both are this class.
class ModulationMatrix final : public Panel, private juce::Timer {
public:
    enum class Layout { Page, Sidebar };
    explicit ModulationMatrix(ModulationBindings,Layout=Layout::Page);
    ~ModulationMatrix() override;
    void paint(juce::Graphics&) override;
    void resized() override;
    void syncFromModel();

    // Inspection / interaction (tests, owners).
    std::size_t routeCount() const noexcept { return rows_.size(); }
    juce::Component* routeRow(std::size_t index) const noexcept;
    const ModulationRouteMonitor* monitor(std::size_t index) const noexcept;
    // Destination menu state of a route row (disabled = would duplicate a pair).
    bool destinationAvailable(std::size_t index,const ModAddress&) const;
    juce::String destinationReason(std::size_t index,const ModAddress&) const;
    juce::TextButton& addButton() noexcept { return add_; }
    // One monitor tick: read the engine's published source slots and append
    // each route's contribution. Normally driven by the UI timer.
    void sampleMonitors();
    Layout layout() const noexcept { return layout_; }
    static constexpr int pageRowHeight=52;
    static constexpr int sidebarRowHeight=138;
private:
    class Row;
    void timerCallback() override;
    void paintContent(juce::Graphics&,juce::Rectangle<int>) override;
    juce::Rectangle<int> listBounds() const;
    ModulationBindings bindings_;
    Layout layout_;
    juce::Viewport viewport_;
    juce::Component content_;
    juce::TextButton add_{"+ ADD ROUTE"};
    std::vector<std::unique_ptr<Row>> rows_;
    ModulationState modulation_{};
    std::vector<unsigned> moduleIds_;
    std::vector<std::pair<ModAddress,std::uint32_t>> dynamicDestinations_;
    std::uint32_t envMask_=0,lfoMask_=0,generatorMask_=0,macroMask_=0;
    bool filterEnabled_=true;
};
}
