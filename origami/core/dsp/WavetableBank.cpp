#include "WavetableBank.h"
#include <algorithm>
#include <cmath>
#include <utility>

namespace mct::origami::dsp {

WavetableBank WavetableBank::builtIns() {
    WavetableBank bank;
    auto basic = Wavetable::builtIns();
    basic.name = "Basic Shapes";
    bank.install(BuiltinWavetableId::BasicShapes, "basic.shapes", std::move(basic));
    return bank;
}

bool WavetableBank::install(WavetableId id, std::string key, Wavetable table) {
    if (id == 0 || key.empty() || !table.valid())
        return false;

    const auto duplicate = std::find_if(entries_.begin(), entries_.end(),
        [&](const WavetableEntry& candidate) {
            return candidate.id == id || candidate.key == key;
        });
    if (duplicate != entries_.end())
        return false;

    entries_.push_back({id, std::move(key), std::move(table)});
    return true;
}

bool WavetableBank::remove(WavetableId id) {
    if (id == 0 || id == BuiltinWavetableId::BasicShapes)
        return false;

    const auto it = std::find_if(entries_.begin(), entries_.end(),
        [&](const WavetableEntry& candidate) { return candidate.id == id; });
    if (it == entries_.end())
        return false;

    entries_.erase(it);
    return true;
}

const Wavetable* WavetableBank::resolve(WavetableId id) const noexcept {
    const auto* item = entry(id);
    return item ? &item->table : nullptr;
}

const Wavetable* WavetableBank::resolve(std::string_view key) const noexcept {
    const auto it = std::find_if(entries_.begin(), entries_.end(),
        [&](const WavetableEntry& candidate) { return candidate.key == key; });
    return it == entries_.end() ? nullptr : &it->table;
}

const WavetableEntry* WavetableBank::entry(WavetableId id) const noexcept {
    const auto it = std::find_if(entries_.begin(), entries_.end(),
        [&](const WavetableEntry& candidate) { return candidate.id == id; });
    return it == entries_.end() ? nullptr : &*it;
}

WavetableSelection WavetableBank::sanitizeSelection(WavetableSelection selection) noexcept {
    if (selection.tableId == 0)
        selection.tableId = BuiltinWavetableId::BasicShapes;
    if (!std::isfinite(selection.position))
        selection.position = 0.0f;
    selection.position = std::clamp(selection.position, 0.0f, 1.0f);
    return selection;
}

} // namespace mct::origami::dsp
