// mct-origami-nodes-n03-control
#include "ModulationDestinations.h"

namespace mct::origami::ui {

std::vector<ModulationDestinationEntry> modulationDestinationCatalog(const InstrumentState& state,const ModulationBindings& bindings) {
    std::vector<ModulationDestinationEntry> out;
    auto add=[&](const juce::String& group,ModAddress address,const juce::String& label,bool separator=false) {
        out.push_back({group,label,address,separator});
    };

    add("Global",{ModDestination::MainTuning,0},"MAIN TUNING");
    add("Global",{ModDestination::MasterGain,0},"AMP");
    add("Global",{ModDestination::Transpose,0},"TRANSPOSE");
    add("Global",{ModDestination::Swing,0},"SWING");
    add("Global",{ModDestination::PortaTime,0},"PORTA TIME");
    add("Global",{ModDestination::EnvelopeScaling,0},"ENVELOPE SCALING");
    add("Global",{ModDestination::LfoScaling,0},"LFO SCALING");
    if(state.modulation.filterEnabled) {
        add("Filter",{ModDestination::Cutoff,0},"CUTOFF");
        add("Filter",{ModDestination::Resonance,0},"RESONANCE");
    }

    struct OscDestinationSpec { ModDestination destination; const char* label; };
    static constexpr OscDestinationSpec oscillatorDestinations[] {
        {ModDestination::WtPosition,"WT POS"},
        {ModDestination::Octave,"OCT"},
        {ModDestination::Semitone,"SEM"},
        {ModDestination::Fine,"FIN"},
        {ModDestination::Detune,"DETUNE"},
        {ModDestination::Pan,"PAN"},
        {ModDestination::Level,"LEVEL"}
    };

    unsigned oscillatorOrdinal=0;
    for(const auto& m:state.oscillators) if(m.id) {
        ++oscillatorOrdinal;
        const auto group="OSC "+juce::String(oscillatorOrdinal);
        for(const auto& spec:oscillatorDestinations)
            add(group,{spec.destination,m.id},spec.label);
        bool separator=m.processCount || m.routeCount;
        for(std::size_t i=0;i<m.processCount;++i) if(m.processes[i].id) {
            const auto& process=m.processes[i];
            unsigned duplicates=0;
            for(std::size_t j=0;j<m.processCount;++j)
                duplicates+=m.processes[j].id && m.processes[j].type==process.type;
            juce::String label="[OC] "+juce::String(dsp::oscProcessName(process.type));
            if(duplicates>1) label+=" #"+juce::String(process.id);
            add(group,{ModDestination::ProcessAmount,m.id,process.id},label,separator);
            separator=false;
        }
        for(std::size_t i=0;i<m.routeCount;++i) if(m.routes[i].id) {
            add(group,{ModDestination::RouteAmount,m.id,m.routes[i].id},
                "[OC] "+juce::String(oscRouteName(m.routes[i].type))+" #"+juce::String(m.routes[i].id),separator);
            separator=false;
        }
    }
    if(bindings.fxDestinations)
        for(const auto& fx:bindings.fxDestinations()) add(juce::String(fx.group),fx.address,juce::String(fx.label));
    return out;
}

juce::String modulationDestinationLabel(const std::vector<ModulationDestinationEntry>& catalog,const ModAddress& address) {
    for(const auto& e:catalog) if(e.address==address) return e.group.toUpperCase()+juce::String(juce::CharPointer_UTF8(" \xc2\xb7 "))+e.label;
    return {};
}

}
