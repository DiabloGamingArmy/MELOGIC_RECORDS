#include "Modulation.h"
#include <algorithm>
#include <cmath>
namespace mct::origami {
namespace {
bool range(float x,float a,float b) {return std::isfinite(x) && x>=a && x<=b;}
bool known(ModSource s) {return s==ModSource::Env1 || s==ModSource::Lfo1 || (s>=ModSource::Macro1 && s<=ModSource::Macro4);}
struct Range {float lo,hi;};
Range limits(ModDestination d) {
    switch(d) {
        case ModDestination::Cutoff:return {20,20000};
        case ModDestination::Octave:return {-4,4};
        case ModDestination::Semitone:return {-12,12};
        case ModDestination::Fine:return {-100,100};
        case ModDestination::Detune:return {0,100};
        case ModDestination::Pan:return {-1,1};
        default:return {0,1};
    }
}
}
bool isGlobalDestination(ModDestination d) noexcept {return d>=ModDestination::Cutoff && d<=ModDestination::MasterGain;}
bool validModulation(const ModulationState& s,const std::array<OscillatorModuleState,16>& modules) noexcept {
    if(s.lfo1.shape<LfoShape::Sine || s.lfo1.shape>LfoShape::Square ||
       (s.lfo1.mode!=LfoMode::Free && s.lfo1.mode!=LfoMode::NoteRetrigger) || !range(s.lfo1.rateHz,.01f,40)) return false;
    for(float v:s.macros) if(!range(v,0,1)) return false;
    std::uint32_t previous=0;bool empty=false;
    if(s.nextRouteId==0) return false;
    for(const auto& r:s.routes) {
        if(!r.id) {empty=true;continue;}
        if(empty || r.id<=previous || r.id>=s.nextRouteId || !known(r.source) || !range(r.amount,-1,1)) return false;
        previous=r.id;
        if(isGlobalDestination(r.destination.parameter)) {if(r.destination.oscillator!=0) return false;}
        else {
            if(r.destination.parameter<ModDestination::WtPosition || r.destination.parameter>ModDestination::Level) return false;
            bool found=false;for(const auto& m:modules) if(m.id && m.id==r.destination.oscillator) found=true;
            if(!found) return false;
        }
    }
    return true;
}
float modulationToNormalized(ModDestination d,float value) noexcept {
    const auto r=limits(d);if(!std::isfinite(value)) value=r.lo;
    value=std::clamp(value,r.lo,r.hi);
    if(d==ModDestination::Cutoff) return std::log(value/r.lo)/std::log(r.hi/r.lo);
    return (value-r.lo)/(r.hi-r.lo);
}
float modulationFromNormalized(ModDestination d,float value) noexcept {
    if(!std::isfinite(value)) value=0;
    value=std::clamp(value,0.f,1.f);const auto r=limits(d);
    if(d==ModDestination::Cutoff) return r.lo*std::pow(r.hi/r.lo,value);
    // Pitch modulation is continuous; discrete base octave/semitone values stay intact.
    return r.lo+value*(r.hi-r.lo);
}
float Lfo::shape(LfoShape type,double phase) noexcept {
    if(!std::isfinite(phase)) return 0;
    phase-=std::floor(phase);
    switch(type) {
        case LfoShape::Sine:return static_cast<float>(std::sin(phase*6.283185307179586));
        case LfoShape::Triangle:return static_cast<float>(1-4*std::abs(phase-.5));
        case LfoShape::Saw:return static_cast<float>(2*phase-1);
        case LfoShape::Square:return phase<.5?1.f:-1.f;
    }
    return 0;
}
float Lfo::next(const LfoSettings& s,double sampleRate) noexcept {
    const float out=shape(s.shape,phase_);
    if(std::isfinite(sampleRate) && sampleRate>0 && std::isfinite(s.rateHz)) {
        phase_+=std::clamp(double(s.rateHz),.01,40.)/sampleRate;
        phase_-=std::floor(phase_);
    }
    return out;
}
void CompiledModulation::compile(const ModulationState& state,const std::array<OscillatorModuleState,16>& modules,bool immediate) noexcept {
    const auto old=groups_;const auto oldCount=count_;count_=voiceCount_=0;voiceFilter_=false;
    groups_={};
    for(const auto& route:state.routes) {
        if(!route.id || !route.enabled || route.amount==0) continue;
        std::size_t slot=0;
        if(!isGlobalDestination(route.destination.parameter)) {
            while(slot<modules.size() && modules[slot].id!=route.destination.oscillator) ++slot;
            if(slot==modules.size()) continue; // module removed since publication
        }
        std::size_t i=0;while(i<count_ && !(groups_[i].address==route.destination)) ++i;
        if(i==count_) {groups_[i].address=route.destination;groups_[i].slot=slot;++count_;}
        auto source=static_cast<unsigned>(route.source);
        const auto index=route.source==ModSource::Env1 ? 5u : route.source==ModSource::Lfo1 ?
            (state.lfo1.mode==LfoMode::Free?0u:6u) : source-static_cast<unsigned>(ModSource::Macro1)+1;
        groups_[i].target[index]+=route.amount;
    }
    for(std::size_t i=0;i<count_;++i) {
        auto& g=groups_[i];g.weight=g.target;
        if(!immediate) {
            g.weight={};
            for(std::size_t j=0;j<oldCount;++j) if(old[j].address==g.address) {g.weight=old[j].weight;break;}
        }
        if(g.target[5]!=0 || g.target[6]!=0 || g.weight[5]!=0 || g.weight[6]!=0) {
            voiceGroups_[voiceCount_++]=i;
            if(g.address.parameter==ModDestination::Cutoff || g.address.parameter==ModDestination::Resonance) voiceFilter_=true;
        }
    }
}
void CompiledModulation::advance(float alpha) noexcept {
    for(std::size_t i=0;i<count_;++i) for(std::size_t s=0;s<7;++s)
        groups_[i].weight[s]+=alpha*(groups_[i].target[s]-groups_[i].weight[s]);
}
float CompiledModulation::read(const ModulationFrame& f,const Group& g) noexcept {
    const auto& m=f.modules[g.slot];
    switch(g.address.parameter) {
        case ModDestination::Cutoff:return f.cutoff;case ModDestination::Resonance:return f.resonance;
        case ModDestination::MasterGain:return f.master;case ModDestination::WtPosition:return m.wtPosition;
        case ModDestination::Octave:return m.octave;case ModDestination::Semitone:return m.semitone;
        case ModDestination::Fine:return m.fineCents;case ModDestination::Detune:return m.detuneCents;
        case ModDestination::Pan:return m.pan;case ModDestination::Level:return m.level;
    }
    return 0;
}
void CompiledModulation::write(ModulationFrame& f,const Group& g,float n) noexcept {
    const float v=modulationFromNormalized(g.address.parameter,n);auto& m=f.modules[g.slot];
    switch(g.address.parameter) {
        case ModDestination::Cutoff:f.cutoff=v;break;case ModDestination::Resonance:f.resonance=v;break;
        case ModDestination::MasterGain:f.master=v;break;case ModDestination::WtPosition:m.wtPosition=v;break;
        case ModDestination::Octave:m.octave=v;break;case ModDestination::Semitone:m.semitone=v;break;
        case ModDestination::Fine:m.fineCents=v;break;case ModDestination::Detune:m.detuneCents=v;break;
        case ModDestination::Pan:m.pan=v;break;case ModDestination::Level:m.level=v;break;
    }
}
void CompiledModulation::globalFrame(ModulationFrame& f,const std::array<float,5>& sources,double rate) const noexcept {
    for(std::size_t i=0;i<count_;++i) {
        const auto& g=groups_[i];float n=modulationToNormalized(g.address.parameter,read(f,g));
        for(std::size_t s=0;s<sources.size();++s) n+=g.weight[s]*sources[s];
        f.normalized[i]=n;write(f,g,n);
    }
    f.filter=dsp::LowPassCoefficients::make(rate,f.cutoff,f.resonance);
}
void CompiledModulation::voiceFrame(ModulationFrame& f,float envelope,float lfo,double rate) const noexcept {
    for(std::size_t j=0;j<voiceCount_;++j) {
        const auto i=voiceGroups_[j];const auto& g=groups_[i];
        write(f,g,f.normalized[i]+g.weight[5]*envelope+g.weight[6]*lfo);
    }
    if(voiceFilter_) f.filter=dsp::LowPassCoefficients::make(rate,f.cutoff,f.resonance);
}
}
