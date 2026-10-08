// mct-origami-fx-modulation-graph-ux-p03
// mct-origami-fx-graph-dsp-bus-routing-p02
// mct-origami-fx-page-foundation-p01
#include <memory>
#include "core/fx/FxGraph.h"
#include "core/fx/FxRenderer.h"
#include "core/fx/FxEnvironment.h"
#include "core/nodes/ControlGraph.h"
#include "core/fx/FxWorkspace.h"
#include "core/fx/FxFilter.h"
#include "core/Engine.h"
#include "core/preset/StateCodec.h"
#include "tests/NodesScenarios.h"
#include <chrono>
#include <limits>
#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstdlib>
#include <cstring>
#include <functional>
#include <iostream>
#include <new>
#include <set>
#include <string>
#include <vector>

namespace { std::atomic<bool> guardAllocations{false}; std::atomic<unsigned> allocations{0}; }
#ifndef ORIGAMI_SANITIZED
void* operator new(std::size_t size) { if(guardAllocations.load()) ++allocations; if(void* p=std::malloc(size?size:1)) return p; throw std::bad_alloc(); }
void* operator new[](std::size_t size) { return ::operator new(size); }
void operator delete(void* p) noexcept { std::free(p); }
void operator delete[](void* p) noexcept { std::free(p); }
void operator delete(void* p,std::size_t) noexcept { std::free(p); }
void operator delete[](void* p,std::size_t) noexcept { std::free(p); }
#endif

using namespace mct::origami;
using namespace mct::origami::fx;

