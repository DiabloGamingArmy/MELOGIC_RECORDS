#include "../ParameterFormatting.h"
// mct-origami-unified-routing-core-fx-p04
// mct-origami-fx-modulation-graph-ux-p03
// mct-origami-fx-graph-dsp-bus-routing-p02
// mct-origami-fx-page-foundation-p01
#include "core/fx/FxGraph.h"
#include "core/fx/SpectralTune.h"
#include <algorithm>
#include <cmath>
#include <cstdio>
#include <cstring>

namespace mct::origami::fx {
namespace {
constexpr std::size_t maxNameBytes=64;
constexpr float minGainDb=-24.0f,maxGainDb=24.0f,maxWidth=2.0f;
constexpr float serialSpacing=240.0f;

bool finite(float v) noexcept { return std::isfinite(v); }
bool finite(FxPoint p) noexcept { return finite(p.x) && finite(p.y); }

bool validKind(FxNodeKind kind) noexcept {
    switch(kind) {
    case FxNodeKind::Source: case FxNodeKind::Effect: case FxNodeKind::Split:
    case FxNodeKind::Merge: case FxNodeKind::Output: return true;
    case FxNodeKind::Send: case FxNodeKind::Return: return false; // reserved
    }
    return false;
}

bool validMode(FxRoutingMode mode) noexcept {
    return static_cast<int>(mode)>=1 && static_cast<int>(mode)<=5;
}

FxNode defaultEffectNode(const FxEffectDescriptor& d) {
    FxNode node;
    node.kind=FxNodeKind::Effect;
    node.effect=d.type;
    node.name=d.label;
    node.ports=fxPortTopology(FxNodeKind::Effect);
    for(std::size_t i=0;i<d.parameterCount;++i)
        node.parameters.push_back({d.parameters[i].id,d.parameters[i].defaultValue});
    return node;
}

FxPoint clampPoint(FxPoint p) noexcept { return {std::max(0.0f,p.x),std::max(0.0f,p.y)}; }
}

const std::array<FxSourceDescriptor,5>& fxSourceCatalog() noexcept {
    // Source KINDS. Concrete audio buses come from the instrument's BusState.
    static const std::array<FxSourceDescriptor,5> catalog{{
        {FxSourceType::Bus,"bus","BUS",FxSignalDomain::Audio,true},
        {FxSourceType::ExternalInput,"external","EXTERNAL IN",FxSignalDomain::Audio,false},
        {FxSourceType::EnvelopeBus,"env","ENV",FxSignalDomain::Control,false},
        {FxSourceType::LfoBus,"lfo","LFO",FxSignalDomain::Control,false},
        {FxSourceType::MidiBus,"midi","MIDI",FxSignalDomain::Control,false},
    }};
    return catalog;
}

const FxSourceDescriptor* findFxSource(FxSourceType type) noexcept {
    for(const auto& d:fxSourceCatalog()) if(d.type==type) return &d;
    return nullptr;
}

float fxParameterValue(const FxParameterDescriptor& d,float normalized) noexcept {
    const float t=std::clamp(finite(normalized) ? normalized : d.defaultValue,0.0f,1.0f);
    switch(d.curve) {
    case FxParameterCurve::Exponential:
        return d.minimum*std::pow(d.maximum/d.minimum,t);
    case FxParameterCurve::Choice: {
        const int states=std::max(2,d.choices);
        return std::round(t*float(states-1));
    }
    case FxParameterCurve::Linear: break;
    }
    return d.minimum+(d.maximum-d.minimum)*t;
}

int fxChoiceIndex(const FxParameterDescriptor& d,float normalized) noexcept {
    return static_cast<int>(fxParameterValue(d,normalized));
}

float fxChoiceNormalized(const FxParameterDescriptor& d,int index) noexcept {
    const int states=std::max(2,d.choices);
    return std::clamp(float(index)/float(states-1),0.0f,1.0f);
}

const std::array<FxCategory,8>& fxCategoryOrder() noexcept {
    static constexpr std::array<FxCategory,8> order{FxCategory::Dynamics,FxCategory::FilterEq,FxCategory::Distortion,FxCategory::Modulation,FxCategory::Spectral,FxCategory::Spatial,FxCategory::Time,FxCategory::Utility};
    return order;
}

const char* fxCategoryName(FxCategory c) noexcept {
    switch(c) {
    case FxCategory::Distortion: return "DISTORTION";
    case FxCategory::Time: return "TIME";
    case FxCategory::Spatial: return "SPATIAL";
    case FxCategory::Modulation: return "MODULATION";
    case FxCategory::FilterEq: return "FILTER / EQ";
    case FxCategory::Dynamics: return "DYNAMICS";
    case FxCategory::Utility: return "UTILITY";
    case FxCategory::Spectral: return "SPECTRAL";
    }
    return "EFFECTS";
}

const FxParameterDescriptor* findFxParameter(const FxEffectDescriptor& d,FxParameterId id) noexcept {
    for(std::size_t i=0;i<d.parameterCount;++i) if(d.parameters[i].id==id) return &d.parameters[i];
    return nullptr;
}

bool FxNode::parameterVisible(const FxParameterDescriptor& p) const noexcept {
    if(p.modeParameter==0) return true;
    const auto* d=findFxEffect(effect);
    const auto* mode=d ? findFxParameter(*d,p.modeParameter) : nullptr;
    if(mode==nullptr) return true;
    const int index=fxChoiceIndex(*mode,parameter(p.modeParameter).value_or(mode->defaultValue));
    return index>=0 && index<32 && (p.modeMask&(1u<<index))!=0;
}

std::string fxParameterText(const FxParameterDescriptor& d,float normalized) {
    const float v=fxParameterValue(d,normalized);
    char text[32];
    const std::string unit=d.unit;
    if(d.curve==FxParameterCurve::Choice) {
        const int index=static_cast<int>(v);
        if(d.choiceLabels!=nullptr && index>=0 && index<d.choices) return d.choiceLabels[index];
        return v>=0.5f ? "ON" : "OFF";
    }
    if(unit=="%") std::snprintf(text,sizeof(text),"%d%%",int(std::lround(v*100.0f)));
    else if(unit=="Hz") return formatFrequencyHz(v);
    else if(unit=="ms" && v>=1000.0f) std::snprintf(text,sizeof(text),"%.2f s",v/1000.0f);
    else if(std::abs(v)<10.0f) std::snprintf(text,sizeof(text),"%.2f %s",v,d.unit);
    else std::snprintf(text,sizeof(text),"%.0f %s",v,d.unit);
    return text;
}

const char* toString(FxEditResult r) noexcept {
    switch(r) {
    case FxEditResult::Ok: return "ok";
    case FxEditResult::UnknownNode: return "unknown node";
    case FxEditResult::InvalidPort: return "invalid port";
    case FxEditResult::SelfConnection: return "self connection";
    case FxEditResult::DuplicateConnection: return "duplicate connection";
    case FxEditResult::InputOccupied: return "input occupied";
    case FxEditResult::OutputOccupied: return "output occupied";
    case FxEditResult::WouldCreateCycle: return "would create cycle";
    case FxEditResult::ControlSourceNotRoutable: return "control source is not audio";
    case FxEditResult::ProtectedNode: return "protected node";
    case FxEditResult::InvalidValue: return "invalid value";
    case FxEditResult::CapacityExceeded: return "capacity exceeded";
    case FxEditResult::Unsupported: return "unsupported";
    case FxEditResult::UnknownConnection: return "unknown connection";
    case FxEditResult::SameDirection: return "ports have the same direction";
    case FxEditResult::TypeMismatch: return "port signal types differ";
    case FxEditResult::ExecutionDomainMismatch: return "nodes run in different execution domains";
    }
    return "unknown";
}

FxPortTopology fxPortTopology(FxNodeKind kind,std::uint8_t branches) noexcept {
    switch(kind) {
    case FxNodeKind::Source: return {0,1};
    case FxNodeKind::Effect: return {1,1};
    case FxNodeKind::Split: return {1,branches};
    case FxNodeKind::Merge: return {branches,1};
    case FxNodeKind::Send: return {1,2};   // through + send (reserved)
    case FxNodeKind::Return: return {1,1}; // reserved
    case FxNodeKind::Output: return {1,0};
    }
    return {};
}

// ---------------------------------------------------------------- typed ports

namespace {
constexpr const char* branchNames[FxGraph::maxBranches]{"A","B","C","D","E","F","G","H"};
nodes::NodeSignalType sourcePortType(const FxNode& node) noexcept {
    const auto* d=findFxSource(node.source);
    return d!=nullptr ? d->domain : nodes::NodeSignalType::Audio;
}
}

std::uint8_t fxPortCount(const FxNode& node,nodes::PortDirection direction) noexcept {
    return direction==nodes::PortDirection::Input ? node.ports.inputs : node.ports.outputs;
}

std::optional<nodes::PortDescriptor> fxPort(const FxNode& node,nodes::PortDirection direction,std::uint8_t index) noexcept {
    using nodes::PortDirection;
    using nodes::NodeSignalType;
    if(index>=fxPortCount(node,direction)) return std::nullopt;
    const bool input=direction==PortDirection::Input;
    nodes::PortDescriptor port{direction,NodeSignalType::Audio,index,input ? "Audio In" : "Audio Out"};
    switch(node.kind) {
    case FxNodeKind::Source: port.type=sourcePortType(node); break;
    case FxNodeKind::Split: if(!input) port.name=branchNames[index]; break;
    case FxNodeKind::Merge: if(input) port.name=branchNames[index]; break;
    case FxNodeKind::Send: if(!input) port.name=index==0 ? "Through" : "Send"; break;
    case FxNodeKind::Return: if(input) port.name="Return In"; break;
    case FxNodeKind::Effect: case FxNodeKind::Output: break;
    }
    return port;
}

std::vector<nodes::PortDescriptor> fxNodePorts(const FxNode& node) {
    std::vector<nodes::PortDescriptor> ports;
    for(auto direction:{nodes::PortDirection::Input,nodes::PortDirection::Output})
        for(std::uint8_t i=0;i<fxPortCount(node,direction);++i) ports.push_back(*fxPort(node,direction,i));
    return ports;
}

nodes::NodeExecutionDomain fxExecutionDomain(const FxNode&) noexcept {
    // Every FX graph node processes its bus's summed audio once: GLOBAL.
    return nodes::NodeExecutionDomain::Global;
}

std::optional<float> FxNode::parameter(FxParameterId id) const noexcept {
    for(const auto& p:parameters) if(p.id==id) return p.value;
    return std::nullopt;
}

// ---------------------------------------------------------------- FxGraph

FxNode* FxGraph::mutableNode(FxNodeId id) noexcept {
    for(auto& n:nodes_) if(n.id==id) return &n;
    return nullptr;
}

FxConnection* FxGraph::mutableConnection(FxConnectionId id) noexcept {
    for(auto& c:connections_) if(c.id==id) return &c;
    return nullptr;
}

const FxNode* FxGraph::findNode(FxNodeId id) const noexcept {
    for(const auto& n:nodes_) if(n.id==id) return &n;
    return nullptr;
}

const FxConnection* FxGraph::findConnection(FxConnectionId id) const noexcept {
    for(const auto& c:connections_) if(c.id==id) return &c;
    return nullptr;
}

FxNodeId FxGraph::appendNode(FxNode node) {
    if(nodes_.size()>=maxNodes || !finite(node.position)) return invalidFxNodeId;
    node.position=clampPoint(node.position);
    node.id=nextNodeId_++;
    nodes_.push_back(std::move(node));
    return nodes_.back().id;
}

FxNodeId FxGraph::addBusSource(FxBusId bus,FxPoint at) {
    if(bus==0 || sourceForBus(bus)!=invalidFxNodeId) return invalidFxNodeId;
    FxNode node;
    node.kind=FxNodeKind::Source;
    node.source=FxSourceType::Bus;
    node.bus=bus;
    node.name="IN"; // displayed as "<BUS NAME> IN" from the canonical bus model
    node.position=at;
    node.ports=fxPortTopology(FxNodeKind::Source);
    return appendNode(std::move(node));
}

FxNodeId FxGraph::addEffect(FxEffectType type,FxPoint at) {
    const auto* d=findFxEffect(type);
    if(d==nullptr) return invalidFxNodeId;
    auto node=defaultEffectNode(*d);
    node.position=at;
    return appendNode(std::move(node));
}

FxNodeId FxGraph::addSplit(FxPoint at,std::uint8_t outputs) {
    if(outputs<minBranches || outputs>maxBranches) return invalidFxNodeId;
    FxNode node;
    node.kind=FxNodeKind::Split;
    node.name="SPLIT";
    node.position=at;
    node.ports=fxPortTopology(FxNodeKind::Split,outputs);
    return appendNode(std::move(node));
}

FxNodeId FxGraph::addMerge(FxPoint at,std::uint8_t inputs) {
    if(inputs<minBranches || inputs>maxBranches) return invalidFxNodeId;
    FxNode node;
    node.kind=FxNodeKind::Merge;
    node.name="MERGE";
    node.position=at;
    node.ports=fxPortTopology(FxNodeKind::Merge,inputs);
    return appendNode(std::move(node));
}

FxNodeId FxGraph::addOutput(FxPoint at) {
    if(outputNode()!=invalidFxNodeId) return invalidFxNodeId;
    FxNode node;
    node.kind=FxNodeKind::Output;
    node.name="OUT"; // displayed as "<BUS NAME> OUT" (MAIN OUT feeds the master)
    node.position=at;
    node.ports=fxPortTopology(FxNodeKind::Output);
    return appendNode(std::move(node));
}

FxNodeId FxGraph::addModule(const FxModuleSpec& spec,FxPoint at) {
    switch(spec.kind) {
    case FxModuleKind::Effect: return addEffect(spec.effect,at);
    case FxModuleKind::Split: return addSplit(at);
    case FxModuleKind::Merge: return addMerge(at);
    case FxModuleKind::BusSource: return addBusSource(spec.bus,at);
    }
    return invalidFxNodeId;
}

FxEditResult FxGraph::removeNode(FxNodeId id) {
    const auto* node=findNode(id);
    if(node==nullptr) return FxEditResult::UnknownNode;
    if(node->kind==FxNodeKind::Source || node->kind==FxNodeKind::Output) return FxEditResult::ProtectedNode;
    connections_.erase(std::remove_if(connections_.begin(),connections_.end(),[id](const FxConnection& c) {
        return c.from.node==id || c.to.node==id;
    }),connections_.end());
    nodes_.erase(std::remove_if(nodes_.begin(),nodes_.end(),[id](const FxNode& n){return n.id==id;}),nodes_.end());
    return FxEditResult::Ok;
}

FxEditResult FxGraph::removeNodeBridging(FxNodeId id) {
    const auto* node=findNode(id);
    if(node==nullptr) return FxEditResult::UnknownNode;
    std::optional<FxPortRef> upstream,downstream;
    if(node->kind==FxNodeKind::Effect) {
        if(const auto* in=connectionAt({id,0},true)) upstream=in->from;
        if(const auto* out=connectionAt({id,0},false)) downstream=out->to;
    }
    const auto result=removeNode(id);
    if(result==FxEditResult::Ok && upstream && downstream) connect(*upstream,*downstream);
    return result;
}

void FxGraph::clearProcessing() {
    std::vector<FxNodeId> doomed;
    for(const auto& n:nodes_)
        if(n.kind!=FxNodeKind::Source && n.kind!=FxNodeKind::Output) doomed.push_back(n.id);
    for(auto id:doomed) removeNode(id);
    const auto src=sourceNode(),out=outputNode();
    if(src!=invalidFxNodeId && out!=invalidFxNodeId && connectionAt({out,0},true)==nullptr)
        connect({src,0},{out,0});
}

const FxConnection* FxGraph::connectionAt(FxPortRef port,bool input) const noexcept {
    for(const auto& c:connections_) if((input ? c.to : c.from)==port) return &c;
    return nullptr;
}

bool FxGraph::reaches(FxNodeId from,FxNodeId target) const noexcept {
    if(from==target) return true;
    std::vector<FxNodeId> stack{from},seen;
    while(!stack.empty()) {
        const auto id=stack.back();
        stack.pop_back();
        if(std::find(seen.begin(),seen.end(),id)!=seen.end()) continue;
        seen.push_back(id);
        for(const auto& c:connections_) {
            if(c.from.node!=id) continue;
            if(c.to.node==target) return true;
            stack.push_back(c.to.node);
        }
    }
    return false;
}

FxEditResult FxGraph::canConnect(FxPortRef from,FxPortRef to) const noexcept {
    return checkConnection({from.node,nodes::PortDirection::Output,from.port},
                           {to.node,nodes::PortDirection::Input,to.port}).result;
}

FxConnectionCheck FxGraph::checkConnection(FxPortEndpoint a,FxPortEndpoint b) const noexcept {
    FxConnectionCheck check;
    const auto fail=[&check](FxEditResult r){check.result=r; return check;};
    const auto* nodeA=findNode(a.node);
    const auto* nodeB=findNode(b.node);
    if(nodeA==nullptr || nodeB==nullptr) return fail(FxEditResult::UnknownNode);
    if(a.direction==b.direction) return fail(FxEditResult::SameDirection);
    if(a.direction==nodes::PortDirection::Input) { std::swap(a,b); std::swap(nodeA,nodeB); }
    const auto out=fxPort(*nodeA,a.direction,a.port);
    const auto in=fxPort(*nodeB,b.direction,b.port);
    if(!out || !in) return fail(FxEditResult::InvalidPort);
    const FxPortRef from{a.node,a.port},to{b.node,b.port};
    check.from=from; check.to=to;
    if(from.node==to.node) return fail(FxEditResult::SelfConnection);
    if(nodeA->kind==FxNodeKind::Source && out->type!=nodes::NodeSignalType::Audio)
        return fail(FxEditResult::ControlSourceNotRoutable);
    if(nodes::checkPortPair(*out,*in)==nodes::PortPairError::TypeMismatch) return fail(FxEditResult::TypeMismatch);
    if(fxExecutionDomain(*nodeA)!=fxExecutionDomain(*nodeB)) return fail(FxEditResult::ExecutionDomainMismatch);
    for(const auto& c:connections_) if(c.from==from && c.to==to) return fail(FxEditResult::DuplicateConnection);
    // One wire per port. Fan-out and summing are explicit Split/Merge nodes,
    // which keeps the visual language honest about where signals divide.
    if(connectionAt(to,true)!=nullptr) return fail(FxEditResult::InputOccupied);
    if(connectionAt(from,false)!=nullptr) return fail(FxEditResult::OutputOccupied);
    if(connections_.size()>=maxConnections) return fail(FxEditResult::CapacityExceeded);
    if(reaches(to.node,from.node)) return fail(FxEditResult::WouldCreateCycle);
    return fail(FxEditResult::Ok);
}

FxEditResult FxGraph::connect(FxPortRef from,FxPortRef to,FxConnectionId* created) {
    const auto result=canConnect(from,to);
    if(result!=FxEditResult::Ok) return result;
    connections_.push_back({nextConnectionId_++,from,to,{}});
    if(created!=nullptr) *created=connections_.back().id;
    return FxEditResult::Ok;
}

bool FxGraph::disconnect(FxConnectionId id) noexcept {
    const auto before=connections_.size();
    connections_.erase(std::remove_if(connections_.begin(),connections_.end(),[id](const FxConnection& c){return c.id==id;}),connections_.end());
    return connections_.size()!=before;
}

std::size_t FxGraph::disconnectPort(FxNodeId node,bool input,std::uint8_t port) noexcept {
    const FxPortRef ref{node,port};
    const auto before=connections_.size();
    connections_.erase(std::remove_if(connections_.begin(),connections_.end(),[&](const FxConnection& c) {
        return (input ? c.to : c.from)==ref;
    }),connections_.end());
    return before-connections_.size();
}

FxNodeId FxGraph::insertEffectOnConnection(FxConnectionId id,FxEffectType type,FxPoint at) {
    return insertModuleOnConnection(id,{FxModuleKind::Effect,type,0},at);
}

FxNodeId FxGraph::parallelOnConnection(FxConnectionId id,FxEffectType type) {
    const auto* original=findConnection(id);
    if(original==nullptr || findFxEffect(type)==nullptr) return invalidFxNodeId;
    const auto snapshot=*this;
    const auto from=original->from,to=original->to;
    const auto* a=findNode(from.node);
    const auto* b=findNode(to.node);
    const FxPoint start=a->position,end=b->position;
    const float midX=(start.x+end.x)*0.5f;
    disconnect(id);
    const auto split=addSplit({std::max(0.0f,midX-200.0f),start.y+30.0f});
    const auto merge=addMerge({midX+200.0f,start.y+30.0f});
    const auto created=addEffect(type,{midX-106.0f,start.y+150.0f});
    const bool ok=split && merge && created
        && connect(from,{split,0})==FxEditResult::Ok
        && connect({split,0},{merge,0})==FxEditResult::Ok
        && connect({split,1},{created,0})==FxEditResult::Ok
        && connect({created,0},{merge,1})==FxEditResult::Ok
        && connect({merge,0},to)==FxEditResult::Ok;
    if(!ok) { *this=snapshot; return invalidFxNodeId; }
    return created;
}

FxNodeId FxGraph::parallelAroundNode(FxNodeId target,FxEffectType type) {
    const auto* node=findNode(target);
    if(node==nullptr || node->kind!=FxNodeKind::Effect || findFxEffect(type)==nullptr) return invalidFxNodeId;
    const auto* in=connectionAt({target,0},true);
    const auto* out=connectionAt({target,0},false);
    if(in==nullptr || out==nullptr) return invalidFxNodeId; // ambiguous: not a chained node
    const auto snapshot=*this;
    const auto from=in->from,to=out->to;
    const auto position=node->position;
    disconnectPort(target,true,0);
    disconnectPort(target,false,0);
    const auto split=addSplit({std::max(0.0f,position.x-140.0f),position.y+50.0f});
    const auto merge=addMerge({position.x+260.0f,position.y+50.0f});
    const auto created=addEffect(type,{position.x,position.y+200.0f});
    const bool ok=split && merge && created
        && connect(from,{split,0})==FxEditResult::Ok
        && connect({split,0},{target,0})==FxEditResult::Ok
        && connect({target,0},{merge,0})==FxEditResult::Ok
        && connect({split,1},{created,0})==FxEditResult::Ok
        && connect({created,0},{merge,1})==FxEditResult::Ok
        && connect({merge,0},to)==FxEditResult::Ok;
    if(!ok) { *this=snapshot; return invalidFxNodeId; }
    return created;
}

FxNodeId FxGraph::branchFromConnection(FxConnectionId id,FxEffectType type) {
    const auto* original=findConnection(id);
    if(original==nullptr || findFxEffect(type)==nullptr) return invalidFxNodeId;
    const auto snapshot=*this;
    const auto from=original->from,to=original->to;
    const auto start=findNode(from.node)->position;
    disconnect(id);
    const auto split=addSplit({start.x+200.0f,start.y+30.0f});
    const auto created=addEffect(type,{start.x+340.0f,start.y+170.0f});
    const bool ok=split && created
        && connect(from,{split,0})==FxEditResult::Ok
        && connect({split,0},to)==FxEditResult::Ok
        && connect({split,1},{created,0})==FxEditResult::Ok;
    if(!ok) { *this=snapshot; return invalidFxNodeId; }
    return created;
}

FxNodeId FxGraph::insertModuleOnConnection(FxConnectionId id,const FxModuleSpec& spec,FxPoint at) {
    const auto* original=findConnection(id);
    if(original==nullptr || spec.kind==FxModuleKind::BusSource) return invalidFxNodeId;
    if(spec.kind==FxModuleKind::Effect && findFxEffect(spec.effect)==nullptr) return invalidFxNodeId;
    const auto snapshot=*this;
    const auto from=original->from,to=original->to;
    disconnect(id);
    const auto created=addModule(spec,at);
    if(created==invalidFxNodeId || connect(from,{created,0})!=FxEditResult::Ok
       || connect({created,0},to)!=FxEditResult::Ok) {
        *this=snapshot;
        return invalidFxNodeId;
    }
    return created;
}

FxEditResult FxGraph::addLayoutPoint(FxConnectionId id,std::size_t index,FxPoint at) {
    auto* c=mutableConnection(id);
    if(c==nullptr) return FxEditResult::UnknownConnection;
    if(!finite(at)) return FxEditResult::InvalidValue;
    if(c->layout.size()>=maxLayoutPoints) return FxEditResult::CapacityExceeded;
    index=std::min(index,c->layout.size());
    c->layout.insert(c->layout.begin()+static_cast<std::ptrdiff_t>(index),clampPoint(at));
    return FxEditResult::Ok;
}

FxEditResult FxGraph::moveLayoutPoint(FxConnectionId id,std::size_t index,FxPoint at) {
    auto* c=mutableConnection(id);
    if(c==nullptr) return FxEditResult::UnknownConnection;
    if(index>=c->layout.size()) return FxEditResult::InvalidPort;
    if(!finite(at)) return FxEditResult::InvalidValue;
    c->layout[index]=clampPoint(at);
    return FxEditResult::Ok;
}

FxEditResult FxGraph::removeLayoutPoint(FxConnectionId id,std::size_t index) {
    auto* c=mutableConnection(id);
    if(c==nullptr) return FxEditResult::UnknownConnection;
    if(index>=c->layout.size()) return FxEditResult::InvalidPort;
    c->layout.erase(c->layout.begin()+static_cast<std::ptrdiff_t>(index));
    return FxEditResult::Ok;
}

FxEditResult FxGraph::moveNode(FxNodeId id,FxPoint at) noexcept {
    auto* node=mutableNode(id);
    if(node==nullptr) return FxEditResult::UnknownNode;
    if(!finite(at)) return FxEditResult::InvalidValue;
    node->position=clampPoint(at);
    return FxEditResult::Ok;
}

FxEditResult FxGraph::setEnabled(FxNodeId id,bool enabled) noexcept {
    auto* node=mutableNode(id);
    if(node==nullptr) return FxEditResult::UnknownNode;
    if(node->kind!=FxNodeKind::Effect) return FxEditResult::Unsupported;
    node->enabled=enabled;
    return FxEditResult::Ok;
}

FxEditResult FxGraph::setParameter(FxNodeId id,FxParameterId parameter,float value) noexcept {
    auto* node=mutableNode(id);
    if(node==nullptr) return FxEditResult::UnknownNode;
    if(!finite(value)) return FxEditResult::InvalidValue;
    for(auto& p:node->parameters) {
        if(p.id!=parameter) continue;
        p.value=std::clamp(value,0.0f,1.0f);
        if(node->effect==FxEffectType::SpectralTune) spectral::normalizeState(*node,parameter);
        return FxEditResult::Ok;
    }
    return FxEditResult::InvalidPort;
}

FxNodeId FxGraph::sourceNode() const noexcept {
    for(const auto& n:nodes_) if(n.kind==FxNodeKind::Source) return n.id;
    return invalidFxNodeId;
}

FxNodeId FxGraph::sourceForBus(FxBusId bus) const noexcept {
    for(const auto& n:nodes_) if(n.kind==FxNodeKind::Source && n.bus==bus) return n.id;
    return invalidFxNodeId;
}

FxNodeId FxGraph::outputNode() const noexcept {
    for(const auto& n:nodes_) if(n.kind==FxNodeKind::Output) return n.id;
    return invalidFxNodeId;
}

FxNodeId FxGraph::insertEffectBeforeOutput(FxEffectType type) {
    const auto output=outputNode();
    const auto* outputNodePtr=findNode(output);
    if(outputNodePtr==nullptr) return invalidFxNodeId;
    const FxPortRef outputIn{output,0};
    std::optional<FxPortRef> upstream;
    if(const auto* existing=connectionAt(outputIn,true)) upstream=existing->from;
    else if(const auto src=sourceNode(); src!=invalidFxNodeId && connectionAt({src,0},false)==nullptr)
        upstream=FxPortRef{src,0};

    FxPoint at=outputNodePtr->position;
    if(upstream) {
        const auto* up=findNode(upstream->node);
        at={up->position.x+serialSpacing,outputNodePtr->position.y-10.0f};
    }
    const auto created=addEffect(type,at);
    if(created==invalidFxNodeId) return invalidFxNodeId;
    if(upstream) {
        disconnectPort(output,true,0);
        connect(*upstream,{created,0});
    }
    connect({created,0},outputIn);
    if(auto* out=mutableNode(output)) out->position.x=std::max(out->position.x,at.x+serialSpacing);
    return created;
}

bool FxGraph::applyTemplate(FxRoutingMode mode) {
    if(mode!=FxRoutingMode::Serial) return false; // other templates: later patches
    const auto src=sourceNode(),out=outputNode();
    if(src==invalidFxNodeId || out==invalidFxNodeId) return false;
    std::vector<FxNodeId> routing;
    for(const auto& n:nodes_) if(n.isRouting()) routing.push_back(n.id);
    for(auto id:routing) removeNode(id);
    connections_.clear();
    std::vector<const FxNode*> effects;
    for(const auto& n:nodes_) if(n.kind==FxNodeKind::Effect) effects.push_back(&n);
    std::stable_sort(effects.begin(),effects.end(),[](const FxNode* a,const FxNode* b){return a->position.x<b->position.x;});
    std::vector<FxNodeId> chain{src};
    for(const auto* e:effects) chain.push_back(e->id);
    chain.push_back(out);
    const auto baseline=findNode(src)->position;
    for(std::size_t i=0;i<chain.size();++i) {
        auto* node=mutableNode(chain[i]);
        if(i>0) node->position=clampPoint({baseline.x+serialSpacing*static_cast<float>(i)-40.0f,baseline.y-50.0f});
        if(i+1<chain.size()) connect({chain[i],0},{chain[i+1],0});
    }
    mode_=mode;
    return true;
}

void FxGraph::setRoutingMode(FxRoutingMode mode) noexcept {
    if(validMode(mode)) mode_=mode;
}

void FxGraph::setGlobals(const FxGlobalSettings& g) noexcept {
    const auto pick=[](float v,float lo,float hi,float fallback){return finite(v) ? std::clamp(v,lo,hi) : fallback;};
    globals_.inputGainDb=pick(g.inputGainDb,minGainDb,maxGainDb,globals_.inputGainDb);
    globals_.dryWet=pick(g.dryWet,0.0f,1.0f,globals_.dryWet);
    globals_.width=pick(g.width,0.0f,maxWidth,globals_.width);
    globals_.outputGainDb=pick(g.outputGainDb,minGainDb,maxGainDb,globals_.outputGainDb);
    if(g.order==FxOrder::PostMaster || g.order==FxOrder::PreMaster) globals_.order=g.order;
    if(g.bypass==FxBypassMode::Crossfade || g.bypass==FxBypassMode::Hard || g.bypass==FxBypassMode::TailPreserve)
        globals_.bypass=g.bypass;
}

bool FxGraph::validate(std::string* error) const {
    const auto fail=[error](const char* why){if(error!=nullptr) *error=why; return false;};
    if(nodes_.size()>maxNodes) return fail("too many nodes");
    if(connections_.size()>maxConnections) return fail("too many connections");
    if(!validMode(mode_)) return fail("invalid routing mode");
    if(!finite(globals_.inputGainDb) || globals_.inputGainDb<minGainDb || globals_.inputGainDb>maxGainDb
       || !finite(globals_.outputGainDb) || globals_.outputGainDb<minGainDb || globals_.outputGainDb>maxGainDb
       || !finite(globals_.dryWet) || globals_.dryWet<0.0f || globals_.dryWet>1.0f
       || !finite(globals_.width) || globals_.width<0.0f || globals_.width>maxWidth)
        return fail("invalid global settings");
    if((globals_.order!=FxOrder::PostMaster && globals_.order!=FxOrder::PreMaster)
       || (globals_.bypass!=FxBypassMode::Crossfade && globals_.bypass!=FxBypassMode::Hard
           && globals_.bypass!=FxBypassMode::TailPreserve)) return fail("invalid global modes");
    int sources=0,outputs=0;
    for(std::size_t i=0;i<nodes_.size();++i) {
        const auto& n=nodes_[i];
        if(n.id==invalidFxNodeId || n.id>=nextNodeId_) return fail("node id out of range");
        for(std::size_t j=0;j<i;++j) if(nodes_[j].id==n.id) return fail("duplicate node id");
        if(!validKind(n.kind)) return fail("unsupported node kind");
        if(!finite(n.position)) return fail("non-finite node position");
        if(n.name.size()>maxNameBytes) return fail("node name too long");
        const std::uint8_t branches=n.kind==FxNodeKind::Split ? n.ports.outputs : n.ports.inputs;
        if(n.isRouting() && (branches<minBranches || branches>maxBranches)) return fail("invalid branch count");
        const auto expected=fxPortTopology(n.kind,branches);
        if(expected.inputs!=n.ports.inputs || expected.outputs!=n.ports.outputs) return fail("port topology mismatch");
        if(n.kind==FxNodeKind::Effect) {
            const auto* d=findFxEffect(n.effect);
            if(d==nullptr) return fail("unknown effect type");
            for(std::size_t p=0;p<n.parameters.size();++p) {
                const auto& value=n.parameters[p];
                if(!finite(value.value) || value.value<0.0f || value.value>1.0f) return fail("invalid parameter value");
                bool known=false;
                for(std::size_t k=0;k<d->parameterCount;++k) known|=d->parameters[k].id==value.id;
                if(!known) return fail("unknown parameter id");
                for(std::size_t q=0;q<p;++q) if(n.parameters[q].id==value.id) return fail("duplicate parameter id");
            }
        } else {
            if(n.effect!=FxEffectType::None || !n.parameters.empty()) return fail("routing node carries effect state");
            if(!n.enabled) return fail("routing node cannot be bypassed");
        }
        if(n.kind==FxNodeKind::Source) {
            ++sources;
            if(n.source!=FxSourceType::Bus || n.bus==0) return fail("source is not an audio bus");
            for(std::size_t j=0;j<i;++j)
                if(nodes_[j].kind==FxNodeKind::Source && nodes_[j].bus==n.bus) return fail("duplicate bus source");
        } else if(n.bus!=0) return fail("non-source node carries a bus");
        if(n.kind==FxNodeKind::Output) ++outputs;
    }
    if(sources<1) return fail("graph requires a source");
    if(outputs!=1) return fail("graph requires exactly one output");
    for(std::size_t i=0;i<connections_.size();++i) {
        const auto& c=connections_[i];
        if(c.id==0 || c.id>=nextConnectionId_) return fail("connection id out of range");
        const auto* a=findNode(c.from.node);
        const auto* b=findNode(c.to.node);
        if(a==nullptr || b==nullptr) return fail("dangling connection");
        // Port and type validation against the model-owned descriptors.
        const auto out=fxPort(*a,nodes::PortDirection::Output,c.from.port);
        const auto in=fxPort(*b,nodes::PortDirection::Input,c.to.port);
        if(!out || !in) return fail("connection uses nonexistent port");
        if(nodes::checkPortPair(*out,*in)!=nodes::PortPairError::None) return fail("connection joins incompatible port types");
        if(fxExecutionDomain(*a)!=fxExecutionDomain(*b)) return fail("connection crosses execution domains");
        if(c.from.node==c.to.node) return fail("self connection");
        if(c.layout.size()>maxLayoutPoints) return fail("too many layout points");
        for(const auto& p:c.layout) if(!finite(p)) return fail("non-finite layout point");
        for(std::size_t j=0;j<i;++j) {
            const auto& o=connections_[j];
            if(o.id==c.id) return fail("duplicate connection id");
            if(o.from==c.from && o.to==c.to) return fail("duplicate connection");
            if(o.to==c.to) return fail("input port has multiple connections");
            if(o.from==c.from) return fail("output port has multiple connections");
        }
    }
    // Kahn's algorithm: every node must be removable, otherwise a cycle exists.
    std::vector<int> indegree(nodes_.size(),0);
    const auto indexOf=[this](FxNodeId id){for(std::size_t i=0;i<nodes_.size();++i) if(nodes_[i].id==id) return i; return nodes_.size();};
    for(const auto& c:connections_) ++indegree[indexOf(c.to.node)];
    std::vector<std::size_t> ready;
    for(std::size_t i=0;i<nodes_.size();++i) if(indegree[i]==0) ready.push_back(i);
    std::size_t visited=0;
    while(!ready.empty()) {
        const auto i=ready.back();
        ready.pop_back();
        ++visited;
        for(const auto& c:connections_)
            if(c.from.node==nodes_[i].id && --indegree[indexOf(c.to.node)]==0) ready.push_back(indexOf(c.to.node));
    }
    if(visited!=nodes_.size()) return fail("cycle detected");
    return true;
}

bool FxGraph::operator==(const FxGraph& o) const noexcept {
    if(nextNodeId_!=o.nextNodeId_ || nextConnectionId_!=o.nextConnectionId_ || mode_!=o.mode_) return false;
    const auto& a=globals_;
    const auto& b=o.globals_;
    if(a.inputGainDb!=b.inputGainDb || a.dryWet!=b.dryWet || a.width!=b.width || a.outputGainDb!=b.outputGainDb
       || a.order!=b.order || a.bypass!=b.bypass) return false;
    if(nodes_.size()!=o.nodes_.size() || connections_.size()!=o.connections_.size()) return false;
    for(std::size_t i=0;i<nodes_.size();++i) {
        const auto& a=nodes_[i];
        const auto& b=o.nodes_[i];
        if(a.id!=b.id || a.kind!=b.kind || a.effect!=b.effect || a.source!=b.source || a.bus!=b.bus || a.name!=b.name
           || a.enabled!=b.enabled || a.position.x!=b.position.x || a.position.y!=b.position.y
           || a.ports.inputs!=b.ports.inputs || a.ports.outputs!=b.ports.outputs
           || a.parameters.size()!=b.parameters.size()) return false;
        for(std::size_t p=0;p<a.parameters.size();++p)
            if(a.parameters[p].id!=b.parameters[p].id || a.parameters[p].value!=b.parameters[p].value) return false;
    }
    for(std::size_t i=0;i<connections_.size();++i) {
        const auto& a=connections_[i];
        const auto& b=o.connections_[i];
        if(a.id!=b.id || a.from!=b.from || a.to!=b.to || a.layout.size()!=b.layout.size()) return false;
        for(std::size_t p=0;p<a.layout.size();++p)
            if(a.layout[p].x!=b.layout[p].x || a.layout[p].y!=b.layout[p].y) return false;
    }
    return true;
}

FxGraph makeDefaultFxGraph(FxBusId bus) {
    FxGraph g;
    const auto source=g.addBusSource(bus,{40.0f,170.0f});
    const auto output=g.addOutput({760.0f,140.0f});
    g.connect({source,0},{output,0});
    return g;
}

// ---------------------------------------------------------------- codec

namespace {
constexpr std::uint8_t magic[4]{'M','F','X','G'};
constexpr std::uint16_t codecVersion=3;

struct Writer {
    std::vector<std::uint8_t> bytes;
    void u8(std::uint8_t v) { bytes.push_back(v); }
    void u16(std::uint16_t v) { u8(static_cast<std::uint8_t>(v>>8)); u8(static_cast<std::uint8_t>(v)); }
    void u32(std::uint32_t v) { u16(static_cast<std::uint16_t>(v>>16)); u16(static_cast<std::uint16_t>(v)); }
    void f32(float v) { std::uint32_t raw=0; std::memcpy(&raw,&v,4); u32(raw); }
};

struct Reader {
    const std::uint8_t* data;
    std::size_t size,offset=0;
    bool ok=true;
    std::uint8_t u8() noexcept { if(offset>=size) { ok=false; return 0; } return data[offset++]; }
    std::uint16_t u16() noexcept { const auto hi=u8(); return static_cast<std::uint16_t>((hi<<8)|u8()); }
    std::uint32_t u32() noexcept { const std::uint32_t hi=u16(); return (hi<<16)|u16(); }
    float f32() noexcept { const auto raw=u32(); float v=0.0f; std::memcpy(&v,&raw,4); return v; }
};
}

std::vector<std::uint8_t> encodeFxGraph(const FxGraph& graph) {
    Writer w;
    for(auto b:magic) w.u8(b);
    w.u16(codecVersion);
    w.u8(static_cast<std::uint8_t>(graph.routingMode()));
    const auto& g=graph.globals();
    w.f32(g.inputGainDb); w.f32(g.dryWet); w.f32(g.width); w.f32(g.outputGainDb);
    w.u8(static_cast<std::uint8_t>(g.order)); w.u8(static_cast<std::uint8_t>(g.bypass));
    // Persist the allocators too, so IDs stay unique across save/load even
    // after deletions (a deleted ID is never handed out again).
    w.u32(graph.nextNodeId_);
    w.u32(graph.nextConnectionId_);
    w.u16(static_cast<std::uint16_t>(graph.nodes().size()));
    for(const auto& n:graph.nodes()) {
        w.u32(n.id);
        w.u8(static_cast<std::uint8_t>(n.kind));
        w.u16(static_cast<std::uint16_t>(n.effect));
        w.u8(static_cast<std::uint8_t>(n.source));
        w.u32(n.bus);
        w.u8(n.enabled ? 1 : 0);
        w.f32(n.position.x); w.f32(n.position.y);
        w.u8(n.ports.inputs); w.u8(n.ports.outputs);
        const auto nameBytes=std::min<std::size_t>(n.name.size(),maxNameBytes);
        w.u8(static_cast<std::uint8_t>(nameBytes));
        for(std::size_t i=0;i<nameBytes;++i) w.u8(static_cast<std::uint8_t>(n.name[i]));
        w.u8(static_cast<std::uint8_t>(n.parameters.size()));
        for(const auto& p:n.parameters) { w.u16(p.id); w.f32(p.value); }
    }
    w.u16(static_cast<std::uint16_t>(graph.connections().size()));
    for(const auto& c:graph.connections()) {
        w.u32(c.id);
        w.u32(c.from.node); w.u8(c.from.port);
        w.u32(c.to.node); w.u8(c.to.port);
        w.u8(static_cast<std::uint8_t>(c.layout.size()));
        for(const auto& p:c.layout) { w.f32(p.x); w.f32(p.y); }
    }
    return std::move(w.bytes);
}

bool decodeFxGraph(const void* data,std::size_t size,FxGraph& output) noexcept {
    try {
        if(data==nullptr || size>1u<<20) return false;
        Reader r{static_cast<const std::uint8_t*>(data),size};
        for(auto b:magic) if(r.u8()!=b) return false;
        const auto version=r.u16();
        if(version<2 || version>codecVersion) return false;
        FxGraph graph;
        graph.mode_=static_cast<FxRoutingMode>(r.u8());
        graph.globals_.inputGainDb=r.f32();
        graph.globals_.dryWet=r.f32();
        graph.globals_.width=r.f32();
        graph.globals_.outputGainDb=r.f32();
        if(version>=3) {
            graph.globals_.order=static_cast<FxOrder>(r.u8());
            graph.globals_.bypass=static_cast<FxBypassMode>(r.u8());
        }
        graph.nextNodeId_=r.u32();
        graph.nextConnectionId_=r.u32();
        const auto nodeCount=r.u16();
        if(!r.ok || nodeCount>FxGraph::maxNodes) return false;
        for(std::uint16_t i=0;i<nodeCount && r.ok;++i) {
            FxNode n;
            n.id=r.u32();
            n.kind=static_cast<FxNodeKind>(r.u8());
            n.effect=static_cast<FxEffectType>(r.u16());
            n.source=static_cast<FxSourceType>(r.u8());
            n.bus=r.u32();
            const auto enabled=r.u8();
            if(enabled>1) return false;
            n.enabled=enabled==1;
            n.position.x=r.f32(); n.position.y=r.f32();
            n.ports.inputs=r.u8(); n.ports.outputs=r.u8();
            const auto nameBytes=r.u8();
            if(nameBytes>maxNameBytes) return false;
            for(std::uint8_t c=0;c<nameBytes;++c) n.name.push_back(static_cast<char>(r.u8()));
            const auto parameterCount=r.u8();
            if(parameterCount>maxFxParameters) return false;
            for(std::uint8_t p=0;p<parameterCount && r.ok;++p) {
                FxParameterValue v;
                v.id=r.u16();
                v.value=r.f32();
                n.parameters.push_back(v);
            }
            graph.nodes_.push_back(std::move(n));
        }
        const auto connectionCount=r.u16();
        if(!r.ok || connectionCount>FxGraph::maxConnections) return false;
        for(std::uint16_t i=0;i<connectionCount && r.ok;++i) {
            FxConnection c;
            c.id=r.u32();
            c.from.node=r.u32(); c.from.port=r.u8();
            c.to.node=r.u32(); c.to.port=r.u8();
            const auto points=r.u8();
            if(points>FxGraph::maxLayoutPoints) return false;
            for(std::uint8_t p=0;p<points && r.ok;++p) { FxPoint pt; pt.x=r.f32(); pt.y=r.f32(); c.layout.push_back(pt); }
            graph.connections_.push_back(std::move(c));
        }
        if(!r.ok || r.offset!=size) return false;
        // P04: COMB became FILTER (TYPE = COMB). Parameter ids 1-4 (freq,
        // feedback, mix, damp) are kept so modulation routes still resolve;
        // frequency is re-normalized from 20-2000 Hz to 20-20000 Hz.
        if(const auto* filter=findFxEffect(FxEffectType::Filter)) {
            for(auto& n:graph.nodes_) {
                if(n.kind!=FxNodeKind::Effect || n.effect!=FxEffectType::Comb) continue;
                n.effect=FxEffectType::Filter;
                if(n.name=="COMB") n.name=filter->label;
                std::vector<FxParameterValue> migrated;
                for(std::size_t i=0;i<filter->parameterCount;++i) {
                    const auto& p=filter->parameters[i];
                    float value=n.parameter(p.id).value_or(p.defaultValue);
                    if(p.id==1 && n.parameter(1)) value=std::clamp(*n.parameter(1)*float(std::log(100.0)/std::log(1000.0)),0.0f,1.0f);
                    if(p.key==std::string("type")) value=fxChoiceNormalized(p,8);
                    migrated.push_back({p.id,value});
                }
                n.parameters=std::move(migrated);
            }
        }
        if(!graph.validate()) return false;
        for(auto& n:graph.nodes_) if(n.effect==FxEffectType::SpectralTune) spectral::normalizeState(n);
        output=std::move(graph);
        return true;
    } catch(...) {
        return false;
    }
}

// ---------------------------------------------------------------- document

FxGraphDocument::FxGraphDocument(FxGraph initial):graph_(std::move(initial)) {}

void FxGraphDocument::commit(FxGraph next) {
    undo_.push_back(std::move(graph_));
    if(undo_.size()>historyLimit) undo_.erase(undo_.begin());
    redo_.clear();
    graph_=std::move(next);
    ++revision_;
    notify();
}

void FxGraphDocument::beginGesture() {
    gestureStart_=graph_;
}

void FxGraphDocument::endGesture() {
    if(!gestureStart_) return;
    auto start=std::move(*gestureStart_);
    gestureStart_.reset();
    if(start==graph_) return;
    undo_.push_back(std::move(start));
    if(undo_.size()>historyLimit) undo_.erase(undo_.begin());
    redo_.clear();
}

bool FxGraphDocument::undo() {
    if(undo_.empty()) return false;
    gestureStart_.reset();
    redo_.push_back(std::move(graph_));
    graph_=std::move(undo_.back());
    undo_.pop_back();
    ++revision_;
    notify();
    return true;
}

bool FxGraphDocument::redo() {
    if(redo_.empty()) return false;
    gestureStart_.reset();
    undo_.push_back(std::move(graph_));
    graph_=std::move(redo_.back());
    redo_.pop_back();
    ++revision_;
    notify();
    return true;
}

void FxGraphDocument::replace(FxGraph next) {
    undo_.clear();
    redo_.clear();
    gestureStart_.reset();
    graph_=std::move(next);
    ++revision_;
    notify();
}

}
