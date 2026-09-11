// mct-origami-v28.1.0-trace-type-visibility-repair
// mct-origami-v28.1.0-env-hold-live-tracer
// mct-origami-modulation-completion-v24.0.1
#pragma once
#include "core/InstrumentState.h"
#include "core/Voice.h"
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
    std::function<bool(const ModulationState&)> modulation;
    std::function<EnvelopeTraceSnapshot()> envelopeTrace;
};
}