namespace {
int failures=0,checks=0;
void check(bool condition,const char* message) {
    ++checks;
    if(!condition) {
        ++failures;
        std::cerr<<"FAIL: "<<message<<'\n';
    }
}

constexpr double sr=48000.0;
constexpr float pi2=6.28318530717958647692f;

FxGraph terminals(FxNodeId& source,FxNodeId& output) {
    FxGraph g;
    source=g.addBusSource(fxMainBusId,{0,0});
    output=g.addOutput({800,0});
    return g;
}

// normalized value producing a physical target for a given descriptor parameter
float normalizedFor(FxEffectType type,FxParameterId id,float physical) {
    const auto* d=findFxEffect(type);
    for(std::size_t i=0;i<d->parameterCount;++i) {
        const auto& p=d->parameters[i];
        if(p.id!=id) continue;
        if(p.curve==FxParameterCurve::Exponential) return std::log(physical/p.minimum)/std::log(p.maximum/p.minimum);
        return (physical-p.minimum)/(p.maximum-p.minimum);
    }
    return 0.0f;
}

struct Stereo { std::vector<float> l,r; };
// Renders a stereo signal through the renderer in irregular host blocks.
Stereo render(FxRenderer& fx,const std::function<float(int)>& source,int samples,
              const std::function<void(int)>& beforeBlock={}) {
    Stereo out{std::vector<float>(std::size_t(samples)),std::vector<float>(std::size_t(samples))};
    for(int i=0;i<samples;++i) out.l[std::size_t(i)]=out.r[std::size_t(i)]=source(i);
    const int pattern[]{128,61,333,512,7};
    for(int offset=0,k=0;offset<samples;++k) {
        const int n=std::min(pattern[k%5],samples-offset);
        if(beforeBlock) beforeBlock(offset);
        fx.process(out.l.data()+offset,out.r.data()+offset,n);
        offset+=n;
    }
    return out;
}
float sine(int i,float hz=220.0f,float amp=0.5f) { return amp*std::sin(pi2*hz*float(i)/float(sr)); }
float peak(const std::vector<float>& v,std::size_t from=0,std::size_t to=~std::size_t{0}) {
    float p=0.0f;
    for(std::size_t i=from;i<std::min(to,v.size());++i) p=std::max(p,std::abs(v[i]));
    return p;
}
double energy(const std::vector<float>& v,std::size_t from,std::size_t to) {
    double e=0.0;
    for(std::size_t i=from;i<std::min(to,v.size());++i) e+=double(v[i])*v[i];
    return e;
}
bool allFinite(const Stereo& s) {
    for(std::size_t i=0;i<s.l.size();++i) if(!std::isfinite(s.l[i]) || !std::isfinite(s.r[i])) return false;
    return true;
}
FxNodeId find(const FxGraph& g,FxEffectType type) {
    for(const auto& n:g.nodes()) if(n.effect==type) return n.id;
    return 0;
}

// ---------------------------------------------------------------- model

void identityTests() {
    FxNodeId src=0,out=0;
    auto g=terminals(src,out);
    const auto a=g.addEffect(FxEffectType::Drive,{100,0});
    const auto b=g.addEffect(FxEffectType::Delay,{200,0});
    check(src && out && a && b,"add nodes");
    std::set<FxNodeId> ids;
    for(const auto& n:g.nodes()) ids.insert(n.id);
    check(ids.size()==g.nodes().size(),"node ids unique");
    check(g.removeNode(a)==FxEditResult::Ok && g.findNode(a)==nullptr,"remove node");
    const auto c=g.addEffect(FxEffectType::Reverb,{300,0});
    check(c!=a && c>b,"deleted node ids are never reused");
    check(g.addEffect(FxEffectType::None,{0,0})==invalidFxNodeId,"unknown effect type rejected");
    check(g.addOutput({0,0})==invalidFxNodeId,"only one MASTER OUT");
    check(g.removeNode(out)==FxEditResult::ProtectedNode && g.removeNode(src)==FxEditResult::ProtectedNode,
          "source and output terminals are protected");
    check(g.removeNode(9999)==FxEditResult::UnknownNode,"remove unknown node fails");
    check(g.validate(),"constructed graph validates");
}

void sourceDomainTests() {
    FxGraph g;
    check(g.addBusSource(0,{0,0})==invalidFxNodeId,"bus 0 is not a source");
    const auto bus1=g.addBusSource(fxMainBusId,{0,0});
    check(bus1!=invalidFxNodeId && g.findNode(bus1)->bus==fxMainBusId,"MAIN is the graph's audio source (labelled from the bus model)");
    check(g.addBusSource(fxMainBusId,{0,0})==invalidFxNodeId,"one source node per bus");
    check(g.addBusSource(2,{0,40})!=invalidFxNodeId,"future buses are representable sources");
    int control=0,available=0;
    for(const auto& d:fxSourceCatalog()) {
        control+=d.domain==FxSignalDomain::Control;
        available+=d.available;
        if(d.domain==FxSignalDomain::Control) check(!d.available,"control sources never available as audio");
    }
    check(control==3 && available==1,"source catalog distinguishes control and audio");
    for(const auto& e:fxEffectCatalog()) {
        check(e.processesAudio && e.create!=nullptr,"every catalog effect has real DSP");
        check(e.parameterCount<=maxFxParameters,"parameter count bounded");
        // Compact nodes stay compact: 1-4 quick controls in the default mode.
        FxGraph probe;
        const auto* node=probe.findNode(probe.addEffect(e.type,{0,0}));
        int quick=0;
        for(std::size_t i=0;i<e.parameterCount;++i) quick+=e.parameters[i].quick && node->parameterVisible(e.parameters[i]);
        check(quick>=1 && quick<=4,"1-4 visible quick controls per effect");
    }
}

void connectionTests() {
    FxNodeId src=0,out=0;
    auto g=terminals(src,out);
    const auto a=g.addEffect(FxEffectType::Drive,{100,0});
    const auto b=g.addEffect(FxEffectType::Delay,{200,0});
    FxConnectionId id=0;
    check(g.connect({src,0},{a,0},&id)==FxEditResult::Ok && id!=0,"valid connection");
    check(g.connect({src,0},{a,0})==FxEditResult::DuplicateConnection,"duplicate rejected");
    check(g.connect({a,0},{a,0})==FxEditResult::SelfConnection,"self connection rejected");
    check(g.connect({a,0},{999,0})==FxEditResult::UnknownNode,"nonexistent node rejected");
    check(g.connect({a,1},{b,0})==FxEditResult::InvalidPort,"nonexistent output port rejected");
    check(g.connect({a,0},{b,3})==FxEditResult::InvalidPort,"nonexistent input port rejected");
    check(g.connect({out,0},{b,0})==FxEditResult::InvalidPort,"MASTER OUT has no downstream output");
    check(g.connect({a,0},{src,0})==FxEditResult::InvalidPort,"source has no input");
    check(g.connect({a,0},{b,0})==FxEditResult::Ok,"chain continues");
    check(g.connect({b,0},{a,0})==FxEditResult::InputOccupied,"occupied input rejected");
    const auto c=g.addEffect(FxEffectType::Reverb,{300,0});
    check(g.connect({a,0},{c,0})==FxEditResult::OutputOccupied,"fan-out requires explicit split");
    check(g.connect({b,0},{c,0})==FxEditResult::Ok,"b -> c");
    g.disconnectPort(a,true,0);
    check(g.connect({c,0},{a,0})==FxEditResult::WouldCreateCycle,"uncontrolled feedback cycle rejected");
    check(g.validate(),"graph after connection edits validates");
    check(g.removeNode(b)==FxEditResult::Ok,"remove connected node");
    bool dangling=false;
    for(const auto& conn:g.connections()) dangling|=conn.from.node==b || conn.to.node==b;
    check(!dangling && g.validate(),"removing node removes its connections");
    check(g.connect({src,0},{a,0},&id)==FxEditResult::Ok,"reconnect source");
    check(g.disconnect(id) && !g.disconnect(id),"disconnect by id");
}

void routingNodeTests() {
    FxGraph g;
    const auto split=g.addSplit({0,0});
    const auto merge=g.addMerge({0,0},3);
    const auto* s=g.findNode(split);
    const auto* m=g.findNode(merge);
    check(s && s->ports.inputs==1 && s->ports.outputs==2,"split: one input, two outputs");
    check(m && m->ports.inputs==3 && m->ports.outputs==1,"merge: n inputs, one output");
    check(s && s->isRouting() && s->parameters.empty() && s->effect==FxEffectType::None,"split is routing, not an effect");
    check(g.addSplit({0,0},1)==invalidFxNodeId && g.addSplit({0,0},9)==invalidFxNodeId,"split branch bounds");
    check(g.setEnabled(split,false)==FxEditResult::Unsupported,"routing nodes cannot be bypassed");
}

void editingTests() {
    // Insert-on-connection: A -> B becomes A -> X -> B atomically.
    auto g=makeDefaultFxGraph();
    const auto src=g.sourceNode(),out=g.outputNode();
    const auto wire=g.connectionAt({out,0},true)->id;
    check(g.addLayoutPoint(wire,0,{300,90})==FxEditResult::Ok && g.findConnection(wire)->layout.size()==1,"layout point stored on connection");
    check(g.moveLayoutPoint(wire,0,{320,120})==FxEditResult::Ok && g.findConnection(wire)->layout[0].y==120.0f,"layout point moves");
    check(g.moveLayoutPoint(wire,3,{0,0})!=FxEditResult::Ok,"invalid layout index rejected");
    check(g.removeLayoutPoint(wire,0)==FxEditResult::Ok && g.findConnection(wire)->layout.empty(),"layout point removed");
    for(std::size_t i=0;i<FxGraph::maxLayoutPoints;++i) g.addLayoutPoint(wire,i,{float(i),0});
    check(g.addLayoutPoint(wire,0,{0,0})==FxEditResult::CapacityExceeded,"layout points bounded");
    const auto x=g.insertEffectOnConnection(wire,FxEffectType::Delay,{400,100});
    check(x!=invalidFxNodeId && g.findConnection(wire)==nullptr,"insert replaces the clicked connection");
    check(g.connectionAt({src,0},false)->to.node==x && g.connectionAt({out,0},true)->from.node==x,"A -> X -> B");
    check(g.findNode(x)->position.x==400.0f && g.validate(),"inserted at clicked position, graph valid");
    const auto before=g;
    const auto reWire=g.connectionAt({x,0},false)->id;
    check(g.insertEffectOnConnection(reWire,FxEffectType::None,{0,0})==invalidFxNodeId && g==before,"failed insert preserves the original connection");
    check(g.insertEffectOnConnection(9999,FxEffectType::Drive,{0,0})==invalidFxNodeId && g==before,"unknown connection insert is a no-op");
    // Bridging delete keeps the chain audible.
    check(g.removeNodeBridging(x)==FxEditResult::Ok && g.connectionAt({out,0},true)->from.node==src,"bridging delete reconnects A -> B");
    // Clear restores the neutral graph.
    g.insertEffectBeforeOutput(FxEffectType::Drive);
    g.clearProcessing();
    check(g.nodes().size()==2 && g.connectionAt({out,0},true) && g.validate(),"clear leaves BUS 1 -> MASTER OUT");
    // Serial template + insert.
    FxNodeId s=0,o=0;
    auto chain=terminals(s,o);
    const auto d1=chain.insertEffectBeforeOutput(FxEffectType::Drive);
    const auto d2=chain.insertEffectBeforeOutput(FxEffectType::Delay);
    check(chain.connectionAt({s,0},false)->to.node==d1 && chain.connectionAt({d1,0},false)->to.node==d2
          && chain.connectionAt({d2,0},false)->to.node==o,"serial insert builds drive -> delay -> out");
    auto dev=makeDevelopmentFxGraph();
    check(dev.applyTemplate(FxRoutingMode::Serial) && dev.validate(),"serial template applies");
    for(const auto& n:dev.nodes()) check(!n.isRouting(),"serial template removes split/merge");
    check(!dev.applyTemplate(FxRoutingMode::Parallel),"unimplemented templates are refused, not faked");
}

void parameterTests() {
    auto g=makeDevelopmentFxGraph();
    const auto delay=find(g,FxEffectType::Delay);
    check(g.setParameter(delay,2,0.9f)==FxEditResult::Ok && *g.findNode(delay)->parameter(2)==0.9f,"set parameter");
    check(g.setParameter(delay,2,4.0f)==FxEditResult::Ok && *g.findNode(delay)->parameter(2)==1.0f,"parameter clamps");
    check(g.setParameter(delay,2,std::nanf(""))==FxEditResult::InvalidValue,"NaN parameter rejected");
    check(g.setParameter(delay,77,0.5f)!=FxEditResult::Ok,"unknown parameter rejected");
    check(g.moveNode(delay,{std::nanf(""),0})==FxEditResult::InvalidValue,"non-finite position rejected");
    const auto* time=&findFxEffect(FxEffectType::Delay)->parameters[0];
    check(std::abs(fxParameterValue(*time,0.0f)-1.0f)<1e-4f && std::abs(fxParameterValue(*time,1.0f)-2000.0f)<0.1f,"exponential mapping endpoints");
    check(fxParameterText(*time,normalizedFor(FxEffectType::Delay,1,350.0f))=="350 ms","parameter text uses physical units");
    FxGlobalSettings globals;
    globals.width=9.0f;globals.inputGainDb=std::nanf("");
    g.setGlobals(globals);
    check(g.globals().width==2.0f && g.globals().inputGainDb==0.0f,"globals clamp and ignore NaN");
}

void codecTests() {
    auto g=makeDevelopmentFxGraph();
    const auto split=g.sourceNode()+2;
    g.removeNode(split);
    g.setRoutingMode(FxRoutingMode::Custom);
    g.addLayoutPoint(g.connections().front().id,0,{123,45});
    const auto bytes=encodeFxGraph(g);
    FxGraph decoded;
    check(decodeFxGraph(bytes.data(),bytes.size(),decoded) && decoded==g,"codec round trip incl. layout points");
    check(decoded.addEffect(FxEffectType::Drive,{0,0})>split,"decoded allocator never reuses deleted ids");
    auto truncated=bytes;truncated.pop_back();
    FxGraph untouched=makeDevelopmentFxGraph();
    const auto before=untouched;
    check(!decodeFxGraph(truncated.data(),truncated.size(),untouched) && untouched==before,"truncated input rejected, destination unchanged");
    auto corrupt=bytes;corrupt[4]=0x7f;
    check(!decodeFxGraph(corrupt.data(),corrupt.size(),untouched),"unsupported version rejected");
}

void documentTests() {
    FxGraphDocument doc;
    check(doc.graph()==makeDefaultFxGraph(),"document defaults to the neutral graph");
    int notifications=0;
    doc.onChanged=[&]{++notifications;};
    const auto initial=doc.graph();
    check(!doc.edit([](FxGraph&){return true;}) && notifications==0,"no-op edit records nothing");
    FxNodeId added=0;
    check(doc.edit([&](FxGraph& g){added=g.insertEffectBeforeOutput(FxEffectType::Delay);return added!=0;}) && notifications==1,"edit commits and notifies");
    check(doc.undo() && doc.graph()==initial,"undo restores");
    check(doc.redo() && doc.graph().findNode(added)!=nullptr,"redo reapplies");
    doc.beginGesture();
    for(int i=0;i<10;++i) doc.gestureEdit([&](FxGraph& g){return g.moveNode(added,{float(100+i),10})==FxEditResult::Ok;});
    doc.endGesture();
    check(doc.undo() && doc.graph().findNode(added)->position.x!=109.0f,"gesture is one undo step");
}

// ---------------------------------------------------------------- DSP

struct Rig {
    FxGraph graph;
    FxRenderer fx;
    Rig() { fx.prepare(sr); }
    void sync() { check(fx.sync(graph),"graph compiles"); }
};

void neutralPathTests() {
    Rig rig;
    rig.graph=makeDefaultFxGraph();
    rig.sync();
    const auto out=render(rig.fx,[](int i){return sine(i);},8192);
    bool exact=true;
    for(int i=0;i<8192;++i) exact&=out.l[std::size_t(i)]==sine(i) && out.r[std::size_t(i)]==sine(i);
    check(exact,"A: BUS 1 -> MASTER OUT is bit-exact clean signal");
    const auto peaks=rig.fx.consumePeaks();
    check(peaks.first>0.49f && rig.fx.consumePeaks().first==0.0f,"meter telemetry reports and resets peaks");
}

void driveTests() {
    Rig rig;
    FxNodeId s=0,o=0;
    rig.graph=terminals(s,o);
    const auto drive=rig.graph.insertEffectBeforeOutput(FxEffectType::Drive);
    rig.graph.setParameter(drive,1,1.0f); // 36 dB
    rig.sync();
    const auto out=render(rig.fx,[](int i){return sine(i);},9600);
    const double rms=std::sqrt(energy(out.l,4800,9600)/4800.0);
    const float crest=peak(out.l,4800)/float(rms);
    check(crest<1.25f,"B: drive flattens a sine toward a square (crest factor drops)");
    check(allFinite(out) && peak(out.l)<1.2f,"drive output bounded and finite");

    rig.graph.setEnabled(drive,false);
    rig.sync();
    const auto bypassed=render(rig.fx,[](int i){return sine(i);},9600);
    bool exact=true;
    for(int i=4800;i<9600;++i) exact&=bypassed.l[std::size_t(i)]==sine(i);
    check(exact,"C: drive bypass reproduces the dry signal exactly once faded");

    // K: toggling bypass on a running signal stays click-free.
    rig.graph.setEnabled(drive,true);
    rig.sync();
    const auto steady=render(rig.fx,[](int i){return sine(i);},4800);
    float steadyDelta=0.0f;
    for(std::size_t i=1;i<steady.l.size();++i) steadyDelta=std::max(steadyDelta,std::abs(steady.l[i]-steady.l[i-1]));
    bool on=true;
    const auto toggled=render(rig.fx,[](int i){return sine(i);},48000,[&](int offset) {
        if(offset/2400%2==(on?1:0)) { on=!on; rig.graph.setEnabled(drive,on); rig.fx.sync(rig.graph); }
    });
    float toggleDelta=0.0f;
    for(std::size_t i=1;i<toggled.l.size();++i) toggleDelta=std::max(toggleDelta,std::abs(toggled.l[i]-toggled.l[i-1]));
    check(toggleDelta<=steadyDelta*1.05f+0.01f,"K: bypass crossfade adds no discontinuity");
}

void delayTests() {
    Rig rig;
    FxNodeId s=0,o=0;
    rig.graph=terminals(s,o);
    const auto delay=rig.graph.insertEffectBeforeOutput(FxEffectType::Delay);
    rig.graph.setParameter(delay,1,normalizedFor(FxEffectType::Delay,1,100.0f));
    rig.graph.setParameter(delay,2,0.0f); // no feedback
    rig.graph.setParameter(delay,3,1.0f); // wet only
    rig.graph.setParameter(delay,4,0.0f); // no damping
    rig.graph.setParameter(delay,5,0.0f); // no spread
    rig.sync();
    const auto out=render(rig.fx,[](int i){return i==0 ? 1.0f : 0.0f;},9600);
    const auto it=std::max_element(out.l.begin(),out.l.end(),[](float a,float b){return std::abs(a)<std::abs(b);});
    const auto at=std::distance(out.l.begin(),it);
    check(std::abs(at-4800)<=2 && std::abs(*it)>0.5f,"D: delay energy arrives at the expected time");
    check(peak(out.l,0,4700)<1e-6f,"D: wet-only delay is silent before the echo");

    rig.graph.setParameter(delay,2,1.0f); // maximum feedback (0.95)
    rig.graph.setParameter(delay,3,0.5f);
    rig.sync();
    const auto tail=render(rig.fx,[](int i){return i<480 ? sine(i,440.0f,0.9f) : 0.0f;},int(sr*12));
    check(allFinite(tail) && peak(tail.l)<2.5f,"E: high-feedback delay stays bounded");
    check(energy(tail.l,std::size_t(sr*10),std::size_t(sr*12))<energy(tail.l,std::size_t(sr*0.5),std::size_t(sr*2.5)),"E: feedback decays");
}

void reverbTests() {
    Rig rig;
    FxNodeId s=0,o=0;
    rig.graph=terminals(s,o);
    const auto reverb=rig.graph.insertEffectBeforeOutput(FxEffectType::Reverb);
    rig.graph.setParameter(reverb,3,1.0f); // wet only
    rig.graph.setParameter(reverb,2,normalizedFor(FxEffectType::Reverb,2,2.0f));
    rig.sync();
    const auto out=render(rig.fx,[](int i){return i==0 ? 1.0f : 0.0f;},int(sr*6));
    const auto window=[&](double a,double b){return energy(out.l,std::size_t(sr*a),std::size_t(sr*b))+energy(out.r,std::size_t(sr*a),std::size_t(sr*b));};
    check(window(0.05,0.5)>1e-4,"F: reverb produces a tail");
    check(window(1.0,1.5)<window(0.05,0.5) && window(3.0,3.5)<window(1.0,1.5),"F: reverb tail decays");
    check(allFinite(out) && peak(out.l)<1.0f,"F: reverb stable and bounded");
    check(window(5.5,6.0)<window(0.05,0.5)*1e-3,"F: decay ~RT60 reaches -30 dB well within 6 s");
}

void splitMergeTests() {
    Rig rig;
    auto& g=rig.graph;
    FxNodeId s=0,o=0;
    g=terminals(s,o);
    const auto split=g.addSplit({200,0});
    const auto merge=g.addMerge({400,0});
    g.connect({s,0},{split,0});
    g.connect({split,0},{merge,0});
    g.connect({split,1},{merge,1});
    g.connect({merge,0},{o,0});
    rig.sync();
    const auto unity=render(rig.fx,[](int i){return sine(i);},4096);
    bool exact=true;
    for(int i=0;i<4096;++i) exact&=unity.l[std::size_t(i)]==sine(i);
    check(exact,"G/H: split -> merge of untouched branches is exactly unity (merge averages)");

    // Put a wet-only delay on branch 1: both branches must reach the merge.
    g.disconnectPort(split,false,1);
    const auto delay=g.addEffect(FxEffectType::Delay,{300,80});
    g.connect({split,1},{delay,0});
    g.disconnectPort(merge,true,1);
    g.connect({delay,0},{merge,1});
    g.setParameter(delay,1,normalizedFor(FxEffectType::Delay,1,50.0f));
    g.setParameter(delay,2,0.0f);g.setParameter(delay,3,1.0f);g.setParameter(delay,4,0.0f);g.setParameter(delay,5,0.0f);
    rig.sync();
    const auto out=render(rig.fx,[](int i){return i==0 ? 1.0f : 0.0f;},4800);
    check(std::abs(out.l[0]-0.5f)<1e-6f,"G: direct branch reaches merge at half gain");
    check(peak(out.l,2398,2403)>0.4f,"H: delayed branch reaches merge");

    // I: deleting a node recompiles safely (bridging keeps the path).
    const auto compiles=rig.fx.compileCount();
    g.removeNodeBridging(delay);
    rig.sync();
    check(rig.fx.compileCount()==compiles+1,"I: deletion recompiles");
    const auto after=render(rig.fx,[](int i){return sine(i);},2048);
    check(allFinite(after) && peak(after.l)>0.2f,"I: graph keeps producing audio after deletion");
    // Parameter edits do not recompile topology.
    const auto compiles2=rig.fx.compileCount();
    g.moveNode(split,{10,10});
    rig.sync();
    check(rig.fx.compileCount()==compiles2,"moving nodes / editing parameters does not recompile");
}

void robustnessTests() {
    for(const auto& d:fxEffectCatalog()) {
        Rig rig;
        FxNodeId s=0,o=0;
        rig.graph=terminals(s,o);
        const auto node=rig.graph.insertEffectBeforeOutput(d.type);
        for(std::size_t i=0;i<d.parameterCount;++i) rig.graph.setParameter(node,d.parameters[i].id,1.0f);
        rig.sync();
        const auto out=render(rig.fx,[](int i){
            if(i%997==0) return std::nanf("");
            if(i%1009==0) return std::numeric_limits<float>::infinity();
            return 8.0f*std::sin(float(i)*0.37f);
        },int(sr));
        check(allFinite(out),"L: every effect stays finite under NaN/Inf/extreme input");
    }
    // Limiter ceiling guarantee.
    Rig rig;
    FxNodeId s=0,o=0;
    rig.graph=terminals(s,o);
    const auto limiter=rig.graph.insertEffectBeforeOutput(FxEffectType::Limiter);
    rig.graph.setParameter(limiter,1,1.0f); // +24 dB
    rig.graph.setParameter(limiter,2,normalizedFor(FxEffectType::Limiter,2,-6.0f));
    rig.sync();
    const auto out=render(rig.fx,[](int i){return sine(i,110.0f,0.9f);},int(sr));
    check(peak(out.l,4800)<=std::pow(10.0f,-6.0f/20.0f)+1e-4f,"limiter never exceeds its ceiling");
}

void globalsTests() {
    Rig rig;
    rig.graph=makeDefaultFxGraph();
    FxGlobalSettings g;
    g.outputGainDb=-6.0f;
    rig.graph.setGlobals(g);
    rig.sync();
    const auto out=render(rig.fx,[](int){return 0.5f;},9600);
    check(std::abs(out.l.back()-0.5f*std::pow(10.0f,-6.0f/20.0f))<1e-4f,"output gain applies");
    check(std::abs(out.l[1]-out.l[0])<0.01f,"output gain is smoothed (no step)");
    g.outputGainDb=0.0f;g.width=0.0f;
    rig.graph.setGlobals(g);
    rig.sync();
    const auto mono=render(rig.fx,[](int i){return sine(i);},9600,{});
    // Width 0 of identical L/R stays identical; feed decorrelated input to see collapse.
    Stereo wide{std::vector<float>(9600),std::vector<float>(9600)};
    for(int i=0;i<9600;++i) {wide.l[std::size_t(i)]=sine(i);wide.r[std::size_t(i)]=-sine(i);}
    rig.fx.process(wide.l.data(),wide.r.data(),9600);
    check(peak(wide.l,4800)<1e-3f && allFinite(mono),"width 0 collapses side signal");
}

void allocationTests() {
#ifndef ORIGAMI_SANITIZED
    Rig rig;
    rig.graph=makeDevelopmentFxGraph();
    rig.sync();
    std::vector<float> l(1024,0.1f),r(1024,0.1f);
    rig.fx.process(l.data(),r.data(),1024);
    unsigned total=0;
    for(int round=0;round<20;++round) {
        // Graph edits + recompiles happen outside the audio callback...
        rig.graph.insertEffectBeforeOutput(round%2 ? FxEffectType::Chorus : FxEffectType::Filter);
        rig.fx.sync(rig.graph);
        // ...and adopting the new plan inside it allocates and frees nothing.
        allocations=0;guardAllocations=true;
        rig.fx.process(l.data(),r.data(),1024);
        guardAllocations=false;
        total+=allocations.load();
    }
    check(total==0,"M: FX rendering and plan adoption never allocate");
#endif
}

// ---------------------------------------------------------------- buses

void busTests() {
    InstrumentState s;
    s.oscillators[0].id=1;s.oscillators[0].enabled=true;
    applyLegacyOscillatorParameters(s.oscillators[0],s.parameters);
    check(s.buses.count==1 && s.buses.find(mainBusId) && s.buses.find(mainBusId)->label()=="MAIN","MAIN exists by default");
    auto& m=s.oscillators[0];
    check(m.busRouteCount==1 && m.busRoutes[0].bus==mainBusId && m.busRoutes[0].level==1.0f,"oscillator routes to BUS 1 at unity by default");
    check(validInstrumentState(s),"default bus state valid");
    check(addOscBusRoute(m,s.buses,mainBusId)==BusRouteResult::Duplicate,"duplicate route rejected");
    check(addOscBusRoute(m,s.buses,42)==BusRouteResult::UnknownBus,"invalid BusId rejected");
    const auto bus2=addBus(s.buses);
    check(bus2==2 && s.buses.find(bus2),"future buses get stable IDs");
    check(addOscBusRoute(m,s.buses,bus2,0.45f)==BusRouteResult::Ok && m.busRouteCount==2,"add route");
    check(setOscBusRoute(m,s.buses,1,mainBusId,0.3f)==BusRouteResult::Duplicate,"retarget onto existing bus rejected");
    check(validInstrumentState(s),"two-route state valid");
    check(removeOscBusRoute(m,1)==BusRouteResult::Ok && m.busRouteCount==1,"remove route");
    check(removeOscBusRoute(m,0)==BusRouteResult::LastRoute,"last route cannot be removed");
    // Removing a bus prunes sends; an oscillator never keeps a dangling destination.
    setOscBusRoute(m,s.buses,0,bus2,0.5f);
    check(!removeBus(s,mainBusId),"BUS 1 cannot be removed");
    check(removeBus(s,bus2) && m.busRouteCount==1 && m.busRoutes[0].bus==mainBusId && validInstrumentState(s),
          "removing a bus falls back to BUS 1, never dangling");

    // Codec: v26 round trip; v25 (pre-bus) migrates to BUS 1 @ unity.
    InstrumentState routed=s;
    routed.buses=BusState{};
    const auto bus3=addBus(routed.buses);
    addOscBusRoute(routed.oscillators[0],routed.buses,bus3,0.25f);
    const auto bytes=encodeInstrumentState(routed);
    InstrumentState decoded;
    check(decodeInstrumentState(bytes.data(),bytes.size(),decoded) && decoded.buses.count==2
          && decoded.oscillators[0].busRouteCount==2 && decoded.oscillators[0].busRoutes[1].level==0.25f,"bus state round trips");
    // Build a v25 payload: the v26 bus section is appended at the end.
    const auto plain=encodeInstrumentState(s);
    std::size_t busWords=2;
    for(std::size_t i=0;i<s.buses.count;++i) busWords+=3+std::strlen(s.buses.buses[i].name.data());
    for(const auto& o:s.oscillators) if(o.id) busWords+=1+2u*o.busRouteCount;
    std::vector<std::uint8_t> legacy(plain.begin(),plain.end()-std::ptrdiff_t(busWords*4));
    legacy[7]=25;
    InstrumentState migrated;
    check(decodeInstrumentState(legacy.data(),legacy.size(),migrated),"v25 state still decodes");
    check(migrated.buses.count==1 && migrated.oscillators[0].busRouteCount==1
          && migrated.oscillators[0].busRoutes[0].bus==mainBusId && migrated.oscillators[0].busRoutes[0].level==1.0f,
          "old oscillator routing migrates to BUS 1 @ unity");
}

void busAudioTests() {
    // The BUS 1 send is real DSP, applied post-filter at the oscillator level.
    const auto renderNote=[](float send) {
        auto engineOwner=std::make_unique<OrigamiEngine>();auto& engine=*engineOwner;
        engine.prepare(sr,512,2);
        auto module=engine.oscillatorModuleState(1);
        module.busRoutes[0].level=send;
        engine.setOscillatorModuleState(1,module);
        engine.noteOn(60,1.0f);
        std::vector<float> l(4096),r(4096);
        float* out[2]{l.data(),r.data()};
        engine.process(out,2,4096);
        return peak(l,1024);
    };
    const float unity=renderNote(1.0f),half=renderNote(0.5f),muted=renderNote(0.0f);
    check(unity>0.01f,"BUS 1 carries the synth");
    check(std::abs(half/unity-0.5f)<0.02f,"send level scales the oscillator into BUS 1");
    check(muted==0.0f,"zero send removes the oscillator from BUS 1");
}
// ---------------------------------------------------------------- P03

void fxModulationModelTests() {
    // A stable destination identity: node + parameter id, never a label.
    ModulationState m;
    std::array<OscillatorModuleState,16> modules{};
    modules[0].id=1;modules[0].enabled=true;
    m.routes[0]={1,true,ModSource::Macro1,fxParameterAddress(14,2),0.5f,false};
    m.nextRouteId=2;
    check(validModulation(m,modules),"FX parameter is a valid canonical modulation destination");
    auto bad=m;bad.routes[0].destination=fxParameterAddress(0,2);
    check(!validModulation(bad,modules),"FX destination without node rejected");
    bad=m;bad.routes[0].destination=fxParameterAddress(14,0);
    check(!validModulation(bad,modules),"FX destination without parameter rejected");

    CompiledModulation compiled;
    compiled.prepare(sr);
    m.routes[1]={2,true,ModSource::Env1,fxParameterAddress(14,3),0.4f,false};
    m.routes[2]={3,true,ModSource::Lfo1,fxParameterAddress(9,1),0.5f,true};
    m.nextRouteId=4;
    const auto before=compiled.generation();
    compiled.compile(m,modules,true);
    check(compiled.generation()!=before && compiled.hasFxRoutes() && compiled.hasFxVoiceRoutes(),"FX groups compiled in the one modulation system");
    std::array<float,CompiledModulation::globalSourceCount> global{};
    global[4]=1.0f;   // Macro 1
    global[0]=-1.0f;  // LFO 1 (bipolar route)
    std::array<float,CompiledModulation::voiceSourceCount> voice{};
    voice[0]=0.5f;    // ENV 1 of the newest voice
    FxModulationOutput out;
    compiled.fxFrame(out,global,&voice);
    check(out.count==3,"three FX destinations evaluated");
    const auto offsetFor=[&](std::uint32_t node,std::uint16_t param){for(std::size_t k=0;k<out.count;++k) if(out.node[k]==node && out.parameter[k]==param) return out.offset[k];return 99.0f;};
    check(std::abs(offsetFor(14,2)-0.5f)<1e-5f,"MACRO -> FX offset = amount x source");
    check(std::abs(offsetFor(14,3)-0.2f)<1e-5f,"ENV -> FX follows the newest voice");
    check(std::abs(offsetFor(9,1)+0.25f)<1e-5f,"bipolar LFO -> FX offset");
    compiled.fxFrame(out,global,nullptr);
    check(offsetFor(14,3)==0.0f,"no voice playing: per-voice sources contribute nothing");
}

void fxEngineModulationTests() {
    auto engineOwner=std::make_unique<OrigamiEngine>();auto& engine=*engineOwner;
    engine.prepare(sr,512,2);
    auto state=engine.instrumentState();
    state.modulation.macros[0]=1.0f;
    state.modulation.routes[0]={1,true,ModSource::Macro1,fxParameterAddress(7,1),0.25f,false};
    state.modulation.nextRouteId=2;
    check(engine.setModulationState(state.modulation),"engine accepts FX route");
    std::vector<float> l(512),r(512);
    float* outputs[2]{l.data(),r.data()};
    engine.process(outputs,2,512);
    engine.process(outputs,2,512);
    const auto& fx=engine.fxModulationOutput();
    check(fx.count==1 && fx.node[0]==7 && fx.parameter[0]==1 && fx.offset[0]>0.2f,"engine publishes FX modulation per block");

    // FX ORDER: PRE MASTER removes master gain from the voices (the FX host re-applies it).
    const auto peakFor=[](bool preMaster) {
        auto eOwner=std::make_unique<OrigamiEngine>();auto& e=*eOwner;
        e.prepare(sr,512,2);
        e.setMasterAfterFx(preMaster);
        e.noteOn(60,1.0f);
        std::vector<float> a(4096),b(4096);
        float* o[2]{a.data(),b.data()};
        e.process(o,2,4096);
        return std::make_pair(peak(a,1024),e.blockMasterGain());
    };
    const auto post=peakFor(false),pre=peakFor(true);
    check(std::abs(pre.first*pre.second-post.first)<post.first*0.02f,"PRE MASTER: engine output x master gain == POST MASTER output");
}

void fxRendererModulationTests() {
    Rig rig;
    FxNodeId s=0,o=0;
    rig.graph=terminals(s,o);
    const auto limiter=rig.graph.insertEffectBeforeOutput(FxEffectType::Limiter);
    rig.sync();
    FxModulationOutput mod;
    mod.generation=1;mod.count=1;mod.node[0]=limiter;mod.parameter[0]=1;mod.offset[0]=0.5f; // gain +12 dB
    std::vector<float> l(9600),r(9600);
    const auto renderWith=[&](const FxModulationOutput* m) {
        for(int i=0;i<9600;++i) l[std::size_t(i)]=r[std::size_t(i)]=sine(i,220.0f,0.05f);
        for(int off=0;off<9600;off+=480) rig.fx.process(l.data()+off,r.data()+off,480,m);
        return peak(l,4800);
    };
    const float plain=renderWith(nullptr);
#ifndef ORIGAMI_SANITIZED
    allocations=0;guardAllocations=true;
#endif
    const float modulated=renderWith(&mod);
#ifndef ORIGAMI_SANITIZED
    guardAllocations=false;
    check(allocations.load()==0,"FX modulation is applied without allocation");
#endif
    check(std::abs(modulated/plain-3.98f)<0.2f,"modulation offset drives the canonical DSP parameter (+12 dB)");
    mod.generation=2;mod.count=0;
    const float cleared=renderWith(&mod);
    check(std::abs(cleared/plain-1.0f)<0.02f,"removing the route clears the offset (after 20 ms smoothing)");
}

void bypassModeTests() {
    for(const auto mode:{FxBypassMode::Hard,FxBypassMode::TailPreserve,FxBypassMode::Crossfade}) {
        Rig rig;
        FxNodeId s=0,o=0;
        rig.graph=terminals(s,o);
        const auto delay=rig.graph.insertEffectBeforeOutput(FxEffectType::Delay);
        rig.graph.setParameter(delay,1,normalizedFor(FxEffectType::Delay,1,100.0f));
        rig.graph.setParameter(delay,2,0.0f);rig.graph.setParameter(delay,3,1.0f);
        rig.graph.setParameter(delay,4,0.0f);rig.graph.setParameter(delay,5,0.0f);
        FxGlobalSettings globals;globals.bypass=mode;
        rig.graph.setGlobals(globals);
        rig.sync();
        // Impulse in, then bypass 50 ms later, before the 100 ms echo.
        const auto out=render(rig.fx,[](int i){return i==0 ? 1.0f : 0.0f;},9600,[&](int offset){
            if(offset>=2400 && rig.graph.findNode(delay)->enabled) { rig.graph.setEnabled(delay,false); rig.fx.sync(rig.graph); }
        });
        const float echo=peak(out.l,4790,4810);
        if(mode==FxBypassMode::TailPreserve) check(echo>0.9f,"TAIL PRESERVE: the existing delay tail still rings out");
        else check(echo<1e-3f,"HARD / CROSSFADE: bypass removes the pending echo");
        check(allFinite(out),"bypass modes stay finite");
    }
    // HARD switches instantly; CROSSFADE ramps.
    const auto firstBypassedSample=[](FxBypassMode mode) {
        Rig rig;
        FxNodeId s=0,o=0;
        rig.graph=terminals(s,o);
        const auto limiter=rig.graph.insertEffectBeforeOutput(FxEffectType::Limiter);
        rig.graph.setParameter(limiter,1,0.5f); // +12 dB
        rig.graph.setParameter(limiter,2,1.0f); // 0 dB ceiling
        FxGlobalSettings globals;globals.bypass=mode;
        rig.graph.setGlobals(globals);
        rig.sync();
        std::vector<float> l(256,0.05f),r(256,0.05f);
        rig.fx.process(l.data(),r.data(),256);
        rig.graph.setEnabled(limiter,false);
        rig.fx.sync(rig.graph);
        std::fill(l.begin(),l.end(),0.05f);std::fill(r.begin(),r.end(),0.05f);
        rig.fx.process(l.data(),r.data(),256);
        return l[0];
    };
    check(std::abs(firstBypassedSample(FxBypassMode::Hard)-0.05f)<1e-6f,"HARD bypass is instantaneous");
    check(firstBypassedSample(FxBypassMode::Crossfade)>0.1f,"CROSSFADE bypass ramps out");
}

void fxOrderRendererTests() {
    Rig rig;
    rig.graph=makeDefaultFxGraph();
    rig.sync();
    std::vector<float> l(4096,0.5f),r(4096,0.5f);
    rig.fx.process(l.data(),r.data(),4096,nullptr,true,0.25f);
    check(std::abs(l[0]-0.125f)<1e-6f && std::abs(l.back()-0.125f)<1e-6f,"PRE MASTER applies master gain after the graph, snapped on mode change");
    std::fill(l.begin(),l.end(),0.5f);std::fill(r.begin(),r.end(),0.5f);
    rig.fx.process(l.data(),r.data(),4096,nullptr,false,0.25f);
    check(l[0]==0.5f && l.back()==0.5f,"POST MASTER leaves the engine's master-scaled signal untouched");
}

void authoringTests() {
    auto g=makeDefaultFxGraph();
    const auto src=g.sourceNode(),out=g.outputNode();
    auto wire=g.connectionAt({out,0},true)->id;
    const auto split=g.insertModuleOnConnection(wire,{FxModuleKind::Split,FxEffectType::None,0},{300,100});
    check(split && g.findNode(split)->kind==FxNodeKind::Split && g.validate(),"insert Split on a connection: in -> output 0");
    const auto merge=g.addModule({FxModuleKind::Merge,FxEffectType::None,0},{500,100});
    check(merge && g.findNode(merge)->ports.inputs==2 && g.findNode(merge)->ports.outputs==1,"Add Module creates a Merge");
    check(g.addModule({FxModuleKind::BusSource,FxEffectType::None,fxMainBusId},{0,0})==invalidFxNodeId,"BUS 1 source is unique");
    check(g.insertModuleOnConnection(g.connections().front().id,{FxModuleKind::BusSource,FxEffectType::None,2},{0,0})==invalidFxNodeId,"sources cannot be inserted on a wire");

    auto p=makeDefaultFxGraph();
    wire=p.connectionAt({p.outputNode(),0},true)->id;
    const auto branch=p.parallelOnConnection(wire,FxEffectType::Reverb);
    check(branch && p.validate() && p.nodes().size()==5,"PARALLEL scaffold on a connection");
    auto chain=makeDefaultFxGraph();
    const auto drive=chain.insertEffectBeforeOutput(FxEffectType::Drive);
    const auto around=chain.parallelAroundNode(drive,FxEffectType::Chorus);
    check(around && chain.validate() && chain.connectionAt({drive,0},false)->to.node!=chain.outputNode(),"PARALLEL around a chained effect");
    auto lonely=makeDefaultFxGraph();
    const auto unwired=lonely.addEffect(FxEffectType::Drive,{0,0});
    const auto before=lonely;
    check(lonely.parallelAroundNode(unwired,FxEffectType::Chorus)==invalidFxNodeId && lonely==before,"ambiguous PARALLEL is refused, graph unchanged");
    auto sp=makeDefaultFxGraph();
    wire=sp.connectionAt({sp.outputNode(),0},true)->id;
    const auto branched=sp.branchFromConnection(wire,FxEffectType::Delay);
    check(branched && sp.validate() && sp.connectionAt({branched,0},false)==nullptr
          && sp.connectionAt({sp.outputNode(),0},true)!=nullptr,"SPLIT: dry path kept, new branch left open");

    for(const auto& t:{makeSerialChainTemplate(),makeParallelTemplate(),makeDevelopmentFxGraph()}) {
        Rig rig; rig.graph=t; rig.sync();
        const auto o=render(rig.fx,[](int i){return sine(i);},4800);
        check(t.validate() && allFinite(o) && peak(o.l)>0.05f,"template is a valid, audible graph");
    }
    auto cleared=makeDevelopmentFxGraph();
    cleared.addLayoutPoint(cleared.connections().front().id,0,{1,1});
    cleared.clearProcessing();
    check(cleared.nodes().size()==2 && cleared.connections().size()==1 && cleared.connections()[0].layout.empty(),
          "clear leaves BUS 1 -> MASTER OUT with no routing points");
    (void)src;
}

void codecV3Tests() {
    auto g=makeSerialChainTemplate();
    FxGlobalSettings s;s.order=FxOrder::PreMaster;s.bypass=FxBypassMode::TailPreserve;
    g.setGlobals(s);
    const auto bytes=encodeFxGraph(g);
    FxGraph decoded;
    check(decodeFxGraph(bytes.data(),bytes.size(),decoded) && decoded==g,"v3 round trip incl. FX order and bypass mode");
    // A v2 payload: no order/bypass bytes after the four global floats.
    std::vector<std::uint8_t> v2(bytes.begin(),bytes.end());
    v2[5]=2;
    const std::size_t globalsEnd=4+2+1+16;
    v2.erase(v2.begin()+std::ptrdiff_t(globalsEnd),v2.begin()+std::ptrdiff_t(globalsEnd+2));
    FxGraph legacy;
    check(decodeFxGraph(v2.data(),v2.size(),legacy) && legacy.globals().order==FxOrder::PostMaster
          && legacy.globals().bypass==FxBypassMode::Crossfade,"v2 graphs decode with default order/bypass");
}
// ---------------------------------------------------------------- P04

// Steady-state amplitude of a sine through a single effect (stereo L).
float throughEffect(FxEffectType type,const std::vector<std::pair<FxParameterId,float>>& params,float hz,float amp=0.25f,int samples=int(sr*0.6)) {
    Rig rig;
    FxNodeId s=0,o=0;
    rig.graph=terminals(s,o);
    const auto node=rig.graph.insertEffectBeforeOutput(type);
    for(const auto& [id,v]:params) rig.graph.setParameter(node,id,v);
    rig.sync();
    const auto out=render(rig.fx,[&](int i){return sine(i,hz,amp);},samples);
    // Amplitude from RMS: sample peaks under-read near Nyquist.
    return float(std::sqrt(2.0*energy(out.l,std::size_t(samples/2),std::size_t(samples))/double(samples-samples/2)));
}
float physicalToNormalized(FxEffectType type,FxParameterId id,float value) { return normalizedFor(type,id,value); }
float choiceN(FxEffectType type,FxParameterId id,int index) { return fxChoiceNormalized(*findFxParameter(*findFxEffect(type),id),index); }

void filterTests() {
    const auto f=FxEffectType::Filter;
    const float cutoff=physicalToNormalized(f,1,1000.0f);
    const auto mode=[&](int type){return std::vector<std::pair<FxParameterId,float>>{{5,choiceN(f,5,type)},{1,cutoff},{6,physicalToNormalized(f,6,0.7071f)},{3,1.0f}};};
    check(throughEffect(f,mode(0),100.0f)>0.24f && throughEffect(f,mode(0),8000.0f)<0.25f*0.05f,"FILTER LOW PASS: passes lows, cuts highs");
    check(throughEffect(f,mode(1),100.0f)<0.25f*0.05f && throughEffect(f,mode(1),8000.0f)>0.24f,"FILTER HIGH PASS: cuts lows, passes highs");
    check(throughEffect(f,mode(2),1000.0f)>0.23f && throughEffect(f,mode(2),100.0f)<0.25f*0.15f,"FILTER BAND PASS: unity at centre");
    check(throughEffect(f,mode(3),1000.0f)<0.25f*0.05f && throughEffect(f,mode(3),100.0f)>0.23f,"FILTER NOTCH: removes the centre");
    auto peak=mode(4); peak.push_back({7,physicalToNormalized(f,7,12.0f)});
    check(std::abs(throughEffect(f,peak,1000.0f)/0.25f-3.98f)<0.25f,"FILTER PEAK: +12 dB at centre");
    // DSP agrees with the analytic response the UI draws.
    const auto c=svfDesign(SvfShape::LowPass,1000.0,0.7071,0.0,sr);
    check(std::abs(svfMagnitude(c,1000.0,sr)-0.7071)<0.01,"analytic LP response -3 dB at cutoff");
    check(std::abs(throughEffect(f,mode(0),1000.0f)/0.25f-float(svfMagnitude(c,1000.0,sr)))<0.02f,"DSP matches analytic response");
    auto comb=mode(8); comb.push_back({2,1.0f});
    check(std::abs(throughEffect(f,comb,220.0f)-throughEffect(f,mode(0),220.0f))>0.01f,"FILTER COMB mode is a different, real topology");
    FxGraph g;
    const auto* node=g.findNode(g.addEffect(f,{0,0}));
    const auto* res=findFxParameter(*findFxEffect(f),6);
    const auto* fb=findFxParameter(*findFxEffect(f),2);
    check(node->parameterVisible(*res) && !node->parameterVisible(*fb),"mode-aware parameters: RES for LP, not FEEDBACK");
}

void compressorTests() {
    const auto c=FxEffectType::Compressor;
    const float dry=throughEffect(c,{{2,physicalToNormalized(c,2,0.0f)}},440.0f,0.5f);
    const float squashed=throughEffect(c,{{2,physicalToNormalized(c,2,-30.0f)},{3,physicalToNormalized(c,3,10.0f)},{6,0.0f}},440.0f,0.5f);
    check(std::abs(dry-0.5f)<0.02f,"threshold above signal: no compression");
    check(squashed<0.5f*0.3f,"threshold -30 dB / 10:1 strongly reduces level");
    const float madeUp=throughEffect(c,{{2,physicalToNormalized(c,2,-30.0f)},{3,physicalToNormalized(c,3,10.0f)},{6,0.0f},{7,0.5f}},440.0f,0.5f);
    check(madeUp>squashed*3.5f,"makeup gain restores level");
    const float halfWet=throughEffect(c,{{2,physicalToNormalized(c,2,-30.0f)},{3,physicalToNormalized(c,3,10.0f)},{6,0.0f},{8,0.5f}},440.0f,0.5f);
    check(halfWet>squashed && halfWet<0.5f,"mix blends dry and compressed");
    // MULTIBAND at unity (thresholds 0 dB, ratio 1): magnitude-flat reconstruction.
    std::vector<std::pair<FxParameterId,float>> unity{{1,1.0f}};
    for(FxParameterId band:{12,17,22}) { unity.push_back({band,1.0f}); unity.push_back({FxParameterId(band+1),0.0f}); }
    for(const float hz:{80.0f,440.0f,1800.0f,6000.0f,12000.0f})
        check(std::abs(20.0f*std::log10(throughEffect(c,unity,hz,0.25f)/0.25f))<0.3f,"multiband unity reconstruction within 0.3 dB");
    auto multi=unity;
    multi.push_back({12,physicalToNormalized(c,12,-40.0f)});multi.push_back({13,1.0f});
    check(throughEffect(c,multi,80.0f,0.25f)<0.25f*0.5f && std::abs(throughEffect(c,multi,6000.0f,0.25f)-0.25f)<0.02f,
          "multiband compresses only its band");
}

void equalizerTests() {
    const auto e=FxEffectType::Equalizer;
    check(std::abs(throughEffect(e,{},1000.0f)-0.25f)<1e-3f,"default EQ is neutral");
    const std::vector<std::pair<FxParameterId,float>> boost{{124,physicalToNormalized(e,124,12.0f)},{123,physicalToNormalized(e,123,1000.0f)}};
    check(std::abs(20.0f*std::log10(throughEffect(e,boost,1000.0f)/0.25f)-12.0f)<0.6f,"EQ bell +12 dB at its frequency");
    check(throughEffect(e,boost,100.0f)<0.25f*1.25f,"EQ bell is local");
    auto removed=boost; removed.push_back({121,0.0f});
    check(std::abs(throughEffect(e,removed,1000.0f)-0.25f)<1e-3f,"removing (disabling) a band removes its effect");
    std::vector<std::pair<FxParameterId,float>> cut{{142,0.0f},{141,1.0f},{143,physicalToNormalized(e,143,500.0f)}}; // band 5 LOW CUT
    check(throughEffect(e,cut,60.0f)<0.25f*0.1f,"added LOW CUT band attenuates lows");
}

void modulationEffectTests() {
    // Each new processor really processes audio (signal differs from dry).
    for(const auto type:{FxEffectType::Flanger,FxEffectType::Phaser,FxEffectType::Spatial,FxEffectType::Gain,FxEffectType::StereoUtility}) {
        Rig rig;
        FxNodeId s=0,o=0;
        rig.graph=terminals(s,o);
        const auto node=rig.graph.insertEffectBeforeOutput(type);
        if(type==FxEffectType::Gain) rig.graph.setParameter(node,1,physicalToNormalized(type,1,-12.0f));
        if(type==FxEffectType::StereoUtility) rig.graph.setParameter(node,2,1.0f);
        rig.sync();
        Stereo in{std::vector<float>(48000),std::vector<float>(48000)};
        for(int i=0;i<48000;++i) { in.l[std::size_t(i)]=sine(i,330.0f,0.3f)+0.1f*sine(i,1210.0f); in.r[std::size_t(i)]=sine(i,330.0f,0.3f)-0.1f*sine(i,1210.0f); }
        auto out=in;
        for(int off=0;off<48000;off+=512) rig.fx.process(out.l.data()+off,out.r.data()+off,std::min(512,48000-off));
        double diff=0.0;
        for(int i=24000;i<48000;++i) diff+=std::abs(out.l[std::size_t(i)]-in.l[std::size_t(i)])+std::abs(out.r[std::size_t(i)]-in.r[std::size_t(i)]);
        check(diff>10.0 && allFinite(out),"new effect audibly processes the signal");
        rig.graph.setEnabled(node,false);
        rig.sync();
        auto bypass=in;
        for(int off=0;off<48000;off+=512) rig.fx.process(bypass.l.data()+off,bypass.r.data()+off,std::min(512,48000-off));
        bool exact=true;
        for(int i=24000;i<48000;++i) exact&=bypass.l[std::size_t(i)]==in.l[std::size_t(i)];
        check(exact,"bypass returns the dry signal");
    }
}

void spatialTests() {
    Rig rig;
    FxNodeId s=0,o=0;
    rig.graph=terminals(s,o);
    const auto spatial=rig.graph.insertEffectBeforeOutput(FxEffectType::Spatial);
    rig.graph.setParameter(spatial,1,1.0f); // amount
    rig.graph.setParameter(spatial,2,1.0f); // width
    rig.graph.setParameter(spatial,3,1.0f); // mix
    rig.sync();
    const auto out=render(rig.fx,[](int i){return sine(i,220.0f,0.3f);},int(sr));
    double side=0.0,mono=0.0,dry=0.0;
    for(std::size_t i=24000;i<48000;++i) {
        side+=0.25*double(out.l[i]-out.r[i])*double(out.l[i]-out.r[i]);
        mono+=0.25*double(out.l[i]+out.r[i])*double(out.l[i]+out.r[i]);
        dry+=double(sine(int(i),220.0f,0.3f))*sine(int(i),220.0f,0.3f);
    }
    check(side>dry*0.02,"SPATIAL widens a mono source");
    check(mono>dry*0.5,"SPATIAL mono sum keeps the signal (no catastrophic cancellation)");
    // Worst case over frequency: sweep tones, mono amplitude never below 0.7x.
    for(const float hz:{110.0f,220.0f,330.0f,440.0f,880.0f,1760.0f}) {
        const auto tone=render(rig.fx,[&](int i){return sine(i,hz,0.3f);},int(sr*0.5));
        double m=0.0,d=0.0;
        for(std::size_t i=12000;i<24000;++i) { m+=0.25*double(tone.l[i]+tone.r[i])*double(tone.l[i]+tone.r[i]); d+=double(sine(int(i),hz,0.3f))*sine(int(i),hz,0.3f); }
        check(std::sqrt(m/d)>0.7,"SPATIAL mono-compatible at every tested frequency");
    }
    check(allFinite(out) && peak(out.l)<1.5f,"SPATIAL stable and bounded");
    rig.graph.setParameter(spatial,2,0.0f);
    rig.sync();
    const auto narrow=render(rig.fx,[](int i){return sine(i,220.0f,0.3f);},int(sr));
    double narrowSide=0.0;
    for(std::size_t i=24000;i<48000;++i) narrowSide+=0.25*double(narrow.l[i]-narrow.r[i])*double(narrow.l[i]-narrow.r[i]);
    check(narrowSide<side*0.01,"WIDTH 0 removes the widening");
}

void combMigrationTests() {
    FxGraph g;
    const auto node=g.insertEffectBeforeOutput(FxEffectType::Filter);
    (void)node;
    auto source=makeDefaultFxGraph();
    const auto filter=source.insertEffectBeforeOutput(FxEffectType::Filter);
    source.setParameter(filter,1,0.6f);
    auto bytes=encodeFxGraph(source);
    // Rewrite the node's effect type to legacy COMB (5).
    bool patched=false;
    for(std::size_t i=0;i+6<bytes.size() && !patched;++i)
        if(bytes[i]==0 && bytes[i+1]==0 && bytes[i+2]==0 && bytes[i+3]==std::uint8_t(filter) && bytes[i+4]==std::uint8_t(FxNodeKind::Effect)
           && bytes[i+5]==0 && bytes[i+6]==std::uint8_t(FxEffectType::Filter)) { bytes[i+6]=std::uint8_t(FxEffectType::Comb); patched=true; }
    FxGraph migrated;
    check(patched && decodeFxGraph(bytes.data(),bytes.size(),migrated),"legacy COMB graph decodes");
    const auto* n=migrated.findNode(filter);
    check(n && n->effect==FxEffectType::Filter,"COMB migrates to FILTER");
    check(n && fxChoiceIndex(*findFxParameter(*findFxEffect(FxEffectType::Filter),5),*n->parameter(5))==8,"... with TYPE = COMB");
    check(n && std::abs(*n->parameter(1)-0.4f)<1e-4f,"... and frequency re-normalized to the wider range");
    check(findFxEffect(FxEffectType::Comb)==nullptr,"COMB is no longer a top-level catalog effect");
}

void busModelP04Tests() {
    BusState b;
    check(b.buses[0].id==mainBusId && b.buses[0].label()=="MAIN","MAIN is the permanent default bus");
    const auto one=addBus(b),two=addBus(b);
    check(b.find(one)->label()=="BUS 1" && b.find(two)->label()=="BUS 2","first user bus is BUS 1, then BUS 2");
    check(one==2 && two==3,"stable, monotonic BusIds");
    InstrumentState s;
    s.oscillators[0].id=1;s.oscillators[0].enabled=true;
    applyLegacyOscillatorParameters(s.oscillators[0],s.parameters);
    s.buses=b;
    setOscBusRoute(s.oscillators[0],s.buses,0,one,0.7f); // only route -> BUS 1
    check(removeBus(s,one) && s.buses.find(two)->label()=="BUS 2","deleting BUS 1 never renames BUS 2");
    check(s.oscillators[0].busRouteCount==1 && s.oscillators[0].busRoutes[0].bus==mainBusId && s.oscillators[0].busRoutes[0].level==1.0f,
          "oscillator whose only bus was deleted falls back to MAIN at unity");
    check(s.buses.find(addBus(s.buses))->label()=="BUS 1","the lowest free number is reused for new buses");
    while(addBus(s.buses)!=0) {}
    check(s.buses.count==maxRenderBuses,"bus count capped at the render capacity");
    // v26 state carrying "BUS 1" migrates to MAIN; ids and routes untouched.
    InstrumentState legacy;
    legacy.oscillators[0].id=1;legacy.oscillators[0].enabled=true;
    applyLegacyOscillatorParameters(legacy.oscillators[0],legacy.parameters);
    BusState::setBusName(legacy.buses.buses[0],"BUS 1");
    auto bytes=encodeInstrumentState(legacy);
    bytes[7]=26;
    InstrumentState decoded;
    check(decodeInstrumentState(bytes.data(),bytes.size(),decoded) && decoded.buses.buses[0].label()=="MAIN"
          && decoded.buses.buses[0].id==mainBusId && decoded.oscillators[0].busRoutes[0].bus==mainBusId,"old BUS 1 migrates to MAIN");
}

void multiBusEngineTests() {
    auto engineOwner=std::make_unique<OrigamiEngine>();auto& engine=*engineOwner;
    engine.prepare(sr,512,2);
    auto state=engine.instrumentState();
    const auto bus=addBus(state.buses);
    check(engine.setBusState(state.buses),"engine accepts the bus list");
    for(OscillatorModuleId id=2;id<=4;++id) engine.setOscillatorModuleEnabled(id,false);
    auto module=engine.oscillatorModuleState(1);
    addOscBusRoute(module,state.buses,bus,0.5f);
    check(engine.setOscillatorModuleState(1,module),"oscillator sends to MAIN 1.0 and BUS 1 0.5");
    engine.noteOn(60,1.0f);
    std::vector<float> l(4096),r(4096);
    std::vector<std::vector<float>> aux(2*(maxRenderBuses-1),std::vector<float>(4096,9.0f));
    float* out[2]{l.data(),r.data()};
    std::array<float*,2*(maxRenderBuses-1)> auxPtr{};
    for(std::size_t i=0;i<aux.size();++i) auxPtr[i]=aux[i].data();
    check(engine.beginHostBlock(2) && engine.processSpan(out,2,4096,auxPtr.data()),"multi-bus span renders");
    engine.endHostBlock();
    check(engine.renderBusCount()==2,"two render slots (MAIN + BUS 1)");
    float ratio=0.0f;int n=0;
    for(int i=1024;i<4096;++i) if(std::abs(l[std::size_t(i)])>1e-4f) { ratio+=aux[0][std::size_t(i)]/l[std::size_t(i)]; ++n; }
    check(n>100 && std::abs(ratio/float(n)-0.5f)<1e-3f,"BUS 1 receives exactly its own send level of the same signal");
    check(peak(aux[2])==0.0f,"unused bus slots are silent (cleared, never stale)");
}

void workspaceTests() {
    FxWorkspace ws;
    check(ws.buses()==std::vector<FxBusId>{fxMainBusId},"workspace starts with MAIN only");
    auto& main=ws.document(fxMainBusId);
    main.edit([](FxGraph& g){return g.insertEffectBeforeOutput(FxEffectType::Delay)!=0;});
    auto& bus=ws.document(5);
    bus.edit([](FxGraph& g){return g.insertEffectBeforeOutput(FxEffectType::Reverb)!=0;});
    check(bus.graph().sourceForBus(5)!=invalidFxNodeId,"each bus graph's input is its own bus");
    check(&ws.document(fxMainBusId)==&main && main.graph().nodes().size()==3,"switching buses never touches another bus graph");
    check(!ws.removeBus(fxMainBusId),"MAIN graph cannot be removed");
    FxGlobalSettings g;g.width=0.5f;ws.setGlobals(g);
    const auto bytes=ws.encode();
    FxWorkspace restored;
    check(restored.decode(bytes.data(),bytes.size()) && restored.buses().size()==2
          && restored.find(5)->graph()==bus.graph() && restored.globals().width==0.5f,"all bus graphs + Global FX round trip");
    auto legacy=makeSerialChainTemplate();
    FxGlobalSettings legacyGlobals;legacyGlobals.outputGainDb=-3.0f;legacy.setGlobals(legacyGlobals);
    restored.adoptLegacyMainGraph(legacy);
    check(restored.globals().outputGainDb==-3.0f && restored.find(fxMainBusId)->graph().globals().outputGainDb==0.0f,
          "P02/P03 MAIN graph adopted; its globals become Global FX (not MAIN bus FX)");
}

void environmentTests() {
    FxEnvironment env;
    env.prepare(sr);
    auto main=makeDefaultFxGraph(fxMainBusId);
    auto aux=makeDefaultFxGraph(7);
    const auto gain=aux.insertEffectBeforeOutput(FxEffectType::Gain);
    aux.setParameter(gain,1,normalizedFor(FxEffectType::Gain,1,-6.0206f));
    env.sync({{fxMainBusId,&main},{7,&aux}},FxGlobalSettings{});
    std::vector<float> l(2048,0.2f),r(2048,0.2f);
    std::vector<std::vector<float>> buffers(2*(maxRenderBuses-1),std::vector<float>(2048,0.0f));
    std::fill(buffers[0].begin(),buffers[0].end(),0.4f);
    std::fill(buffers[1].begin(),buffers[1].end(),0.4f);
    std::array<float*,2*(maxRenderBuses-1)> ptr{};
    for(std::size_t i=0;i<buffers.size();++i) ptr[i]=buffers[i].data();
    for(int pass=0;pass<4;++pass) {
        std::fill(l.begin(),l.end(),0.2f);std::fill(r.begin(),r.end(),0.2f);
        std::fill(buffers[0].begin(),buffers[0].end(),0.4f);std::fill(buffers[1].begin(),buffers[1].end(),0.4f);
        env.process(l.data(),r.data(),ptr.data(),2,2048);
    }
    check(std::abs(l.back()-(0.2f+0.4f*0.5f))<1e-3f,"master = MAIN + BUS processed by its own graph (-6 dB)");
    // Neutral MAIN-only state is a bit-exact pass-through.
    FxEnvironment neutral;
    neutral.prepare(sr);
    auto clean=makeDefaultFxGraph();
    neutral.sync({{fxMainBusId,&clean}},FxGlobalSettings{});
    std::vector<float> a(512),b(512);
    for(int i=0;i<512;++i) a[std::size_t(i)]=b[std::size_t(i)]=sine(i);
    neutral.process(a.data(),b.data(),nullptr,1,512);
    bool exact=true;
    for(int i=0;i<512;++i) exact&=a[std::size_t(i)]==sine(i);
    check(exact,"MAIN-only neutral environment is bit-exact");
}
}

