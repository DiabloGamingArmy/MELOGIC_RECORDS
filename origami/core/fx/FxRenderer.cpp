// mct-origami-unified-routing-core-fx-p04
// mct-origami-fx-modulation-graph-ux-p03
// mct-origami-fx-graph-dsp-bus-routing-p02
#include "core/fx/FxRenderer.h"
#include <algorithm>
#include <cmath>
#include <cstring>

namespace mct::origami::fx {
namespace {
constexpr std::size_t dryBuffer=FxGraph::maxNodes;      // post-input-gain bus
constexpr std::size_t wetBuffer=FxGraph::maxNodes+1;    // graph output / effect dry copy
constexpr std::size_t gateBuffer=FxGraph::maxNodes+2;   // TAIL PRESERVE gate ramp
float dbToGain(float db) noexcept { return std::pow(10.0f,db*0.05f); }
bool settled(float now,float target) noexcept { return now==target; }
float approach(float now,float target,float coef) noexcept {
    const float next=target+(now-target)*coef;
    return std::abs(next-target)<1.0e-6f ? target : next;
}
}

// ================================================================ compiler

void FxGraphCompiler::prepare(double sampleRate) {
    sampleRate_=sampleRate;
    cache_.clear();
}

std::unique_ptr<PreparedFxPlan> FxGraphCompiler::compile(const FxGraph& graph) {
    // mct-origami-nodes-n02: FxGraph::validate() is the gate, in stages:
    // structure (ids, kinds, terminals) -> ports (descriptors exist) -> types
    // (equal signal types) -> execution domain (equal domains) -> duplicates /
    // one wire per port -> topology (Kahn: no cycles). Only a graph passing
    // every stage becomes a plan; the audio thread never type-checks.
    if(!graph.validate()) return nullptr;
    const auto& nodes=graph.nodes();
    const auto& connections=graph.connections();
    const auto indexOf=[&nodes](FxNodeId id){for(std::size_t i=0;i<nodes.size();++i) if(nodes[i].id==id) return i; return nodes.size();};

    // Executable set = reachable from a source AND reaching MASTER OUT.
    // Dangling branches are never traversed by the renderer.
    std::vector<bool> fromSource(nodes.size(),false),toOutput(nodes.size(),false);
    const auto flood=[&](std::vector<bool>& marked,std::vector<FxNodeId> stack,bool forward) {
        while(!stack.empty()) {
            const auto id=stack.back();
            stack.pop_back();
            const auto i=indexOf(id);
            if(i>=nodes.size() || marked[i]) continue;
            marked[i]=true;
            for(const auto& c:connections) {
                if(forward && c.from.node==id) stack.push_back(c.to.node);
                if(!forward && c.to.node==id) stack.push_back(c.from.node);
            }
        }
    };
    std::vector<FxNodeId> sources;
    for(const auto& n:nodes) if(n.kind==FxNodeKind::Source) sources.push_back(n.id);
    flood(fromSource,sources,true);
    flood(toOutput,{graph.outputNode()},false);

    std::vector<int> indegree(nodes.size(),0);
    for(const auto& c:connections) ++indegree[indexOf(c.to.node)];
    std::vector<std::size_t> ready,order;
    for(std::size_t i=0;i<nodes.size();++i) if(indegree[i]==0) ready.push_back(i);
    while(!ready.empty()) {
        std::sort(ready.begin(),ready.end(),std::greater<>{}); // deterministic
        const auto i=ready.back();
        ready.pop_back();
        if(fromSource[i] && toOutput[i]) order.push_back(i);
        for(const auto& c:connections)
            if(c.from.node==nodes[i].id && --indegree[indexOf(c.to.node)]==0) ready.push_back(indexOf(c.to.node));
    }

    auto plan=std::make_unique<PreparedFxPlan>();
    std::vector<int> bufferOf(nodes.size(),-1);
    for(std::size_t s=0;s<order.size();++s) bufferOf[order[s]]=static_cast<int>(s);
    std::map<FxNodeId,std::shared_ptr<FxNodeInstance>> nextCache;
    for(std::size_t s=0;s<order.size();++s) {
        const auto& node=nodes[order[s]];
        auto& step=plan->steps[s];
        step.output=static_cast<std::uint8_t>(s);
        for(std::uint8_t port=0;port<node.ports.inputs;++port) {
            const auto* c=graph.connectionAt({node.id,port},true);
            if(c==nullptr) continue;
            const int from=bufferOf[indexOf(c->from.node)];
            if(from<0) continue; // upstream not executable: treated as silence
            step.inputs[step.inputCount++]=static_cast<std::uint8_t>(from);
        }
        switch(node.kind) {
        case FxNodeKind::Source: step.kind=FxStepKind::Source; step.bus=node.bus; break;
        case FxNodeKind::Split: step.kind=FxStepKind::Split; break;
        case FxNodeKind::Merge:
            step.kind=FxStepKind::Merge;
            // Summing policy: merge AVERAGES its live branches (gain 1/N). A
            // split feeding untouched branches into a merge is exactly unity,
            // so parallel topologies cannot explode in level by construction.
            step.inputGain=step.inputCount>0 ? 1.0f/float(step.inputCount) : 0.0f;
            break;
        case FxNodeKind::Output:
            step.kind=FxStepKind::Output;
            plan->hasOutput=true;
            plan->outputBuffer=static_cast<std::uint8_t>(s);
            break;
        case FxNodeKind::Effect: {
            step.kind=FxStepKind::Effect;
            const auto* descriptor=findFxEffect(node.effect);
            auto instance=cache_.count(node.id) && cache_[node.id]->descriptor==descriptor ? cache_[node.id] : nullptr;
            if(instance==nullptr) {
                instance=std::make_shared<FxNodeInstance>();
                instance->node=node.id;
                instance->descriptor=descriptor;
                instance->processor=descriptor->create();
                instance->processor->prepare(sampleRate_);
                for(std::size_t i=0;i<descriptor->parameterCount;++i) {
                    const float v=node.parameter(descriptor->parameters[i].id).value_or(descriptor->parameters[i].defaultValue);
                    instance->targets[i].store(v,std::memory_order_relaxed);
                    instance->latched[i]=v;
                }
                instance->enabled.store(node.enabled,std::memory_order_relaxed);
                instance->wet=node.enabled ? 1.0f : 0.0f;
                instance->processing=node.enabled;
            }
            step.instance=instance.get();
            nextCache[node.id]=instance;
            plan->instances.push_back(std::move(instance));
            break;
        }
        case FxNodeKind::Send: case FxNodeKind::Return: break;
        }
    }
    plan->stepCount=order.size();
    plan->identity=plan->stepCount==2 && plan->steps[0].kind==FxStepKind::Source
        && plan->steps[1].kind==FxStepKind::Output && plan->steps[1].inputCount==1;
    cache_=std::move(nextCache);
    return plan;
}

void FxGraphCompiler::pushParameters(const FxGraph& graph) noexcept {
    for(const auto& node:graph.nodes()) {
        if(node.kind!=FxNodeKind::Effect) continue;
        const auto it=cache_.find(node.id);
        if(it==cache_.end()) continue;
        auto& instance=*it->second;
        const auto* d=instance.descriptor;
        for(std::size_t i=0;i<d->parameterCount;++i)
            instance.targets[i].store(node.parameter(d->parameters[i].id).value_or(d->parameters[i].defaultValue),std::memory_order_relaxed);
        instance.enabled.store(node.enabled,std::memory_order_release);
    }
}

// ================================================================ renderer

FxRenderer::FxRenderer():pool_((FxGraph::maxNodes+3)*2*chunk,0.0f) {
    prepare(48000.0);
}

FxRenderer::~FxRenderer() {
    drainRetired();
    delete pending_.exchange(nullptr);
    delete active_;
}

std::vector<std::uint32_t> FxRenderer::topologyKey(const FxGraph& g) {
    // Everything that changes execution: node identity/kind/type/bus and wires.
    // Parameters, PWR, positions and layout points are not topology.
    std::vector<std::uint32_t> key;
    for(const auto& n:g.nodes()) {
        key.push_back(n.id);
        key.push_back((std::uint32_t(n.kind)<<24)|(std::uint32_t(n.effect)<<8)|n.ports.inputs<<4|n.ports.outputs);
        key.push_back(n.bus);
    }
    key.push_back(0xffffffffu);
    for(const auto& c:g.connections()) {
        key.push_back(c.from.node); key.push_back(c.from.port);
        key.push_back(c.to.node); key.push_back(c.to.port);
    }
    return key;
}

void FxRenderer::prepare(double sampleRate) {
    // Called with audio stopped: rebuild every instance at the new rate.
    drainRetired();
    delete pending_.exchange(nullptr);
    delete active_;
    active_=nullptr;
    sampleRate_=sampleRate;
    modulationGeneration_=~std::uint64_t{0};
    modulationPlan_=nullptr;
    smoothing_=float(std::exp(-1.0/(0.02*sampleRate)));
    bypassStep_=float(1.0/(0.01*sampleRate));
    compiler_.prepare(sampleRate);
    auto plan=compiler_.compile(lastGraph_.nodes().empty() ? makeDefaultFxGraph(bus_.load(std::memory_order_relaxed)) : lastGraph_);
    if(plan) identity_.store(plan->identity,std::memory_order_relaxed);
    lastKey_=topologyKey(lastGraph_);
    active_=plan.release();
    ++compileCount_;
}

void FxRenderer::setBypassMode(FxBypassMode mode) noexcept {
    bypassMode_.store(static_cast<int>(mode),std::memory_order_relaxed);
}

void FxRenderer::bind(FxBusId bus) {
    if(bus==bus_.load(std::memory_order_relaxed)) return;
    bus_.store(bus,std::memory_order_relaxed);
    compiler_.prepare(compiler_.sampleRate()); // fresh instances for the new bus graph
    lastKey_.clear();
}

bool FxRenderer::sync(const FxGraph& graph,bool applyGraphGlobals) {
    auto key=topologyKey(graph);
    if(key!=lastKey_) {
        auto plan=compiler_.compile(graph);
        if(!plan) return false;
        identity_.store(plan->identity,std::memory_order_relaxed);
        lastKey_=std::move(key);
        ++compileCount_;
        publish(std::move(plan));
    }
    lastGraph_=graph;
    compiler_.pushParameters(graph);
    const auto g=applyGraphGlobals ? graph.globals() : FxGlobalSettings{};
    inputGain_.store(dbToGain(g.inputGainDb),std::memory_order_relaxed);
    dryWet_.store(g.dryWet,std::memory_order_relaxed);
    width_.store(g.width,std::memory_order_relaxed);
    outputGain_.store(dbToGain(g.outputGainDb),std::memory_order_relaxed);
    if(applyGraphGlobals) bypassMode_.store(static_cast<int>(g.bypass),std::memory_order_relaxed);
    return true;
}

void FxRenderer::publish(std::unique_ptr<PreparedFxPlan> plan) {
    drainRetired();
    // A plan the audio thread never adopted can be freed right here.
    delete pending_.exchange(plan.release(),std::memory_order_acq_rel);
}

void FxRenderer::drainRetired() noexcept {
    auto read=retireRead_.load(std::memory_order_relaxed);
    const auto write=retireWrite_.load(std::memory_order_acquire);
    while(read!=write) {
        delete retired_[read%retireCapacity];
        retired_[read%retireCapacity]=nullptr;
        ++read;
    }
    retireRead_.store(read,std::memory_order_release);
}

void FxRenderer::adoptPending() noexcept {
    if(pending_.load(std::memory_order_acquire)==nullptr) return;
    const auto write=retireWrite_.load(std::memory_order_relaxed);
    // Never free on the audio thread: if the retire ring is full, adopt later.
    if(active_!=nullptr && write-retireRead_.load(std::memory_order_acquire)>=retireCapacity) return;
    auto* next=pending_.exchange(nullptr,std::memory_order_acq_rel);
    if(next==nullptr) return;
    if(active_!=nullptr) {
        retired_[write%retireCapacity]=active_;
        retireWrite_.store(write+1,std::memory_order_release);
    }
    active_=next;
}

std::pair<float,float> FxRenderer::consumePeaks() noexcept {
    return {peakLeft_.exchange(0.0f,std::memory_order_acq_rel),peakRight_.exchange(0.0f,std::memory_order_acq_rel)};
}

void FxRenderer::publishNodeTelemetry(FxNodeId node,const float* left,const float* right,int n) noexcept {
    if(!telemetryEnabled_.load(std::memory_order_acquire) || node==invalidFxNodeId || left==nullptr || right==nullptr || n<=0) return;
    NodeTelemetrySlot* slot=nullptr;
    for(auto& candidate:nodeTelemetry_) {
        const auto id=candidate.node.load(std::memory_order_relaxed);
        if(id==node) { slot=&candidate; break; }
        if(id==invalidFxNodeId && slot==nullptr) slot=&candidate;
    }
    if(slot==nullptr) return;
    if(slot->node.load(std::memory_order_relaxed)!=node) slot->node.store(node,std::memory_order_relaxed);
    float pl=0.0f,pr=0.0f;
    for(int i=0;i<n;++i) { pl=std::max(pl,std::abs(left[i])); pr=std::max(pr,std::abs(right[i])); }
    if(pl>slot->peakLeft.load(std::memory_order_relaxed)) slot->peakLeft.store(pl,std::memory_order_relaxed);
    if(pr>slot->peakRight.load(std::memory_order_relaxed)) slot->peakRight.store(pr,std::memory_order_relaxed);
    for(std::size_t i=0;i<telemetrySamples;++i) {
        const int source=std::min(n-1,int((i*std::size_t(n))/telemetrySamples));
        slot->left[i].store(left[source],std::memory_order_relaxed);
        slot->right[i].store(right[source],std::memory_order_relaxed);
    }
    slot->sequence.fetch_add(1,std::memory_order_release);
}

FxRenderer::NodeTelemetrySnapshot FxRenderer::consumeNodeTelemetry(FxNodeId node) noexcept {
    NodeTelemetrySnapshot out; out.node=node;
    for(auto& slot:nodeTelemetry_) {
        if(slot.node.load(std::memory_order_acquire)!=node) continue;
        for(int attempt=0;attempt<2;++attempt) {
            const auto before=slot.sequence.load(std::memory_order_acquire);
            for(std::size_t i=0;i<telemetrySamples;++i) {
                out.left[i]=slot.left[i].load(std::memory_order_relaxed);
                out.right[i]=slot.right[i].load(std::memory_order_relaxed);
            }
            const auto after=slot.sequence.load(std::memory_order_acquire);
            if(before==after) { out.sequence=after; out.valid=after!=0; break; }
        }
        out.peakLeft=slot.peakLeft.exchange(0.0f,std::memory_order_acq_rel);
        out.peakRight=slot.peakRight.exchange(0.0f,std::memory_order_acq_rel);
        return out;
    }
    return out;
}

void FxRenderer::applyModulation(const FxModulationOutput* mod) noexcept {
    const std::uint64_t generation=mod!=nullptr ? mod->generation : 0;
    if(generation!=modulationGeneration_ || active_!=modulationPlan_) {
        // Slot map changed: clear every live offset, then resolve each slot
        // once (bounded search, only on change; never per sample).
        modulationGeneration_=generation;
        modulationPlan_=active_;
        modulationTarget_.fill(nullptr);
        if(active_!=nullptr)
            for(std::size_t s=0;s<active_->stepCount;++s)
                if(auto* fx=active_->steps[s].instance) fx->modulation.fill(0.0f);
        if(mod!=nullptr && active_!=nullptr) {
            for(std::size_t k=0;k<mod->count;++k) {
                const auto bus=mod->bus[k]==0 ? fxMainBusId : mod->bus[k];
                if(bus!=bus_.load(std::memory_order_relaxed)) continue; // another bus graph's parameter
                for(std::size_t s=0;s<active_->stepCount && modulationTarget_[k]==nullptr;++s) {
                    auto* fx=active_->steps[s].instance;
                    if(fx==nullptr || fx->node!=mod->node[k]) continue;
                    for(std::size_t i=0;i<fx->descriptor->parameterCount;++i)
                        if(fx->descriptor->parameters[i].id==mod->parameter[k]) {
                            modulationTarget_[k]=fx;
                            modulationIndex_[k]=static_cast<std::uint8_t>(i);
                            break;
                        }
                }
            }
        }
    }
    if(mod==nullptr) return;
    for(std::size_t k=0;k<mod->count;++k)
        if(auto* fx=modulationTarget_[k]) fx->modulation[modulationIndex_[k]]=mod->offset[k];
}

void FxRenderer::process(float* left,float* right,int samples,const FxModulationOutput* modulation,
                         bool preMaster,float masterGain) noexcept {
    adoptPending();
    if(samples<=0 || left==nullptr || right==nullptr) return;
    applyModulation(modulation);
    // FX ORDER = PRE MASTER: master gain follows the graph. Snap on mode
    // changes (the engine switches in the same block), smooth otherwise.
    postGainTarget_=preMaster && std::isfinite(masterGain) ? std::clamp(masterGain,0.0f,4.0f) : 1.0f;
    if(preMaster!=postGainActive_) { postGainNow_=postGainTarget_; postGainActive_=preMaster; }
    const float inputTarget=inputGain_.load(std::memory_order_relaxed);
    const float mixTarget=dryWet_.load(std::memory_order_relaxed);
    const float widthTarget=width_.load(std::memory_order_relaxed);
    const float outputTarget=outputGain_.load(std::memory_order_relaxed);
    const bool neutralGlobals=inputTarget==1.0f && mixTarget==1.0f && widthTarget==1.0f && outputTarget==1.0f
        && settled(inputGainNow_,1.0f) && settled(dryWetNow_,1.0f) && settled(widthNow_,1.0f) && settled(outputGainNow_,1.0f)
        && postGainTarget_==1.0f && settled(postGainNow_,1.0f);

    // Neutral path: BUS 1 -> MASTER OUT with neutral globals is bit-exact
    // pass-through. Old presets and the Init patch sound exactly as before.
    if(active_==nullptr || (active_->identity && neutralGlobals)) {
        float pl=0.0f,pr=0.0f;
        for(int i=0;i<samples;++i) { pl=std::max(pl,std::abs(left[i])); pr=std::max(pr,std::abs(right[i])); }
        if(pl>peakLeft_.load(std::memory_order_relaxed)) peakLeft_.store(pl,std::memory_order_relaxed);
        if(pr>peakRight_.load(std::memory_order_relaxed)) peakRight_.store(pr,std::memory_order_relaxed);
        return;
    }
    for(int offset=0;offset<samples;offset+=chunk)
        renderChunk(left+offset,right+offset,std::min(chunk,samples-offset));
}

void FxRenderer::renderChunk(float* left,float* right,int n) noexcept {
    const float inputTarget=inputGain_.load(std::memory_order_relaxed);
    const float mixTarget=dryWet_.load(std::memory_order_relaxed);
    const float widthTarget=width_.load(std::memory_order_relaxed);
    const float outputTarget=outputGain_.load(std::memory_order_relaxed);
    const auto bytes=static_cast<std::size_t>(n)*sizeof(float);
    float* dryL=buffer(dryBuffer,0);
    float* dryR=buffer(dryBuffer,1);
    for(int i=0;i<n;++i) {
        inputGainNow_=approach(inputGainNow_,inputTarget,smoothing_);
        const float l=left[i],r=right[i];
        dryL[i]=(std::isfinite(l) ? l : 0.0f)*inputGainNow_;
        dryR[i]=(std::isfinite(r) ? r : 0.0f)*inputGainNow_;
    }
    float* wetL=buffer(wetBuffer,0);
    float* wetR=buffer(wetBuffer,1);
    const auto& plan=*active_;
    if(plan.identity) {
        std::memcpy(wetL,dryL,bytes);
        std::memcpy(wetR,dryR,bytes);
    } else {
        for(std::size_t s=0;s<plan.stepCount;++s) {
            const auto& step=plan.steps[s];
            float* outL=buffer(step.output,0);
            float* outR=buffer(step.output,1);
            const auto copyInput=[&] {
                if(step.inputCount==0) { std::memset(outL,0,bytes); std::memset(outR,0,bytes); return; }
                std::memcpy(outL,buffer(step.inputs[0],0),bytes);
                std::memcpy(outR,buffer(step.inputs[0],1),bytes);
            };
            switch(step.kind) {
            case FxStepKind::Source:
                // Each renderer serves one bus; its graph's source is that bus.
                std::memcpy(outL,dryL,bytes); std::memcpy(outR,dryR,bytes);
                break;
            case FxStepKind::Split:
            case FxStepKind::Output:
                copyInput();
                break;
            case FxStepKind::Merge:
                std::memset(outL,0,bytes); std::memset(outR,0,bytes);
                for(std::uint8_t k=0;k<step.inputCount;++k) {
                    const float* inL=buffer(step.inputs[k],0);
                    const float* inR=buffer(step.inputs[k],1);
                    for(int i=0;i<n;++i) { outL[i]+=inL[i]*step.inputGain; outR[i]+=inR[i]*step.inputGain; }
                }
                break;
            case FxStepKind::Effect:
                copyInput();
                processEffect(step,outL,outR,n);
                // P03 telemetry is observational only: capture the signal that
                // actually leaves the node, after bypass/crossfade semantics.
                // This call is a no-op unless the NODES UI enabled telemetry.
                if(step.instance!=nullptr) publishNodeTelemetry(step.instance->node,outL,outR,n);
                break;
            }
        }
        if(plan.hasOutput) {
            std::memcpy(wetL,buffer(plan.outputBuffer,0),bytes);
            std::memcpy(wetR,buffer(plan.outputBuffer,1),bytes);
        } else {
            std::memset(wetL,0,bytes); std::memset(wetR,0,bytes);
        }
    }

    // Global stage: dry/wet -> stereo width (mid/side) -> output gain.
    float pl=0.0f,pr=0.0f;
    for(int i=0;i<n;++i) {
        dryWetNow_=approach(dryWetNow_,mixTarget,smoothing_);
        widthNow_=approach(widthNow_,widthTarget,smoothing_);
        outputGainNow_=approach(outputGainNow_,outputTarget,smoothing_);
        float l=dryL[i]+dryWetNow_*(wetL[i]-dryL[i]);
        float r=dryR[i]+dryWetNow_*(wetR[i]-dryR[i]);
        if(widthNow_!=1.0f) {
            const float mid=0.5f*(l+r),side=0.5f*(l-r)*widthNow_;
            l=mid+side; r=mid-side;
        }
        postGainNow_=approach(postGainNow_,postGainTarget_,smoothing_);
        l*=outputGainNow_*postGainNow_; r*=outputGainNow_*postGainNow_;
        left[i]=std::isfinite(l) ? l : 0.0f;
        right[i]=std::isfinite(r) ? r : 0.0f;
        pl=std::max(pl,std::abs(left[i]));
        pr=std::max(pr,std::abs(right[i]));
    }
    if(pl>peakLeft_.load(std::memory_order_relaxed)) peakLeft_.store(pl,std::memory_order_relaxed);
    if(pr>peakRight_.load(std::memory_order_relaxed)) peakRight_.store(pr,std::memory_order_relaxed);
}
void FxRenderer::processEffect(const FxPlanStep& step,float* outL,float* outR,int n) noexcept {
    auto& fx=*step.instance;
    const auto bytes=static_cast<std::size_t>(n)*sizeof(float);
    const auto mode=static_cast<FxBypassMode>(bypassMode_.load(std::memory_order_relaxed));
    const float target=fx.enabled.load(std::memory_order_acquire) ? 1.0f : 0.0f;
    const auto latch=[&] {
        for(std::size_t i=0;i<fx.descriptor->parameterCount;++i)
            fx.latched[i]=std::clamp(fx.targets[i].load(std::memory_order_relaxed)+fx.modulation[i],0.0f,1.0f);
    };
    float* tmpL=buffer(wetBuffer,0);
    float* tmpR=buffer(wetBuffer,1);

    if(mode==FxBypassMode::Hard) {
        if(fx.wet!=target) {
            fx.wet=target;
            if(target==1.0f) fx.processor->reset();
            fx.processing=target==1.0f;
        }
        if(!fx.processing) return; // input passes straight through
        latch();
        fx.processor->process(outL,outR,n,fx.latched.data());
        return;
    }

    if(mode==FxBypassMode::TailPreserve) {
        if(!fx.processing && target==0.0f) return;
        if(!fx.processing) { fx.processor->reset(); fx.processing=true; }
        latch();
        // Gate the effect INPUT and pass the dry signal around it:
        //   out = fx(x*g) + (1-g)*x
        // g=1 is normal processing; g=0 is dry + the effect's own decaying
        // tail. The expression is continuous for any g, so no click.
        float* gate=buffer(gateBuffer,0);
        for(int i=0;i<n;++i) {
            fx.wet=target>fx.wet ? std::min(target,fx.wet+bypassStep_) : std::max(target,fx.wet-bypassStep_);
            gate[i]=fx.wet;
        }
        std::memcpy(tmpL,outL,bytes); std::memcpy(tmpR,outR,bytes);
        for(int i=0;i<n;++i) { outL[i]*=gate[i]; outR[i]*=gate[i]; }
        fx.processor->process(outL,outR,n,fx.latched.data());
        float tail=0.0f;
        for(int i=0;i<n;++i) {
            if(target==0.0f) tail=std::max(tail,std::max(std::abs(outL[i]),std::abs(outR[i])));
            outL[i]+=(1.0f-gate[i])*tmpL[i];
            outR[i]+=(1.0f-gate[i])*tmpR[i];
        }
        if(target==0.0f && fx.wet==0.0f) {
            fx.silentSamples=tail<1.0e-5f ? fx.silentSamples+n : 0;
            if(fx.silentSamples>int(sampleRate_*0.25)) { fx.processing=false; fx.silentSamples=0; }
        } else {
            fx.silentSamples=0;
        }
        return;
    }

    // Crossfade (default): short linear crossfade between dry and processed.
    if(!fx.processing && target==0.0f) return;
    if(!fx.processing) { fx.processor->reset(); fx.processing=true; }
    latch();
    const bool fading=fx.wet!=target || fx.wet!=1.0f;
    if(fading) { std::memcpy(tmpL,outL,bytes); std::memcpy(tmpR,outR,bytes); }
    fx.processor->process(outL,outR,n,fx.latched.data());
    if(fading) {
        for(int i=0;i<n;++i) {
            fx.wet=target>fx.wet ? std::min(target,fx.wet+bypassStep_) : std::max(target,fx.wet-bypassStep_);
            outL[i]=tmpL[i]+fx.wet*(outL[i]-tmpL[i]);
            outR[i]=tmpR[i]+fx.wet*(outR[i]-tmpR[i]);
        }
        if(fx.wet==0.0f) fx.processing=false;
    }
}
}
