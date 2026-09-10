#pragma once
#include "core/InstrumentState.h"
#include <functional>
namespace mct::origami::ui {
// UI commands mutate only their own model field under the processor's writer lock.
struct ModulationBindings {
    std::function<InstrumentState()> snapshot;
    std::function<bool(unsigned,float)> macro;
    std::function<bool(const LfoSettings&)> lfo;
    std::function<unsigned()> addRoute;
    std::function<bool(const ModRoute&)> route;
    std::function<bool(unsigned)> removeRoute;
};
}