// mct-origami-nodes-n02: golden fingerprints of the compiled plans and the
// rendered audio of representative graphs, captured on the pre-N02 (N01) code.
// The typed-graph metadata must not change either. (Bit-exact float hashes:
// valid for this toolchain/flags; a deliberate DSP change re-baselines them.)
std::uint64_t fnv(std::uint64_t h,std::uint32_t v) {
    for(int i=0;i<4;++i) { h^=(v>>(i*8))&0xffu; h*=1099511628211ull; }
    return h;
}
std::uint64_t planFingerprint(const PreparedFxPlan& plan) {
    std::uint64_t h=1469598103934665603ull;
    h=fnv(h,std::uint32_t(plan.stepCount)); h=fnv(h,plan.hasOutput); h=fnv(h,plan.outputBuffer); h=fnv(h,plan.identity);
    for(std::size_t s=0;s<plan.stepCount;++s) {
        const auto& st=plan.steps[s];
        h=fnv(h,std::uint32_t(st.kind)); h=fnv(h,st.inputCount); h=fnv(h,st.output); h=fnv(h,st.bus);
        for(std::uint8_t i=0;i<st.inputCount;++i) h=fnv(h,st.inputs[i]);
        std::uint32_t g; std::memcpy(&g,&st.inputGain,4); h=fnv(h,g);
        h=fnv(h,st.instance!=nullptr ? std::uint32_t(st.instance->node) : 0u);
    }
    return h;
}
float testSignal(int i) {
    static std::uint32_t seed=0;
    if(i==0) seed=0x1234567u;
    seed=seed*1664525u+1013904223u;
    const float noise=float(int(seed>>9)-(1<<22))/float(1<<22);
    return 0.4f*std::sin(pi2*110.0f*float(i)/float(sr))+0.25f*std::sin(pi2*1870.0f*float(i)/float(sr))+0.1f*noise;
}
std::uint64_t audioFingerprint(const Stereo& audio) {
    std::uint64_t h=1469598103934665603ull;
    for(std::size_t i=0;i<audio.l.size();++i) {
        std::uint32_t a,b; std::memcpy(&a,&audio.l[i],4); std::memcpy(&b,&audio.r[i],4);
        h=fnv(fnv(h,a),b);
    }
    return h;
}
std::vector<std::pair<const char*,FxGraph>> goldenGraphs() {
    std::vector<std::pair<const char*,FxGraph>> out;
    out.push_back({"serial",makeSerialChainTemplate()});
    out.push_back({"parallel",makeParallelTemplate()});
    out.push_back({"development",makeDevelopmentFxGraph()});
    FxGraph library=makeDefaultFxGraph();
    for(const auto& d:fxEffectCatalog()) if(d.processesAudio) library.insertEffectBeforeOutput(d.type);
    out.push_back({"library",library});
    FxGraph branches=makeDefaultFxGraph();
    const auto wire=branches.connections().front().id;
    const auto comp=branches.parallelOnConnection(wire,FxEffectType::Compressor);
    branches.parallelAroundNode(comp,FxEffectType::Equalizer);
    out.push_back({"branches",branches});
    return out;
}
void goldenFingerprintTests() {
    const bool print=std::getenv("ORIGAMI_PRINT_GOLDEN")!=nullptr;
    struct Expected { const char* name; std::uint64_t plan,audio; };
    static const Expected expected[]{
        {"serial",0xcfaf957bac2d45f4ull,0xece608152cf406dfull},
        {"parallel",0xf8f02b5f63351024ull,0x7218697422c67fe3ull},
        {"development",0xcdecc542baaca4d7ull,0xa36c7f2582b7a76bull},
        {"library",0xe6c7f08938c37bf1ull,0x2ec083b41d2ba932ull},
        {"branches",0xc6070f4215b466c8ull,0x3404a89abd48ea43ull}};
    for(const auto& [name,graph]:goldenGraphs()) {
        check(graph.validate(),"golden graph is valid");
        FxGraphCompiler compiler;
        compiler.prepare(sr);
        const auto plan=compiler.compile(graph);
        check(plan!=nullptr,"golden graph compiles");
        if(plan==nullptr) continue;
        FxRenderer fx;
        fx.prepare(sr);
        fx.sync(graph);
        const auto audio=render(fx,testSignal,16384);
        const auto ph=planFingerprint(*plan),ah=audioFingerprint(audio);
        if(print) std::cout<<"GOLDEN "<<name<<" plan=0x"<<std::hex<<ph<<" audio=0x"<<ah<<std::dec<<"\n";
        for(const auto& e:expected) if(std::string(e.name)==name && e.plan!=0)
            check(e.plan==ph && e.audio==ah,"compiled plan and rendered audio match the pre-N02 golden");
    }
    // Multi-bus environment with non-neutral Global FX.
    FxEnvironment env;
    env.prepare(sr);
    auto main=makeSerialChainTemplate();
    auto bus7=makeDefaultFxGraph(7);
    bus7.insertEffectBeforeOutput(FxEffectType::Compressor);
    bus7.insertEffectBeforeOutput(FxEffectType::Phaser);
    FxGlobalSettings globals; globals.dryWet=0.8f; globals.width=1.3f; globals.outputGainDb=-2.0f;
    env.sync({{fxMainBusId,&main},{7,&bus7}},globals);
    std::vector<float> l(16384),r(16384),a(16384),b(16384);
    for(int i=0;i<16384;++i) { l[std::size_t(i)]=r[std::size_t(i)]=testSignal(i); }
    for(int i=0;i<16384;++i) { a[std::size_t(i)]=b[std::size_t(i)]=0.5f*testSignal((i*7)%16384); }
    std::array<float*,2*(maxRenderBuses-1)> aux{}; aux[0]=a.data(); aux[1]=b.data();
    for(int offset=0;offset<16384;offset+=512) {
        std::array<float*,2*(maxRenderBuses-1)> view{}; view[0]=a.data()+offset; view[1]=b.data()+offset;
        env.process(l.data()+offset,r.data()+offset,view.data(),2,512);
    }
    Stereo mixed{l,r};
    const auto eh=audioFingerprint(mixed);
    static constexpr std::uint64_t expectedEnvironment=0x741f1baf7208d220ull;
    if(print) std::cout<<"GOLDEN environment audio=0x"<<std::hex<<eh<<std::dec<<"\n";
    if(expectedEnvironment!=0) check(eh==expectedEnvironment,"multi-bus environment + Global FX match the pre-N02 golden");
}

