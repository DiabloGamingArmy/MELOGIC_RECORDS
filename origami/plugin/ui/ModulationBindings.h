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
// Any direct route source's label ("LFO 2", "MOD WHEEL", a macro's name).
inline juce::String modulationSourceLabel(const ModulationState& state,ModSource s) {
    using S=ModSource;
    if(const auto* a=findSourceInstance(state,s)) return juce::String(sourceFamilyName(a->family))+" "+juce::String(a->number);
    if(const auto id=macroIdOf(s)) return macroLabel(state,id);
    switch(s) {
        case S::Env1:return "ENV 1"; case S::Env2:return "ENV 2"; case S::Env3:return "ENV 3";
        case S::Lfo1:return "LFO 1"; case S::Lfo2:return "LFO 2"; case S::Lfo3:return "LFO 3"; case S::Lfo4:return "LFO 4";
        case S::Random:return "RANDOM"; case S::Function:return "FUNCTION";
        case S::Chaos:return "CHAOS"; case S::Drift:return "DRIFT"; case S::Sequencer:return "SEQUENCER";
        case S::ModWheel:return "MOD WHEEL"; case S::Velocity:return "VELOCITY"; case S::Keytrack:return "KEYTRACK";
        case S::Aftertouch:return "AFTERTOUCH"; case S::PitchBend:return "PITCH BEND"; case S::NoteGate:return "NOTE GATE";
        default:break;
    }
    return isOperatorSource(s) ? "NODES" : "MODULATOR";
}
}
