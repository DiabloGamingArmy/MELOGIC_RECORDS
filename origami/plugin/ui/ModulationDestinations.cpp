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

    for(const auto& f:state.modulation.synthFilters.filters) if(f.id) {
        const auto group="SYNTH FILTER "+juce::String(f.id);
        const char* names[]{"CUTOFF","RESONANCE","DRIVE","MIX","KEYTRACK"};
        for(std::uint32_t i=0;i<5;++i) add(group,{static_cast<ModDestination>(401+i),0,f.id},names[i]);
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

    // mct-origami-nested-modulation-manual-qa: modulation of modulation. An
    // LFO's canonical rate, a macro's effective value and the depth of every
    // complete route, all by stable identity ("LFO 2 -> OSC 2 LEVEL / DEPTH").
    const auto& mod=state.modulation;
    const std::size_t plain=out.size();
    for(std::size_t i=0;i<4;++i)
        if(mod.lfoActiveMask&(1u<<i)) add(nestedDestinationGroup,lfoRateAddress(i),"LFO "+juce::String(int(i+1))+" RATE",i==0);
    for(const auto& a:mod.instances) if(a.id && a.family==SourceFamily::Lfo) add(nestedDestinationGroup,{ModDestination::LfoRate,0,static_cast<std::uint32_t>(instanceSource(a.id))},modulationSourceLabel(mod,instanceSource(a.id))+" RATE");
    for(const auto macro:activeMacroSources(mod)) add(nestedDestinationGroup,macroValueAddress(macroIdOf(macro)),macroLabel(mod,macroIdOf(macro)));
    bool first=true;
    const std::vector<ModulationDestinationEntry> known(out.begin(),out.begin()+std::ptrdiff_t(plain));
    for(const auto& route:mod.routes) if(route.id && routeComplete(route)) {
        add(nestedDestinationGroup,routeDepthAddress(route.id),modulationRouteLabel(known,mod,route)+" / DEPTH",first);
        first=false;
    }
    return out;
}

juce::String modulationDestinationLabel(const std::vector<ModulationDestinationEntry>& catalog,const ModAddress& address) {
    for(const auto& e:catalog) if(e.address==address) return e.group.toUpperCase()+juce::String(juce::CharPointer_UTF8(" \xc2\xb7 "))+e.label;
    return {};
}

juce::String modulationAddressLabel(const std::vector<ModulationDestinationEntry>& catalog,const ModulationState& mod,const ModAddress& address,int depth) {
    switch(address.parameter) {
        case ModDestination::LfoRate: if(isInstanceSource(static_cast<ModSource>(address.itemId))) return modulationSourceLabel(mod,static_cast<ModSource>(address.itemId))+" RATE"; return "LFO "+juce::String(int(address.itemId))+" RATE";
        case ModDestination::MacroValue: return macroLabel(mod,address.itemId);
        case ModDestination::RouteDepth: {
            for(const auto& r:mod.routes)
                if(r.id && r.id==address.itemId)
                    return depth>=4 ? juce::String("ROUTE ")+juce::String(int(r.id))+" / DEPTH"
                                    : "["+modulationRouteLabel(catalog,mod,r,depth+1)+"] DEPTH";
            return "MISSING ROUTE / DEPTH";
        }
        default: break;
    }
    for(const auto& e:catalog)
        if(e.address==address) return e.group=="Global" || e.group==nestedDestinationGroup ? e.label : e.group.toUpperCase()+" "+e.label;
    return "UNAVAILABLE DESTINATION";
}

juce::String modulationRouteLabel(const std::vector<ModulationDestinationEntry>& catalog,const ModulationState& mod,const ModRoute& route,int depth) {
    juce::String source=modulationSourceLabel(mod,route.source);
    if(isOperatorSource(route.source)) {
        source="NODES";
        if(const auto* op=findControlOperator(mod,operatorIdOf(route.source)))
            if(const auto* info=controlOpInfo(op->type)) source+=": "+juce::String(info->label);
    }
    return source+juce::String(juce::CharPointer_UTF8(" \xe2\x86\x92 "))+modulationAddressLabel(catalog,mod,route.destination,depth);
}

}