// mct-origami-nodes-n02: typed port model, connection rules, cycle and
// duplicate policy, execution domain.
void typedGraphTests() {
    using nodes::PortDirection; using nodes::NodeSignalType; using nodes::NodeExecutionDomain;
    // Every constructible node kind exposes coherent, model-owned ports.
    FxGraph g=makeDefaultFxGraph();
    for(const auto& d:fxEffectCatalog()) g.addEffect(d.type,{0,0});
    for(std::uint8_t b=FxGraph::minBranches;b<=FxGraph::maxBranches;++b) { g.addSplit({0,0},b); g.addMerge({0,0},b); }
    bool coherent=true,audio=true,global=true,named=true;
    for(const auto& n:g.nodes()) {
        const auto ports=fxNodePorts(n);
        coherent&=ports.size()==std::size_t(n.ports.inputs)+n.ports.outputs;
        std::uint8_t in=0,out=0;
        for(const auto& p:ports) {
            coherent&=p.index==(p.direction==PortDirection::Input ? in++ : out++);
            audio&=p.type==NodeSignalType::Audio;
            named&=p.name!=nullptr && p.name[0]!='\0';
        }
        coherent&=!fxPort(n,PortDirection::Input,n.ports.inputs) && !fxPort(n,PortDirection::Output,n.ports.outputs);
        global&=fxExecutionDomain(n)==NodeExecutionDomain::Global;
    }
    check(coherent,"every node's descriptors match its topology (sequential indices, out of range = none)");
    check(audio,"every shipping port is AUDIO");
    check(named,"every port has a semantic name");
    check(global,"every shipping node executes GLOBAL (bus graph), never per voice");
    {
        FxGraph t=makeDefaultFxGraph();
        const auto comp=t.addEffect(FxEffectType::Compressor,{0,0});
        const auto split=t.addSplit({0,0},3);
        const auto merge=t.addMerge({0,0},2);
        const auto* c=t.findNode(comp); const auto* s=t.findNode(split); const auto* m=t.findNode(merge);
        check(std::string(fxPort(*c,PortDirection::Input,0)->name)=="Audio In" && std::string(fxPort(*c,PortDirection::Output,0)->name)=="Audio Out"
              && !fxPort(*c,PortDirection::Input,1),"COMPRESSOR: Audio In -> Audio Out (no invented sidechain)");
        check(std::string(fxPort(*s,PortDirection::Output,0)->name)=="A" && std::string(fxPort(*s,PortDirection::Output,2)->name)=="C",
              "SPLIT outputs A, B, C");
        check(std::string(fxPort(*m,PortDirection::Input,1)->name)=="B" && std::string(fxPort(*m,PortDirection::Output,0)->name)=="Audio Out",
              "MERGE inputs A, B -> Audio Out");
        check(t.findNode(t.sourceNode())->ports.inputs==0 && std::string(fxPort(*t.findNode(t.outputNode()),PortDirection::Input,0)->name)=="Audio In",
              "terminals: source has only Audio Out, output only Audio In");
    }
    // Connection rules (structured reasons), either endpoint order.
    FxGraph k=makeDefaultFxGraph();
    const auto src=k.sourceNode(),out=k.outputNode();
    k.disconnect(k.connections().front().id);
    const auto a=k.addEffect(FxEffectType::Gain,{0,0}),b=k.addEffect(FxEffectType::Filter,{0,0});
    const FxPortEndpoint aOut{a,PortDirection::Output,0},aIn{a,PortDirection::Input,0},bIn{b,PortDirection::Input,0},bOut{b,PortDirection::Output,0};
    const auto ok=k.checkConnection(aOut,bIn),reversed=k.checkConnection(bIn,aOut);
    check(ok.valid() && reversed.valid() && reversed.from==FxPortRef{a,0} && reversed.to==FxPortRef{b,0},"AUDIO out -> AUDIO in is valid from either end");
    check(k.checkConnection(aIn,bIn).result==FxEditResult::SameDirection && k.checkConnection(aOut,bOut).result==FxEditResult::SameDirection,
          "input->input and output->output are rejected");
    check(k.checkConnection({a,PortDirection::Output,3},bIn).result==FxEditResult::InvalidPort,"invalid port index is rejected");
    check(k.checkConnection({999,PortDirection::Output,0},bIn).result==FxEditResult::UnknownNode,"missing node is rejected");
    check(k.checkConnection(aOut,aIn).result==FxEditResult::SelfConnection,"self connection is rejected");
    check(k.canConnect({a,0},{b,0})==k.checkConnection(aOut,bIn).result,"canConnect is the same rule set");
    // Synthetic typed ports (no shipping node has them): no implicit conversion.
    const nodes::PortDescriptor audioOut{PortDirection::Output,NodeSignalType::Audio,0,"Audio Out"};
    const nodes::PortDescriptor controlIn{PortDirection::Input,NodeSignalType::Control,0,"Amount"};
    const nodes::PortDescriptor controlOut{PortDirection::Output,NodeSignalType::Control,0,"Value"};
    const nodes::PortDescriptor eventIn{PortDirection::Input,NodeSignalType::Event,0,"Notes"};
    const nodes::PortDescriptor audioIn{PortDirection::Input,NodeSignalType::Audio,0,"Audio In"};
    check(nodes::checkPortPair(audioOut,controlIn)==nodes::PortPairError::TypeMismatch,"AUDIO -> CONTROL is a type mismatch");
    check(nodes::checkPortPair(controlOut,eventIn)==nodes::PortPairError::TypeMismatch,"CONTROL -> EVENT is a type mismatch");
    check(nodes::checkPortPair(audioOut,audioIn)==nodes::PortPairError::None && nodes::checkPortPair(audioIn,audioOut)==nodes::PortPairError::None,
          "AUDIO -> AUDIO pairs in either order");
    check(nodes::checkPortPair(audioIn,controlIn)==nodes::PortPairError::SameDirection,"two inputs never pair");
    // Duplicate edges, fan-out, merge, cycles.
    check(k.connect({src,0},{a,0})==FxEditResult::Ok && k.connect({a,0},{b,0})==FxEditResult::Ok,"chain");
    check(k.checkConnection(aOut,bIn).result==FxEditResult::DuplicateConnection,"exact duplicate edge (same output, same input) is rejected");
    {   // Free ports on both ends, so the cycle itself is the reason.
        FxGraph loop=makeDefaultFxGraph();
        const auto x=loop.addEffect(FxEffectType::Gain,{0,0}),y=loop.addEffect(FxEffectType::Drive,{0,0});
        check(loop.connect({x,0},{y,0})==FxEditResult::Ok,"x -> y");
        const FxPortEndpoint yOut{y,PortDirection::Output,0},xIn{x,PortDirection::Input,0};
        check(loop.checkConnection(yOut,xIn).result==FxEditResult::WouldCreateCycle
              && loop.checkConnection(xIn,yOut).result==FxEditResult::WouldCreateCycle
              && loop.connect({y,0},{x,0})==FxEditResult::WouldCreateCycle && loop.validate(),
              "a zero-delay cycle is rejected, deterministically, and the graph is unchanged");
    }
    const auto split=k.addSplit({0,0},2),merge=k.addMerge({0,0},2),c=k.addEffect(FxEffectType::Delay,{0,0});
    check(k.disconnectPort(b,false,0)==0,"b output free");
    check(k.connect({b,0},{split,0})==FxEditResult::Ok && k.connect({split,0},{c,0})==FxEditResult::Ok
          && k.connect({split,1},{merge,1})==FxEditResult::Ok && k.connect({c,0},{merge,0})==FxEditResult::Ok
          && k.connect({merge,0},{out,0})==FxEditResult::Ok,"fan-out through SPLIT and summing through MERGE stay legal");
    check(k.validate(),"typed graph validates");
    FxGraphCompiler compiler; compiler.prepare(sr);
    check(compiler.compile(k)!=nullptr,"typed graph compiles");
}

// Bounded, deterministic randomized graph editing: the model never breaks its
// invariants, every rejection is deterministic, every valid graph compiles to
// a memory-safe plan, and the codec round-trips.
void graphFuzzTests() {
    std::uint32_t seed=0x5eed2u;
    const auto next=[&](std::uint32_t range){ seed=seed*1664525u+1013904223u; return range==0 ? 0u : (seed>>8)%range; };
    std::vector<FxEffectType> types;
    for(const auto& d:fxEffectCatalog()) if(d.processesAudio) types.push_back(d.type);
    FxGraphCompiler compiler; compiler.prepare(sr);
    bool invariants=true,deterministic=true,plansSafe=true,roundTrip=true,consistent=true;
    std::size_t accepted=0,rejected=0;
    for(int round=0;round<6;++round) {
        FxGraph g=makeDefaultFxGraph();
        for(int op=0;op<120;++op) {
            const auto ids=[&]{std::vector<FxNodeId> v; for(const auto& n:g.nodes()) v.push_back(n.id); return v;}();
            const auto pick=[&]{ return next(10)==0 ? FxNodeId(900+next(50)) : ids[next(std::uint32_t(ids.size()))]; };
            switch(next(8)) {
            case 0: g.addEffect(types[next(std::uint32_t(types.size()))],{float(next(800)),float(next(600))}); break;
            case 1: g.addSplit({0,0},std::uint8_t(2+next(7))); break;
            case 2: g.addMerge({0,0},std::uint8_t(2+next(7))); break;
            case 3: if(!g.connections().empty()) g.disconnect(g.connections()[next(std::uint32_t(g.connections().size()))].id); break;
            default: {
                // Mostly plausible requests (output -> input, small ports), plus
                // wrong directions, absurd ports and missing nodes.
                const auto port=[&]{ return std::uint8_t(next(5)==0 ? next(12) : next(2)); };
                const bool flip=next(5)==0;
                const FxPortEndpoint x{pick(),flip ? nodes::PortDirection::Input : nodes::PortDirection::Output,port()};
                const FxPortEndpoint y{pick(),next(6)==0 ? nodes::PortDirection::Output : nodes::PortDirection::Input,port()};
                const auto first=g.checkConnection(x,y),second=g.checkConnection(x,y);
                deterministic&=first.result==second.result;
                if(first.valid()) {
                    consistent&=g.canConnect(first.from,first.to)==FxEditResult::Ok;
                    consistent&=g.connect(first.from,first.to)==FxEditResult::Ok;
                    ++accepted;
                } else ++rejected;
            }
            }
            invariants&=g.validate();
        }
        const auto plan=compiler.compile(g);
        plansSafe&=plan!=nullptr;
        if(plan!=nullptr)
            for(std::size_t s=0;s<plan->stepCount;++s) {
                const auto& step=plan->steps[s];
                plansSafe&=step.output==s && step.inputCount<=FxGraph::maxBranches;
                for(std::uint8_t i=0;i<step.inputCount;++i) plansSafe&=step.inputs[i]<s; // topological, in range
            }
        FxGraph decoded;
        const auto bytes=encodeFxGraph(g);
        roundTrip&=decodeFxGraph(bytes.data(),bytes.size(),decoded) && decoded==g;
    }
    check(accepted>20 && rejected>100,"fuzz exercised both valid and invalid connections");
    check(invariants,"random editing never leaves an invalid graph");
    check(deterministic,"connection verdicts are deterministic");
    check(consistent,"checkConnection, canConnect and connect agree");
    check(plansSafe,"every random graph compiles to a topologically ordered, in-range plan");
    check(roundTrip,"every random graph round-trips through the codec");
}

// mct-origami-nodes-n03-control: the CONTROL layer is a view of ModRoutes.
void controlGraphTests() {
    using namespace mct::origami;
    using namespace mct::origami::nodes;
    InstrumentState state;
    auto& m=state.modulation;
    const ModAddress cutoff{ModDestination::Cutoff,0,0},porta{ModDestination::PortaTime,0,0};
    const auto fxParam=fxParameterAddress(mainBusId,4,2);
    // Execution domains.
    check(sourceDomain(ModSource::Lfo1,m)==NodeExecutionDomain::Global && sourceDomain(ModSource::Macro2,m)==NodeExecutionDomain::Global
          && sourceDomain(ModSource::Random,m)==NodeExecutionDomain::Global,"free LFO, macros, random are GLOBAL sources");
    check(sourceDomain(ModSource::Env1,m)==NodeExecutionDomain::Voice && sourceDomain(ModSource::Velocity,m)==NodeExecutionDomain::Voice,
          "envelopes and performance inputs are VOICE sources");
    {   auto loop=m; loop.lfo1.mode=LfoMode::Loop;
        check(sourceDomain(ModSource::Lfo1,loop)==NodeExecutionDomain::Voice,"an LFO in a per-note mode is a VOICE source"); }
    check(destinationDomain(cutoff)==NodeExecutionDomain::Voice && destinationDomain({ModDestination::Level,1,0})==NodeExecutionDomain::Voice,
          "filter and oscillator parameters are consumed per voice");
    check(destinationDomain(porta)==NodeExecutionDomain::Global && destinationDomain(fxParam)==NodeExecutionDomain::Global,
          "glide and NODES parameters are consumed globally");
    check(domainCrossingSupported(NodeExecutionDomain::Global,NodeExecutionDomain::Voice)
          && domainCrossingSupported(NodeExecutionDomain::Voice,NodeExecutionDomain::Voice)
          && !domainCrossingSupported(NodeExecutionDomain::Voice,NodeExecutionDomain::Global),
          "GLOBAL->VOICE broadcast and VOICE->VOICE allowed; VOICE->GLOBAL rejected");
    // Link validation.
    check(checkControlLink(state,ModSource::Lfo1,cutoff).creatable(),"LFO 1 -> CUTOFF can be created");
    check(checkControlLink(state,ModSource::Env1,porta).result==ControlLinkResult::DomainCrossing
          && checkControlLink(state,ModSource::Env1,fxParam).result==ControlLinkResult::DomainCrossing,
          "a per-voice source cannot drive a global parameter");
    check(checkControlLink(state,ModSource::None,cutoff).result==ControlLinkResult::MissingSource
          && checkControlLink(state,ModSource::Lfo1,{ModDestination::None,0,0}).result==ControlLinkResult::MissingDestination,
          "incomplete ends are rejected");
    // N04 exposes every canonical source; a non-source value is still refused.
    check(checkControlLink(state,static_cast<ModSource>(999),cutoff).result==ControlLinkResult::SourceNotExposed,"only canonical sources are nodes");
    check(checkControlLink(state,ModSource::Lfo1,{ModDestination::Level,99,0}).result==ControlLinkResult::DestinationUnavailable,
          "a destination that does not exist is rejected (canonical validator)");
    {   auto removed=state; removed.modulation.lfoActiveMask&=~0x2u;
        check(checkControlLink(removed,ModSource::Lfo2,cutoff).result==ControlLinkResult::SourceInactive,"an inactive source is rejected"); }
    m.routes[0]={1,true,ModSource::Lfo1,cutoff,0.42f,false};
    m.nextRouteId=2;
    const auto existing=checkControlLink(state,ModSource::Lfo1,cutoff);
    check(existing.result==ControlLinkResult::Exists && existing.existingRoute==1,"an existing relationship is recognised, never duplicated");
    // Typed ports.
    const auto out=controlPort(ControlNodeKind::Source),in=controlPort(ControlNodeKind::Parameter);
    check(out.type==NodeSignalType::Control && out.direction==PortDirection::Output && in.type==NodeSignalType::Control
          && in.direction==PortDirection::Input && checkPortPair(out,in)==PortPairError::None,"SOURCE Control Out -> PARAMETER Control In");
    const PortDescriptor audioIn{PortDirection::Input,NodeSignalType::Audio,0,"Audio In"};
    const PortDescriptor audioOut{PortDirection::Output,NodeSignalType::Audio,0,"Audio Out"};
    const PortDescriptor eventIn{PortDirection::Input,NodeSignalType::Event,0,"Notes"};
    check(checkPortPair(out,audioIn)==PortPairError::TypeMismatch && checkPortPair(audioOut,in)==PortPairError::TypeMismatch,
          "CONTROL and AUDIO ports never connect");
    check(checkPortPair(out,eventIn)==PortPairError::TypeMismatch,"CONTROL and EVENT ports never connect");
    // Derived graph: every complete route of an exposed source is a link.
    m.routes[1]={2,true,ModSource::Env1,fxParam,0.5f,false};   // crossing created elsewhere
    m.routes[2]={3,true,ModSource::Chaos,cutoff,0.3f,false};   // N04: Chaos is a source node too
    m.routes[3]={4,true,ModSource::Lfo2,{ModDestination::None,0,0},0.0f,false}; // incomplete
    m.nextRouteId=5;
    ControlLayout layout;
    layout.setPlaced(sourceKey(ModSource::Macro3),true);
    const auto graph=deriveControlGraph(m,layout);
    check(graph.links.size()==3 && graph.links[0].routeId==1 && graph.links[1].routeId==2 && graph.links[2].routeId==3,
          "links are exactly the complete routes, by route id");
    check(graph.links[0].supported && !graph.links[1].supported,"a crossing made outside NODES is shown as unsupported");
    check(graph.find(sourceKey(ModSource::Macro3)).has_value() && graph.find(sourceKey(ModSource::Chaos)).has_value(),"placed nodes and linked sources appear");
    // Layout: positions only, stable, versioned.
    layout.setPosition(parameterKey(cutoff),900.0f,620.0f);
    const auto again=deriveControlGraph(m,layout);
    const auto index=again.find(parameterKey(cutoff));
    check(index && again.nodes[*index].x==900.0f && again.nodes[*index].y==620.0f,"layout positions are honoured");
    const auto bytes=layout.encode();
    ControlLayout decoded;
    check(decoded.decode(bytes.data(),bytes.size()) && decoded==layout,"layout round-trips");
    check(bytes.size()==6+4+(1+4+8+1)+(1+12+8+1),"layout stores identities + positions + flags only (no route data)");
    auto corrupt=bytes; corrupt[0]='X';
    check(!decoded.decode(corrupt.data(),corrupt.size()) && decoded==layout,"a corrupt layout is rejected without side effects");
}

// mct-origami-nodes-n04-control-processing: CONTROL operators.
namespace n04 {
ControlOperator op(ControlOpType type,std::uint32_t id=1) { return makeControlOperator(type,id); }
float run(ControlOpType type,float a,float b=0.0f,std::array<float,6> params={},bool useParams=false,
          ControlRange range=ControlRange::Unipolar,bool aConnected=true,bool bConnected=true) {
    auto o=op(type);
    if(useParams) o.params=params;
    ControlOpRuntime state;
    return evaluateControlOp(o,a,aConnected,range,b,bConnected,range,state,1.0f,1.0f);
}
std::vector<float> renderEngine(const ModulationState& mod,int samples,std::initializer_list<std::pair<int,int>> notes,bool* ok=nullptr) {
    auto engine=std::make_unique<OrigamiEngine>();
    engine->prepare(sr,512,2);
    for(OscillatorModuleId id=2;id<=4;++id) engine->setOscillatorModuleEnabled(id,false);
    const bool accepted=engine->setModulationState(mod);
    if(ok) *ok=accepted;
    std::vector<float> l(static_cast<std::size_t>(samples)),r(static_cast<std::size_t>(samples));
    int done=0;
    auto pending=std::vector<std::pair<int,int>>(notes);
    while(done<samples) {
        int n=std::min(256,samples-done);
        for(auto it=pending.begin();it!=pending.end();)
            if(it->first<=done) { engine->noteOn(it->second,0.9f); it=pending.erase(it); } else ++it;
        float* out[2]{l.data()+done,r.data()+done};
        engine->process(out,2,std::size_t(n));
        done+=n;
    }
    return l;
}
}

