// mct-origami-unified-routing-core-fx-p04
#include "core/fx/FxEnvironment.h"
#include <algorithm>
#include <cmath>
#include <cstring>

namespace mct::origami::fx {
namespace {
float dbToGain(float db) noexcept { return std::pow(10.0f,db*0.05f); }
float approach(float now,float target,float coef) noexcept {
    const float next=target+(now-target)*coef;
    return std::abs(next-target)<1.0e-6f ? target : next;
}
}

FxEnvironment::FxEnvironment():dry_(2*chunk,0.0f) {
    for(std::size_t b=0;b<renderers_.size();++b) {
        renderers_[b]=std::make_unique<FxRenderer>();
        renderers_[b]->bind(b==0 ? fxMainBusId : FxBusId(1000+b)); // placeholder until synced
    }
}

void FxEnvironment::prepare(double sampleRate) {
    smoothing_=float(std::exp(-1.0/(0.02*sampleRate)));
    for(auto& r:renderers_) r->prepare(sampleRate);
}

void FxEnvironment::sync(const std::vector<BusGraph>& slots,const FxGlobalSettings& g) {
    const std::size_t count=std::clamp<std::size_t>(slots.size(),1,maxRenderBuses);
    for(std::size_t b=0;b<count;++b) {
        auto& r=*renderers_[b];
        r.bind(slots[b].bus);
        r.setBypassMode(g.bypass);
        if(slots[b].graph!=nullptr) r.sync(*slots[b].graph,false);
    }
    activeBuses_.store(count,std::memory_order_release);
    inputGain_.store(dbToGain(g.inputGainDb),std::memory_order_relaxed);
    dryWet_.store(g.dryWet,std::memory_order_relaxed);
    width_.store(g.width,std::memory_order_relaxed);
    outputGain_.store(dbToGain(g.outputGainDb),std::memory_order_relaxed);
}

std::uint64_t FxEnvironment::compileCount() const noexcept {
    std::uint64_t total=0;
    for(const auto& r:renderers_) total+=r->compileCount();
    return total;
}

std::pair<float,float> FxEnvironment::consumeInputPeaks(FxBusId bus) noexcept {
    const auto count=activeBuses_.load(std::memory_order_acquire);
    for(std::size_t b=0;b<count && b<maxRenderBuses;++b)
        if(renderers_[b]->boundBus()==bus)
            return {inputPeak_[2*b].exchange(0.0f,std::memory_order_acq_rel),inputPeak_[2*b+1].exchange(0.0f,std::memory_order_acq_rel)};
    return {0.0f,0.0f};
}
FxRenderer::NodeTelemetrySnapshot FxEnvironment::consumeNodeTelemetry(FxBusId bus,FxNodeId node) noexcept {
    const auto count=activeBuses_.load(std::memory_order_acquire);
    for(std::size_t b=0;b<count && b<maxRenderBuses;++b)
        if(renderers_[b]->boundBus()==bus) return renderers_[b]->consumeNodeTelemetry(node);
    FxRenderer::NodeTelemetrySnapshot empty; empty.node=node; return empty;
}

void FxEnvironment::setNodeTelemetryEnabled(FxBusId bus,bool enabled) noexcept {
    const auto count=activeBuses_.load(std::memory_order_acquire);
    for(std::size_t b=0;b<count && b<maxRenderBuses;++b)
        renderers_[b]->setTelemetryEnabled(enabled && renderers_[b]->boundBus()==bus);
}

std::pair<float,float> FxEnvironment::consumePeaks() noexcept {
    return {peakLeft_.exchange(0.0f,std::memory_order_acq_rel),peakRight_.exchange(0.0f,std::memory_order_acq_rel)};
}

void FxEnvironment::process(float* mainLeft,float* mainRight,float* const* aux,std::size_t busCount,int samples,
                            const FxModulationOutput* modulation,bool preMaster,float masterGain) noexcept {
    if(samples<=0 || mainLeft==nullptr || mainRight==nullptr) return;
    const std::size_t buses=aux==nullptr ? 1 : std::min(busCount,activeBuses_.load(std::memory_order_acquire));
    const float postTarget=preMaster && std::isfinite(masterGain) ? std::clamp(masterGain,0.0f,4.0f) : 1.0f;
    if(preMaster!=postActive_) { postNow_=postTarget; postActive_=preMaster; } // engine switched this block too
    postTarget_=postTarget;
    modulation_=modulation;
    const bool neutralGlobals=inputGain_.load(std::memory_order_relaxed)==1.0f && dryWet_.load(std::memory_order_relaxed)==1.0f
        && width_.load(std::memory_order_relaxed)==1.0f && outputGain_.load(std::memory_order_relaxed)==1.0f
        && inputNow_==1.0f && dryWetNow_==1.0f && widthNow_==1.0f && outputNow_==1.0f && postTarget==1.0f && postNow_==1.0f;
    // Neutral fast path: MAIN only, MAIN graph is IN -> OUT, globals neutral:
    // bit-exact pass-through (old patches sound identical).
    if(buses==1 && neutralGlobals && renderers_[0]->identity()) {
        float il=0.0f,ir=0.0f; // MAIN IN: the signal entering the graph
        for(int i=0;i<samples;++i) { il=std::max(il,std::abs(mainLeft[i])); ir=std::max(ir,std::abs(mainRight[i])); }
        noteInputPeak(0,il,ir);
        renderers_[0]->process(mainLeft,mainRight,samples,modulation); // adopts plans; untouched audio
        float pl=0.0f,pr=0.0f;
        for(int i=0;i<samples;++i) { pl=std::max(pl,std::abs(mainLeft[i])); pr=std::max(pr,std::abs(mainRight[i])); }
        if(pl>peakLeft_.load(std::memory_order_relaxed)) peakLeft_.store(pl,std::memory_order_relaxed);
        if(pr>peakRight_.load(std::memory_order_relaxed)) peakRight_.store(pr,std::memory_order_relaxed);
        return;
    }
    for(int offset=0;offset<samples;offset+=chunk)
        processChunk(mainLeft,mainRight,aux,buses,offset,std::min(chunk,samples-offset));
}

void FxEnvironment::processChunk(float* mainLeft,float* mainRight,float* const* aux,std::size_t buses,int offset,int n) noexcept {
    const float inputTarget=inputGain_.load(std::memory_order_relaxed);
    float* dryL=dry_.data();
    float* dryR=dry_.data()+chunk;
    const auto busPointer=[&](std::size_t b,int c)->float* {
        if(b==0) return (c==0 ? mainLeft : mainRight)+offset;
        float* p=aux[2*(b-1)+std::size_t(c)];
        return p!=nullptr ? p+offset : nullptr;
    };
    // 1) input gain on every bus; the unprocessed sum is the global "dry".
    std::fill_n(dryL,n,0.0f);
    std::fill_n(dryR,n,0.0f);
    float gains[chunk];
    for(int i=0;i<n;++i) { inputNow_=approach(inputNow_,inputTarget,smoothing_); gains[i]=inputNow_; }
    for(std::size_t b=0;b<buses;++b) {
        float* l=busPointer(b,0);
        float* r=busPointer(b,1);
        if(l==nullptr || r==nullptr) continue;
        float il=0.0f,ir=0.0f;
        for(int i=0;i<n;++i) {
            l[i]=(std::isfinite(l[i]) ? l[i] : 0.0f)*gains[i];
            r[i]=(std::isfinite(r[i]) ? r[i] : 0.0f)*gains[i];
            dryL[i]+=l[i];
            dryR[i]+=r[i];
            il=std::max(il,std::abs(l[i])); ir=std::max(ir,std::abs(r[i]));
        }
        noteInputPeak(b,il,ir); // the bus IN node's signal (after GLOBAL input gain)
    }
    // 2) each bus through its own compiled graph (in place).
    for(std::size_t b=0;b<buses;++b) {
        float* l=busPointer(b,0);
        float* r=busPointer(b,1);
        if(l!=nullptr && r!=nullptr) renderers_[b]->process(l,r,n,modulation_);
    }
    // 3) sum bus outputs into the master, 4) GLOBAL FX.
    const float mixTarget=dryWet_.load(std::memory_order_relaxed);
    const float widthTarget=width_.load(std::memory_order_relaxed);
    const float outputTarget=outputGain_.load(std::memory_order_relaxed);
    float* outL=mainLeft+offset;
    float* outR=mainRight+offset;
    float pl=0.0f,pr=0.0f;
    for(int i=0;i<n;++i) {
        float wl=outL[i],wr=outR[i];
        for(std::size_t b=1;b<buses;++b) {
            const float* l=busPointer(b,0);
            const float* r=busPointer(b,1);
            if(l!=nullptr && r!=nullptr) { wl+=l[i]; wr+=r[i]; }
        }
        dryWetNow_=approach(dryWetNow_,mixTarget,smoothing_);
        widthNow_=approach(widthNow_,widthTarget,smoothing_);
        outputNow_=approach(outputNow_,outputTarget,smoothing_);
        postNow_=approach(postNow_,postTarget_,smoothing_);
        float l=dryL[i]+dryWetNow_*(wl-dryL[i]);
        float r=dryR[i]+dryWetNow_*(wr-dryR[i]);
        if(widthNow_!=1.0f) { const float mid=0.5f*(l+r),side=0.5f*(l-r)*widthNow_; l=mid+side; r=mid-side; }
        l*=outputNow_*postNow_;
        r*=outputNow_*postNow_;
        outL[i]=std::isfinite(l) ? l : 0.0f;
        outR[i]=std::isfinite(r) ? r : 0.0f;
        pl=std::max(pl,std::abs(outL[i]));
        pr=std::max(pr,std::abs(outR[i]));
    }
    if(pl>peakLeft_.load(std::memory_order_relaxed)) peakLeft_.store(pl,std::memory_order_relaxed);
    if(pr>peakRight_.load(std::memory_order_relaxed)) peakRight_.store(pr,std::memory_order_relaxed);
}

}
