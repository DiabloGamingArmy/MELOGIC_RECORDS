// mct-origami-unified-routing-core-fx-p04
#include "core/fx/FxWorkspace.h"
#include <algorithm>
#include <cstring>

namespace mct::origami::fx {
namespace {
constexpr std::uint8_t magic[4]{'M','F','X','W'};
constexpr std::uint16_t version=1;
void u8(std::vector<std::uint8_t>& b,std::uint8_t v) { b.push_back(v); }
void u32(std::vector<std::uint8_t>& b,std::uint32_t v) { for(int s=24;s>=0;s-=8) b.push_back(std::uint8_t(v>>s)); }
void f32(std::vector<std::uint8_t>& b,float v) { std::uint32_t raw=0; std::memcpy(&raw,&v,4); u32(b,raw); }
struct Reader {
    const std::uint8_t* data; std::size_t size,pos=0; bool ok=true;
    std::uint8_t u8() { if(pos>=size) { ok=false; return 0; } return data[pos++]; }
    std::uint32_t u32() { std::uint32_t v=0; for(int i=0;i<4;++i) v=(v<<8)|u8(); return v; }
    float f32() { const auto raw=u32(); float v=0; std::memcpy(&v,&raw,4); return v; }
};
}

FxWorkspace::FxWorkspace() { reset(); }

FxGraphDocument& FxWorkspace::add(FxBusId bus,FxGraph graph) {
    auto doc=std::make_unique<FxGraphDocument>(std::move(graph));
    doc->onEditBegin=[this]{if(onEditBegin)onEditBegin();};
    doc->onEditEnd=[this]{if(onEditEnd)onEditEnd();};
    doc->onChanged=[this]{ if(onChanged) onChanged(); };
    documents_.emplace_back(bus,std::move(doc));
    return *documents_.back().second;
}

void FxWorkspace::reset() {
    documents_.clear();
    globals_={};
    add(fxMainBusId,makeDefaultFxGraph(fxMainBusId));
    generation_.fetch_add(1,std::memory_order_release);
}

FxGraphDocument& FxWorkspace::document(FxBusId bus) {
    if(auto* existing=find(bus)) return *existing;
    auto& created=add(bus,makeDefaultFxGraph(bus));
    if(onChanged) onChanged();
    return created;
}

FxGraphDocument* FxWorkspace::find(FxBusId bus) noexcept {
    for(auto& [id,doc]:documents_) if(id==bus) return doc.get();
    return nullptr;
}

const FxGraphDocument* FxWorkspace::find(FxBusId bus) const noexcept {
    for(const auto& [id,doc]:documents_) if(id==bus) return doc.get();
    return nullptr;
}

bool FxWorkspace::removeBus(FxBusId bus) {
    if(bus==fxMainBusId) return false;
    const auto before=documents_.size();
    documents_.erase(std::remove_if(documents_.begin(),documents_.end(),[bus](const auto& e){return e.first==bus;}),documents_.end());
    if(documents_.size()==before) return false;
    generation_.fetch_add(1,std::memory_order_release);
    if(onChanged) onChanged();
    return true;
}

std::vector<FxBusId> FxWorkspace::buses() const {
    std::vector<FxBusId> out;
    for(const auto& [id,doc]:documents_) out.push_back(id);
    return out;
}

void FxWorkspace::setGlobals(const FxGlobalSettings& settings) {
    FxGraph probe; // reuse FxGraph's validated clamping
    probe.setGlobals(settings);
    if(onEditBegin)onEditBegin();
    globals_=probe.globals();
    if(onChanged) onChanged();
    if(onEditEnd)onEditEnd();
}

std::vector<std::uint8_t> FxWorkspace::encode() const {
    std::vector<std::uint8_t> b;
    for(auto m:magic) u8(b,m);
    u8(b,std::uint8_t(version>>8)); u8(b,std::uint8_t(version));
    f32(b,globals_.inputGainDb); f32(b,globals_.dryWet); f32(b,globals_.width); f32(b,globals_.outputGainDb);
    u8(b,std::uint8_t(globals_.order)); u8(b,std::uint8_t(globals_.bypass));
    u32(b,std::uint32_t(documents_.size()));
    for(const auto& [id,doc]:documents_) {
        const auto graph=encodeFxGraph(doc->graph());
        u32(b,id);
        u32(b,std::uint32_t(graph.size()));
        b.insert(b.end(),graph.begin(),graph.end());
    }
    return b;
}

bool FxWorkspace::decode(const void* data,std::size_t size) {
    if(data==nullptr || size>(8u<<20)) return false;
    Reader r{static_cast<const std::uint8_t*>(data),size};
    for(auto m:magic) if(r.u8()!=m) return false;
    const std::uint16_t v=std::uint16_t((r.u8()<<8)|r.u8());
    if(v!=version) return false;
    FxGlobalSettings g;
    g.inputGainDb=r.f32(); g.dryWet=r.f32(); g.width=r.f32(); g.outputGainDb=r.f32();
    g.order=static_cast<FxOrder>(r.u8()); g.bypass=static_cast<FxBypassMode>(r.u8());
    FxGraph probe;
    probe.setGlobals(g);
    if(probe.globals().order!=g.order || probe.globals().bypass!=g.bypass) return false;
    const auto count=r.u32();
    if(!r.ok || count<1 || count>64) return false;
    std::vector<std::pair<FxBusId,FxGraph>> graphs;
    for(std::uint32_t i=0;i<count && r.ok;++i) {
        const auto bus=r.u32();
        const auto length=r.u32();
        if(!r.ok || bus==0 || length>size-r.pos) return false;
        FxGraph graph;
        if(!decodeFxGraph(r.data+r.pos,length,graph)) return false;
        r.pos+=length;
        for(const auto& [existing,unused]:graphs) if(existing==bus) return false;
        graphs.emplace_back(bus,std::move(graph));
    }
    if(!r.ok || r.pos!=size) return false;
    if(std::none_of(graphs.begin(),graphs.end(),[](const auto& e){return e.first==fxMainBusId;})) return false;
    documents_.clear();
    globals_=probe.globals();
    for(auto& [bus,graph]:graphs) add(bus,std::move(graph));
    generation_.fetch_add(1,std::memory_order_release);
    if(onChanged) onChanged();
    return true;
}

void FxWorkspace::adoptLegacyMainGraph(FxGraph graph) {
    documents_.clear();
    globals_=graph.globals();
    graph.setGlobals(FxGlobalSettings{});
    add(fxMainBusId,std::move(graph));
    generation_.fetch_add(1,std::memory_order_release);
    if(onChanged) onChanged();
}

}