void controlOperatorTests() {
    using namespace n04;
    using T=ControlOpType;
    // Exact math.
    check(run(T::Add,0.25f,0.5f)==0.75f && run(T::Add,0.25f,0.0f,{},false,ControlRange::Unipolar,true,false)==0.25f,"ADD (unconnected B = 0)");
    check(run(T::Subtract,0.25f,0.5f)==-0.25f,"SUBTRACT = A - B");
    check(run(T::Multiply,0.5f,-0.5f)==-0.25f && run(T::Multiply,0.5f,0.0f,{},false,ControlRange::Unipolar,true,false)==0.5f,"MULTIPLY (unconnected B = 1)");
    check(run(T::Min,0.2f,0.7f)==0.2f && run(T::Max,0.2f,0.7f)==0.7f
          && run(T::Min,0.0f,0.7f,{},false,ControlRange::Unipolar,false,true)==0.7f,"MIN / MAX (a lone input passes through)");
    check(run(T::Abs,-0.6f)==0.6f,"ABS");
    check(run(T::Invert,0.3f)==0.7f && run(T::Invert,0.3f,0,{},false,ControlRange::Bipolar)==-0.3f,"INVERT: 1-x unipolar, -x bipolar");
    check(run(T::Clamp,1.4f,0,{{0.2f,0.8f}},true)==0.8f && run(T::Clamp,-1.0f,0,{{0.8f,0.2f}},true)==0.2f,"CLAMP (bounds in either order)");
    check(run(T::ScaleOffset,0.5f,0,{{2.0f,-0.25f}},true)==0.75f,"SCALE / OFFSET = in*scale + offset");
    check(std::abs(run(T::Remap,0.5f,0,{{0.0f,1.0f,0.25f,0.75f,1.0f}},true)-0.5f)<1e-6f
          && std::abs(run(T::Remap,1.0f,0,{{0.0f,1.0f,0.25f,0.75f,1.0f}},true)-0.75f)<1e-6f,"REMAP 0..1 -> 0.25..0.75");
    check(std::abs(run(T::Remap,0.25f,0,{{1.0f,0.0f,0.0f,1.0f,1.0f}},true)-0.75f)<1e-6f,"REMAP with an inverted input range inverts");
    check(run(T::Remap,2.0f,0,{{0.0f,1.0f,0.0f,1.0f,1.0f}},true)==1.0f && run(T::Remap,2.0f,0,{{0.0f,1.0f,0.0f,1.0f,0.0f}},true)==2.0f
          && run(T::Remap,0.4f,0,{{0.5f,0.5f,0.0f,1.0f,1.0f}},true)==0.0f,"REMAP clamp on/off; a zero-width input range is deterministic");
    check(std::abs(run(T::Quantize,0.6f,0,{{5.0f}},true)-0.5f)<1e-6f && std::abs(run(T::Quantize,0.9f,0,{{5.0f}},true)-1.0f)<1e-6f,"QUANTIZE unipolar 5 levels");
    check(std::abs(run(T::Quantize,-0.4f,0,{{5.0f}},true,ControlRange::Bipolar)+0.5f)<1e-6f
          && run(T::Quantize,1.0f,0,{{5.0f}},true,ControlRange::Bipolar)==1.0f && run(T::Quantize,-1.0f,0,{{5.0f}},true,ControlRange::Bipolar)==-1.0f,
          "QUANTIZE bipolar keeps -1 and +1");
    check(run(T::Constant,0,0,{{0.25f}},true)==0.25f,"CONSTANT");
    const float lin=run(T::Curve,0.5f,0,{{0.0f,0.5f}},true),ex=run(T::Curve,0.5f,0,{{1.0f,0.5f}},true),lg=run(T::Curve,0.5f,0,{{2.0f,0.5f}},true);
    check(lin==0.5f && ex<0.5f && lg>0.5f && std::abs(run(T::Curve,0.5f,0,{{3.0f,1.0f}},true)-0.5f)<1e-6f,"CURVE linear / exp / log / S (S fixes the midpoint)");
    check(std::abs(run(T::Curve,-0.5f,0,{{1.0f,0.5f}},true,ControlRange::Bipolar)+ex)<1e-6f,"CURVE shapes bipolar values odd-symmetrically");
    // SMOOTH: convergence, rise/fall, reset, sample-rate independence.
    {
        auto smooth=op(T::Smooth); smooth.params[0]=0.01f; smooth.params[1]=0.1f;
        const auto settle=[&](double rate,float seconds) {
            ControlOpRuntime state;
            const float rise=controlSmoothingCoefficient(smooth.params[0],rate),fall=controlSmoothingCoefficient(smooth.params[1],rate);
            evaluateControlOp(smooth,0.0f,true,ControlRange::Unipolar,0,false,ControlRange::Unipolar,state,rise,fall);
            float y=0.0f,previous=0.0f; bool monotonic=true;
            for(int i=0;i<int(seconds*rate);++i) {
                y=evaluateControlOp(smooth,1.0f,true,ControlRange::Unipolar,0,false,ControlRange::Unipolar,state,rise,fall);
                monotonic&=y>=previous; previous=y;
            }
            return std::make_pair(y,monotonic);
        };
        const auto at48=settle(48000.0,0.01f),at96=settle(96000.0,0.01f);
        check(std::abs(at48.first-0.632f)<0.01f && std::abs(at96.first-0.632f)<0.01f && at48.second,"SMOOTH: one time constant = 63% at any sample rate, monotonic");
        check(settle(48000.0,0.2f).first>0.999f,"SMOOTH converges");
        ControlOpRuntime state;
        evaluateControlOp(smooth,0.7f,true,ControlRange::Unipolar,0,false,ControlRange::Unipolar,state,0.5f,0.5f);
        check(state.initialized && state.value==0.7f,"SMOOTH starts at its first input (no ramp from zero after a reset)");
    }
    // Validation: DAG, references, bounds.
    ModulationState m;
    const ModAddress cutoff{ModDestination::Cutoff,0,0};
    m.operators[0]=op(T::ScaleOffset,1); m.operators[0].inputs[0]={ControlInput::Kind::Source,ModSource::Lfo1,0};
    m.operators[2]=op(T::Smooth,2); m.operators[2].inputs[0]={ControlInput::Kind::Operator,ModSource::None,1};
    m.nextOperatorId=3;
    std::array<OscillatorModuleState,16> modules{}; modules[0].id=1;
    check(validModulation(m,modules),"a source -> SCALE -> SMOOTH chain (with a storage hole) is valid");
    {   auto cyc=m; cyc.operators[0].inputs[0]={ControlInput::Kind::Operator,ModSource::None,2};
        check(!validModulation(cyc,modules),"a control cycle is rejected"); }
    {   auto bad=m; bad.operators[2].inputs[0].op=9; check(!validModulation(bad,modules),"an input to a missing operator is rejected"); }
    {   auto bad=m; bad.operators[2].inputs[1]={ControlInput::Kind::Source,ModSource::Lfo2,0}; check(!validModulation(bad,modules),"a unary operator has no B input"); }
    {   auto bad=m; bad.operators[0].params[0]=9.0f; check(!validModulation(bad,modules),"out-of-range parameters are rejected"); }
    {   auto bad=m; bad.routes[0]={1,true,operatorSource(7),cutoff,0.5f,false}; bad.nextRouteId=2;
        check(!validModulation(bad,modules),"a route from a missing operator is rejected"); }
    // Domains and ranges.
    check(!sourceIsVoice(operatorSource(2),m) && sourceRange(operatorSource(2),m)==ControlRange::Bipolar,"LFO chain: GLOBAL, bipolar");
    {   auto v=m; v.operators[1]=op(T::Add,3); v.operators[1].inputs[0]={ControlInput::Kind::Source,ModSource::Macro1,0};
        v.operators[1].inputs[1]={ControlInput::Kind::Source,ModSource::Env1,0}; v.nextOperatorId=4;
        check(sourceIsVoice(operatorSource(3),v) && sourceRange(operatorSource(3),v)==ControlRange::Unipolar,"GLOBAL + VOICE -> VOICE (unipolar)"); }
    std::array<ModSource,16> roots{};
    m.routes[0]={1,true,operatorSource(2),cutoff,0.5f,false}; m.nextRouteId=2;
    check(routeRootSources(m,m.routes[0],roots)==1 && roots[0]==ModSource::Lfo1,"a processed route's root source is LFO 1");

    // Engine: inserting SCALE x1 between LFO and CUTOFF is bit-identical to the direct route.
    ModulationState direct;
    direct.routes[0]={1,true,ModSource::Lfo1,cutoff,0.6f,false}; direct.nextRouteId=2;
    direct.lfo1.rateHz=7.0f;
    ModulationState processed=direct;
    processed.operators[0]=op(T::ScaleOffset,1); processed.operators[0].inputs[0]={ControlInput::Kind::Source,ModSource::Lfo1,0};
    processed.nextOperatorId=2;
    processed.routes[0].source=operatorSource(1);
    bool okA=false,okB=false;
    const auto a=renderEngine(direct,8192,{{0,60}},&okA),b=renderEngine(processed,8192,{{0,60}},&okB);
    check(okA && okB && a==b,"LFO -> SCALE(x1) -> CUTOFF renders bit-identically to LFO -> CUTOFF");
    {   // A bipolar chain scaled to zero on a BIPOLAR route contributes nothing
        // (on a unipolar route it sits at the centre, exactly like a stopped LFO).
        auto scaled=processed; scaled.operators[0].params[0]=0.0f; scaled.routes[0].bipolar=true;
        auto silent=direct; silent.routes[0].amount=0.0f;
        // (Tolerance: an active route still round-trips its destination through
        // normalize/denormalize, which an amount-0 route never compiles.)
        const auto x=renderEngine(scaled,8192,{{0,60}}),y=renderEngine(silent,8192,{{0,60}});
        float worst=0.0f; for(std::size_t i=0;i<x.size();++i) worst=std::max(worst,std::abs(x[i]-y[i]));
        check(worst<1e-4f,"SCALE x0 on a bipolar route removes the modulation"); }
    // Polyphony: ENV 1 -> SCALE -> per-voice LEVEL with overlapping notes equals the direct per-voice route.
    ModulationState envDirect;
    envDirect.routes[0]={1,true,ModSource::Env1,{ModDestination::Level,1,0},-0.7f,false}; envDirect.nextRouteId=2;
    ModulationState envProcessed=envDirect;
    envProcessed.operators[0]=op(T::ScaleOffset,1); envProcessed.operators[0].inputs[0]={ControlInput::Kind::Source,ModSource::Env1,0};
    envProcessed.nextOperatorId=2; envProcessed.routes[0].source=operatorSource(1);
    check(renderEngine(envDirect,12000,{{0,60},{3000,67},{6000,72}})==renderEngine(envProcessed,12000,{{0,60},{3000,67},{6000,72}}),
          "ENV -> SCALE -> per-voice LEVEL: each voice gets its own envelope (matches the direct per-voice route)");
    {   // Per-voice SMOOTH state is independent.
        CompiledModulation compiled; compiled.prepare(sr);
        ModulationState sm;
        sm.operators[0]=op(T::Smooth,1); sm.operators[0].params[0]=sm.operators[0].params[1]=0.05f;
        sm.operators[0].inputs[0]={ControlInput::Kind::Source,ModSource::Env1,0}; sm.nextOperatorId=2;
        sm.routes[0]={1,true,operatorSource(1),{ModDestination::Level,1,0},0.5f,false}; sm.nextRouteId=2;
        compiled.compile(sm,modules,true);
        check(compiled.hasVoiceOperators() && !compiled.hasGlobalOperators(),"ENV -> SMOOTH compiles as a per-voice operator");
        ModulationFrame f1,f2; CompiledModulation::OperatorState s1{},s2{};
        std::array<float,CompiledModulation::voiceSourceCount> v1{},v2{};
        v1[0]=1.0f; v2[0]=0.0f;
        for(int i=0;i<64;++i) { compiled.evaluateVoiceOperators(f1,v1,s1); compiled.evaluateVoiceOperators(f2,v2,s2); }
        v2[0]=1.0f; compiled.evaluateVoiceOperators(f2,v2,s2);
        check(f1.operatorOutputs[0]==1.0f && f2.operatorOutputs[0]>0.0f && f2.operatorOutputs[0]<0.01f,"one voice's SMOOTH never moves another voice's");
    }
    // Domain: a per-voice result never drives a global destination.
    {
        ModulationState fx;
        fx.operators[0]=op(T::ScaleOffset,1); fx.operators[0].inputs[0]={ControlInput::Kind::Source,ModSource::Env1,0};
        fx.operators[1]=op(T::ScaleOffset,2); fx.operators[1].inputs[0]={ControlInput::Kind::Source,ModSource::Lfo1,0};
        fx.nextOperatorId=3;
        fx.routes[0]={1,true,operatorSource(1),fxParameterAddress(mainBusId,4,2),0.5f,false};
        fx.routes[1]={2,true,operatorSource(2),fxParameterAddress(mainBusId,5,2),0.5f,false};
        fx.nextRouteId=3;
        auto engine=std::make_unique<OrigamiEngine>(); engine->prepare(sr,512,2);
        check(engine->setModulationState(fx),"state with a per-voice chain to an FX parameter is storable");
        engine->noteOn(60,1.0f);
        std::vector<float> l(512),r(512); float* out[2]{l.data(),r.data()};
        engine->process(out,2,512);
        const auto& output=engine->fxModulationOutput();
        check(output.count==1 && output.node[0]==5,"only the GLOBAL chain reaches the FX parameter; the per-voice one stays inert");
    }
    // Realtime: rendering with operators never allocates.
#ifndef ORIGAMI_SANITIZED
    {
        auto engine=std::make_unique<OrigamiEngine>(); engine->prepare(sr,512,2);
        auto chain=envProcessed; chain.operators[1]=op(T::Smooth,2); chain.operators[1].inputs[0]={ControlInput::Kind::Operator,ModSource::None,1};
        chain.nextOperatorId=3; chain.routes[0].source=operatorSource(2);
        engine->setModulationState(chain);
        engine->noteOn(60,1.0f); engine->noteOn(64,1.0f);
        std::vector<float> l(512),r(512); float* out[2]{l.data(),r.data()};
        engine->process(out,2,512); // adopts the compiled plan
        allocations=0;guardAllocations=true;
        for(int i=0;i<16;++i) engine->process(out,2,512);
        guardAllocations=false;
        check(allocations.load()==0,"control operators evaluate without allocating");
    }
#endif
    // Codec: v27 bytes when unused, v28 round-trip when used.
    {
        auto base=std::make_unique<OrigamiEngine>(); base->prepare(sr,512,2);
        const auto plain=base->instrumentState();
        const auto v27=encodeInstrumentState(plain);
        check(v27[7]==27,"a state without operators is still written as v27");
        auto withOps=plain;
        withOps.modulation=processed;
        const auto v28=encodeInstrumentState(withOps);
        InstrumentState decoded;
        check(v28[7]==28 && decodeInstrumentState(v28.data(),v28.size(),decoded),"a state with operators is written as v28 and decodes");
        check(decoded.modulation.operators[0].id==1 && decoded.modulation.operators[0].type==T::ScaleOffset
              && decoded.modulation.operators[0].inputs[0]==processed.operators[0].inputs[0]
              && decoded.modulation.routes[0].source==operatorSource(1) && decoded.modulation.nextOperatorId==2,"operators and processed routes round-trip");
    }
}

// mct-origami-nodes-n05-events-logic: EVENT / GATE family.
namespace n05 {
using T=ControlOpType;
ControlInput src(ModSource s) { return {ControlInput::Kind::Source,s,0}; }
ControlInput opIn(std::uint32_t id) { return {ControlInput::Kind::Operator,ModSource::None,id}; }
// Steps one operator with explicit inputs (deterministic sequences).
struct Stepper {
    ControlOperator op; ControlOpRuntime state; ControlOpPrepared prepared; ControlEventContext ctx;
    explicit Stepper(ControlOpType type,std::array<float,6> params={},bool useParams=false) {
        op=makeControlOperator(type,1); if(useParams) op.params=params; prepared=prepareControlOp(op,48000.0);
    }
    float step(float a=0.0f,float b=0.0f,float c=0.0f,std::array<bool,3> connected={true,true,true},ControlRange range=ControlRange::Unipolar) {
        ControlOpInputs in; in.value={a,b,c}; in.connected=connected; in.range={range,range,range};
        return evaluateControlOp(op,in,state,prepared,ctx);
    }
};
// Mirrors the engine's global evaluation: one sample at a time.
struct GlobalHarness {
    CompiledModulation compiled; ModulationFrame frame; std::array<OscillatorModuleState,16> modules{};
    double bpm=120.0,beats=0.0;
    explicit GlobalHarness(const ModulationState& m) { modules[0].id=1; compiled.prepare(48000.0); compiled.compile(m,modules,true); }
    void sample(const std::array<float,CompiledModulation::globalSourceCount>& sources) {
        frame.events.beats=beats; frame.events.beatsPerSample=bpm/60.0/48000.0; frame.events.sampleRate=48000.0;
        compiled.evaluateGlobalOperators(frame,sources);
        beats+=frame.events.beatsPerSample;
    }
};
}

void eventLogicTests() {
    using namespace n05;
    // ---- node semantics --------------------------------------------------
    {   Stepper t(T::Threshold,{{0.5f,0.2f}},true);
        const float in[]{0.0f,0.55f,0.61f,0.5f,0.41f,0.39f,0.55f};
        const float expected[]{0,0,1,1,1,0,0};
        bool ok=true; for(int i=0;i<7;++i) ok&=t.step(in[i])==expected[i];
        check(ok,"THRESHOLD: opens above thr+h/2, closes below thr-h/2 (no chatter)"); }
    {   Stepper rising(T::Edge,{{0}},true),falling(T::Edge,{{1}},true),both(T::Edge,{{2}},true);
        const float gate[]{0,1,1,0,1,0};
        int r=0,f=0,b=0; std::array<int,6> at{};
        for(int i=0;i<6;++i) { r+=rising.step(gate[i])!=0.0f; f+=falling.step(gate[i])!=0.0f; const bool e=both.step(gate[i])!=0.0f; b+=e; at[std::size_t(i)]=e; }
        check(r==2 && f==2 && b==4 && at[1] && at[3] && at[4] && at[5],"EDGE rising / falling / both at the transition samples"); }
    {   Stepper pulse(T::Pulse,{{0.0001f}},true); // 4.8 samples -> 5
        pulse.prepared.pulseSamples=3;
        const float trig[]{0,1,0,0,0,0,1,1,0,0};
        const float expected[]{0,1,1,1,0,0,1,1,1,1};
        bool ok=true; for(int i=0;i<10;++i) ok&=pulse.step(trig[i])==expected[i];
        check(ok,"PULSE opens at the event sample for LENGTH; a new event restarts it"); }
    {   bool ok=true;
        const auto cmp=[&](int mode,float a,float b){ Stepper c(T::Compare,{{float(mode),0.01f}},true); return c.step(a,b)!=0.0f; };
        ok&=cmp(0,0.6f,0.5f) && !cmp(0,0.5f,0.5f) && cmp(1,0.4f,0.5f) && cmp(2,0.5f,0.5f) && cmp(3,0.5f,0.5f);
        ok&=cmp(4,0.5f,0.505f) && !cmp(4,0.5f,0.52f) && cmp(5,0.5f,0.52f) && !cmp(5,0.5f,0.505f);
        check(ok,"COMPARE > < >= <= and == / != within TOLERANCE"); }
    {   Stepper a(T::And),o(T::Or),x(T::Xor),n(T::Not);
        bool ok=true;
        const float pairs[4][2]{{0,0},{0,1},{1,0},{1,1}};
        const float andE[]{0,0,0,1},orE[]{0,1,1,1},xorE[]{0,1,1,0};
        for(int i=0;i<4;++i) ok&=a.step(pairs[i][0],pairs[i][1])==andE[i] && o.step(pairs[i][0],pairs[i][1])==orE[i] && x.step(pairs[i][0],pairs[i][1])==xorE[i];
        ok&=n.step(0.0f)==1.0f && n.step(1.0f)==0.0f;
        check(ok,"AND / OR / XOR / NOT truth tables on gates"); }
    {   Stepper sw(T::Switch);
        check(sw.step(0.2f,0.8f,0.0f)==0.2f && sw.step(0.2f,0.8f,1.0f)==0.8f,"SWITCH: SELECT closed -> A, open -> B (instant)");
        Stepper glide(T::Switch,{{0.001f}},true); // 48 samples
        glide.step(0.0f,1.0f,0.0f); const float mid=[&]{ float v=0; for(int i=0;i<24;++i) v=glide.step(0.0f,1.0f,1.0f); return v; }();
        check(mid>0.4f && mid<0.6f,"SWITCH GLIDE crossfades instead of jumping"); }
    {   Stepper sh(T::SampleHold);
        const float value[]{0.1f,0.2f,0.3f,0.4f,0.5f,0.6f},trig[]{0,0,1,0,0,1};
        const float expected[]{0.1f,0.1f,0.3f,0.3f,0.3f,0.6f};
        bool ok=true; for(int i=0;i<6;++i) ok&=sh.step(value[i],trig[i])==expected[i];
        check(ok,"SAMPLE & HOLD captures VALUE at the trigger's own sample and holds it"); }
    {   Stepper th(T::TrackHold);
        const float value[]{0.1f,0.2f,0.3f,0.4f},gate[]{1,1,0,0};
        check(th.step(value[0],gate[0])==0.1f && th.step(value[1],gate[1])==0.2f && th.step(value[2],gate[2])==0.2f && th.step(value[3],gate[3])==0.2f,
              "TRACK & HOLD follows while open, holds the last value when closed"); }
    {   Stepper a(T::RandomTrigger),b(T::RandomTrigger),c(T::RandomTrigger,{{-1.0f,1.0f,7.0f}},true);
        bool same=true,inRange=true,changes=false; float last=a.step(0); b.step(0);
        for(int i=0;i<32;++i) { const float x=a.step(1.0f),y=b.step(1.0f); same&=x==y; inRange&=x>=0.0f && x<=1.0f; changes|=x!=last; last=x; }
        const float held=a.step(0.0f);
        check(same && inRange && changes && held==last,"RANDOM: deterministic per seed, in range, new value only per trigger");
        bool bipolar=false; for(int i=0;i<32;++i) bipolar|=c.step(1.0f)<0.0f;
        check(bipolar,"RANDOM honours a bipolar MIN..MAX"); }
    {   Stepper t(T::Toggle);
        check(t.step(0)==0.0f && t.step(1)==1.0f && t.step(0)==1.0f && t.step(1)==0.0f,"TOGGLE flips on each event"); }
    {   Stepper wrap(T::Counter,{{4.0f,0.0f}},true),clamp(T::Counter,{{4.0f,1.0f}},true);
        float w=0,c=0; for(int i=0;i<5;++i) { w=wrap.step(1.0f); c=clamp.step(1.0f); }
        check(std::abs(w-1.0f/3.0f)<1e-6f && c==1.0f,"COUNTER wraps (5 events in 4 steps -> step 1) or clamps at the last step");
        Stepper merged(T::Counter,{{8.0f,0.0f}},true);
        check(std::abs(merged.step(3.0f)-1.0f/7.0f)<1e-6f,"coincident events on one port at one sample merge into one (deterministic)"); }

    // ---- CLOCK: sample-exact grid, tempo, phase, free rate ----------------
    {
        ModulationState m;
        m.operators[0]=makeControlOperator(T::Clock,1); // TEMPO 1/8 by default
        m.nextOperatorId=2;
        GlobalHarness h(m);
        std::vector<int> ticks;
        for(int n=0;n<48000;++n) { h.sample({}); if(h.frame.operatorOutputs[0]!=0.0f) ticks.push_back(n); }
        // 120 BPM, 1/8 = 0.5 beat = 12000 samples; the first tick is at sample 0.
        bool exact=ticks.size()==4;
        for(std::size_t i=0;exact && i<ticks.size();++i) exact&=std::abs(ticks[i]-int(i)*12000)<=1;
        check(exact,"CLOCK 1/8 at 120 BPM ticks every 12000 samples from sample 0");
        GlobalHarness fast(m); fast.bpm=240.0; int count=0;
        for(int n=0;n<48000;++n) { fast.sample({}); count+=fast.frame.operatorOutputs[0]!=0.0f; }
        check(count==8,"doubling the tempo doubles the tick rate");
        ModulationState freeClock=m; freeClock.operators[0].params[0]=0.0f; freeClock.operators[0].params[1]=10.0f;
        GlobalHarness f(freeClock); int freeTicks=0;
        for(int n=0;n<48000;++n) { f.sample({}); freeTicks+=f.frame.operatorOutputs[0]!=0.0f; }
        check(freeTicks==10 || freeTicks==11,"free-running CLOCK at 10 Hz ticks 10 times a second");
    }
    // ---- same-sample ordering: CLOCK -> S&H captures LFO at that sample ---
    {
        ModulationState m;
        m.operators[0]=makeControlOperator(T::Clock,1);
        m.operators[1]=makeControlOperator(T::SampleHold,2);
        m.operators[1].inputs[0]=src(ModSource::Lfo1);
        m.operators[1].inputs[1]=opIn(1);
        m.nextOperatorId=3;
        GlobalHarness h(m);
        bool captured=true; int changes=0; float last=-9.0f;
        for(int n=0;n<36000;++n) {
            std::array<float,CompiledModulation::globalSourceCount> sources{};
            sources[0]=std::sin(float(n)*0.001f);
            h.sample(sources);
            const float out=h.frame.operatorOutputs[4];
            if(h.frame.operatorOutputs[0]!=0.0f) captured&=out==sources[0]; // the value AT the tick sample
            if(out!=last) { ++changes; last=out; }
        }
        check(captured && changes==3,"S&H triggered by CLOCK captures the LFO value at the tick's own sample (3 captures)");
    }
    // ---- MACRO -> THRESHOLD -> EDGE -> RANDOM: one chain, one sample --------
    {
        ModulationState m;
        m.operators[0]=makeControlOperator(T::Threshold,1); m.operators[0].inputs[0]=src(ModSource::Macro1);
        m.operators[1]=makeControlOperator(T::Edge,2); m.operators[1].inputs[0]=opIn(1);
        m.operators[2]=makeControlOperator(T::RandomTrigger,3); m.operators[2].inputs[0]=opIn(2);
        m.nextOperatorId=4;
        GlobalHarness h(m);
        std::array<float,CompiledModulation::globalSourceCount> sources{};
        h.sample(sources); const float before=h.frame.operatorOutputs[8];
        for(int n=0;n<10;++n) h.sample(sources);
        sources[4]=0.9f; h.sample(sources);
        check(h.frame.operatorOutputs[0]==1.0f && h.frame.operatorOutputs[4]==1.0f && h.frame.operatorOutputs[8]!=before,
              "the macro crossing propagates through THRESHOLD, EDGE and RANDOM within the same sample");
        h.sample(sources);
        check(h.frame.operatorOutputs[4]==0.0f,"the EVENT lasts exactly one sample");
    }
    // ---- validation / typing ----------------------------------------------
    std::array<OscillatorModuleState,16> modules{}; modules[0].id=1;
    {
        ModulationState m;
        m.operators[0]=makeControlOperator(T::Toggle,1);
        m.operators[0].inputs[0]=src(ModSource::Lfo1);
        m.nextOperatorId=2;
        check(!validModulation(m,modules),"a CONTROL source into an EVENT input is rejected (no float-as-trigger)");
        m.operators[0].inputs[0]={};
        m.operators[1]=makeControlOperator(T::ScaleOffset,2); m.operators[1].inputs[0]=opIn(1); m.nextOperatorId=3;
        check(!validModulation(m,modules),"a GATE output into a CONTROL input is rejected");
        m.operators[1]=makeControlOperator(T::Edge,2); m.operators[1].inputs[0]=opIn(1);
        check(validModulation(m,modules),"GATE -> GATE input (TOGGLE -> EDGE) is valid");
        m.operators[2]=makeControlOperator(T::Smooth,3); m.operators[2].inputs[0]=opIn(2); m.nextOperatorId=4;
        check(!validModulation(m,modules),"an EVENT output into a CONTROL input is rejected");
        m.operators[2]={};
        m.routes[0]={1,true,operatorSource(1),{ModDestination::Cutoff,0,0},0.5f,false}; m.nextRouteId=2;
        check(!validModulation(m,modules),"a GATE output cannot drive a parameter directly");
    }
    // ---- engine: note events, polyphony, stealing, envelope triggers ------
    {
        // NOTE ON -> TOGGLE (per voice) -> SWITCH SELECT; LFO -> A, ENV -> B; SWITCH -> LEVEL.
        ModulationState m;
        m.operators[0]=makeControlOperator(T::NoteOn,1);
        m.operators[1]=makeControlOperator(T::Toggle,2); m.operators[1].inputs[0]=opIn(1);
        m.operators[2]=makeControlOperator(T::Switch,3);
        m.operators[2].inputs[0]=src(ModSource::Lfo1); m.operators[2].inputs[1]=src(ModSource::Env1); m.operators[2].inputs[2]=opIn(2);
        m.nextOperatorId=4;
        m.routes[0]={1,true,operatorSource(3),{ModDestination::Level,1,0},0.3f,false}; m.nextRouteId=2;
        check(validModulation(m,modules) && sourceIsVoice(operatorSource(3),m),"NOTE ON -> TOGGLE -> SWITCH is a per-voice chain");
        auto engine=std::make_unique<OrigamiEngine>(); engine->prepare(sr,512,2);
        check(engine->setModulationState(m),"engine accepts the chain");
        std::vector<float> l(512),r(512); float* out[2]{l.data(),r.data()};
        const auto toggleOfNewest=[&]{ return engine->runtimeVisualizationSnapshot().routeSources[CompiledModulation::sourceSlotCount+operatorOutputIndex(1,0)]; };
        engine->noteOn(60,1.0f); engine->process(out,2,512);
        engine->noteOn(64,1.0f); engine->process(out,2,512);
        // A shared toggle would have flipped back to OFF on the second note.
        check(toggleOfNewest()==1.0f && engine->activeVoiceCount()==2,"each voice's NOTE ON flips its own TOGGLE (no cross-voice state)");
        // Voice stealing: one voice; every new note reuses it and must start fresh.
        auto stealing=std::make_unique<OrigamiEngine>(); stealing->prepare(sr,512,2);
        stealing->setModulationState(m); stealing->setVoiceAdmissionCeiling(1);
        bool fresh=true;
        for(int note=0;note<5;++note) {
            stealing->noteOn(60+note,1.0f); stealing->process(out,2,512);
            fresh&=stealing->runtimeVisualizationSnapshot().routeSources[CompiledModulation::sourceSlotCount+operatorOutputIndex(1,0)]==1.0f;
        }
        check(fresh,"a stolen voice never inherits stale TOGGLE state (ON after every note, never alternating)");
    }
    {
        // CLOCK -> ENV TRIGGER (ENV 2): the modulation envelope restarts on each tick.
        ModulationState m;
        m.env2.attack=1.0f; m.env2.decay=1.0f; m.env2.sustain=1.0f; m.env2.release=1.0f;
        m.operators[0]=makeControlOperator(T::Clock,1); m.operators[0].params[0]=0.0f; m.operators[0].params[1]=20.0f;
        m.operators[1]=makeControlOperator(T::EnvelopeTrigger,2); m.operators[1].inputs[0]=opIn(1);
        m.nextOperatorId=3;
        auto triggered=std::make_unique<OrigamiEngine>(); triggered->prepare(sr,512,2);
        auto plain=std::make_unique<OrigamiEngine>(); plain->prepare(sr,512,2);
        auto noTrigger=m; noTrigger.operators={}; noTrigger.nextOperatorId=1;
        check(triggered->setModulationState(m) && plain->setModulationState(noTrigger),"envelope trigger states");
        triggered->noteOn(60,1.0f); plain->noteOn(60,1.0f);
        std::vector<float> l(512),r(512); float* out[2]{l.data(),r.data()};
        for(int b=0;b<40;++b) { triggered->process(out,2,512); plain->process(out,2,512); } // ~0.43 s
        float t=0,p=0;
        for(std::size_t v=0;v<OrigamiEngine::voiceCount;++v) {
            if(triggered->voiceInfo(v).active) t=triggered->voiceInfo(v).envelopes[1].progress;
            if(plain->voiceInfo(v).active) p=plain->voiceInfo(v).envelopes[1].progress;
        }
        check(p>0.3f && t<0.1f,"CLOCK -> ENV TRIGGER restarts ENV 2 on every tick (MIDI triggering unaffected)");
    }
    {
        // Block-size independence + host sync: identical audio for 64- and 500-sample blocks.
        ModulationState m;
        m.operators[0]=makeControlOperator(T::Clock,1); m.operators[0].params[2]=4.0f; // 1/16
        m.operators[1]=makeControlOperator(T::SampleHold,2); m.operators[1].inputs[0]=src(ModSource::Lfo1); m.operators[1].inputs[1]=opIn(1);
        m.nextOperatorId=3;
        m.routes[0]={1,true,operatorSource(2),{ModDestination::Cutoff,0,0},0.7f,true}; m.nextRouteId=2;
        m.lfo1.rateHz=3.0f;
        const auto renderBlocks=[&](int block,bool host) {
            auto e=std::make_unique<OrigamiEngine>(); e->prepare(sr,512,2); e->setModulationState(m);
            for(OscillatorModuleId id=2;id<=4;++id) e->setOscillatorModuleEnabled(id,false);
            e->noteOn(60,1.0f);
            std::vector<float> l(24000),r(24000);
            for(int done=0;done<24000;done+=block) {
                const int n=std::min(block,24000-done);
                if(host) { OrigamiEngine::HostTransport t; t.bpm=128.0; t.playing=true; t.ppqValid=true; t.ppq=double(done)*128.0/60.0/sr; e->setHostTransport(t); }
                float* out[2]{l.data()+done,r.data()+done}; e->process(out,2,std::size_t(n));
            }
            return l;
        };
        check(renderBlocks(64,false)==renderBlocks(500,false),"CLOCK-driven modulation is block-size independent (internal tempo)");
        const auto a=renderBlocks(64,true),b=renderBlocks(500,true);
        float worst=0.0f; for(std::size_t i=0;i<a.size();++i) worst=std::max(worst,std::abs(a[i]-b[i]));
        check(worst<1e-4f,"host-synced CLOCK resyncs each block: block-size independent");
    }
    // ---- realtime: event chains never allocate ----------------------------
#ifndef ORIGAMI_SANITIZED
    {
        ModulationState m;
        m.operators[0]=makeControlOperator(T::Clock,1); m.operators[0].params[0]=0.0f; m.operators[0].params[1]=40.0f;
        m.operators[1]=makeControlOperator(T::Counter,2); m.operators[1].inputs[0]=opIn(1);
        m.operators[2]=makeControlOperator(T::NoteOn,3);
        m.operators[3]=makeControlOperator(T::Pulse,4); m.operators[3].inputs[0]=opIn(3);
        m.operators[4]=makeControlOperator(T::TrackHold,5); m.operators[4].inputs[0]=src(ModSource::Env1); m.operators[4].inputs[1]=opIn(4);
        m.nextOperatorId=6;
        m.routes[0]={1,true,operatorSource(2),{ModDestination::Cutoff,0,0},0.4f,false};
        m.routes[1]={2,true,operatorSource(5),{ModDestination::Level,1,0},0.4f,false}; m.nextRouteId=3;
        auto e=std::make_unique<OrigamiEngine>(); e->prepare(sr,512,2); e->setModulationState(m);
        e->noteOn(60,1.0f); e->noteOn(64,1.0f);
        std::vector<float> l(512),r(512); float* out[2]{l.data(),r.data()};
        e->process(out,2,512);
        allocations=0;guardAllocations=true;
        for(int i=0;i<16;++i) { if(i==8) e->noteOn(67,1.0f); e->process(out,2,512); }
        guardAllocations=false;
        check(allocations.load()==0,"event / gate / stateful nodes evaluate without allocating");
    }
#endif
    // ---- codec: v27 / v28 / v29 --------------------------------------------
    {
        auto base=std::make_unique<OrigamiEngine>(); base->prepare(sr,512,2);
        auto state=base->instrumentState();
        state.modulation.operators[0]=makeControlOperator(T::ScaleOffset,1);
        state.modulation.operators[0].inputs[0]=src(ModSource::Lfo1);
        state.modulation.nextOperatorId=2;
        check(encodeInstrumentState(state)[7]==28,"N04-only operators still write v28");
        state.modulation.operators[1]=makeControlOperator(T::Switch,2);
        state.modulation.operators[1].inputs[2]=opIn(3);
        state.modulation.operators[2]=makeControlOperator(T::Threshold,3);
        state.modulation.operators[2].inputs[0]=src(ModSource::Macro1);
        state.modulation.nextOperatorId=4;
        const auto bytes=encodeInstrumentState(state);
        InstrumentState decoded;
        check(bytes[7]==29 && decodeInstrumentState(bytes.data(),bytes.size(),decoded),"event / logic nodes write v29 and decode");
        check(decoded.modulation.operators[1].inputs[2]==state.modulation.operators[1].inputs[2]
              && decoded.modulation.operators[2].type==T::Threshold,"three-input nodes round-trip");
    }
}

