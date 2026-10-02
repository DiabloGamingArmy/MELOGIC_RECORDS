// mct-origami-fx-page-foundation-p01
#include "core/fx/FxGraph.h"
#include <algorithm>
#include <cmath>
#include <iostream>
#include <set>
#include <string>

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

FxGraph terminals(FxNodeId& source,FxNodeId& output) {
    FxGraph g;
    source=g.addSource(FxSourceType::SynthSum,{0,0});
    output=g.addOutput({800,0});
    return g;
}

void identityTests() {
    FxNodeId src=0,out=0;
    auto g=terminals(src,out);
    const auto a=g.addEffect(FxEffectType::Drive,{100,0});
    const auto b=g.addEffect(FxEffectType::Delay,{200,0});
    check(src!=invalidFxNodeId && out!=invalidFxNodeId && a!=invalidFxNodeId && b!=invalidFxNodeId,"add nodes");
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
    check(g.addSource(FxSourceType::EnvelopeBus,{0,0})==invalidFxNodeId,"control source cannot become an audio node");
    check(g.addSource(FxSourceType::LfoBus,{0,0})==invalidFxNodeId,"LFO bus is control, not audio");
    check(g.addSource(FxSourceType::MidiBus,{0,0})==invalidFxNodeId,"MIDI bus is control, not audio");
    check(g.addSource(FxSourceType::OscillatorBus,{0,0})==invalidFxNodeId,"unavailable audio bus not routable yet");
    check(g.addSource(FxSourceType::SynthSum,{0,0})!=invalidFxNodeId,"synth sum is the active audio source");
    check(g.addSource(FxSourceType::SynthSum,{0,0})==invalidFxNodeId,"source type is unique");
    int control=0,available=0;
    for(const auto& d:fxSourceCatalog()) {
        control+=d.domain==FxSignalDomain::Control;
        available+=d.available;
        if(d.domain==FxSignalDomain::Control) check(!d.available,"control sources never available as audio");
    }
    check(control==3 && available==1,"source catalog distinguishes control and audio");
    for(const auto& e:fxEffectCatalog()) check(!e.processesAudio,"development effects do not claim DSP");
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
    const auto out=fxPortTopology(FxNodeKind::Output);
    check(out.inputs==1 && out.outputs==0,"output topology terminal");
}

void developmentGraphTests() {
    const auto g=makeDevelopmentFxGraph();
    std::string error;
    check(g.validate(&error),"development graph validates");
    const auto plan=compileFxRenderPlan(g);
    check(plan.valid && plan.order.size()==7,"plan covers every source->output node");
    check(!plan.processesAudio,"development graph does not claim to process audio");
    check(!plan.order.empty() && plan.order.front()==g.sourceNode() && plan.order.back()==g.outputNode(),
          "plan is topologically ordered source -> output");
    auto copy=g;
    const auto orphan=copy.addEffect(FxEffectType::Delay,{0,0});
    const auto plan2=compileFxRenderPlan(copy);
    check(std::find(plan2.order.begin(),plan2.order.end(),orphan)==plan2.order.end(),"disconnected node excluded from plan");
}

void serialWorkflowTests() {
    FxNodeId src=0,out=0;
    auto g=terminals(src,out);
    const auto a=g.insertEffectBeforeOutput(FxEffectType::Drive);
    const auto b=g.insertEffectBeforeOutput(FxEffectType::Delay);
    const auto c=g.insertEffectBeforeOutput(FxEffectType::Reverb);
    const auto plan=compileFxRenderPlan(g);
    check(plan.valid && plan.order==std::vector<FxNodeId>{src,a,b,c,out},"serial insert builds drive->delay->reverb");
    check(g.findNode(out)->position.x>g.findNode(c)->position.x,"output shifts right of inserted effect");

    auto dev=makeDevelopmentFxGraph();
    check(dev.applyTemplate(FxRoutingMode::Serial),"serial template applies");
    const auto serial=compileFxRenderPlan(dev);
    check(serial.valid && serial.order.size()==5,"serial template: source + 3 effects + output");
    for(const auto& n:dev.nodes()) check(!n.isRouting(),"serial template removes split/merge");
    check(!dev.applyTemplate(FxRoutingMode::Parallel),"unimplemented templates are refused, not faked");

    g.clearProcessing();
    check(g.nodes().size()==2 && g.connections().empty() && g.validate(),"clear keeps terminals only");
}

