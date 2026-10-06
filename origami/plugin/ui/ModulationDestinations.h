// mct-origami-nodes-n03-control
#pragma once
#include "ModulationBindings.h"
#include <JuceHeader.h>
#include <vector>

// The one catalog of modulation destinations offered by the UI. The Matrix
// destination menu and the NODES PARAMETER picker are both built from it, so
// labels, grouping and availability can never drift apart.
namespace mct::origami::ui {

struct ModulationDestinationEntry {
    juce::String group;   // "Global", "Filter", "OSC 1", "NODES / MAIN / DELAY 4"
    juce::String label;   // "CUTOFF", "LEVEL", "TIME"
    ModAddress address;
    bool separatorBefore=false; // visual break inside its group (OSC processes)
};

std::vector<ModulationDestinationEntry> modulationDestinationCatalog(const InstrumentState&,const ModulationBindings&);
// "OSC 1 · LEVEL"; empty when the address is not in the catalog.
juce::String modulationDestinationLabel(const std::vector<ModulationDestinationEntry>&,const ModAddress&);
// mct-origami-nested-modulation-manual-qa: the catalog group of the nested
// destinations (LFO RATE, MACRO, route DEPTH). NODES keeps its own picker.
inline const juce::String nestedDestinationGroup{"Modulation"};
// Human-readable target / route names, nested routes resolved recursively:
// "OSC 2 LEVEL", "LFO 2 RATE", "[LFO 2 → OSC 2 LEVEL] DEPTH",
// "LFO 3 → [LFO 2 → OSC 2 LEVEL] DEPTH".
juce::String modulationAddressLabel(const std::vector<ModulationDestinationEntry>&,const ModulationState&,const ModAddress&,int depth=0);
juce::String modulationRouteLabel(const std::vector<ModulationDestinationEntry>&,const ModulationState&,const ModRoute&,int depth=0);

}