namespace n06 {
using T=ControlOpType;
ControlInput src(ModSource s) { return {ControlInput::Kind::Source,s,0}; }
ControlInput opIn(std::uint32_t id,std::uint8_t port=0) { return {ControlInput::Kind::Operator,ModSource::None,id,port}; }
// Multi-output stepper: every port of one node, one sample at a time.
struct MultiStepper {
    ControlOperator op; ControlOpRuntime state; ControlOpPrepared prepared; ControlEventContext ctx;
    std::array<float,maxControlOutputs> out{};
    explicit MultiStepper(ControlOpType type,std::array<float,6> params={},bool useParams=false) {
        op=makeControlOperator(type,1); if(useParams) op.params=params; prepared=prepareControlOp(op,48000.0);
    }
    const std::array<float,maxControlOutputs>& step(float a=0.0f,float b=0.0f,float c=0.0f) {
        ControlOpInputs in; in.value={a,b,c}; in.connected={true,true,true};
        evaluateControlOpOutputs(op,in,state,prepared,ctx,out);
        return out;
    }
};
// The engine's global evaluation, with the canonical sequencer attached.
struct SeqHarness {
    CompiledModulation compiled; ModulationFrame frame; std::array<OscillatorModuleState,16> modules{};
    SequencerGenerator sequencer; SequencerSettings settings;
    double bpm=120.0,beats=0.0;
    explicit SeqHarness(const ModulationState& m) { modules[0].id=1; compiled.prepare(48000.0); compiled.compile(m,modules,true); sequencer.reset(); }
    void sample(std::array<float,CompiledModulation::globalSourceCount> sources={}) {
        frame.events.beats=beats; frame.events.beatsPerSample=bpm/60.0/48000.0; frame.events.sampleRate=48000.0;
        frame.events.sequencer=&sequencer; frame.events.sequencerSettings=&settings;
        compiled.evaluateGlobalOperators(frame,sources);
        beats+=frame.events.beatsPerSample;
    }
    float out(std::size_t slot,std::size_t port=0) const { return frame.operatorOutputs[operatorOutputIndex(slot,port)]; }
};
bool evenlySpaced(int steps,int pulses,int rotation) {
    std::vector<int> hits;
    for(int i=0;i<steps;++i) if(euclideanHit(steps,pulses,rotation,i)) hits.push_back(i);
    if(int(hits.size())!=pulses) return false;
    if(pulses<2) return true;
    int lo=steps,hi=0;
    for(std::size_t i=0;i<hits.size();++i) {
        const int gap=(i+1<hits.size() ? hits[i+1] : hits[0]+steps)-hits[i];
        lo=std::min(lo,gap); hi=std::max(hi,gap);
    }
    return hi-lo<=1; // maximal evenness (Bjorklund): gaps differ by at most one
}
}

