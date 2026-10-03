// mct-origami-unified-routing-core-fx-p04
#pragma once
#include "core/fx/FxGraph.h"
#include <functional>
#include <memory>
#include <utility>
#include <vector>

// The FX state of the instrument: one canonical, persistent processing graph
// per audio bus (MAIN always exists) plus the GLOBAL FX settings that act on
// the final summed master. Bus FX and Global FX are deliberately separate.
// Message thread only; the audio thread sees compiled plans (FxEnvironment).
namespace mct::origami::fx {

class FxWorkspace {
public:
    FxWorkspace();
    FxWorkspace(const FxWorkspace&)=delete;
    FxWorkspace& operator=(const FxWorkspace&)=delete;

    // Returns the bus's graph document, creating the neutral graph if new.
    FxGraphDocument& document(FxBusId);
    FxGraphDocument* find(FxBusId) noexcept;
    const FxGraphDocument* find(FxBusId) const noexcept;
    bool contains(FxBusId bus) const noexcept { return find(bus)!=nullptr; }
    // MAIN cannot be removed. Returns false when nothing was removed.
    bool removeBus(FxBusId);
    std::vector<FxBusId> buses() const;

    const FxGlobalSettings& globals() const noexcept { return globals_; }
    void setGlobals(const FxGlobalSettings&);

    // Fired after any document edit or globals change.
    std::function<void()> onChanged;

    std::vector<std::uint8_t> encode() const;
    // Strict, all-or-nothing: on failure the workspace is unchanged.
    bool decode(const void*,std::size_t);
    // P02/P03 states carried a single (MAIN) graph whose globals were the
    // instrument's Global FX. Adopt it as MAIN and lift its globals out.
    void adoptLegacyMainGraph(FxGraph);
    void reset(); // MAIN only, neutral graph, default globals

private:
    FxGraphDocument& add(FxBusId,FxGraph);
    std::vector<std::pair<FxBusId,std::unique_ptr<FxGraphDocument>>> documents_;
    FxGlobalSettings globals_{};
};

}
