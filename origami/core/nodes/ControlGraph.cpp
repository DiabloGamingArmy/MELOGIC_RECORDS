// mct-origami-nodes-n03-control
#include "core/nodes/ControlGraph.h"
#include <algorithm>
#include <cmath>
#include <cstring>

namespace mct::origami::nodes {
namespace {
bool lfoSource(ModSource s) noexcept { return s>=ModSource::Lfo1 && s<=ModSource::Lfo4; }
std::size_t lfoIndex(ModSource s) noexcept { return static_cast<std::size_t>(s)-static_cast<std::size_t>(ModSource::Lfo1); }

constexpr float sourceColumnX=40.0f,operatorColumnX=400.0f,operatorColumnPitch=280.0f,parameterColumnX=1040.0f,
                firstRowY=600.0f,rowPitch=84.0f,operatorPitch=130.0f;

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
    // A processed source (an operator output) runs where its chain runs.
    if(isOperatorSource(s)) return sourceIsVoice(s,m) ? NodeExecutionDomain::Voice : NodeExecutionDomain::Global;
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
    case ControlLinkResult::TypeMismatch: return "signal types differ (use a THRESHOLD / EDGE / PULSE converter)";
    }
    return "unknown";
}

ControlLinkCheck checkControlLink(const InstrumentState& state,ModSource source,const ModAddress& destination) noexcept {
    ControlLinkCheck check;
    const auto fail=[&check](ControlLinkResult r){ check.result=r; return check; };
    const auto& m=state.modulation;
    if(source==ModSource::None) return fail(ControlLinkResult::MissingSource);
    if(isOperatorSource(source)) {
        const auto* op=findControlOperator(m,operatorIdOf(source));
        if(op==nullptr) return fail(ControlLinkResult::MissingOperator);
        // Only a CONTROL output drives a parameter (no implicit GATE/EVENT coercion).
        const auto* info=controlOpInfo(op->type);
        if(info==nullptr || operatorPortOf(source)>=info->outputCount) return fail(ControlLinkResult::InvalidPort);
        if(controlOutputSignalOf(*info,operatorPortOf(source))!=ControlSignal::Control) return fail(ControlLinkResult::TypeMismatch);
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

namespace {
// N07 layered placement: sources | operators by chain depth | parameters, left
// to right. Within a column, nodes are ordered by the barycenter of their
// neighbours (a few sweeps: fewer crossings) with a stable key tie-break, then
// stacked by their drawn height. Deterministic for a given graph.
float nodeExtent(const ModulationState& m,const ControlNodeKey& key) noexcept {
    if(key.kind!=ControlNodeKind::Operator) return rowPitch;
    const auto* op=findControlOperator(m,key.op);
    const auto* info=op ? controlOpInfo(op->type) : nullptr;
    if(info==nullptr) return operatorPitch;
    const int rows=std::max({1,int(info->inputs),info->outputCount>1 ? int(info->outputCount) : 1});
    const bool preview=op->type==ControlOpType::Sequencer || op->type==ControlOpType::Pattern || op->type==ControlOpType::Euclidean;
    // ControlNodeComponent::heightFor (header, socket rows, preview, inline control) + a gap.
    return 34.0f+22.0f*float(rows)+(preview ? 30.0f : 0.0f)+26.0f+8.0f+24.0f;
}
std::uint64_t stableOrder(const ControlNodeKey& k) noexcept {
    switch(k.kind) {
    case ControlNodeKind::Source: return std::uint64_t(static_cast<std::uint32_t>(k.source));
    case ControlNodeKind::Operator: return (std::uint64_t(1)<<40)+k.op;
    case ControlNodeKind::Parameter:
        return (std::uint64_t(2)<<40)+(std::uint64_t(static_cast<std::uint32_t>(k.destination.parameter))<<24)
              +(std::uint64_t(k.destination.oscillator&0xffffu)<<8)+(k.destination.itemId&0xffu);
    }
    return 0;
}
void placeLayered(ControlGraph& graph,const ModulationState& m,const ControlLayout& layout,bool ignorePinned) {
    const auto n=graph.nodes.size();
    if(n==0) return;
    // Columns.
    std::array<int,ModulationState::maxControlOperators> depth{};
    depth.fill(0);
    for(int pass=0;pass<int(ModulationState::maxControlOperators);++pass)
        for(std::size_t i=0;i<m.operators.size();++i) {
            const auto& op=m.operators[i];
            if(!op.id) continue;
            int d=0;
            for(const auto& in:op.inputs)
                if(in.kind==ControlInput::Kind::Operator) {
                    const auto from=controlOperatorSlot(m,in.op);
                    if(from<depth.size()) d=std::max(d,depth[from]+1);
                }
            depth[i]=d;
        }
    int maxDepth=-1;
    for(const auto& node:graph.nodes)
        if(node.key.kind==ControlNodeKind::Operator) {
            const auto slot=controlOperatorSlot(m,node.key.op);
            if(slot<depth.size()) maxDepth=std::max(maxDepth,depth[slot]);
        }
    const int parameterColumn=maxDepth+2; // 0 = sources, 1.. = operator depths
    std::vector<int> column(n,0);
    for(std::size_t i=0;i<n;++i) {
        const auto& key=graph.nodes[i].key;
        if(key.kind==ControlNodeKind::Source) column[i]=0;
        else if(key.kind==ControlNodeKind::Parameter) column[i]=parameterColumn;
        else { const auto slot=controlOperatorSlot(m,key.op); column[i]=1+(slot<depth.size() ? depth[slot] : 0); }
    }
    const auto columnX=[&](int c) {
        if(c==0) return sourceColumnX;
        if(c==parameterColumn) return std::max(parameterColumnX,operatorColumnX+operatorColumnPitch*float(c-1));
        return operatorColumnX+operatorColumnPitch*float(c-1);
    };
    // Neighbours (both directions) from the links.
    std::vector<std::vector<std::size_t>> preds(n),succs(n);
    for(const auto& l:graph.links) { if(l.source<n && l.parameter<n) { succs[l.source].push_back(l.parameter); preds[l.parameter].push_back(l.source); } }
    // Order within columns.
    std::vector<std::vector<std::size_t>> columns(std::size_t(parameterColumn+1));
    for(std::size_t i=0;i<n;++i) columns[std::size_t(column[i])].push_back(i);
    std::vector<double> rank(n,0.0);
    for(auto& col:columns) {
        std::sort(col.begin(),col.end(),[&](std::size_t a,std::size_t b){ return stableOrder(graph.nodes[a].key)<stableOrder(graph.nodes[b].key); });
        for(std::size_t r=0;r<col.size();++r) rank[col[r]]=double(r);
    }
    const auto sweep=[&](bool forward) {
        const int count=int(columns.size());
        for(int k=0;k<count;++k) {
            auto& col=columns[std::size_t(forward ? k : count-1-k)];
            std::vector<double> key(col.size());
            for(std::size_t r=0;r<col.size();++r) {
                const auto& nb=forward ? preds[col[r]] : succs[col[r]];
                if(nb.empty()) { key[r]=rank[col[r]]; continue; }
                double sum=0.0; for(auto x:nb) sum+=rank[x];
                key[r]=sum/double(nb.size());
            }
            std::vector<std::size_t> order(col.size());
            for(std::size_t r=0;r<order.size();++r) order[r]=r;
            std::stable_sort(order.begin(),order.end(),[&](std::size_t a,std::size_t b){
                if(key[a]!=key[b]) return key[a]<key[b];
                return stableOrder(graph.nodes[col[a]].key)<stableOrder(graph.nodes[col[b]].key); });
            std::vector<std::size_t> next(col.size());
            for(std::size_t r=0;r<order.size();++r) next[r]=col[order[r]];
            col=next;
            for(std::size_t r=0;r<col.size();++r) rank[col[r]]=double(r);
        }
    };
    for(int i=0;i<3;++i) { sweep(true); sweep(false); }
    // Stack each column; pinned (positioned) nodes keep their place and are
    // stepped around.
    const auto pinned=[&](std::size_t i){ if(ignorePinned) return false; const auto* e=layout.find(graph.nodes[i].key); return e!=nullptr && e->positioned; };
    for(std::size_t c=0;c<columns.size();++c) {
        const float x=columnX(int(c));
        std::vector<std::pair<float,float>> occupied; // pinned nodes overlapping this column band
        if(!ignorePinned)
            for(std::size_t i=0;i<n;++i) if(pinned(i)) {
                const auto* e=layout.find(graph.nodes[i].key);
                if(std::abs(e->x-x)<220.0f) occupied.push_back({e->y,e->y+nodeExtent(m,graph.nodes[i].key)});
            }
        float y=firstRowY;
        for(const auto i:columns[c]) {
            if(pinned(i)) continue;
            const float h=nodeExtent(m,graph.nodes[i].key);
            for(bool moved=true;moved;) {
                moved=false;
                for(const auto& o:occupied) if(y<o.second && y+h>o.first) { y=o.second; moved=true; }
            }
            graph.nodes[i].x=x; graph.nodes[i].y=y;
            y+=h;
        }
    }
}
}

ControlGraph deriveControlGraph(const ModulationState& m,const ControlLayout& layout) {
    ControlGraph graph;
    const auto nodeFor=[&](const ControlNodeKey& key)->std::size_t {
        if(const auto existing=graph.find(key)) return *existing;
        ControlGraphNode node;
        node.key=key;
        node.domain=key.kind==ControlNodeKind::Source ? sourceDomain(key.source,m)
                  : key.kind==ControlNodeKind::Parameter ? destinationDomain(key.destination)
                  : (sourceIsVoice(operatorSource(key.op),m) ? NodeExecutionDomain::Voice : NodeExecutionDomain::Global);
        if(const auto* e=layout.find(key)) node.placed=e->placed;
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
            link.sourcePort=in.kind==ControlInput::Kind::Operator ? in.port : 0;
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
        link.sourcePort=operatorPortOf(r.source);
        link.source=nodeFor(processed ? operatorKey(operatorIdOf(r.source)) : sourceKey(r.source));
        link.parameter=nodeFor(parameterKey(r.destination));
        const auto from=processed ? (sourceIsVoice(r.source,m) ? NodeExecutionDomain::Voice : NodeExecutionDomain::Global)
                                  : sourceDomain(r.source,m);
        link.supported=domainCrossingSupported(from,destinationDomain(r.destination));
        graph.links.push_back(link);
    }
    // Positions: a stored position wins; everything else is placed (layered).
    placeLayered(graph,m,layout,false);
    for(auto& node:graph.nodes)
        if(const auto* e=layout.find(node.key); e!=nullptr && e->positioned) { node.x=e->x; node.y=e->y; }
    return graph;
}

std::size_t autoLayoutControlGraph(const ModulationState& m,ControlLayout& layout) {
    auto graph=deriveControlGraph(m,layout);
    placeLayered(graph,m,layout,true); // every node, ignoring stored positions
    for(const auto& node:graph.nodes) layout.setPosition(node.key,node.x,node.y);
    return graph.nodes.size();
}

// ---------------------------------------------------------------- N04 edges / edits

ControlSignal controlOutputSignal(const ModulationState& m,const ControlEndpoint& e) noexcept {
    if(e.kind==ControlEndpoint::Kind::Source) return ControlSignal::Control;
    if(e.kind!=ControlEndpoint::Kind::OperatorOutput) return ControlSignal::None;
    const auto* op=findControlOperator(m,e.op);
    const auto* info=op ? controlOpInfo(op->type) : nullptr;
    return info ? controlOutputSignalOf(*info,e.port) : ControlSignal::None;
}

ControlSignal controlInputSignal(const ModulationState& m,const ControlEndpoint& e) noexcept {
    if(e.kind==ControlEndpoint::Kind::Parameter) return ControlSignal::Control;
    if(e.kind!=ControlEndpoint::Kind::OperatorInput) return ControlSignal::None;
    const auto* op=findControlOperator(m,e.op);
    const auto* info=op ? controlOpInfo(op->type) : nullptr;
    return info && e.input<info->inputs ? info->inputSignals[e.input] : ControlSignal::None;
}

NodeSignalType nodeSignal(ControlSignal s) noexcept {
    return s==ControlSignal::Gate ? NodeSignalType::Gate : s==ControlSignal::Event ? NodeSignalType::Event : NodeSignalType::Control;
}

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
    // Strict typing: CONTROL->CONTROL, GATE->GATE, EVENT->EVENT.
    const auto fromSignal=controlOutputSignal(m,from);
    if(fromSignal==ControlSignal::None) return fail(ControlLinkResult::InvalidPort);
    if(fromSignal!=info->inputSignals[to.input]) return fail(ControlLinkResult::TypeMismatch);
    if(target->inputs[to.input].kind!=ControlInput::Kind::None) return fail(ControlLinkResult::InputOccupied);
    if(from.kind==ControlEndpoint::Kind::OperatorOutput && (from.op==to.op || controlOperatorReaches(m,to.op,from.op)))
        return fail(ControlLinkResult::WouldCreateCycle);
    // Domain propagation: a VOICE input makes the operator (and everything
    // downstream) per-voice; no existing chain into a GLOBAL destination may
    // be turned into a per-voice result.
    auto probe=m;
    auto& input=probe.operators[controlOperatorSlot(probe,to.op)].inputs[to.input];
    input=from.kind==ControlEndpoint::Kind::Source ? ControlInput{ControlInput::Kind::Source,from.source,0}
                                                   : ControlInput{ControlInput::Kind::Operator,ModSource::None,from.op,from.port};
    for(const auto& r:m.routes)
        if(r.id && isOperatorSource(r.source) && destinationIsGlobal(r.destination.parameter)
           && sourceIsVoice(r.source,probe) && !sourceIsVoice(r.source,m))
            return fail(ControlLinkResult::DomainCrossing);
    // N06: the canonical sequencer is global; a per-voice input never drives it.
    for(const auto& op:probe.operators)
        if(const auto* i=op.id ? controlOpInfo(op.type) : nullptr; i!=nullptr && i->globalOnly && sourceIsVoice(operatorSource(op.id),probe))
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
                                                    : ControlInput{ControlInput::Kind::Operator,ModSource::None,from.op,from.port};
}
ControlInput inputFromSource(ModSource s) noexcept {
    return isOperatorSource(s) ? ControlInput{ControlInput::Kind::Operator,ModSource::None,operatorIdOf(s),operatorPortOf(s)}
                               : ControlInput{ControlInput::Kind::Source,s,0};
}
ModSource sourceOf(const ControlInput& in) noexcept {
    return in.kind==ControlInput::Kind::Source ? in.source : in.kind==ControlInput::Kind::Operator ? operatorSource(in.op,in.port) : ModSource::None;
}
}