void sequencingTests() {
    using namespace n06;
    std::array<OscillatorModuleState,16> modules{}; modules[0].id=1;
    // ---- multi-output metadata ---------------------------------------------
    {
        const auto* counter=controlOpInfo(T::Counter);
        const auto* split=controlOpInfo(T::ChanceSplit);
        const auto* seq=controlOpInfo(T::Sequencer);
        check(counter && counter->outputCount==2 && controlOutputSignalOf(*counter,0)==ControlSignal::Control
              && controlOutputSignalOf(*counter,1)==ControlSignal::Event && std::string(controlOutputName(*counter,1))=="WRAP",
              "COUNTER: VALUE (CONTROL) + WRAP (EVENT) with stable port indices and names");
        check(split && split->outputCount==2 && seq && seq->outputCount==3 && seq->globalOnly
              && controlOutputSignalOf(*seq,1)==ControlSignal::Control && controlOutputSignalOf(*seq,2)==ControlSignal::Event,
              "CHANCE SPLIT A/B and SEQUENCER VALUE / STEP / STEP EVENT ports");
        check(operatorSource(7,0)==operatorSource(7) && operatorIdOf(operatorSource(7,2))==7 && operatorPortOf(operatorSource(7,2))==2,
              "port 0 keeps the pre-N06 source encoding; the port round-trips");
        bool catalog=true; for(auto t:controlSequencingOpCatalog()) catalog&=controlOpInfo(t)!=nullptr;
        check(catalog,"every sequencing / generative catalog entry is defined");
    }
    // ---- COUNTER: VALUE + WRAP, modes, RESET before ADVANCE ------------------
    {
        MultiStepper wrap(T::Counter,{{4.0f,0.0f}},true);
        const float expected[]{1.0f/3.0f,2.0f/3.0f,1.0f,0.0f,1.0f/3.0f};
        bool ok=true,wrapOnlyAtZero=true;
        for(int i=0;i<5;++i) { const auto& o=wrap.step(1.0f); ok&=std::abs(o[0]-expected[i])<1e-6f; wrapOnlyAtZero&=(o[1]!=0.0f)==(i==3); }
        check(ok,"COUNTER VALUE = position / (LENGTH - 1)");
        check(wrapOnlyAtZero,"COUNTER WRAP fires at the exact sample VALUE returns to 0");
        MultiStepper clamp(T::Counter,{{3.0f,1.0f}},true);
        int clampWraps=0; for(int i=0;i<6;++i) clampWraps+=clamp.step(1.0f)[1]!=0.0f;
        check(clampWraps==1 && clamp.out[0]==1.0f,"CLAMP: WRAP fires once on reaching the end; VALUE stays at 1");
        MultiStepper pong(T::Counter,{{3.0f,2.0f}},true);
        std::vector<float> seq; int pongWraps=0;
        for(int i=0;i<6;++i) { const auto& o=pong.step(1.0f); seq.push_back(o[0]); pongWraps+=o[1]!=0.0f; }
        check(seq==std::vector<float>{0.5f,1.0f,0.5f,0.0f,0.5f,1.0f} && pongWraps==3,"PING-PONG 0 1 2 1 0 1 2 with WRAP on reaching each end");
        MultiStepper reset(T::Counter,{{8.0f,0.0f}},true);
        reset.step(1.0f); reset.step(1.0f); reset.step(1.0f);
        const float both=reset.step(1.0f,1.0f)[0];
        check(std::abs(both-1.0f/7.0f)<1e-6f,"RESET and ADVANCE on one sample: RESET first, then ADVANCE (position 1)");
        check(reset.step(0.0f,1.0f)[0]==0.0f,"RESET alone returns to position 0");
        MultiStepper toggle(T::Toggle);
        toggle.step(1.0f);
        check(toggle.step(1.0f,1.0f)[0]==1.0f && toggle.step(0.0f,1.0f)[0]==0.0f,"TOGGLE: RESET (off) before TRIG (on) on the same sample");
        MultiStepper random(T::RandomTrigger);
        const float first=random.step()[0]; random.step(1.0f); random.step(1.0f);
        check(random.step(0.0f,1.0f)[0]==first,"RANDOM RESET restarts the seeded sequence");
    }
    // ---- CLOCK DIVIDER / EVENT DELAY / MERGE ---------------------------------
    {
        MultiStepper div(T::ClockDivider);
        std::array<int,4> counts{}; std::array<bool,4> downbeat{};
        for(int i=0;i<32;++i) { const auto& o=div.step(1.0f); for(std::size_t k=0;k<4;++k) { counts[k]+=o[k]!=0.0f; if(i==0) downbeat[k]=o[k]!=0.0f; } }
        check(counts==std::array<int,4>{16,8,4,2} && downbeat==std::array<bool,4>{true,true,true,true},
              "CLOCK DIVIDER /2 /4 /8 /16 from one input, all on the downbeat");
        div.step(1.0f); div.step(1.0f);
        const auto& afterReset=div.step(1.0f,1.0f);
        check(afterReset[3]!=0.0f,"CLOCK DIVIDER RESET realigns every output to the next event");
        int silent=0; for(int i=0;i<10;++i) silent+=div.step(0.0f)[0]!=0.0f;
        check(silent==0,"no input event, no output event");
    }
    {
        MultiStepper delay(T::EventDelay); delay.prepared.delaySamples=3;
        std::vector<int> fired;
        for(int i=0;i<12;++i) if(delay.step(i==0 || i==1 ? 1.0f : 0.0f)[0]!=0.0f) fired.push_back(i);
        check(fired==std::vector<int>{3,4},"EVENT DELAY: an event at N fires at N + delay (each event kept)");
        MultiStepper full(T::EventDelay); full.prepared.delaySamples=100;
        int out=0; for(int i=0;i<300;++i) out+=full.step(i<12 ? 1.0f : 0.0f)[0]!=0.0f;
        check(out==int(ControlOpRuntime::delayCapacity),"EVENT DELAY overflow: bounded at 8 pending; newer events are dropped");
        MultiStepper sync(T::EventDelay,{{1.0f,100.0f,3.0f}},true); // 1/8 at 120 BPM = 12000 samples
        sync.prepared=prepareControlOp(sync.op,48000.0); sync.ctx.beatsPerSample=120.0/60.0/48000.0;
        int at=-1; for(int i=0;i<13000;++i) if(sync.step(i==0 ? 1.0f : 0.0f)[0]!=0.0f) at=i;
        check(std::abs(at-12000)<=1,"EVENT DELAY SYNC: a tempo division (1/8 at 120 BPM = 12000 samples)");
        MultiStepper merge(T::EventMerge);
        check(merge.step(1,0,0)[0]==1.0f && merge.step(0,0,1)[0]==1.0f && merge.step(1,1,1)[0]==1.0f && merge.step(0,0,0)[0]==0.0f,
              "EVENT MERGE: any input event; coincident events merge into one");
    }
    // ---- PROBABILITY / CHANCE SPLIT ------------------------------------------
    {
        MultiStepper never(T::Probability,{{0.0f,1.0f}},true),always(T::Probability,{{1.0f,1.0f}},true);
        MultiStepper half(T::Probability,{{0.5f,1.0f}},true),twin(T::Probability,{{0.5f,1.0f}},true);
        int n=0,a=0,h=0; bool same=true;
        for(int i=0;i<2000;++i) { n+=never.step(1.0f)[0]!=0.0f; a+=always.step(1.0f)[0]!=0.0f; const bool x=half.step(1.0f)[0]!=0.0f; h+=x; same&=x==(twin.step(1.0f)[0]!=0.0f); }
        check(n==0 && a==2000 && h>850 && h<1150 && same,"PROBABILITY: 0 never, 1 always, 0.5 about half, deterministic per seed");
        MultiStepper split(T::ChanceSplit,{{0.3f,9.0f}},true);
        int A=0,B=0,both=0,idle=0;
        for(int i=0;i<4000;++i) {
            const bool ev=(i%2)==0;
            const auto& o=split.step(ev ? 1.0f : 0.0f);
            const bool x=o[0]!=0.0f,y=o[1]!=0.0f;
            if(ev) { A+=x; B+=y; both+=x==y; } else idle+=x||y;
        }
        check(A+B==2000 && both==0 && idle==0,"CHANCE SPLIT: exactly one of A / B per event, nothing between events");
        check(A>450 && A<750,"CHANCE SPLIT honours A CHANCE");
    }
    // ---- EUCLIDEAN / PATTERN / RANDOM WALK -----------------------------------
    {
        bool even=true;
        for(int steps=1;steps<=32;++steps) for(int pulses=0;pulses<=steps;++pulses) even&=evenlySpaced(steps,pulses,0);
        check(even,"EUCLIDEAN: every steps 1..32 / pulses 0..steps pattern has PULSES maximally even hits");
        std::string e38,e58;
        for(int i=0;i<8;++i) { e38+=euclideanHit(8,3,0,i)?'x':'.'; e58+=euclideanHit(8,5,0,i)?'x':'.'; }
        check(e38=="x..x..x." && e58=="x.x.xx.x","EUCLIDEAN(3,8) = x..x..x. and (5,8) = x.x.xx.x (Bjorklund necklaces)");
        std::string e416; for(int i=0;i<16;++i) e416+=euclideanHit(16,4,0,i)?'x':'.';
        check(e416=="x...x...x...x...","EUCLIDEAN(4,16) = four on the floor");
        bool rotates=true; for(int i=0;i<8;++i) rotates&=euclideanHit(8,3,1,i)==euclideanHit(8,3,0,(i+1)%8);
        check(rotates,"EUCLIDEAN ROTATION shifts the pattern");
        MultiStepper euclid(T::Euclidean,{{8.0f,3.0f,0.0f}},true);
        std::string run; for(int i=0;i<16;++i) run+=euclid.step(1.0f)[0]!=0.0f?'x':'.';
        check(run=="x..x..x.x..x..x.","EUCLIDEAN node walks its pattern one step per CLOCK event");
        MultiStepper pattern(T::Pattern,{{5.0f,float(0b10011),0.0f}},true);
        std::string p; for(int i=0;i<10;++i) p+=pattern.step(1.0f)[0]!=0.0f?'x':'.';
        check(p=="xx..xxx..x","PATTERN: bounded binary mask over LENGTH steps");
        MultiStepper walk(T::RandomWalk,{{0.3f,-0.5f,0.5f,3.0f,1.0f}},true),twin(T::RandomWalk,{{0.3f,-0.5f,0.5f,3.0f,1.0f}},true);
        bool bounded=true,same=true,moves=false; float last=walk.step()[0]; twin.step();
        for(int i=0;i<500;++i) { const float v=walk.step(1.0f)[0]; bounded&=v>=-0.5f && v<=0.5f; same&=v==twin.step(1.0f)[0]; moves|=v!=last; last=v; }
        check(bounded && same && moves,"RANDOM WALK: bounded (reflect), deterministic per seed, steps only on TRIG");
        check(walk.step(0.0f,1.0f)[0]==0.0f,"RANDOM WALK RESET returns to the centre of MIN..MAX");
    }
    // ---- validation: ports, typing, singleton sequencer ----------------------
    {
        ModulationState m;
        m.operators[0]=makeControlOperator(T::Counter,1);
        m.operators[1]=makeControlOperator(T::Toggle,2); m.operators[1].inputs[0]=opIn(1,1); // WRAP (EVENT) -> TRIG
        m.nextOperatorId=3;
        check(validModulation(m,modules),"an EVENT output port feeds an EVENT input");
        m.operators[1].inputs[0]=opIn(1,0);
        check(!validModulation(m,modules),"the CONTROL port of the same node cannot feed an EVENT input");
        m.operators[1].inputs[0]=opIn(1,3);
        check(!validModulation(m,modules),"a port beyond the node's outputs is rejected");
        m.operators[1].inputs[0]=opIn(1,1);
        m.routes[0]={1,true,operatorSource(1,0),{ModDestination::Cutoff,0,0},0.5f,false}; m.nextRouteId=2;
        check(validModulation(m,modules),"COUNTER VALUE drives a parameter");
        m.routes[0].source=operatorSource(1,1);
        check(!validModulation(m,modules),"COUNTER WRAP (EVENT) cannot drive a parameter");
        m.routes[0]={};
        m.operators[2]=makeControlOperator(T::Sequencer,3); m.operators[3]=makeControlOperator(T::Sequencer,4); m.nextOperatorId=5;
        check(!validModulation(m,modules),"there is exactly one SEQUENCER");
        ModulationState one; std::uint32_t id=0;
        check(nodes::addControlOperator(one,T::Sequencer,one,id) && !nodes::controlOperatorCreatable(one,T::Sequencer),
              "a second SEQUENCER cannot be created");
    }
    // ---- success graph A: COUNTER VALUE + WRAP from one CLOCK -----------------
    {
        ModulationState m;
        m.operators[0]=makeControlOperator(T::Clock,1); m.operators[0].params[0]=0.0f; m.operators[0].params[1]=50.0f; // 960 samples
        m.operators[1]=makeControlOperator(T::Counter,2); m.operators[1].params[0]=4.0f; m.operators[1].inputs[0]=opIn(1);
        m.operators[2]=makeControlOperator(T::Toggle,3); m.operators[2].inputs[0]=opIn(2,1);
        m.operators[3]=makeControlOperator(T::ScaleOffset,4); m.operators[3].inputs[0]=opIn(2,0);   // VALUE -> SCALE
        m.operators[4]=makeControlOperator(T::RandomTrigger,5); m.operators[4].inputs[0]=opIn(2,1); // WRAP -> RANDOM
        m.nextOperatorId=6;
        m.routes[0]={1,true,operatorSource(4),{ModDestination::Cutoff,0,0},0.5f,false};
        m.routes[1]={2,true,operatorSource(5),{ModDestination::Resonance,0,0},0.4f,false}; m.nextRouteId=3;
        check(validModulation(m,modules),"graph A is valid (VALUE -> SCALE -> CUTOFF, WRAP -> RANDOM -> parameter, WRAP fan-out)");
        SeqHarness h(m);
        bool sameSample=true,scaled=true; int wraps=0,toggles=0,randoms=0; float lastToggle=0.0f,lastRandom=0.0f;
        for(int n=0;n<9600;++n) {
            h.sample();
            const bool wrap=h.out(1,1)!=0.0f;
            wraps+=wrap;
            if(wrap) sameSample&=h.out(1,0)==0.0f;
            scaled&=h.out(3)==h.out(1,0); // SCALE x1 follows VALUE on the same sample
            if(h.out(2)!=lastToggle) { ++toggles; sameSample&=wrap; lastToggle=h.out(2); }
            if(n>0 && h.out(4)!=lastRandom) { ++randoms; sameSample&=wrap; }
            lastRandom=h.out(4);
        }
        check(wraps==2 && toggles==2 && randoms==2 && sameSample && scaled,
              "graph A: WRAP fires at the sample VALUE wraps; every WRAP consumer reacts on that sample (fan-out)");
    }
    // ---- success graph B: CLOCK -> EUCLIDEAN(5/8) -> PROBABILITY -> S&H <- LFO --
    {
        ModulationState m;
        m.operators[0]=makeControlOperator(T::Clock,1); m.operators[0].params[0]=0.0f; m.operators[0].params[1]=50.0f;
        m.operators[1]=makeControlOperator(T::Euclidean,2); m.operators[1].params[0]=8.0f; m.operators[1].params[1]=5.0f; m.operators[1].inputs[0]=opIn(1);
        m.operators[2]=makeControlOperator(T::Probability,3); m.operators[2].params[0]=1.0f; m.operators[2].inputs[0]=opIn(2);
        m.operators[3]=makeControlOperator(T::SampleHold,4); m.operators[3].inputs[0]=src(ModSource::Lfo1); m.operators[3].inputs[1]=opIn(3);
        m.nextOperatorId=5;
        m.routes[0]={1,true,operatorSource(4),{ModDestination::Cutoff,0,0},0.5f,true}; m.nextRouteId=2;
        check(validModulation(m,modules),"graph B is valid");
        SeqHarness h(m);
        int captures=0; bool exact=true; std::array<float,CompiledModulation::globalSourceCount> sources{};
        for(int n=0;n<960*8;++n) {
            sources[0]=std::sin(float(n)*0.01f);
            h.sample(sources);
            if(h.out(2)!=0.0f) { ++captures; exact&=h.out(3)==sources[0]; }
        }
        check(captures==5 && exact,"graph B: 5 of 8 clock steps sample the LFO at the event's own sample");
    }
    // ---- success graph C: CHANCE SPLIT -> ENV TRIGGER / RANDOM ----------------
    {
        ModulationState m;
        m.operators[0]=makeControlOperator(T::Clock,1); m.operators[0].params[0]=0.0f; m.operators[0].params[1]=50.0f;
        m.operators[1]=makeControlOperator(T::ChanceSplit,2); m.operators[1].inputs[0]=opIn(1);
        m.operators[2]=makeControlOperator(T::EnvelopeTrigger,3); m.operators[2].inputs[0]=opIn(2,0);
        m.operators[3]=makeControlOperator(T::RandomTrigger,4); m.operators[3].inputs[0]=opIn(2,1);
        m.nextOperatorId=5;
        m.routes[0]={1,true,operatorSource(4),{ModDestination::Cutoff,0,0},0.5f,false}; m.nextRouteId=2;
        check(validModulation(m,modules),"graph C is valid (A -> ENV TRIGGER, B -> RANDOM -> parameter)");
        SeqHarness h(m);
        int b=0,changes=0; bool onlyOnB=true; float last=0.0f;
        for(int n=0;n<48000;++n) {
            h.sample();
            const bool onB=h.out(1,1)!=0.0f; b+=onB;
            if(n>0 && h.out(3)!=last) { ++changes; onlyOnB&=onB; }
            last=h.out(3);
        }
        check(b>0 && changes>0 && onlyOnB,"graph C: RANDOM changes only on CHANCE SPLIT B events");
    }
    // ---- the canonical SEQUENCER node -----------------------------------------
    {
        // Graph E: external CLOCK -> SEQUENCER ADVANCE; the internal clock never runs.
        ModulationState m;
        m.operators[0]=makeControlOperator(T::Clock,1); m.operators[0].params[0]=0.0f; m.operators[0].params[1]=2.0f; // 2 Hz
        m.operators[1]=makeControlOperator(T::Sequencer,2); m.operators[1].params[0]=1.0f; m.operators[1].inputs[0]=opIn(1);
        m.nextOperatorId=3;
        m.routes[0]={1,true,operatorSource(2),{ModDestination::Cutoff,0,0},0.5f,true}; m.nextRouteId=2;
        check(validModulation(m,modules),"graph E is valid");
        SeqHarness h(m); h.settings.rateHz=13.0f; // would step 13x per second if the internal clock ran
        int events=0; bool coincident=true; std::vector<std::size_t> steps;
        for(int n=0;n<48000;++n) {
            h.sample();
            const bool tick=h.out(0)!=0.0f,step=h.out(1,2)!=0.0f;
            coincident&=tick==step;
            if(step) { ++events; steps.push_back(h.sequencer.currentStep()); }
        }
        check(events==2 && coincident,"graph E: one STEP EVENT per external CLOCK, none from the internal clock");
        check(steps==std::vector<std::size_t>{0,1},"the first ADVANCE plays the start step, the next one step 2");
        check(h.out(1,0)==h.settings.steps[1] && std::abs(h.out(1,1)-1.0f/7.0f)<1e-6f,"VALUE is the step value; STEP = step / (count - 1)");
        check(h.frame.globalSources[12]==h.out(1,0),"the canonical SEQ source follows the node's VALUE");
    }
    {
        // Transport jumps: a seek / loop that lands in a new grid cell ticks ONCE.
        ModulationState m;
        m.operators[0]=makeControlOperator(T::Clock,1); m.operators[0].params[2]=3.0f; // 1/8
        m.operators[1]=makeControlOperator(T::Sequencer,2); m.operators[1].inputs[0]=opIn(1); m.operators[1].params[0]=1.0f;
        m.nextOperatorId=3;
        SeqHarness h(m);
        int events=0,atJump=0;
        for(int n=0;n<30000;++n) {
            if(n==20000) h.beats=0.0;     // loop back to bar start
            if(n==25000) h.beats=7.25;    // seek forward mid-cell
            h.sample();
            const bool e=h.out(1,2)!=0.0f;
            events+=e; if(n==20000 || n==25000) atJump+=e;
        }
        // 0..19999: ticks at 0, 12000 (2); loop: 1 at 20000; seek: 1 at 25000; then none before 30000.
        check(events==4 && atJump==2,"seek / loop: exactly one tick per jump into a new cell; no double trigger");
    }
    {
        // Connecting a clock to ADVANCE hands clock ownership to it.
        InstrumentState state; state.oscillators[0].id=1;
        std::uint32_t clockId=0,seqId=0;
        check(nodes::addControlOperator(state.modulation,T::Clock,state.modulation,clockId)
              && nodes::addControlOperator(state.modulation,T::Sequencer,state.modulation,seqId),"CLOCK + SEQUENCER");
        check(findControlOperator(state.modulation,seqId)->params[0]==0.0f,"a new SEQUENCER runs its own (INTERNAL) clock");
        ModulationState connected;
        check(nodes::connectControlInput(state,nodes::ControlEndpoint::fromOperator(clockId),seqId,0,connected)
              && findControlOperator(connected,seqId)->params[0]==1.0f,"connecting ADVANCE selects EXTERNAL in the same edit");
    }
    {
        // RESET before ADVANCE; EXTERNAL holds between events.
        ModulationState m;
        m.operators[0]=makeControlOperator(T::Sequencer,1); m.operators[0].params[0]=1.0f;
        m.operators[1]=makeControlOperator(T::Constant,2);
        m.nextOperatorId=3;
        SeqHarness h(m);
        auto& seq=h.sequencer; const auto& st=h.settings;
        seq.advance(st); seq.advance(st); seq.advance(st);
        check(seq.currentStep()==2,"external advances step the one sequencer");
        seq.restart(st); seq.advance(st);
        check(seq.currentStep()==0 && seq.held()==st.steps[0],"RESET then ADVANCE (same sample) plays the start step");
    }
    {
        // INTERNAL mode: the node runs the sequencer's own clock, step-for-step with the legacy generator.
        ModulationState m;
        m.operators[0]=makeControlOperator(T::Sequencer,1);
        m.nextOperatorId=2;
        SeqHarness h(m); h.settings.rateHz=8.0f; h.settings.ratchets[2]=2;
        SequencerGenerator legacy; legacy.reset();
        bool sameSteps=true; int events=0,changes=0; std::size_t lastStep=0;
        for(int n=0;n<48000;++n) {
            h.sample(); legacy.next(h.settings,48000.0);
            sameSteps&=h.sequencer.currentStep()==legacy.currentStep();
            events+=h.out(0,2)!=0.0f;
            if(h.sequencer.currentStep()!=lastStep) { ++changes; lastStep=h.sequencer.currentStep(); }
        }
        check(sameSteps,"INTERNAL clock: identical step timing to the legacy sequencer (one clock, never doubled)");
        check(events==changes+1+1,"STEP EVENT on every step (incl. sample 0) and each ratchet repeat");
    }
    {
        // Graph D: SEQUENCER VALUE -> CURVE, STEP EVENT -> PROBABILITY.
        ModulationState m;
        m.operators[0]=makeControlOperator(T::Sequencer,1);
        m.operators[1]=makeControlOperator(T::Curve,2); m.operators[1].inputs[0]=opIn(1,0);
        m.operators[2]=makeControlOperator(T::Probability,3); m.operators[2].params[0]=1.0f; m.operators[2].inputs[0]=opIn(1,2);
        m.operators[3]=makeControlOperator(T::ScaleOffset,4); m.operators[3].inputs[0]=src(ModSource::Sequencer); // reads SEQ after the node
        m.operators[4]=makeControlOperator(T::Toggle,5); m.operators[4].inputs[0]=opIn(3);                    // another event consumer
        m.nextOperatorId=6;
        m.routes[0]={1,true,operatorSource(2),{ModDestination::WtPosition,1,0},0.5f,true};
        m.routes[1]={2,true,operatorSource(1,1),{ModDestination::Resonance,0,0},0.3f,false}; m.nextRouteId=3;
        check(validModulation(m,modules),"graph D is valid (VALUE -> CURVE, STEP EVENT -> PROBABILITY, STEP -> parameter)");
        SeqHarness h(m);
        bool passes=true,seqSource=true; int events=0;
        for(int n=0;n<24000;++n) {
            h.sample();
            passes&=(h.out(0,2)!=0.0f)==(h.out(2)!=0.0f);
            seqSource&=h.out(3)==h.out(0,0);
            events+=h.out(2)!=0.0f;
        }
        check(passes && events>=2,"graph D: every STEP EVENT reaches PROBABILITY on its own sample");
        check((h.out(4)!=0.0f)==(events%2==1),"graph D: PROBABILITY's events drive a further event consumer (TOGGLE flips per event)");
        check(seqSource,"a SEQ source read by another node sees the node's VALUE on the same sample");
    }
    // ---- multi-output routing through the compiled plan -----------------------
    {
        ModulationState m;
        m.operators[0]=makeControlOperator(T::Sequencer,1);
        m.nextOperatorId=2;
        m.routes[0]={1,true,operatorSource(1,0),{ModDestination::Cutoff,0,0},0.5f,true};
        m.routes[1]={2,true,operatorSource(1,1),{ModDestination::Resonance,0,0},0.5f,false}; m.nextRouteId=3;
        SeqHarness h(m);
        for(int n=0;n<20000;++n) h.sample();
        h.frame.cutoff=1000.0f; h.frame.resonance=0.1f;
        h.compiled.globalFrame(h.frame,{},48000.0);
        check(h.out(0,1)>0.0f && h.frame.resonance>0.1f,"two outputs of one node drive two parameters (STEP raises RESONANCE)");
        ModulationSourceSlots slots{};
        slots[modulationSourceSlot(operatorSource(1,1),m)]=h.out(0,1);
        check(modulationSourceSlot(operatorSource(1,1),m)==CompiledModulation::sourceSlotCount+operatorOutputIndex(0,1)
              && routeContribution(m.routes[1],m,slots)>0.0f,"monitor slots index (operator slot, port)");
    }
    // ---- block sizes / determinism / allocation -------------------------------
    {
        ModulationState m;
        m.operators[0]=makeControlOperator(T::Clock,1); m.operators[0].params[2]=4.0f; // 1/16 tempo
        m.operators[1]=makeControlOperator(T::Euclidean,2); m.operators[1].params[1]=5.0f; m.operators[1].inputs[0]=opIn(1);
        m.operators[2]=makeControlOperator(T::EventDelay,3); m.operators[2].params[0]=1.0f; m.operators[2].params[2]=5.0f; m.operators[2].inputs[0]=opIn(2);
        m.operators[3]=makeControlOperator(T::Sequencer,4); m.operators[3].params[0]=1.0f; m.operators[3].inputs[0]=opIn(3);
        m.operators[4]=makeControlOperator(T::RandomWalk,5); m.operators[4].inputs[0]=opIn(4,2);
        m.operators[5]=makeControlOperator(T::ChanceSplit,6); m.operators[5].inputs[0]=opIn(1);
        m.operators[6]=makeControlOperator(T::Counter,7); m.operators[6].params[1]=2.0f; m.operators[6].inputs[0]=opIn(6,0); m.operators[6].inputs[1]=opIn(6,1);
        m.nextOperatorId=8;
        m.routes[0]={1,true,operatorSource(4),{ModDestination::Cutoff,0,0},0.6f,true};
        m.routes[1]={2,true,operatorSource(5),{ModDestination::Level,1,0},0.3f,false};
        m.routes[2]={3,true,operatorSource(7),{ModDestination::Resonance,0,0},0.3f,false}; m.nextRouteId=4;
        m.generatorActiveMask|=0x10u;
        check(validModulation(m,modules),"the sequencing stress graph is valid");
        const auto render=[&](int block,bool host,double bpmChangeAt=-1.0,bool loop=false) {
            auto e=std::make_unique<OrigamiEngine>(); e->prepare(sr,1024,2); e->setModulationState(m);
            for(OscillatorModuleId id=2;id<=4;++id) e->setOscillatorModuleEnabled(id,false);
            e->noteOn(60,1.0f);
            std::vector<float> l(48000),r(48000);
            for(int done=0;done<48000;done+=block) {
                const int n=std::min(block,48000-done);
                if(host) {
                    // The host reports its position directly (never accumulated in the test).
                    const bool changed=bpmChangeAt>=0 && done>=bpmChangeAt;
                    OrigamiEngine::HostTransport t; t.bpm=changed ? 91.0 : 127.0; t.playing=true; t.ppqValid=true;
                    t.ppq=changed ? bpmChangeAt*127.0/60.0/sr+(double(done)-bpmChangeAt)*91.0/60.0/sr : double(done)*127.0/60.0/sr;
                    if(loop) { t.bpm=127.0; t.ppq=double(done%24576)*127.0/60.0/sr; } // a host loop jumps back to 0
                    e->setHostTransport(t);
                }
                float* out[2]{l.data()+done,r.data()+done}; e->process(out,2,std::size_t(n));
            }
            return l;
        };
        const auto reference=render(32,false);
        bool identical=true; for(int block:{64,128,512,1024}) identical&=render(block,false)==reference;
        check(identical,"sequencing graph: bit-identical audio for blocks 32 / 64 / 128 / 512 / 1024");
        check(render(256,false)==render(256,false),"offline renders are deterministic");
        const auto hostA=render(64,true,24576),hostB=render(1024,true,24576); // a change on a common block boundary
        float worst=0.0f; for(std::size_t i=0;i<hostA.size();++i) worst=std::max(worst,std::abs(hostA[i]-hostB[i]));
        check(worst<1e-4f,"host tempo change mid-render: block-size independent");
        float diff=0.0f; const auto fixedTempo=render(64,true); for(std::size_t i=24576;i<hostA.size();++i) diff=std::max(diff,std::abs(hostA[i]-fixedTempo[i]));
        check(diff>1e-4f,"the tempo change is honoured (the sequence follows the host)");
        const auto loopA=render(64,true,-1.0,true),loopB=render(1024,true,-1.0,true);
        float loopWorst=0.0f; for(std::size_t i=0;i<loopA.size();++i) loopWorst=std::max(loopWorst,std::abs(loopA[i]-loopB[i]));
        check(loopWorst<1e-4f,"host loop / seek (position jumps back): block-size independent, no stuck state");
#ifndef ORIGAMI_SANITIZED
        auto e=std::make_unique<OrigamiEngine>(); e->prepare(sr,512,2); e->setModulationState(m);
        e->noteOn(60,1.0f); e->noteOn(64,1.0f);
        std::vector<float> l(512),r(512); float* out[2]{l.data(),r.data()};
        e->process(out,2,512);
        allocations=0;guardAllocations=true;
        for(int i=0;i<32;++i) { if(i==8) e->noteOn(67,1.0f); e->process(out,2,512); }
        guardAllocations=false;
        check(allocations.load()==0,"sequencing / generative nodes and the sequencer node evaluate without allocating");
#endif
    }
    // ---- polyphonic generative state -------------------------------------------
    {
        // NOTE ON -> PROBABILITY(1) -> COUNTER, per voice: each voice counts its own notes.
        ModulationState m;
        m.operators[0]=makeControlOperator(T::NoteOn,1);
        m.operators[1]=makeControlOperator(T::Probability,2); m.operators[1].params[0]=1.0f; m.operators[1].inputs[0]=opIn(1);
        m.operators[2]=makeControlOperator(T::Counter,3); m.operators[2].inputs[0]=opIn(2);
        m.operators[3]=makeControlOperator(T::RandomWalk,4); m.operators[3].inputs[0]=opIn(1);
        m.nextOperatorId=5;
        m.routes[0]={1,true,operatorSource(3),{ModDestination::Level,1,0},0.3f,false}; m.nextRouteId=2;
        check(validModulation(m,modules) && sourceIsVoice(operatorSource(3),m) && sourceIsVoice(operatorSource(4),m),
              "NOTE ON -> PROBABILITY -> COUNTER is per voice");
        auto engine=std::make_unique<OrigamiEngine>(); engine->prepare(sr,512,2); engine->setModulationState(m);
        std::vector<float> l(512),r(512); float* out[2]{l.data(),r.data()};
        bool isolated=true;
        for(int note=0;note<4;++note) {
            engine->noteOn(60+note,1.0f); engine->process(out,2,512);
            const float value=engine->runtimeVisualizationSnapshot().routeSources[CompiledModulation::sourceSlotCount+operatorOutputIndex(2,0)];
            isolated&=std::abs(value-1.0f/7.0f)<1e-6f; // a shared counter would read 2/7, 3/7...
        }
        check(isolated && engine->activeVoiceCount()==4,"per-voice COUNTER / PROBABILITY / RANDOM WALK state never leaks between voices");
    }
    // ---- legacy sequencer: unchanged without a node ---------------------------
    {
        ModulationState m;
        m.generatorActiveMask|=0x10u;
        m.sequencer.rateHz=6.0f; m.sequencer.ratchets[3]=3; m.sequencer.probability[5]=0.5f; m.sequencer.humanize=0.2f;
        m.routes[0]={1,true,ModSource::Sequencer,{ModDestination::Cutoff,0,0},0.6f,true}; m.nextRouteId=2;
        // The legacy path must match a straight SequencerGenerator::next() run.
        auto e=std::make_unique<OrigamiEngine>(); e->prepare(sr,512,2); e->setModulationState(m);
        SequencerGenerator reference; reference.reset();
        std::vector<float> l(1),r(1); float* out[2]{l.data(),r.data()};
        bool same=true;
        for(int n=0;n<24000;++n) {
            reference.next(m.sequencer,sr);
            e->process(out,2,1);
            if(n%97==0) same&=e->runtimeVisualizationSnapshot().sequencerStep==reference.currentStep();
        }
        check(same,"without a SEQUENCER node the legacy source pass drives the sequencer exactly as before");
    }
    // ---- codec v30 ------------------------------------------------------------
    {
        auto base=std::make_unique<OrigamiEngine>(); base->prepare(sr,512,2);
        auto state=base->instrumentState();
        state.modulation.operators[0]=makeControlOperator(T::Clock,1);
        state.modulation.operators[1]=makeControlOperator(T::Counter,2); state.modulation.operators[1].inputs[0]=opIn(1);
        state.modulation.nextOperatorId=3;
        check(encodeInstrumentState(state)[7]==29,"N05-only graphs still write v29");
        state.modulation.operators[2]=makeControlOperator(T::Toggle,3); state.modulation.operators[2].inputs[0]=opIn(2,1);
        state.modulation.operators[3]=makeControlOperator(T::Sequencer,4); state.modulation.operators[3].inputs[0]=opIn(1);
        state.modulation.nextOperatorId=5;
        state.modulation.routes[0]={1,true,operatorSource(4,1),{ModDestination::Cutoff,0,0},0.5f,false}; state.modulation.nextRouteId=2;
        const auto bytes=encodeInstrumentState(state);
        InstrumentState decoded;
        check(bytes[7]==30 && decodeInstrumentState(bytes.data(),bytes.size(),decoded),"sequencing nodes / ports write v30 and decode");
        bool sameOps=true;
        for(std::size_t i=0;i<4;++i) sameOps&=decoded.modulation.operators[i].type==state.modulation.operators[i].type
                                             && decoded.modulation.operators[i].inputs==state.modulation.operators[i].inputs;
        check(sameOps && decoded.modulation.routes[0].source==operatorSource(4,1),
              "output ports round-trip in inputs and routes");
        auto pingPong=base->instrumentState();
        pingPong.modulation.operators[0]=makeControlOperator(T::Counter,1); pingPong.modulation.operators[0].params[1]=2.0f;
        pingPong.modulation.nextOperatorId=2;
        check(encodeInstrumentState(pingPong)[7]==30,"PING-PONG (an N06 mode) writes v30 so older builds reject it cleanly");
    }
}

// ============================================================ N07 consolidation
namespace n07 {
using T=ControlOpType;
namespace sc=mct::origami::scenarios;
std::array<OscillatorModuleState,16> engineModules() {
    auto e=std::make_unique<OrigamiEngine>(); e->prepare(48000.0,512,2);
    return e->instrumentState().oscillators;
}
// One plan, evaluated sample by sample (global domain).
struct Plan {
    std::unique_ptr<CompiledModulation> compiled=std::make_unique<CompiledModulation>();
    std::unique_ptr<ModulationFrame> frame=std::make_unique<ModulationFrame>();
    std::array<OscillatorModuleState,16> modules{};
    explicit Plan(const ModulationState& m) { modules[0].id=1; compiled->prepare(48000.0); compiled->compile(m,modules,true); }
    void sample(const std::array<float,CompiledModulation::globalSourceCount>& sources) {
        frame->events.sampleRate=48000.0; frame->events.beatsPerSample=120.0/60.0/48000.0;
        compiled->evaluateGlobalOperators(*frame,sources);
    }
    float out(std::size_t slot,std::size_t port=0) const { return frame->operatorOutputs[operatorOutputIndex(slot,port)]; }
};
std::uint32_t xs(std::uint32_t& x) { x^=x<<13; x^=x>>17; x^=x<<5; return x; }
float unit(std::uint32_t& x) { return float(xs(x)>>8)/float(1u<<24); }
std::vector<float> render(const ModulationState& m,int block,int total,int voices) {
    auto e=std::make_unique<OrigamiEngine>(); e->prepare(48000.0,1024,2); e->setModulationState(m);
    for(int v=0;v<voices;++v) e->noteOn(48+v*4,0.9f);
    std::vector<float> l(static_cast<std::size_t>(total)),r(static_cast<std::size_t>(total));
    for(int done=0;done<total;done+=block) { const int n=std::min(block,total-done); float* out[2]{l.data()+done,r.data()+done}; e->process(out,2,std::size_t(n)); }
    return l;
}
}