void parameterAndValueTests() {
    auto g=makeDevelopmentFxGraph();
    FxNodeId delay=0;
    for(const auto& n:g.nodes()) if(n.effect==FxEffectType::Delay) delay=n.id;
    check(g.setParameter(delay,2,0.9f)==FxEditResult::Ok && *g.findNode(delay)->parameter(2)==0.9f,"set parameter");
    check(g.setParameter(delay,2,4.0f)==FxEditResult::Ok && *g.findNode(delay)->parameter(2)==1.0f,"parameter clamps");
    check(g.setParameter(delay,2,std::nanf(""))==FxEditResult::InvalidValue,"NaN parameter rejected");
    check(g.setParameter(delay,77,0.5f)!=FxEditResult::Ok,"unknown parameter rejected");
    check(g.moveNode(delay,{std::nanf(""),0})==FxEditResult::InvalidValue,"non-finite position rejected");
    check(g.moveNode(delay,{-50,20})==FxEditResult::Ok && g.findNode(delay)->position.x==0.0f,"position clamps to canvas");
    check(g.setEnabled(delay,false)==FxEditResult::Ok && !g.findNode(delay)->enabled,"effect bypass");
    FxGlobalSettings globals;
    globals.width=9.0f;globals.inputGainDb=std::nanf("");
    g.setGlobals(globals);
    check(g.globals().width==2.0f && g.globals().inputGainDb==0.0f,"globals clamp and ignore NaN");
}

void codecTests() {
    auto g=makeDevelopmentFxGraph();
    FxNodeId split=0;
    for(const auto& n:g.nodes()) if(n.kind==FxNodeKind::Split) split=n.id;
    g.removeNode(split);
    g.setRoutingMode(FxRoutingMode::Custom);
    const auto bytes=encodeFxGraph(g);
    FxGraph decoded;
    check(decodeFxGraph(bytes.data(),bytes.size(),decoded) && decoded==g,"codec round trip");
    const auto fresh=decoded.addEffect(FxEffectType::Drive,{0,0});
    check(fresh>split,"decoded allocator never reuses deleted ids");
    auto truncated=bytes;truncated.pop_back();
    FxGraph untouched=makeDevelopmentFxGraph();
    const auto before=untouched;
    check(!decodeFxGraph(truncated.data(),truncated.size(),untouched) && untouched==before,"truncated input rejected, destination unchanged");
    auto corrupt=bytes;corrupt[4]=0x7f;
    check(!decodeFxGraph(corrupt.data(),corrupt.size(),untouched),"unsupported version rejected");
    check(!decodeFxGraph(nullptr,0,untouched),"null input rejected");
}

void documentTests() {
    FxGraphDocument doc;
    const auto initial=doc.graph();
    const auto r0=doc.revision();
    check(!doc.canUndo() && !doc.canRedo(),"fresh document has no history");
    check(!doc.edit([](FxGraph&){return true;}),"no-op edit records nothing");
    FxNodeId added=0;
    check(doc.edit([&](FxGraph& g){added=g.insertEffectBeforeOutput(FxEffectType::Delay);return added!=0;}),"edit commits");
    check(doc.revision()>r0 && doc.canUndo(),"edit bumps revision and records undo");
    check(!doc.edit([](FxGraph& g){g.clearProcessing();return false;}) && doc.graph().findNode(added),"failed edit rolls back");
    check(doc.undo() && doc.graph()==initial && doc.canRedo(),"undo restores");
    check(doc.redo() && doc.graph().findNode(added)!=nullptr,"redo reapplies");
    doc.beginGesture();
    for(int i=0;i<10;++i) doc.gestureEdit([&](FxGraph& g){return g.moveNode(added,{float(100+i),10})==FxEditResult::Ok;});
    doc.endGesture();
    check(doc.graph().findNode(added)->position.x==109.0f,"gesture applies live");
    check(doc.undo() && doc.graph().findNode(added)->position.x!=109.0f,"gesture is one undo step");
    for(std::size_t i=0;i<FxGraphDocument::historyLimit+10;++i)
        doc.edit([&](FxGraph& g){return g.moveNode(added,{float(i),0})==FxEditResult::Ok;});
    int undos=0;
    while(doc.undo()) ++undos;
    check(undos==static_cast<int>(FxGraphDocument::historyLimit),"history is bounded");
}
}

int main() {
    identityTests();
    sourceDomainTests();
    connectionTests();
    routingNodeTests();
    developmentGraphTests();
    serialWorkflowTests();
    parameterAndValueTests();
    codecTests();
    documentTests();
    if(failures!=0) {
        std::cerr<<failures<<" of "<<checks<<" FX graph checks failed\n";
        return 1;
    }
    std::cout<<"PASS: "<<checks<<" FX graph checks\n";
    return 0;
}
