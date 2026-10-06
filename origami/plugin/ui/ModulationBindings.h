// mct-origami-v30.1.0-env-sync-native-menus-retrigger
// mct-origami-v28.1.0-trace-type-visibility-repair
// mct-origami-v28.1.0-env-hold-live-tracer
// mct-origami-modulation-completion-v24.0.1
#pragma once
#include "core/InstrumentState.h"
#include "core/Voice.h"
#include "core/Engine.h"
#include <JuceHeader.h>
#include <functional>
#include <string>
#include <vector>
namespace mct::origami::ui {
// mct-origami-fx-modulation-graph-ux-p03: an FX graph parameter exposed as a
// destination of the one canonical modulation system.
struct FxModulationDestination {
    ModAddress address;
    std::string group; // e.g. "FX / DELAY 4"
    std::string label; // e.g. "TIME"
};
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
    std::function<PerformanceInputSnapshot()> performanceInput;
    std::function<double()> hostBpm;
    std::function<RuntimeVisualizationSnapshot()> visualization;
    std::function<std::uint32_t()> visualizationMask;
    std::function<std::vector<FxModulationDestination>()> fxDestinations;
    // N07: the UI model revision (changes whenever the canonical state does).
    std::function<std::uint64_t()> modelRevision;
    // N07: the engine's NODES diagnostics counters (compiles, updates, skips...).
    std::function<OrigamiEngine::NodesDiagnostics()> nodesDiagnostics;
    // mct-origami-nested-modulation-manual-qa: a macro knob drag is one DAW
    // gesture (index = stable id - 1; true = begin, false = end), and macro
    // renaming (empty = the default name).
    std::function<void(unsigned,bool)> macroGesture;
    std::function<bool(unsigned,const juce::String&)> macroName;
};
// The macro's label everywhere (SYNTH, Matrix, NODES): its custom name or
// "MACRO n". Stable id, never a position.
inline juce::String macroLabel(const ModulationState& state,std::size_t id) {
    if(id>=1 && id<=maxMacros && state.macroNames[id-1][0]!='\0') return juce::String(state.macroNames[id-1].data()).toUpperCase();
    return "MACRO "+juce::String(int(id));
}
}