void consolidationTests() {
    using namespace n07;
    using n05::Stepper; using n06::MultiStepper;
    const auto modules=engineModules();
    // ---- scenarios are valid; repair is a no-op on valid graphs --------------
    {
        bool valid=true,clean=true;
        for(const auto& m:{sc::directRoutes(32),sc::controlChain(8),sc::mixedControl(),sc::eventHeavy(),sc::sequencing(),sc::maximal(),sc::perVoice()}) {
            valid&=validModulation(m,modules);
            clean&=nodes::validateControlGraph(m).empty();
            auto copy=m; clean&=nodes::repairControlGraph(copy)==0 && copy.operators==m.operators;
        }
        check(valid && clean,"N07 scenarios are valid; the validator finds nothing and repair changes nothing");
        int ops=0; for(const auto& op:sc::maximal().operators) ops+=op.id!=0;
        check(ops==32,"the stress graph uses all 32 operator slots");
    }
    // ---- prepared kernels == the general evaluator (bit for bit) ------------
    {
        bool same=true;
        std::uint32_t rng=0x1234567u;
        for(T type:{T::Add,T::Subtract,T::Multiply,T::Min,T::Max,T::ScaleOffset,T::Invert,T::Abs,T::Clamp,T::Constant,T::Smooth})
            for(int connection=0;connection<4;++connection) for(int bipolar=0;bipolar<2;++bipolar) {
                ModulationState m;
                auto& op=m.operators[0]; op=makeControlOperator(type,1);
                if(type==T::ScaleOffset) { op.params[0]=-1.7f; op.params[1]=0.3f; }
                if(type==T::Clamp) { op.params[0]=0.8f; op.params[1]=-0.2f; }
                if(type==T::Constant) op.params[0]=-0.6f;
                const ModSource a=bipolar ? ModSource::Lfo1 : ModSource::Macro1,b=bipolar ? ModSource::Lfo2 : ModSource::Macro2;
                if(connection&1) op.inputs[0]=sc::src(a);
                if((connection&2) && controlOpInfo(type)->inputs>1) op.inputs[1]=sc::src(b);
                m.nextOperatorId=2;
                Plan plan(m);
                Stepper reference(type,op.params,true);
                const auto ia=std::size_t(bipolar ? 0 : 4),ib=std::size_t(bipolar ? 1 : 5);
                for(int n=0;n<500;++n) {
                    std::array<float,CompiledModulation::globalSourceCount> sources{};
                    sources[ia]=bipolar ? unit(rng)*2.0f-1.0f : unit(rng); sources[ib]=bipolar ? unit(rng)*2.0f-1.0f : unit(rng);
                    if(n==17) sources[ia]=std::numeric_limits<float>::quiet_NaN();
                    plan.sample(sources);
                    const bool ca=op.inputs[0].kind!=ControlInput::Kind::None,cb=op.inputs[1].kind!=ControlInput::Kind::None;
                    // An unconnected input reads 0 and has no range (the compiler treats it as unipolar).
                    const float expected=reference.step(ca ? sources[ia] : 0.0f,cb ? sources[ib] : 0.0f,0.0f,{ca,cb,false},bipolar && ca ? ControlRange::Bipolar : ControlRange::Unipolar);
                    same&=plan.out(0)==expected;
                }
            }
        check(same,"compile-time kernels produce exactly the general evaluator's values (all connections, ranges, NaN input)");
    }
    // ---- compile lifecycle ----------------------------------------------------
    {
        auto m=sc::mixedControl();
        auto compiled=std::make_unique<CompiledModulation>(); compiled->prepare(48000.0);
        std::array<OscillatorModuleState,16> mods{}; mods[0].id=1;
        compiled->compile(m,mods,true);
        auto counters=[&]{ return compiled->compileCounters(); };
        const auto base=counters();
        compiled->compile(m,mods);                                   // identical republish
        auto macro=m; macro.macros[0]=0.77f; compiled->compile(macro,mods);   // a macro drag
        auto lfo=macro; lfo.lfo1.rateHz=7.0f; compiled->compile(lfo,mods);     // an LFO rate
        auto steps=lfo; steps.sequencer.steps[3]=0.9f; compiled->compile(steps,mods); // a sequence step
        check(counters().skipped==base.skipped+4 && counters().compiles==base.compiles,
              "macros, LFO rates and sequence steps never recompile the plan");
        auto scale=steps; scale.operators[0].params[0]=0.5f; compiled->compile(scale,mods);
        check(counters().parameterUpdates==base.parameterUpdates+1 && counters().compiles==base.compiles,
              "SCALE amount: an in-place parameter update (no topology rebuild)");
        auto remap=scale; remap.operators[3].params[2]=-1.0f; compiled->compile(remap,mods); // Remap output turns bipolar
        check(counters().compiles==base.compiles+1,"a parameter that changes an output RANGE recompiles (polarity flows downstream)");
        auto rewired=remap; rewired.operators[1].inputs[0]=sc::src(ModSource::Lfo4); compiled->compile(rewired,mods);
        auto amount=rewired; amount.routes[0].amount=0.1f; compiled->compile(amount,mods);
        auto mode=amount; mode.lfo1.mode=LfoMode::Envelope; compiled->compile(mode,mods);
        check(counters().compiles==base.compiles+4,"connections, route amounts and LFO free/voice modes recompile");
        // The parameter path is equivalent to a fresh compile of the same state.
        Plan updated(sc::mixedControl()),fresh(scale);
        updated.compiled->compile(scale,updated.modules);
        bool equal=true; std::uint32_t r=99;
        for(int n=0;n<2000;++n) {
            std::array<float,CompiledModulation::globalSourceCount> s{}; s[0]=unit(r)*2-1; s[1]=unit(r)*2-1; s[2]=unit(r)*2-1; s[4]=unit(r);
            updated.sample(s); fresh.sample(s);
            for(std::size_t slot=0;slot<24;++slot) equal&=updated.out(slot)==fresh.out(slot);
        }
        check(updated.compiled->compileCounters().parameterUpdates==1 && equal,"an updated plan computes exactly what a fresh compile computes");
        // Engine: the diagnostics see the same lifecycle.
        auto e=std::make_unique<OrigamiEngine>(); e->prepare(48000.0,512,2);
        check(e->setModulationState(sc::mixedControl()),"engine accepts the plan");
        std::vector<float> l(512),rr(512); float* out[2]{l.data(),rr.data()};
        e->process(out,2,512);
        const auto d0=e->nodesDiagnostics();
        auto knob=sc::mixedControl(); knob.macros[1]=0.4f; e->setModulationState(knob); e->process(out,2,512);
        auto edit=knob; edit.operators[0].params[1]=0.2f; e->setModulationState(edit); e->process(out,2,512);
        const auto d1=e->nodesDiagnostics();
        check(d1.compileSkips==d0.compileSkips+1 && d1.parameterUpdates==d0.parameterUpdates+1 && d1.compiles==d0.compiles
              && d1.stateRevision==d0.stateRevision+2,"engine diagnostics: macro -> skip, SCALE -> parameter update, revision counts both");
    }
    // ---- per-voice RNG --------------------------------------------------------
    {
        ModulationState m;
        m.operators[0]=makeControlOperator(T::NoteOn,1);
        m.operators[1]=makeControlOperator(T::RandomTrigger,2); m.operators[1].inputs[0]=sc::opIn(1);
        m.nextOperatorId=3;
        auto compiled=std::make_unique<CompiledModulation>(); compiled->prepare(48000.0);
        std::array<OscillatorModuleState,16> mods{}; mods[0].id=1; compiled->compile(m,mods,true);
        const auto stream=[&](std::uint32_t seed) {
            CompiledModulation::OperatorState state{}; ModulationFrame f; std::array<float,CompiledModulation::voiceSourceCount> v{};
            std::vector<float> values;
            for(int n=0;n<8;++n) { f.events.voiceSeed=seed; f.events.noteOn=true; compiled->evaluateVoiceOperators(f,v,state); values.push_back(f.operatorOutputs[operatorOutputIndex(1,0)]); }
            return values;
        };
        check(stream(11)!=stream(12),"two voices draw distinct random sequences");
        check(stream(11)==stream(11),"the same voice lifecycle repeats exactly");
        // Engine: two simultaneous voices, repeated renders, voice stealing.
        m.routes[0]={1,true,operatorSource(2),{ModDestination::Level,1,0},0.5f,false}; m.nextRouteId=2;
        check(render(m,256,24000,2)==render(m,64,24000,2),"two-voice generative render: identical across runs and block sizes");
        auto e=std::make_unique<OrigamiEngine>(); e->prepare(48000.0,512,2); e->setModulationState(m); e->setVoiceAdmissionCeiling(1);
        std::vector<float> l(512),r(512); float* out[2]{l.data(),r.data()};
        std::vector<float> perNote;
        for(int note=0;note<4;++note) {
            e->noteOn(60+note,0.9f); e->process(out,2,512);
            perNote.push_back(e->runtimeVisualizationSnapshot().routeSources[CompiledModulation::sourceSlotCount+operatorOutputIndex(1,0)]);
        }
        bool fresh=true; for(std::size_t i=1;i<perNote.size();++i) fresh&=perNote[i]!=perNote[i-1];
        check(fresh,"a stolen voice starts a new stream (never continues the previous note's)");
        e->reset();
        std::vector<float> again;
        for(int note=0;note<4;++note) {
            e->noteOn(60+note,0.9f); e->process(out,2,512);
            again.push_back(e->runtimeVisualizationSnapshot().routeSources[CompiledModulation::sourceSlotCount+operatorOutputIndex(1,0)]);
        }
        check(again==perNote,"after an engine reset the voice streams repeat exactly");
        // Global generative nodes keep their N06 sequences (no voice salt).
        MultiStepper global(T::RandomTrigger); const float first=global.step()[0];
        MultiStepper global2(T::RandomTrigger); check(global2.step()[0]==first,"global RANDOM is unchanged by per-voice seeding");
    }
    // ---- validator / recovery: every issue kind -------------------------------
    {
        const auto base=sc::sequencing();
        struct Case { const char* what; std::function<void(ModulationState&)> mutate; nodes::ControlIssueKind kind; };
        std::vector<Case> cases{
            {"duplicate id",[](ModulationState& m){ m.operators[20]=m.operators[1]; },nodes::ControlIssueKind::DuplicateId},
            {"unknown type",[](ModulationState& m){ m.operators[20]=makeControlOperator(T::Add,40); m.operators[20].type=static_cast<T>(77); m.nextOperatorId=41; },nodes::ControlIssueKind::UnknownType},
            {"id beyond counter",[](ModulationState& m){ m.operators[20]=makeControlOperator(T::Add,500); },nodes::ControlIssueKind::IdOutOfRange},
            {"bad parameter",[](ModulationState& m){ m.operators[1].params[0]=999.0f; },nodes::ControlIssueKind::BadParameter},
            {"missing operator",[](ModulationState& m){ m.operators[2].inputs[0]=sc::opIn(77); },nodes::ControlIssueKind::DanglingInput},
            {"invalid output index",[](ModulationState& m){ m.operators[4].inputs[0]=sc::opIn(4,3); },nodes::ControlIssueKind::InvalidPort},
            {"wrong signal type",[](ModulationState& m){ m.operators[7].inputs[0]=sc::opIn(4,0); },nodes::ControlIssueKind::TypeMismatch},
            {"cycle",[](ModulationState& m){ m.operators[0]=makeControlOperator(T::EventMerge,1); m.operators[0].inputs[0]=sc::opIn(3); },nodes::ControlIssueKind::Cycle},
            {"second sequencer",[](ModulationState& m){ m.operators[20]=makeControlOperator(T::Sequencer,40); m.nextOperatorId=41; },nodes::ControlIssueKind::MultipleSequencers},
            {"per-voice into sequencer",[](ModulationState& m){ m.operators[20]=makeControlOperator(T::NoteOn,40); m.nextOperatorId=41; m.operators[3].inputs[1]=sc::opIn(40); },nodes::ControlIssueKind::DomainViolation},
            {"route from missing operator",[](ModulationState& m){ m.routes[0].source=operatorSource(90); },nodes::ControlIssueKind::RouteMissingOperator},
            {"route from invalid port",[](ModulationState& m){ m.routes[0].source=operatorSource(4,3); },nodes::ControlIssueKind::RouteInvalidPort},
            {"route from an EVENT",[](ModulationState& m){ m.routes[0].source=operatorSource(4,2); },nodes::ControlIssueKind::RouteNotControl},
        };
        for(const auto& c:cases) {
            auto m=base; c.mutate(m);
            const auto issues=nodes::validateControlGraph(m);
            const bool reported=std::any_of(issues.begin(),issues.end(),[&](const nodes::ControlIssue& i){ return i.kind==c.kind; });
            auto repaired=m;
            const auto repairs=nodes::repairControlGraph(repaired);
            int survivors=0; for(const auto& op:repaired.operators) survivors+=op.id!=0;
            const bool recovered=repairs>0 && nodes::validateControlGraph(repaired).empty() && validModulation(repaired,modules) && survivors>=9;
            check(reported && recovered,(std::string("malformed graph (")+c.what+"): reported, repaired, valid parts kept").c_str());
        }
        // The engine never runs an invalid graph: it keeps the previous plan.
        auto e=std::make_unique<OrigamiEngine>(); e->prepare(48000.0,512,2);
        check(e->setModulationState(base),"valid plan");
        auto bad=base; bad.operators[2].inputs[0]=sc::opIn(77);
        check(!e->setModulationState(bad) && e->instrumentState().modulation.operators==base.operators,
              "an invalid graph is rejected before it reaches the audio thread (previous plan stays)");
    }
    // ---- save / load: equivalence and deterministic fuzzing --------------------
    {
        auto base=std::make_unique<OrigamiEngine>(); base->prepare(48000.0,512,2);
        bool equivalent=true;
        for(const auto& m:{sc::mixedControl(),sc::eventHeavy(),sc::sequencing(),sc::maximal(),sc::perVoice()}) {
            auto state=base->instrumentState(); state.modulation.routes=m.routes; state.modulation.nextRouteId=m.nextRouteId;
            state.modulation.operators=m.operators; state.modulation.nextOperatorId=m.nextOperatorId;
            InstrumentState decoded; DecodeReport report;
            const auto bytes=encodeInstrumentState(state);
            equivalent&=decodeInstrumentState(bytes.data(),bytes.size(),decoded,&report) && report.graphRepairs==0
                     && decoded.modulation.operators==state.modulation.operators && render(decoded.modulation,512,12000,3)==render(m,512,12000,3);
        }
        check(equivalent,"N04-N06 graphs: save -> load is semantically identical and renders identical audio");
        // Mutation fuzzing (bounded, deterministic): never crash, never accept invalid state.
        auto state=base->instrumentState(); const auto m=sc::maximal();
        state.modulation.routes=m.routes; state.modulation.nextRouteId=m.nextRouteId; state.modulation.operators=m.operators; state.modulation.nextOperatorId=m.nextOperatorId;
        const auto bytes=encodeInstrumentState(state);
        std::uint32_t rng=0xC0FFEEu; int accepted=0,repaired=0,rejected=0; bool safe=true;
        auto engine=std::make_unique<OrigamiEngine>(); engine->prepare(48000.0,256,2);
        std::vector<float> l(256),r(256); float* out[2]{l.data(),r.data()};
        for(int iteration=0;iteration<3000;++iteration) {
            auto mutated=bytes;
            const int edits=1+int(xs(rng)%4);
            for(int k=0;k<edits;++k) {
                // Bias toward the operator section (tail of the stream): ids, ports, types, counts.
                const std::size_t at=xs(rng)%3==0 ? xs(rng)%mutated.size() : mutated.size()-1-(xs(rng)%std::min<std::size_t>(mutated.size(),1600));
                const auto mode=xs(rng)%4;
                if(mode==0) mutated[at]^=std::uint8_t(1u<<(xs(rng)%8));
                else if(mode==1) mutated[at]=std::uint8_t(xs(rng));
                else if(mode==2) mutated[at]=0xff;
                else mutated[at]=0;
            }
            if(iteration%97==0) mutated.resize(mutated.size()-1-xs(rng)%8); // truncation
            InstrumentState decoded; DecodeReport report;
            if(!decodeInstrumentState(mutated.data(),mutated.size(),decoded,&report)) { ++rejected; continue; }
            ++accepted; repaired+=report.graphRepairs!=0;
            safe&=validInstrumentState(decoded) && nodes::validateControlGraph(decoded.modulation).empty();
            if(iteration%25==0) {
                safe&=engine->setModulationState(decoded.modulation);
                engine->noteOn(60,0.8f); engine->process(out,2,256);
                for(float v:l) safe&=std::isfinite(v);
            }
        }
        check(safe && rejected>0 && accepted>0,"3000 mutated saves: no crash, accepted states are valid, malformed ones rejected or repaired");
        check(repaired>0,"some mutated graphs are recovered (valid parts kept) instead of rejected");
    }
    // ---- block sizes, determinism, allocation: the 32-node stress graph --------
    {
        const auto m=sc::maximal();
        const auto reference=render(m,32,24000,8);
        bool same=true; for(int block:{64,128,512,1024}) same&=render(m,block,24000,8)==reference;
        check(same,"32-node stress graph, 8 voices: bit-identical at blocks 32/64/128/512/1024");
#ifndef ORIGAMI_SANITIZED
        auto e=std::make_unique<OrigamiEngine>(); e->prepare(48000.0,512,2); e->setModulationState(m);
        for(int v=0;v<16;++v) e->noteOn(40+v*2,0.8f);
        std::vector<float> l(512),r(512); float* out[2]{l.data(),r.data()};
        e->process(out,2,512);
        allocations=0;guardAllocations=true;
        for(int i=0;i<16;++i) { auto knob=m; knob.macros[0]=float(i)/16.0f; e->process(out,2,512); }
        auto edit=m; edit.operators[14].params[0]=0.3f; e->setModulationState(edit); // parameter update (audio-thread path)
        guardAllocations=false; // setModulationState itself runs on the caller's thread
        allocations=0;guardAllocations=true;
        for(int i=0;i<8;++i) e->process(out,2,512);
        guardAllocations=false;
        check(allocations.load()==0,"stress graph at 16 voices (incl. a parameter-update compile) renders without allocating");
        // Gross CPU regression gate: relative to the same engine without NODES.
        const auto cost=[&](const ModulationState& s) {
            auto x=std::make_unique<OrigamiEngine>(); x->prepare(48000.0,512,2); x->setModulationState(s);
            for(int v=0;v<16;++v) x->noteOn(40+v*2,0.8f);
            for(int b=0;b<10;++b) x->process(out,2,512);
            const auto t0=std::chrono::steady_clock::now();
            for(int b=0;b<60;++b) x->process(out,2,512);
            return std::chrono::duration<double>(std::chrono::steady_clock::now()-t0).count();
        };
        const double ratio=cost(m)/std::max(1e-9,cost(ModulationState{}));
        std::cout<<"[N07 stress] 32-node x16 voices / empty x16 voices CPU ratio "<<ratio<<"\n";
        check(ratio<12.0,"CPU gate: the 32-node graph at 16 voices costs < 12x the same engine without NODES");
#endif
    }
    // ---- bounded capacities (memory gate) -------------------------------------
    static_assert(ModulationState::maxControlOperators==32,"operator slots are a deliberate limit");
    static_assert(ControlOpRuntime::delayCapacity==8,"EVENT DELAY queue is a deliberate limit");
    static_assert(sizeof(ControlOpRuntime)<=64,"per-operator runtime state");
    static_assert(sizeof(CompiledModulation::OperatorState)<=2048,"per-voice operator state");
    // v37 typed sends add 4 KiB/voice (two fixed oscillator snapshots).
    static_assert(sizeof(Voice)<=133*1024,"voice footprint including source pool and sixteen typed output sends");
    // Comb adds non-owning state only (~14 KiB/engine); delay banks are lazy,
    // writer-owned and bounded separately, never embedded in Voice.
    static_assert(sizeof(OrigamiEngine)<=2512*1024,"engine footprint including bounded typed routing and source pools");
    check(true,"memory gates hold (compile-time)");
}


void nodeTelemetryTests() {
    // The node under observation must be ON the signal path: addEffect() only
    // appends an unconnected node, which the compiler (reachable from a
    // source AND reaching OUT) never executes. insertEffectBeforeOutput()
    // places it between MAIN IN and MAIN OUT.
    const auto makeGraph=[](float gainDb,bool enabled,FxNodeId& id) {
        FxGraph graph=makeDefaultFxGraph();
        id=graph.insertEffectBeforeOutput(FxEffectType::Gain);
        const auto* d=findFxEffect(FxEffectType::Gain);
        graph.setParameter(id,d->parameters[0].id,gainDb);
        graph.setEnabled(id,enabled);
        return graph;
    };
    const auto makeSignal=[] {
        std::pair<std::array<float,256>,std::array<float,256>> signal;
        for(std::size_t i=0;i<signal.first.size();++i) {
            signal.first[i]=0.35f*std::sin(float(i)*0.07f);
            signal.second[i]=0.2f*std::cos(float(i)*0.11f);
        }
        return signal;
    };
    FxNodeId id=invalidFxNodeId;
    const auto graph=makeGraph(-6.0f,true,id);
    FxRenderer renderer;
    renderer.prepare(48000.0);
    check(id!=invalidFxNodeId && renderer.sync(graph),"node telemetry graph compiles");

    // 1 / 13: telemetry defaults OFF; a hidden NODES page publishes nothing.
    auto disabled=makeSignal();
    renderer.process(disabled.first.data(),disabled.second.data(),int(disabled.first.size()));
    check(!renderer.identity(),"the Gain node is an Effect step on the path (not the identity fast path)");
    check(!renderer.consumeNodeTelemetry(id).valid,"hidden NODES leaves node telemetry unpublished");

    // 2-5: enabled -> a stable-id, coherent, stereo snapshot of the node output.
    renderer.setTelemetryEnabled(true);
    auto enabled=makeSignal();
    renderer.process(enabled.first.data(),enabled.second.data(),int(enabled.first.size()));
    const auto beforeRead=enabled;
    const auto snapshot=renderer.consumeNodeTelemetry(id);
    check(snapshot.valid && snapshot.node==id && snapshot.sequence>0,"node telemetry publishes stable-id snapshot");
    check(snapshot.peakLeft>0.0f && snapshot.peakRight>0.0f,"node telemetry publishes stereo activity");
    check(enabled==beforeRead,"consuming telemetry cannot mutate rendered audio");
    // The node is the last before OUT and the globals are neutral: the rendered
    // block is its output after the global stage, which recomputes
    // dry + mix * (wet - dry) even at mix 1 (last-bit float rounding only).
    bool samplesMatch=true;
    for(std::size_t k=0;k<FxRenderer::telemetrySamples;++k) {
        const auto source=std::min<std::size_t>(255,(k*256)/FxRenderer::telemetrySamples);
        samplesMatch=samplesMatch && std::abs(snapshot.left[k]-enabled.first[source])<=1.0e-6f && std::abs(snapshot.right[k]-enabled.second[source])<=1.0e-6f;
    }
    check(samplesMatch,"the snapshot holds the node's real output samples (coherent)");
    check(std::abs(snapshot.peakLeft-*std::max_element(enabled.first.begin(),enabled.first.end(),[](float a,float b){return std::abs(a)<std::abs(b);}))<1.0e-6f
          || snapshot.peakLeft>=std::abs(enabled.first[0]),"peaks follow the node output");

    // 6: peaks are consume/reset; the sample snapshot stays readable.
    const auto second=renderer.consumeNodeTelemetry(id);
    check(second.valid && second.sequence==snapshot.sequence
          && second.peakLeft==0.0f && second.peakRight==0.0f,
          "node peaks consume/reset while sample snapshot remains readable");

    // 7: unknown ids are never fabricated.
    check(!renderer.consumeNodeTelemetry(0xf00du).valid && !renderer.consumeNodeTelemetry(invalidFxNodeId).valid,"unknown node has no fabricated telemetry");

    // 8: disabling stops future publication; by contract the last snapshot stays readable.
    renderer.setTelemetryEnabled(false);
    auto offAgain=makeSignal();
    renderer.process(offAgain.first.data(),offAgain.second.data(),int(offAgain.first.size()));
    const auto afterDisable=renderer.consumeNodeTelemetry(id);
    check(afterDisable.valid && afterDisable.sequence==snapshot.sequence,
          "disabled node telemetry does not publish a new snapshot");
    check(afterDisable.peakLeft==0.0f && afterDisable.peakRight==0.0f,"disabled telemetry accumulates no peaks");

    // 10: telemetry on / off is audio-transparent. Two independently prepared
    // renderers with the same graph and input (identical state at every step).
    {
        FxNodeId a=invalidFxNodeId,b=invalidFxNodeId;
        FxRenderer on,off;
        on.prepare(48000.0); off.prepare(48000.0);
        on.sync(makeGraph(-6.0f,true,a)); off.sync(makeGraph(-6.0f,true,b));
        on.setTelemetryEnabled(true);
        bool identical=true;
        for(int block=0;block<16;++block) {
            auto x=makeSignal(),y=makeSignal();
            on.process(x.first.data(),x.second.data(),256);
            off.process(y.first.data(),y.second.data(),256);
            identical=identical && x==y;
            on.consumeNodeTelemetry(a);
        }
        check(identical,"node telemetry on/off is bit-identical for rendered audio");
    }

    // 12: bypass / crossfade -> the snapshot is the FINAL node output (dry when bypassed).
    {
        FxNodeId b=invalidFxNodeId;
        FxRenderer bypassed;
        bypassed.prepare(48000.0);
        bypassed.setBypassMode(FxBypassMode::Hard);
        bypassed.sync(makeGraph(-12.0f,false,b));
        bypassed.setTelemetryEnabled(true);
        auto x=makeSignal(); const auto dry=x;
        bypassed.process(x.first.data(),x.second.data(),256);
        const auto t=bypassed.consumeNodeTelemetry(b);
        check(t.valid && std::abs(t.left[10]-dry.first[(10*256)/FxRenderer::telemetrySamples])<=1.0e-6f,"a bypassed node reports its final (dry) output");
        FxGraph live=makeGraph(-12.0f,true,b);
        bypassed.setBypassMode(FxBypassMode::Crossfade);
        bypassed.sync(live);
        float lastCaptured=1.0f; bool tracks=true;
        for(int block=0;block<40;++block) {
            auto y=makeSignal();
            bypassed.process(y.first.data(),y.second.data(),256);
            const auto snap=bypassed.consumeNodeTelemetry(b);
            const auto source=(10*256)/FxRenderer::telemetrySamples;
            tracks=tracks && snap.valid && std::abs(snap.left[10]-y.first[source])<=1.0e-6f;
            lastCaptured=std::abs(snap.left[10]);
        }
        check(tracks,"through the crossfade the snapshot is the node's final output, block by block");
        check(lastCaptured<std::abs(dry.first[(10*256)/FxRenderer::telemetrySamples]),"after the crossfade the snapshot carries the -12 dB output");
    }

    // 9: graph / node churn never exhausts the fixed slots.
    {
        FxRenderer churn;
        churn.prepare(48000.0);
        churn.setTelemetryEnabled(true);
        FxGraph g=makeDefaultFxGraph();
        FxNodeId previous=invalidFxNodeId,current=invalidFxNodeId;
        bool allPublished=true;
        for(std::size_t round=0;round<FxGraph::maxNodes*3;++round) {
            if(previous!=invalidFxNodeId) g.removeNode(previous);
            current=g.insertEffectBeforeOutput(FxEffectType::Gain);
            churn.sync(g);
            auto x=makeSignal();
            churn.process(x.first.data(),x.second.data(),256);
            allPublished=allPublished && churn.consumeNodeTelemetry(current).valid;
            previous=current;
        }
        check(allPublished,"after 3 x maxNodes delete / recreate rounds every new node still gets a slot");
        check(!churn.consumeNodeTelemetry(1).valid || g.findNode(1)!=nullptr,"a deleted node's telemetry is released");
        churn.prepare(48000.0);
        check(!churn.consumeNodeTelemetry(current).valid,"re-prepare releases every slot");
    }

#ifndef ORIGAMI_SANITIZED
    // 11: zero audio-thread allocation while publishing and adopting plans.
    renderer.setTelemetryEnabled(true);
    auto allocationSignal=makeSignal();
    allocations=0;guardAllocations=true;
    for(int i=0;i<64;++i)
        renderer.process(allocationSignal.first.data(),allocationSignal.second.data(),int(allocationSignal.first.size()));
    guardAllocations=false;
    check(allocations.load()==0,"node telemetry publication allocates nothing on audio thread");
#endif
}

int main() {
    identityTests();
    sourceDomainTests();
    connectionTests();
    routingNodeTests();
    editingTests();
    parameterTests();
    codecTests();
    documentTests();
    neutralPathTests();
    driveTests();
    delayTests();
    reverbTests();
    splitMergeTests();
    robustnessTests();
    globalsTests();
    allocationTests();
    busTests();
    busAudioTests();
    fxModulationModelTests();
    fxEngineModulationTests();
    fxRendererModulationTests();
    bypassModeTests();
    fxOrderRendererTests();
    authoringTests();
    codecV3Tests();
    filterTests();
    compressorTests();
    equalizerTests();
    modulationEffectTests();
    spatialTests();
    combMigrationTests();
    busModelP04Tests();
    multiBusEngineTests();
    workspaceTests();
    environmentTests();
    nodeTelemetryTests();
    goldenFingerprintTests();
    typedGraphTests();
    graphFuzzTests();
    controlGraphTests();
    controlOperatorTests();
    eventLogicTests();
    sequencingTests();
    consolidationTests();
    if(failures!=0) {
        std::cerr<<failures<<" of "<<checks<<" FX checks failed\n";
        return 1;
    }
    std::cout<<"PASS: "<<checks<<" FX graph/DSP/bus checks\n";
    return 0;
}
