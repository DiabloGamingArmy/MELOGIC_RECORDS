#pragma once
#include "Wavetable.h"
#include <cstdint>
#include <string>
#include <string_view>
#include <vector>

namespace mct::origami::dsp {

using WavetableId = std::uint32_t;

namespace BuiltinWavetableId {
constexpr WavetableId BasicShapes = 1;
}

struct WavetableSelection {
    WavetableId tableId = BuiltinWavetableId::BasicShapes;
    float position = 0.0f;
};

struct WavetableEntry {
    WavetableId id = 0;
    std::string key;
    Wavetable table;
};

class WavetableBank {
public:
    WavetableBank() = default;

    static WavetableBank builtIns();

    bool install(WavetableId id, std::string key, Wavetable table);
    bool remove(WavetableId id);

    const Wavetable* resolve(WavetableId id) const noexcept;
    const Wavetable* resolve(std::string_view key) const noexcept;
    const WavetableEntry* entry(WavetableId id) const noexcept;

    bool contains(WavetableId id) const noexcept { return resolve(id) != nullptr; }
    std::size_t size() const noexcept { return entries_.size(); }
    bool empty() const noexcept { return entries_.empty(); }

    static WavetableSelection sanitizeSelection(WavetableSelection selection) noexcept;

private:
    std::vector<WavetableEntry> entries_;
};

} // namespace mct::origami::dsp
