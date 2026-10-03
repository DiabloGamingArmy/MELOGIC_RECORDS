// mct-origami-nodes-n03-control
#include "core/nodes/ControlGraph.h"
#include <algorithm>
#include <cmath>
#include <cstring>

namespace mct::origami::nodes {
namespace {
bool lfoSource(ModSource s) noexcept { return s>=ModSource::Lfo1 && s<=ModSource::Lfo4; }
std::size_t lfoIndex(ModSource s) noexcept { return static_cast<std::size_t>(s)-static_cast<std::size_t>(ModSource::Lfo1); }

constexpr float sourceColumnX=40.0f,operatorColumnX=540.0f,parameterColumnX=1040.0f,firstRowY=600.0f,rowPitch=84.0f,operatorPitch=120.0f;

void u8(std::vector<std::uint8_t>& b,std::uint8_t v) { b.push_back(v); }
void u32(std::vector<std::uint8_t>& b,std::uint32_t v) { for(int s=24;s>=0;s-=8) b.push_back(std::uint8_t(v>>s)); }
void f32(std::vector<std::uint8_t>& b,float v) { std::uint32_t raw=0; std::memcpy(&raw,&v,4); u32(b,raw); }
struct Reader {
    const std::uint8_t* data; std::size_t size,pos=0; bool ok=true;
    std::uint8_t u8() { if(pos>=size) { ok=false; return 0; } return data[pos++]; }
    std::uint32_t u32() { std::uint32_t v=0; for(int i=0;i<4;++i) v=(v<<8)|u8(); return v; }
    float f32() { const auto raw=u32(); float v=0; std::memcpy(&v,&raw,4); return v; }
};
constexpr std::uint8_t layoutMagic[4]{'M','C','V','L'};
// v1 (N03): source / parameter entries. v2 (N04): + operator entries; written
// only when an operator entry exists, so N03 layouts stay byte-identical.
constexpr std::uint16_t layoutVersion=1,layoutVersionOperators=2;
}

NodeExecutionDomain sourceDomain(ModSource s,const ModulationState& m) noexcept {
    if(lfoSource(s)) return lfoSettings(m,lfoIndex(s)).mode==LfoMode::Free ? NodeExecutionDomain::Global : NodeExecutionDomain::Voice;
    switch(s) {
    case ModSource::Macro1: case ModSource::Macro2: case ModSource::Macro3: case ModSource::Macro4:
    case ModSource::Random: case ModSource::Function: case ModSource::Chaos: case ModSource::Drift: case ModSource::Sequencer:
        return NodeExecutionDomain::Global;
    default:
        // Envelopes, velocity, keytrack, mod wheel, aftertouch, pitch bend,
        // note gate: evaluated inside each voice.
        return NodeExecutionDomain::Voice;
    }
}

NodeExecutionDomain destinationDomain(const ModAddress& a) noexcept {
    return destinationIsGlobal(a.parameter) ? NodeExecutionDomain::Global : NodeExecutionDomain::Voice;
}

bool domainCrossingSupported(NodeExecutionDomain source,NodeExecutionDomain destination) noexcept {
    return !(source==NodeExecutionDomain::Voice && destination==NodeExecutionDomain::Global);
}

bool controlSourceExposed(ModSource s) noexcept {
    switch(s) {
    case ModSource::Env1: case ModSource::Env2: case ModSource::Env3:
    case ModSource::Lfo1: case ModSource::Lfo2: case ModSource::Lfo3: case ModSource::Lfo4:
    case ModSource::Macro1: case ModSource::Macro2: case ModSource::Macro3: case ModSource::Macro4:
    case ModSource::Random:
    // N04: the remaining canonical sources (already clean ModSources).
    case ModSource::Function: case ModSource::Chaos: case ModSource::Drift: case ModSource::Sequencer:
    case ModSource::Velocity: case ModSource::ModWheel: case ModSource::Keytrack:
    case ModSource::Aftertouch: case ModSource::PitchBend: case ModSource::NoteGate:
        return true;
    default:
        return false;
    }
}

bool controlSourceActive(ModSource s,const ModulationState& m) noexcept {
    if(s>=ModSource::Env1 && s<=ModSource::Env3) return (m.envActiveMask&(1u<<(static_cast<unsigned>(s)-1u)))!=0;
    if(lfoSource(s)) return (m.lfoActiveMask&(1u<<lfoIndex(s)))!=0;
    switch(s) {
    case ModSource::Function: return (m.generatorActiveMask&0x01u)!=0;
    case ModSource::Random: return (m.generatorActiveMask&0x02u)!=0;
    case ModSource::Chaos: return (m.generatorActiveMask&0x04u)!=0;
    case ModSource::Drift: return (m.generatorActiveMask&0x08u)!=0;
    case ModSource::Sequencer: return (m.generatorActiveMask&0x10u)!=0;
    default: return controlSourceExposed(s);
    }
}

PortDescriptor controlPort(ControlNodeKind kind) noexcept {
    return kind==ControlNodeKind::Source
        ? PortDescriptor{PortDirection::Output,NodeSignalType::Control,0,"Control Out"}
        : PortDescriptor{PortDirection::Input,NodeSignalType::Control,0,"Control In"};
}

const char* toString(ControlLinkResult r) noexcept {
    switch(r) {
    case ControlLinkResult::Ok: return "ok";
    case ControlLinkResult::Exists: return "already routed";
    case ControlLinkResult::MissingSource: return "no source";
    case ControlLinkResult::SourceNotExposed: return "source not available in NODES yet";
    case ControlLinkResult::SourceInactive: return "source is not active";
    case ControlLinkResult::MissingDestination: return "no destination";
    case ControlLinkResult::DestinationUnavailable: return "destination unavailable";
    case ControlLinkResult::DomainCrossing: return "a per-voice source cannot drive a global parameter";
    case ControlLinkResult::CapacityExceeded: return "capacity reached";
    case ControlLinkResult::MissingOperator: return "operator does not exist";
    case ControlLinkResult::InvalidPort: return "not a compatible port";
    case ControlLinkResult::InputOccupied: return "this input already has a connection";
    case ControlLinkResult::WouldCreateCycle: return "control feedback loops are not allowed";
    }
    return "unknown";
}

ControlLinkCheck checkControlLink(const InstrumentState& state,ModSource source,const ModAddress& destination) noexcept {
    ControlLinkCheck check;
    const auto fail=[&check](ControlLinkResult r){ check.result=r; return check; };
    const auto& m=state.modulation;
    if(source==ModSource::None) return fail(ControlLinkResult::MissingSource);
    if(isOperatorSource(source)) {
        if(findControlOperator(m,operatorIdOf(source))==nullptr) return fail(ControlLinkResult::MissingOperator);
    } else {
        if(!controlSourceExposed(source)) return fail(ControlLinkResult::SourceNotExposed);
        if(!controlSourceActive(source,m)) return fail(ControlLinkResult::SourceInactive);
    }
    if(destination.parameter==ModDestination::None) return fail(ControlLinkResult::MissingDestination);
    for(const auto& r:m.routes)
        if(r.id && r.source==source && r.destination==destination) { check.existingRoute=r.id; return fail(ControlLinkResult::Exists); }
    const auto from=isOperatorSource(source) ? (sourceIsVoice(source,m) ? NodeExecutionDomain::Voice : NodeExecutionDomain::Global)
                                             : sourceDomain(source,m);
    if(!domainCrossingSupported(from,destinationDomain(destination))) return fail(ControlLinkResult::DomainCrossing);
    // Destination validity: the canonical validator judges a probe state.
    auto probe=m;
    auto slot=std::find_if(probe.routes.begin(),probe.routes.end(),[](const ModRoute& r){ return r.id==0; });
    if(slot==probe.routes.end() || probe.nextRouteId==~std::uint32_t{0}) return fail(ControlLinkResult::CapacityExceeded);
    *slot=ModRoute{};
    slot->id=probe.nextRouteId++;
    slot->source=source;
    slot->destination=destination;
    if(!validModulation(probe,state.oscillators)) return fail(ControlLinkResult::DestinationUnavailable);
    return fail(ControlLinkResult::Ok);
}

// ---------------------------------------------------------------- layout

const ControlLayoutEntry* ControlLayout::find(const ControlNodeKey& key) const noexcept {
    for(const auto& e:entries_) if(e.key==key) return &e;
    return nullptr;
}

ControlLayoutEntry& ControlLayout::entry(const ControlNodeKey& key) {
    for(auto& e:entries_) if(e.key==key) return e;
    entries_.push_back({key,0.0f,0.0f,false});
    return entries_.back();
}

void ControlLayout::setPosition(const ControlNodeKey& key,float x,float y) {
    if(!std::isfinite(x) || !std::isfinite(y)) return;
    if(find(key)==nullptr && entries_.size()>=maxEntries) return;
    auto& e=entry(key);
    e.x=x; e.y=y; e.positioned=true;
}

void ControlLayout::setPlaced(const ControlNodeKey& key,bool placed) {
    if(find(key)==nullptr && entries_.size()>=maxEntries) return;
    entry(key).placed=placed;
}

bool ControlLayout::remove(const ControlNodeKey& key) {
    const auto before=entries_.size();
    entries_.erase(std::remove_if(entries_.begin(),entries_.end(),[&key](const ControlLayoutEntry& e){ return e.key==key; }),entries_.end());
    return entries_.size()!=before;
}

bool ControlLayout::operator==(const ControlLayout& o) const noexcept {
    if(entries_.size()!=o.entries_.size()) return false;
    for(std::size_t i=0;i<entries_.size();++i) {
        const auto& a=entries_[i]; const auto& b=o.entries_[i];
        if(a.key!=b.key || a.x!=b.x || a.y!=b.y || a.placed!=b.placed || a.positioned!=b.positioned) return false;
    }
    return true;
}

std::vector<std::uint8_t> ControlLayout::encode() const {
    std::vector<std::uint8_t> b;
    bool operators=false;
    for(const auto& e:entries_) operators|=e.key.kind==ControlNodeKind::Operator;
    const auto version=operators ? layoutVersionOperators : layoutVersion;
    for(auto m:layoutMagic) u8(b,m);
    u8(b,std::uint8_t(version>>8)); u8(b,std::uint8_t(version));
    u32(b,std::uint32_t(entries_.size()));
    for(const auto& e:entries_) {
        u8(b,std::uint8_t(e.key.kind));
        if(e.key.kind==ControlNodeKind::Source) u32(b,static_cast<std::uint32_t>(e.key.source));
        else if(e.key.kind==ControlNodeKind::Operator) u32(b,e.key.op);
        else { u32(b,static_cast<std::uint32_t>(e.key.destination.parameter)); u32(b,e.key.destination.oscillator); u32(b,e.key.destination.itemId); }
        f32(b,e.x); f32(b,e.y); u8(b,std::uint8_t((e.placed ? 1 : 0)|(e.positioned ? 2 : 0)));
    }
    return b;
}

bool ControlLayout::decode(const void* data,std::size_t size) {
    if(data==nullptr || size>(1u<<20)) return false;
    Reader r{static_cast<const std::uint8_t*>(data),size};
    for(auto m:layoutMagic) if(r.u8()!=m) return false;
    const std::uint16_t version=std::uint16_t((r.u8()<<8)|r.u8());
    if(version!=layoutVersion && version!=layoutVersionOperators) return false;
    const auto count=r.u32();
    if(!r.ok || count>maxEntries) return false;
    std::vector<ControlLayoutEntry> decoded;
    for(std::uint32_t i=0;i<count && r.ok;++i) {
        ControlLayoutEntry e;
        const auto kind=r.u8();
        if(kind==std::uint8_t(ControlNodeKind::Source)) {
            e.key=sourceKey(static_cast<ModSource>(r.u32()));
            if(!controlSourceExposed(e.key.source)) return false;
        } else if(kind==std::uint8_t(ControlNodeKind::Operator) && version>=layoutVersionOperators) {
            const auto id=r.u32();
            if(id==0) return false;
            e.key=operatorKey(id);
        } else if(kind==std::uint8_t(ControlNodeKind::Parameter)) {
            ModAddress a;
            a.parameter=static_cast<ModDestination>(r.u32()); a.oscillator=r.u32(); a.itemId=r.u32();
            if(a.parameter==ModDestination::None) return false;
            e.key=parameterKey(a);
        } else return false;
        e.x=r.f32(); e.y=r.f32();
        const auto flags=r.u8();
        if(!std::isfinite(e.x) || !std::isfinite(e.y) || flags>3) return false;
        e.placed=(flags&1)!=0;
        e.positioned=(flags&2)!=0;
        for(const auto& d:decoded) if(d.key==e.key) return false;
        decoded.push_back(e);
    }
    if(!r.ok || r.pos!=size) return false;
    entries_=std::move(decoded);
    return true;
}

// ---------------------------------------------------------------- derived graph

std::optional<std::size_t> ControlGraph::find(const ControlNodeKey& key) const noexcept {
    for(std::size_t i=0;i<nodes.size();++i) if(nodes[i].key==key) return i;
    return std::nullopt;
}

ControlGraph deriveControlGraph(const ModulationState& m,const ControlLayout& layout) {
    ControlGraph graph;
    // Unpositioned nodes stack below the ones already laid out, in a compact
    // column per kind (sources | operators | parameters). The UI pins these
    // positions as soon as the nodes are shown, so nothing moves later.
    int sourceRow=0,operatorRow=0,parameterRow=0;
    for(const auto& e:layout.entries())
        if(e.positioned) (e.key.kind==ControlNodeKind::Source ? sourceRow : e.key.kind==ControlNodeKind::Operator ? operatorRow : parameterRow)++;
    const auto nodeFor=[&](const ControlNodeKey& key)->std::size_t {
        if(const auto existing=graph.find(key)) return *existing;
        ControlGraphNode node;
        node.key=key;
        node.domain=key.kind==ControlNodeKind::Source ? sourceDomain(key.source,m)
                  : key.kind==ControlNodeKind::Parameter ? destinationDomain(key.destination)
                  : (sourceIsVoice(operatorSource(key.op),m) ? NodeExecutionDomain::Voice : NodeExecutionDomain::Global);
        const auto* e=layout.find(key);
        if(e!=nullptr) node.placed=e->placed;
        if(e!=nullptr && e->positioned) { node.x=e->x; node.y=e->y; }
        else if(key.kind==ControlNodeKind::Source) { node.x=sourceColumnX; node.y=firstRowY+rowPitch*float(sourceRow++); }
        else if(key.kind==ControlNodeKind::Operator) { node.x=operatorColumnX; node.y=firstRowY+operatorPitch*float(operatorRow++); }
        else { node.x=parameterColumnX; node.y=firstRowY+rowPitch*float(parameterRow++); }
        graph.nodes.push_back(node);
        return graph.nodes.size()-1;
    };
    for(const auto& e:layout.entries())
        if(e.placed && e.key.kind!=ControlNodeKind::Operator) nodeFor(e.key);
    // Operators are real (persisted) objects: always shown.
    for(const auto& op:m.operators) if(op.id) nodeFor(operatorKey(op.id));
    // Edges into operator inputs.
    for(const auto& op:m.operators) {
        if(!op.id) continue;
        for(std::uint8_t k=0;k<op.inputs.size();++k) {
            const auto& in=op.inputs[k];
            if(in.kind==ControlInput::Kind::None) continue;
            if(in.kind==ControlInput::Kind::Source && !controlSourceExposed(in.source)) continue;
            ControlGraphLink link;
            link.source=nodeFor(in.kind==ControlInput::Kind::Source ? sourceKey(in.source) : operatorKey(in.op));
            link.parameter=nodeFor(operatorKey(op.id));
            link.targetOperator=op.id;
            link.targetInput=k;
            graph.links.push_back(link);
        }
    }
    // Routes: direct (source -> parameter) and processed (operator -> parameter).
    for(const auto& r:m.routes) {
        if(!r.id || !routeComplete(r)) continue;
        const bool processed=isOperatorSource(r.source);
        if(processed ? findControlOperator(m,operatorIdOf(r.source))==nullptr : !controlSourceExposed(r.source)) continue;
        ControlGraphLink link;
        link.routeId=r.id;
        link.source=nodeFor(processed ? operatorKey(operatorIdOf(r.source)) : sourceKey(r.source));
        link.parameter=nodeFor(parameterKey(r.destination));
        const auto from=processed ? (sourceIsVoice(r.source,m) ? NodeExecutionDomain::Voice : NodeExecutionDomain::Global)
                                  : sourceDomain(r.source,m);
        link.supported=domainCrossingSupported(from,destinationDomain(r.destination));
        graph.links.push_back(link);
    }
    return graph;
}

// ---------------------------------------------------------------- N04 edges / edits

ControlLinkCheck checkControlEdge(const InstrumentState& state,const ControlEndpoint& from,const ControlEndpoint& to) noexcept {
    ControlLinkCheck check;
    const auto fail=[&check](ControlLinkResult r){ check.result=r; return check; };
    const auto& m=state.modulation;
    if(!from.isOutput() || to.isOutput()) return fail(ControlLinkResult::InvalidPort);
    if(from.kind==ControlEndpoint::Kind::Source) {
        if(from.source==ModSource::None || isOperatorSource(from.source)) return fail(ControlLinkResult::MissingSource);
        if(!controlSourceExposed(from.source)) return fail(ControlLinkResult::SourceNotExposed);
        if(!controlSourceActive(from.source,m)) return fail(ControlLinkResult::SourceInactive);
    } else if(findControlOperator(m,from.op)==nullptr) return fail(ControlLinkResult::MissingOperator);
    if(to.kind==ControlEndpoint::Kind::Parameter) return checkControlLink(state,from.outputSource(),to.destination);
    const auto* target=findControlOperator(m,to.op);
    if(target==nullptr) return fail(ControlLinkResult::MissingOperator);
    const auto* info=controlOpInfo(target->type);
    if(info==nullptr || to.input>=info->inputs) return fail(ControlLinkResult::InvalidPort);
    if(target->inputs[to.input].kind!=ControlInput::Kind::None) return fail(ControlLinkResult::InputOccupied);
    if(from.kind==ControlEndpoint::Kind::OperatorOutput && (from.op==to.op || controlOperatorReaches(m,to.op,from.op)))
        return fail(ControlLinkResult::WouldCreateCycle);
    // Domain propagation: a VOICE input makes the operator (and everything
    // downstream) per-voice; no existing chain into a GLOBAL destination may
    // be turned into a per-voice result.
    auto probe=m;
    auto& input=probe.operators[controlOperatorSlot(probe,to.op)].inputs[to.input];
    input=from.kind==ControlEndpoint::Kind::Source ? ControlInput{ControlInput::Kind::Source,from.source,0}
                                                   : ControlInput{ControlInput::Kind::Operator,ModSource::None,from.op};
    for(const auto& r:m.routes)
        if(r.id && isOperatorSource(r.source) && destinationIsGlobal(r.destination.parameter)
           && sourceIsVoice(r.source,probe) && !sourceIsVoice(r.source,m))
            return fail(ControlLinkResult::DomainCrossing);
    return fail(ControlLinkResult::Ok);
}

namespace {
void compactRoutes(ModulationState& m) noexcept {
    std::size_t write=0;
    for(const auto& r:m.routes) if(r.id) m.routes[write++]=r;
    while(write<m.routes.size()) m.routes[write++]={};
}
ControlInput inputFrom(const ControlEndpoint& from) noexcept {
    return from.kind==ControlEndpoint::Kind::Source ? ControlInput{ControlInput::Kind::Source,from.source,0}
                                                    : ControlInput{ControlInput::Kind::Operator,ModSource::None,from.op};
}
ControlInput inputFromSource(ModSource s) noexcept {
    return isOperatorSource(s) ? ControlInput{ControlInput::Kind::Operator,ModSource::None,operatorIdOf(s)}
                               : ControlInput{ControlInput::Kind::Source,s,0};
}
ModSource sourceOf(const ControlInput& in) noexcept {
    return in.kind==ControlInput::Kind::Source ? in.source : in.kind==ControlInput::Kind::Operator ? operatorSource(in.op) : ModSource::None;
}
}

bool addControlOperator(const ModulationState& m,ControlOpType type,ModulationState& out,std::uint32_t& id) noexcept {
    if(controlOpInfo(type)==nullptr || m.nextOperatorId==0 || m.nextOperatorId>=0xfffffu) return false;
    std::size_t slot=0;
    while(slot<m.operators.size() && m.operators[slot].id!=0) ++slot;
    if(slot==m.operators.size()) return false;
    auto next=m;
    id=next.nextOperatorId++;
    next.operators[slot]=makeControlOperator(type,id);
    out=next;
    return true;
}

bool connectControlInput(const InstrumentState& state,const ControlEndpoint& from,std::uint32_t op,std::uint8_t input,ModulationState& out) noexcept {
    if(!checkControlEdge(state,from,ControlEndpoint::toInput(op,input)).creatable()) return false;
    auto next=state.modulation;
    next.operators[controlOperatorSlot(next,op)].inputs[input]=inputFrom(from);
    out=next;
    return true;
}

bool disconnectControlInput(const ModulationState& m,std::uint32_t op,std::uint8_t input,ModulationState& out) noexcept {
    const auto slot=controlOperatorSlot(m,op);
    if(slot>=m.operators.size() || input>=m.operators[slot].inputs.size()
       || m.operators[slot].inputs[input].kind==ControlInput::Kind::None) return false;
    auto next=m;
    next.operators[slot].inputs[input]={};
    out=next;
    return true;
}

bool insertControlOperatorOnRoute(const InstrumentState& state,std::uint32_t route,ControlOpType type,ModulationState& out,std::uint32_t& id) noexcept {
    const auto* info=controlOpInfo(type);
    if(info==nullptr || info->inputs==0) return false;
    const auto& m=state.modulation;
    const ModRoute* existing=nullptr;
    for(const auto& r:m.routes) if(r.id==route) existing=&r;
    if(existing==nullptr || !routeComplete(*existing)) return false;
    ModulationState next;
    if(!addControlOperator(m,type,next,id)) return false;
    next.operators[controlOperatorSlot(next,id)].inputs[0]=inputFromSource(existing->source);
    for(auto& r:next.routes) if(r.id==route) r.source=operatorSource(id); // replaced, never left underneath
    if(!validModulation(next,state.oscillators)) return false;
    out=next;
    return true;
}

bool insertControlOperatorOnInput(const InstrumentState& state,std::uint32_t op,std::uint8_t input,ControlOpType type,ModulationState& out,std::uint32_t& id) noexcept {
    const auto* info=controlOpInfo(type);
    const auto& m=state.modulation;
    const auto slot=controlOperatorSlot(m,op);
    if(info==nullptr || info->inputs==0 || slot>=m.operators.size() || input>=m.operators[slot].inputs.size()) return false;
    const auto upstream=m.operators[slot].inputs[input];
    if(upstream.kind==ControlInput::Kind::None) return false;
    ModulationState next;
    if(!addControlOperator(m,type,next,id)) return false;
    next.operators[controlOperatorSlot(next,id)].inputs[0]=upstream;
    next.operators[slot].inputs[input]={ControlInput::Kind::Operator,ModSource::None,id};
    if(!validModulation(next,state.oscillators)) return false;
    out=next;
    return true;
}

bool deleteControlOperator(const ModulationState& m,std::uint32_t id,ModulationState& out) noexcept {
    const auto slot=controlOperatorSlot(m,id);
    if(slot>=m.operators.size()) return false;
    const auto& op=m.operators[slot];
    const auto* info=controlOpInfo(op.type);
    auto next=m;
    const bool bridge=info!=nullptr && info->inputs==1 && op.inputs[0].kind!=ControlInput::Kind::None;
    const auto upstream=op.inputs[0];
    for(auto& other:next.operators) {
        if(!other.id || other.id==id) continue;
        for(auto& in:other.inputs)
            if(in.kind==ControlInput::Kind::Operator && in.op==id) in=bridge ? upstream : ControlInput{};
    }
    const auto self=operatorSource(id);
    for(auto& r:next.routes) {
        if(!r.id || r.source!=self) continue;
        if(!bridge) { r.id=0; continue; }
        const auto replacement=sourceOf(upstream);
        bool duplicate=false;
        for(const auto& o:next.routes) duplicate|=o.id && o.id!=r.id && o.source==replacement && o.destination==r.destination;
        if(duplicate) r.id=0; else r.source=replacement; // a chain of one collapses to a direct route
    }
    compactRoutes(next);
    next.operators[slot]={};
    out=next;
    return true;
}

}
