// mct-origami-fx-graph-dsp-bus-routing-p02
// mct-origami-fx-page-foundation-p01
#include "core/fx/FxGraph.h"
#include "core/fx/FxRenderer.h"
#include "core/Engine.h"
#include "core/preset/StateCodec.h"
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
    check(bus1!=invalidFxNodeId && g.findNode(bus1)->name=="BUS 1","BUS 1 is an audio source");
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
        int quick=0;
        for(std::size_t i=0;i<e.parameterCount;++i) quick+=e.parameters[i].quick;
        check(quick>=2 && quick<=4,"2-4 quick controls per effect");
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
        rig.graph.insertEffectBeforeOutput(round%2 ? FxEffectType::Chorus : FxEffectType::Comb);
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
    check(s.buses.count==1 && s.buses.find(mainBusId) && s.buses.find(mainBusId)->label()=="BUS 1","BUS 1 exists by default");
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
        OrigamiEngine engine;
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
    if(failures!=0) {
        std::cerr<<failures<<" of "<<checks<<" FX checks failed\n";
        return 1;
    }
    std::cout<<"PASS: "<<checks<<" FX graph/DSP/bus checks\n";
    return 0;
}
