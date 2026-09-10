// mct-origami-v28.0.0-interactive-envelope-editor
// mct-origami-modulation-completion-v24
#include "Modulation.h"
#include <algorithm>
#include <cmath>
namespace mct::origami {
namespace {
bool range(float x,float a,float b) {return std::isfinite(x) && x>=a && x<=b;}
bool validEnvelope(const dsp::EnvelopeSettings& e) {
    return range(e.attack,.001f,10.f) && range(e.decay,.001f,10.f) &&
           range(e.sustain,0.f,1.f) && range(e.release,.001f,20.f) &&
           range(e.attackCurve,-1.f,1.f) && range(e.decayCurve,-1.f,1.f) &&
           range(e.releaseCurve,-1.f,1.f);
}
bool validLfo(const LfoSettings& s) {
    return s.shape>=LfoShape::Sine && s.shape<=LfoShape::Square &&
           (s.mode==LfoMode::Free || s.mode==LfoMode::NoteRetrigger) &&
           range(s.rateHz,.01f,40.f);
}
bool known(ModSource s) {
    switch(s) {
        case ModSource::Env1:case ModSource::Env2:case ModSource::Env3:
        case ModSource::Lfo1:case ModSource::Lfo2:case ModSource::Lfo3:case ModSource::Lfo4:
        case ModSource::Macro1:case ModSource::Macro2:case ModSource::Macro3:case ModSource::Macro4:
        case ModSource::ModWheel:case ModSource::Velocity:case ModSource::Keytrack:case ModSource::Aftertouch:
        case ModSource::Random:case ModSource::Function:return true;
    }
    return false;
}
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
std::size_t slotFor(ModSource source,const ModulationState& state) {
    switch(source) {
        case ModSource::Lfo1:return state.lfo1.mode==LfoMode::Free?0u:13u;
        case ModSource::Lfo2:return state.lfo2.mode==LfoMode::Free?1u:14u;
        case ModSource::Lfo3:return state.lfo3.mode==LfoMode::Free?2u:15u;
        case ModSource::Lfo4:return state.lfo4.mode==LfoMode::Free?3u:16u;
        case ModSource::Macro1:return 4u;case ModSource::Macro2:return 5u;
        case ModSource::Macro3:return 6u;case ModSource::Macro4:return 7u;
        case ModSource::Random:return 8u;case ModSource::Function:return 9u;
        case ModSource::Env1:return 10u;case ModSource::Env2:return 11u;case ModSource::Env3:return 12u;
        case ModSource::Velocity:return 17u;case ModSource::ModWheel:return 18u;
        case ModSource::Keytrack:return 19u;case ModSource::Aftertouch:return 20u;
    }
    return 0u;
}
}

const LfoSettings& lfoSettings(const ModulationState& s,std::size_t i) noexcept {
    switch(i) {case 0:return s.lfo1;case 1:return s.lfo2;case 2:return s.lfo3;default:return s.lfo4;}
}
LfoSettings& lfoSettings(ModulationState& s,std::size_t i) noexcept {
    switch(i) {case 0:return s.lfo1;case 1:return s.lfo2;case 2:return s.lfo3;default:return s.lfo4;}
}

bool isGlobalDestination(ModDestination d) noexcept {return d>=ModDestination::Cutoff && d<=ModDestination::MasterGain;}
bool validModulation(const ModulationState& s,const std::array<OscillatorModuleState,16>& modules) noexcept {
    for(std::size_t i=0;i<4;++i) if(!validLfo(lfoSettings(s,i))) return false;
    if(!validEnvelope(s.env2) || !validEnvelope(s.env3)) return false;
    for(float c:s.env1Curves) if(!range(c,-1.f,1.f)) return false;
    if(!range(s.random.rateHz,.01f,40.f) || !range(s.function.rateHz,.01f,40.f) || !range(s.function.curve,-1.f,1.f)) return false;
    for(float v:s.macros) if(!range(v,0,1)) return false;
    std::uint32_t previous=0;bool empty=false;
    if(s.nextRouteId==0) return false;
    for(const auto& r:s.routes) {
        if(!r.id) {empty=true;continue;}
        if(empty || r.id<=previous || r.id>=s.nextRouteId || !known(r.source) || !range(r.amount,-1,1)) return false;
        previous=r.id;
        if(isGlobalDestination(r.destination.parameter)) {
            if(r.destination.oscillator!=0) return false;
        } else {
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
float RandomGenerator::next(const RandomSettings& s,double sampleRate) noexcept {
    const float out=value_;
    if(std::isfinite(sampleRate) && sampleRate>0) {
        phase_+=std::clamp(double(s.rateHz),.01,40.)/sampleRate;
        if(phase_>=1.0) {
            phase_-=std::floor(phase_);
            std::uint32_t x=state_;
            x^=x<<13;x^=x>>17;x^=x<<5;state_=x;
            value_=static_cast<float>((state_>>8)&0x00ffffffu)/16777215.0f*2.0f-1.0f;
        }
    }
    return out;
}
float FunctionGenerator::shape(float curve,double phase) noexcept {
    phase-=std::floor(phase);
    const float raw=static_cast<float>(1.0-4.0*std::abs(phase-.5));
    const float exponent=std::exp2(std::clamp(curve,-1.f,1.f)*2.0f);
    return std::copysign(std::pow(std::abs(raw),exponent),raw);
}
float FunctionGenerator::next(const FunctionSettings& s,double sampleRate) noexcept {
    const float out=shape(s.curve,phase_);
    if(std::isfinite(sampleRate) && sampleRate>0) {
        phase_+=std::clamp(double(s.rateHz),.01,40.)/sampleRate;
        phase_-=std::floor(phase_);
    }
    return out;
}

void CompiledModulation::compile(const ModulationState& state,const std::array<OscillatorModuleState,16>& modules,bool immediate) noexcept {
    const auto old=groups_;const auto oldCount=count_;count_=voiceCount_=0;voiceFilter_=false;groups_={};
    for(const auto& route:state.routes) {
        if(!route.id || !route.enabled || route.amount==0) continue;
        std::size_t slot=0;
        if(!isGlobalDestination(route.destination.parameter)) {
            while(slot<modules.size() && modules[slot].id!=route.destination.oscillator) ++slot;
            if(slot==modules.size()) continue;
        }
        std::size_t i=0;while(i<count_ && !(groups_[i].address==route.destination)) ++i;
        if(i==count_) {groups_[i].address=route.destination;groups_[i].slot=slot;++count_;}
        groups_[i].target[slotFor(route.source,state)]+=route.amount;
    }
    for(std::size_t i=0;i<count_;++i) {
        auto& g=groups_[i];g.weight=g.target;
        if(!immediate) {
            g.weight={};
            for(std::size_t j=0;j<oldCount;++j) if(old[j].address==g.address) {g.weight=old[j].weight;break;}
        }
        bool voice=false;
        for(std::size_t s=globalSourceCount;s<sourceSlotCount;++s)
            voice=voice || g.target[s]!=0 || g.weight[s]!=0;
        if(voice) {
            voiceGroups_[voiceCount_++]=i;
            if(g.address.parameter==ModDestination::Cutoff || g.address.parameter==ModDestination::Resonance) voiceFilter_=true;
        }
    }
}
void CompiledModulation::advance(float alpha) noexcept {
    for(std::size_t i=0;i<count_;++i) for(std::size_t s=0;s<sourceSlotCount;++s)
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
void CompiledModulation::globalFrame(ModulationFrame& f,const std::array<float,globalSourceCount>& sources,double rate) const noexcept {
    for(std::size_t i=0;i<count_;++i) {
        const auto& g=groups_[i];float n=modulationToNormalized(g.address.parameter,read(f,g));
        for(std::size_t s=0;s<globalSourceCount;++s) n+=g.weight[s]*sources[s];
        f.normalized[i]=n;write(f,g,n);
    }
    f.filter=dsp::LowPassCoefficients::make(rate,f.cutoff,f.resonance);
}
void CompiledModulation::voiceFrame(ModulationFrame& f,const std::array<float,voiceSourceCount>& sources,double rate) const noexcept {
    for(std::size_t j=0;j<voiceCount_;++j) {
        const auto i=voiceGroups_[j];const auto& g=groups_[i];
        float n=f.normalized[i];
        for(std::size_t s=0;s<voiceSourceCount;++s) n+=g.weight[globalSourceCount+s]*sources[s];
        write(f,g,n);
    }
    if(voiceFilter_) f.filter=dsp::LowPassCoefficients::make(rate,f.cutoff,f.resonance);
}
}