bool controlOperatorCreatable(const ModulationState& m,ControlOpType type) noexcept {
    if(controlOpInfo(type)==nullptr) return false;
    if(type!=ControlOpType::Sequencer) return true;
    for(const auto& op:m.operators) if(op.id && op.type==ControlOpType::Sequencer) return false;
    return true;
}

bool addControlOperator(const ModulationState& m,ControlOpType type,ModulationState& out,std::uint32_t& id) noexcept {
    if(!controlOperatorCreatable(m,type) || m.nextOperatorId==0 || m.nextOperatorId>=0xfffffu) return false;
    std::size_t slot=0;
    while(slot<m.operators.size() && m.operators[slot].id!=0) ++slot;
    if(slot==m.operators.size()) return false;
    auto next=m;
    id=next.nextOperatorId++;
    next.operators[slot]=makeControlOperator(type,id);
    // N06: the SEQUENCER node IS the instrument's sequencer: placing it makes the
    // sequencer active (its steps are never touched).
    if(type==ControlOpType::Sequencer) next.generatorActiveMask|=0x10u;
    out=next;
    return true;
}

bool connectControlInput(const InstrumentState& state,const ControlEndpoint& from,std::uint32_t op,std::uint8_t input,ModulationState& out) noexcept {
    if(!checkControlEdge(state,from,ControlEndpoint::toInput(op,input)).creatable()) return false;
    auto next=state.modulation;
    auto& target=next.operators[controlOperatorSlot(next,op)];
    target.inputs[input]=inputFrom(from);
    // N06: connecting a clock to SEQUENCER ADVANCE hands clock ownership to it
    // (EXTERNAL) in the same edit: never two clocks, never a silent no-op cable.
    if(target.type==ControlOpType::Sequencer && input==0) target.params[0]=1.0f;
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

int controlAutoOutputPort(const ControlOpInfo& info,ControlSignal wanted) noexcept {
    if(info.output==wanted) return 0;
    int found=-1;
    for(std::size_t p=1;p<info.outputCount;++p)
        if(controlOutputSignalOf(info,p)==wanted) { if(found>=0) return -1; found=int(p); }
    return found;
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
    const int port=controlAutoOutputPort(*info,ControlSignal::Control);
    if(port<0) return false;
    for(auto& r:next.routes) if(r.id==route) r.source=operatorSource(id,std::uint8_t(port)); // replaced, never left underneath
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
    const auto* targetInfo=controlOpInfo(m.operators[slot].type);
    const int port=targetInfo ? controlAutoOutputPort(*info,targetInfo->inputSignals[input]) : -1;
    if(port<0) return false;
    next.operators[slot].inputs[input]={ControlInput::Kind::Operator,ModSource::None,id,std::uint8_t(port)};
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
    // Bridging needs a pass-through of the same signal type (THRESHOLD, EDGE
    // and PULSE convert types, so their neighbours are disconnected instead).
    // Only the primary output (port 0) of a single-output pass-through bridges.
    const bool bridge=info!=nullptr && info->inputs==1 && info->outputCount==1 && op.inputs[0].kind!=ControlInput::Kind::None
                   && info->inputSignals[0]==info->output;
    const auto upstream=op.inputs[0];
    for(auto& other:next.operators) {
        if(!other.id || other.id==id) continue;
        for(auto& in:other.inputs)
            if(in.kind==ControlInput::Kind::Operator && in.op==id) in=bridge && in.port==0 ? upstream : ControlInput{};
    }
    for(auto& r:next.routes) {
        if(!r.id || !isOperatorSource(r.source) || operatorIdOf(r.source)!=id) continue; // every output port
        if(!bridge || operatorPortOf(r.source)!=0) { r.id=0; continue; }
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


// ---------------------------------------------------------------- N07 validation / recovery

const char* toString(ControlIssueKind k) noexcept {
    switch(k) {
    case ControlIssueKind::DuplicateId: return "duplicate operator id";
    case ControlIssueKind::UnknownType: return "unknown operator type";
    case ControlIssueKind::IdOutOfRange: return "operator id beyond the id counter";
    case ControlIssueKind::BadParameter: return "parameter out of range";
    case ControlIssueKind::UnusedInput: return "connection on a missing input";
    case ControlIssueKind::DanglingInput: return "input references a missing operator";
    case ControlIssueKind::InvalidPort: return "invalid output port";
    case ControlIssueKind::TypeMismatch: return "signal types differ";
    case ControlIssueKind::InvalidSource: return "unknown source";
    case ControlIssueKind::Cycle: return "feedback loop";
    case ControlIssueKind::DomainViolation: return "per-voice input into a global-only node";
    case ControlIssueKind::MultipleSequencers: return "more than one sequencer";
    case ControlIssueKind::RouteMissingOperator: return "route from a missing operator";
    case ControlIssueKind::RouteInvalidSource: return "route from an unknown source";
    case ControlIssueKind::RouteInvalidPort: return "route from an invalid output port";
    case ControlIssueKind::RouteNotControl: return "an EVENT / GATE output drives a parameter";
    }
    return "unknown";
}

namespace {
// Shared by the validator (report) and the repair (fix): one rule set.
template<typename OnOperator,typename OnInput,typename OnRoute>
void scanControlGraph(const ModulationState& m,OnOperator&& onOperator,OnInput&& onInput,OnRoute&& onRoute) {
    std::uint32_t maxId=0;
    bool sequencerSeen=false;
    for(std::size_t i=0;i<m.operators.size();++i) {
        const auto& op=m.operators[i];
        if(!op.id) continue;
        maxId=std::max(maxId,op.id);
        for(std::size_t j=0;j<i;++j) if(m.operators[j].id==op.id) { onOperator(i,ControlIssueKind::DuplicateId); break; }
        const auto* info=controlOpInfo(op.type);
        if(info==nullptr) { onOperator(i,ControlIssueKind::UnknownType); continue; }
        if(op.id>=m.nextOperatorId) onOperator(i,ControlIssueKind::IdOutOfRange);
        if(op.type==ControlOpType::Sequencer) { if(sequencerSeen) onOperator(i,ControlIssueKind::MultipleSequencers); sequencerSeen=true; }
        for(std::size_t p=0;p<controlOpParameterCount;++p) {
            const float v=op.params[p];
            const bool bad=!std::isfinite(v) || (p<info->parameterCount ? (v<info->parameters[p].minimum || v>info->parameters[p].maximum) : v!=0.0f);
            if(bad) { onOperator(i,ControlIssueKind::BadParameter); break; }
        }
        for(std::uint8_t k=0;k<op.inputs.size();++k) {
            const auto& in=op.inputs[k];
            if(in.kind==ControlInput::Kind::None) {
                if(in.source!=ModSource::None || in.op!=0 || in.port!=0) onInput(i,k,ControlIssueKind::UnusedInput);
                continue;
            }
            if(k>=info->inputs) { onInput(i,k,ControlIssueKind::UnusedInput); continue; }
            if(in.kind==ControlInput::Kind::Source) {
                if(!knownModSource(in.source) || in.op!=0) onInput(i,k,ControlIssueKind::InvalidSource);
                else if(in.port!=0) onInput(i,k,ControlIssueKind::InvalidPort);
                else if(info->inputSignals[k]!=ControlSignal::Control) onInput(i,k,ControlIssueKind::TypeMismatch);
                continue;
            }
            if(in.kind!=ControlInput::Kind::Operator) { onInput(i,k,ControlIssueKind::UnusedInput); continue; }
            const auto* up=findControlOperator(m,in.op);
            const auto* upInfo=up ? controlOpInfo(up->type) : nullptr;
            if(up==nullptr || in.op==op.id || upInfo==nullptr || in.source!=ModSource::None) onInput(i,k,ControlIssueKind::DanglingInput);
            else if(in.port>=upInfo->outputCount) onInput(i,k,ControlIssueKind::InvalidPort);
            else if(controlOutputSignalOf(*upInfo,in.port)!=info->inputSignals[k]) onInput(i,k,ControlIssueKind::TypeMismatch);
            else if(controlOperatorReaches(m,op.id,in.op)) onInput(i,k,ControlIssueKind::Cycle);
        }
        if(info->globalOnly && sourceIsVoice(operatorSource(op.id),m)) onOperator(i,ControlIssueKind::DomainViolation);
    }
    (void)maxId;
    for(std::size_t r=0;r<m.routes.size();++r) {
        const auto& route=m.routes[r];
        if(!route.id) continue;
        if(!isOperatorSource(route.source)) {
            if(route.source!=ModSource::None && !knownModSource(route.source)) onRoute(r,ControlIssueKind::RouteInvalidSource);
            continue;
        }
        const auto* op=findControlOperator(m,operatorIdOf(route.source));
        const auto* info=op ? controlOpInfo(op->type) : nullptr;
        const auto port=operatorPortOf(route.source);
        if(info==nullptr) onRoute(r,ControlIssueKind::RouteMissingOperator);
        else if(port>=info->outputCount) onRoute(r,ControlIssueKind::RouteInvalidPort);
        else if(controlOutputSignalOf(*info,port)!=ControlSignal::Control) onRoute(r,ControlIssueKind::RouteNotControl);
    }
}
}

std::vector<ControlIssue> validateControlGraph(const ModulationState& m) {
    std::vector<ControlIssue> issues;
    scanControlGraph(m,
        [&](std::size_t slot,ControlIssueKind k){ issues.push_back({k,m.operators[slot].id,0,0}); },
        [&](std::size_t slot,std::uint8_t input,ControlIssueKind k){ issues.push_back({k,m.operators[slot].id,input,0}); },
        [&](std::size_t r,ControlIssueKind k){ issues.push_back({k,0,0,m.routes[r].id}); });
    return issues;
}

std::size_t repairControlGraph(ModulationState& m) noexcept {
    std::size_t repairs=0;
    // Collect a pass of issues (bounded), then apply them in slot order. Fixing
    // one problem can expose another (a removed operator dangles its
    // consumers), so passes repeat until none remain; each pass fixes at least
    // one, so this is bounded by the graph size.
    struct Found { ControlIssue issue; std::size_t index; };
    for(int pass=0;pass<int(ModulationState::maxControlOperators*4+4);++pass) {
        std::array<Found,ModulationState::maxControlOperators*5+ModulationState::capacity> found{};
        std::size_t count=0;
        const auto push=[&](Found f){ if(count<found.size()) found[count++]=f; };
        scanControlGraph(m,
            [&](std::size_t slot,ControlIssueKind k){ push({{k,0,0,0},slot}); },
            [&](std::size_t slot,std::uint8_t input,ControlIssueKind k){ push({{k,0,input,0},slot}); },
            [&](std::size_t r,ControlIssueKind k){ push({{k,0,0,1},r}); });
        if(count==0) break;
        for(std::size_t i=0;i<count;++i) {
            const auto& f=found[i];
            const auto k=f.issue.kind;
            if(f.issue.route!=0) { if(m.routes[f.index].id) { m.routes[f.index].id=0; ++repairs; } continue; }
            auto& op=m.operators[f.index];
            if(!op.id) continue; // already removed this pass
            switch(k) {
            case ControlIssueKind::IdOutOfRange: m.nextOperatorId=std::max(m.nextOperatorId,op.id+1); break;
            case ControlIssueKind::BadParameter: {
                const auto* info=controlOpInfo(op.type);
                for(std::size_t p=0;p<controlOpParameterCount;++p) {
                    float& v=op.params[p];
                    if(info==nullptr || p>=info->parameterCount) { v=0.0f; continue; }
                    const auto& d=info->parameters[p];
                    v=std::isfinite(v) ? std::clamp(v,d.minimum,d.maximum) : d.defaultValue;
                }
                break;
            }
            case ControlIssueKind::DomainViolation: for(auto& in:op.inputs) in={}; break;
            case ControlIssueKind::UnusedInput: case ControlIssueKind::DanglingInput: case ControlIssueKind::InvalidPort:
            case ControlIssueKind::TypeMismatch: case ControlIssueKind::InvalidSource: case ControlIssueKind::Cycle:
                op.inputs[f.issue.input]={};
                break;
            default: op={}; break; // duplicate id / unknown type / extra sequencer: removed
            }
            ++repairs;
            if(k==ControlIssueKind::Cycle) break; // re-scan: one cut can resolve several reports
        }
    }
    if(m.nextOperatorId==0) { m.nextOperatorId=1; ++repairs; }
    compactRoutes(m);
    return repairs;
}

}
