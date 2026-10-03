// mct-origami-nodes-n03-control
#include "core/nodes/ControlGraph.h"
#include <algorithm>
#include <cmath>
#include <cstring>

namespace mct::origami::nodes {
namespace {
bool lfoSource(ModSource s) noexcept { return s>=ModSource::Lfo1 && s<=ModSource::Lfo4; }
std::size_t lfoIndex(ModSource s) noexcept { return static_cast<std::size_t>(s)-static_cast<std::size_t>(ModSource::Lfo1); }

constexpr float sourceColumnX=40.0f,parameterColumnX=1040.0f,firstRowY=600.0f,rowPitch=84.0f;

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
constexpr std::uint16_t layoutVersion=1;
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
    switch(a.parameter) {
    case ModDestination::PortaTime: case ModDestination::LfoScaling: case ModDestination::Swing:
    case ModDestination::FxParameter:
        return NodeExecutionDomain::Global;
    default:
        return NodeExecutionDomain::Voice;
    }
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
        return true;
    default:
        return false;
    }
}

bool controlSourceActive(ModSource s,const ModulationState& m) noexcept {
    if(s>=ModSource::Env1 && s<=ModSource::Env3) return (m.envActiveMask&(1u<<(static_cast<unsigned>(s)-1u)))!=0;
    if(lfoSource(s)) return (m.lfoActiveMask&(1u<<lfoIndex(s)))!=0;
    if(s==ModSource::Random) return (m.generatorActiveMask&0x02u)!=0;
    return controlSourceExposed(s);
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
    case ControlLinkResult::CapacityExceeded: return "modulation route capacity reached";
    }
    return "unknown";
}

ControlLinkCheck checkControlLink(const InstrumentState& state,ModSource source,const ModAddress& destination) noexcept {
    ControlLinkCheck check;
    const auto fail=[&check](ControlLinkResult r){ check.result=r; return check; };
    const auto& m=state.modulation;
    if(source==ModSource::None) return fail(ControlLinkResult::MissingSource);
    if(!controlSourceExposed(source)) return fail(ControlLinkResult::SourceNotExposed);
    if(!controlSourceActive(source,m)) return fail(ControlLinkResult::SourceInactive);
    if(destination.parameter==ModDestination::None) return fail(ControlLinkResult::MissingDestination);
    for(const auto& r:m.routes)
        if(r.id && r.source==source && r.destination==destination) { check.existingRoute=r.id; return fail(ControlLinkResult::Exists); }
    if(!domainCrossingSupported(sourceDomain(source,m),destinationDomain(destination))) return fail(ControlLinkResult::DomainCrossing);
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
    for(auto m:layoutMagic) u8(b,m);
    u8(b,std::uint8_t(layoutVersion>>8)); u8(b,std::uint8_t(layoutVersion));
    u32(b,std::uint32_t(entries_.size()));
    for(const auto& e:entries_) {
        u8(b,std::uint8_t(e.key.kind));
        if(e.key.kind==ControlNodeKind::Source) u32(b,static_cast<std::uint32_t>(e.key.source));
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
    if(version!=layoutVersion) return false;
    const auto count=r.u32();
    if(!r.ok || count>maxEntries) return false;
    std::vector<ControlLayoutEntry> decoded;
    for(std::uint32_t i=0;i<count && r.ok;++i) {
        ControlLayoutEntry e;
        const auto kind=r.u8();
        if(kind==std::uint8_t(ControlNodeKind::Source)) {
            e.key=sourceKey(static_cast<ModSource>(r.u32()));
            if(!controlSourceExposed(e.key.source)) return false;
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
    // column per kind. The UI pins these positions as soon as the nodes are
    // shown, so a node never moves when other relationships come and go.
    int defaultSourceRow=0,defaultParameterRow=0;
    for(const auto& e:layout.entries())
        if(e.positioned) (e.key.kind==ControlNodeKind::Source ? defaultSourceRow : defaultParameterRow)++;
    const auto nodeFor=[&](const ControlNodeKey& key)->std::size_t {
        if(const auto existing=graph.find(key)) return *existing;
        ControlGraphNode node;
        node.key=key;
        node.domain=key.kind==ControlNodeKind::Source ? sourceDomain(key.source,m) : destinationDomain(key.destination);
        const auto* e=layout.find(key);
        if(e!=nullptr) node.placed=e->placed;
        if(e!=nullptr && e->positioned) { node.x=e->x; node.y=e->y; }
        else if(key.kind==ControlNodeKind::Source) { node.x=sourceColumnX; node.y=firstRowY+rowPitch*float(defaultSourceRow++); }
        else { node.x=parameterColumnX; node.y=firstRowY+rowPitch*float(defaultParameterRow++); }
        graph.nodes.push_back(node);
        return graph.nodes.size()-1;
    };
    for(const auto& e:layout.entries()) if(e.placed) nodeFor(e.key);
    for(const auto& r:m.routes) {
        if(!r.id || !routeComplete(r) || !controlSourceExposed(r.source)) continue;
        ControlGraphLink link;
        link.routeId=r.id;
        link.source=nodeFor(sourceKey(r.source));
        link.parameter=nodeFor(parameterKey(r.destination));
        link.supported=domainCrossingSupported(sourceDomain(r.source,m),destinationDomain(r.destination));
        graph.links.push_back(link);
    }
    return graph;
}

}
