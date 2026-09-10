#include "core/dsp/WavetableBank.h"
#include <cmath>
#include <iostream>

using namespace mct::origami::dsp;

namespace {
int failures = 0;

void expect(bool condition, const char* message) {
    if (!condition) {
        ++failures;
        std::cerr << "FAIL: " << message << '\n';
    }
}
}

int main() {
    auto bank = WavetableBank::builtIns();

    expect(bank.size() == 1, "built-in bank contains one canonical table");
    expect(bank.contains(BuiltinWavetableId::BasicShapes), "Basic Shapes stable ID resolves");

    const auto* byId = bank.resolve(BuiltinWavetableId::BasicShapes);
    const auto* byKey = bank.resolve("basic.shapes");
    expect(byId != nullptr, "resolve by stable ID");
    expect(byKey == byId, "resolve by key returns same table");
    expect(byId && byId->valid(), "built-in table is valid");
    expect(byId && byId->frames.size() == 4, "Basic Shapes preserves four existing frames");

    auto low = WavetableBank::sanitizeSelection({BuiltinWavetableId::BasicShapes, -5.0f});
    auto high = WavetableBank::sanitizeSelection({BuiltinWavetableId::BasicShapes, 5.0f});
    auto nan = WavetableBank::sanitizeSelection({0, std::nanf("")});
    expect(low.position == 0.0f, "WT position clamps low");
    expect(high.position == 1.0f, "WT position clamps high");
    expect(nan.tableId == BuiltinWavetableId::BasicShapes, "zero table ID normalizes to built-in");
    expect(nan.position == 0.0f, "non-finite WT position normalizes to zero");

    Wavetable invalid;
    expect(!bank.install(2, "invalid", std::move(invalid)), "invalid table rejected");

    auto second = Wavetable::builtIns();
    second.name = "Test Clone";
    expect(bank.install(2, "test.clone", std::move(second)), "valid secondary table installs");
    expect(bank.size() == 2, "secondary table increments catalog");
    expect(!bank.install(2, "duplicate.id", Wavetable::builtIns()), "duplicate stable ID rejected");
    expect(!bank.install(3, "test.clone", Wavetable::builtIns()), "duplicate stable key rejected");
    expect(!bank.remove(BuiltinWavetableId::BasicShapes), "canonical built-in cannot be removed");
    expect(bank.remove(2), "secondary table can be removed");
    expect(bank.size() == 1, "secondary removal updates catalog");

    WavetableOscillator oscillator;
    const auto* table = bank.resolve(BuiltinWavetableId::BasicShapes);
    expect(table != nullptr, "table available for oscillator");
    if (table) {
        oscillator.reset(0.123);
        const float a = oscillator.next(*table, 220.0, 48000.0, 0.0f);
        oscillator.reset(0.123);
        const float b = oscillator.next(*table, 220.0, 48000.0, 1.0f);
        expect(std::isfinite(a) && std::isfinite(b), "endpoint renders finite");
        expect(std::abs(a-b) > 1.0e-5f, "WT position changes rendered frame");
    }

    if (failures) {
        std::cerr << failures << " wavetable-bank checks failed\n";
        return 1;
    }

    std::cout << "PASS: V22.0 wavetable-bank foundation\n";
    return 0;
}
