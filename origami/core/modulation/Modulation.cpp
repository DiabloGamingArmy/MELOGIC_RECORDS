// mct-origami-v32.1.1-extended-mod-sources-hotfix
// mct-origami-v32.0.0-dynamic-mod-filter-collections
// mct-origami-v31.0.0-matrix-routing-expansion
// mct-origami-v28.0.0-interactive-envelope-editor
// mct-origami-modulation-completion-v24
// mct-origami-v34.0.0-random-lfo
// mct-origami-v34.1.0-mod-scroll-clip-mseg-audio
// mct-origami-v34.2.1-performance-reinforcement
// mct-origami-v34.3.0-lfo-interaction-mod-properties
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
    if(!(s.shape>=LfoShape::Sine && s.shape<=LfoShape::Square) ||
       !(s.mode==LfoMode::Free || s.mode==LfoMode::Loop || s.mode==LfoMode::Envelope) ||
       !range(s.rateHz,.01f,40.f) ||
       s.pointCount>s.points.size() || s.pointCount==1)
        return false;
    float previousX=-1.0f;
    for(std::size_t i=0;i<s.pointCount;++i) {
        const auto& p=s.points[i];
        if(!range(p.x,0.0f,1.0f) || !range(p.y,-1.0f,1.0f) ||
           !range(p.curve,-1.0f,1.0f) || p.x<=previousX) return false;
        previousX=p.x;
    }
    return true;
}
bool known(ModSource s) {
    switch(s) {
        case ModSource::Env1:case ModSource::Env2:case ModSource::Env3:
        case ModSource::Lfo1:case ModSource::Lfo2:case ModSource::Lfo3:case ModSource::Lfo4:
        case ModSource::Macro1:case ModSource::Macro2:case ModSource::Macro3:case ModSource::Macro4:
        case ModSource::ModWheel:case ModSource::Velocity:case ModSource::Keytrack:case ModSource::Aftertouch:
        case ModSource::PitchBend:case ModSource::NoteGate:
        case ModSource::Random:case ModSource::Function:
        case ModSource::Chaos:case ModSource::Drift:case ModSource::Sequencer:return true;
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
        case ModDestination::Pan:
        case ModDestination::Process1Amount:
        case ModDestination::Process2Amount:
        case ModDestination::Route1Amount:
        case ModDestination::Route2Amount:
            return {-1,1};
        default:return {0,1};
    }
}
std::size_t slotFor(ModSource source,const ModulationState& state) {
    switch(source) {
        case ModSource::Lfo1:return state.lfo1.mode==LfoMode::Free?0u:16u;
        case ModSource::Lfo2:return state.lfo2.mode==LfoMode::Free?1u:17u;
        case ModSource::Lfo3:return state.lfo3.mode==LfoMode::Free?2u:18u;
        case ModSource::Lfo4:return state.lfo4.mode==LfoMode::Free?3u:19u;
        case ModSource::Macro1:return 4u;case ModSource::Macro2:return 5u;
        case ModSource::Macro3:return 6u;case ModSource::Macro4:return 7u;
        case ModSource::Random:return 8u;case ModSource::Function:return 9u;
        case ModSource::Chaos:return 10u;case ModSource::Drift:return 11u;case ModSource::Sequencer:return 12u;
        case ModSource::Env1:return 13u;case ModSource::Env2:return 14u;case ModSource::Env3:return 15u;
        case ModSource::Velocity:return 20u;case ModSource::ModWheel:return 21u;
        case ModSource::Keytrack:return 22u;case ModSource::Aftertouch:return 23u;
        case ModSource::PitchBend:return 24u;case ModSource::NoteGate:return 25u;
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
    if((s.envActiveMask&~0x7u)!=0 || (s.envActiveMask&0x1u)==0) return false;
    if((s.lfoActiveMask&~0xFu)!=0) return false;
    if((s.generatorActiveMask&~0x1Fu)!=0) return false;
    for(std::size_t i=0;i<4;++i) if(!validLfo(lfoSettings(s,i))) return false;
    if(!validEnvelope(s.env2) || !validEnvelope(s.env3)) return false;
    for(float c:s.env1Curves) if(!range(c,-1.f,1.f)) return false;
    if(!range(s.random.rateHz,.01f,40.f) ||
       !range(s.random.smoothing,0.f,1.f) ||
       !range(s.random.hold,0.f,.98f) ||
       !range(s.random.delaySeconds,0.f,5.f) ||
       !range(s.function.rateHz,.01f,40.f) || !range(s.function.curve,-1.f,1.f) ||
       !range(s.chaos.rateHz,.01f,40.f) ||
       !range(s.drift.rateHz,.01f,40.f) ||
       !range(s.sequencer.rateHz,.01f,40.f)) return false;
    for(float step:s.sequencer.steps) if(!range(step,-1.f,1.f)) return false;
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
            if(r.destination.parameter<ModDestination::WtPosition || r.destination.parameter>ModDestination::Route2Amount) return false;
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
float Lfo::mseg(const LfoSettings& s,double phase) noexcept {
    if(s.pointCount<2 || s.pointCount>s.points.size()) return shape(s.shape,phase);
    phase-=std::floor(phase);
    const float x=static_cast<float>(phase);
    if(x<=s.points[0].x) return s.points[0].y;
    if(x>=s.points[s.pointCount-1].x) return s.points[s.pointCount-1].y;

    std::size_t hi=1;
    while(hi<s.pointCount && x>s.points[hi].x) ++hi;
    hi=std::min<std::size_t>(hi,s.pointCount-1);

    const auto& a=s.points[hi-1];
    const auto& b=s.points[hi];
    float t=std::clamp((x-a.x)/std::max(0.0001f,b.x-a.x),0.0f,1.0f);
    const float cv=std::clamp(b.curve,-1.0f,1.0f);
    if(cv>0.0f) t=std::pow(t,1.0f+cv*4.0f);
    else if(cv<0.0f) t=1.0f-std::pow(1.0f-t,1.0f+(-cv)*4.0f);
    return std::clamp(a.y+(b.y-a.y)*t,-1.0f,1.0f);
}

float Lfo::next(const LfoSettings& s,double sampleRate) noexcept {
    // Envelope mode is a one-shot MSEG: after reaching the right endpoint it
    // remains there until reset by the next note. Loop and Free wrap normally.
    if(s.mode==LfoMode::Envelope && phase_>=1.0) {
        if(s.pointCount>=2 && s.pointCount<=s.points.size())
            return s.points[s.pointCount-1].y;
        return shape(s.shape,0.999999);
    }

    const float out=mseg(s,phase_);
    if(std::isfinite(sampleRate) && sampleRate>0 && std::isfinite(s.rateHz)) {
        phase_+=std::clamp(double(s.rateHz),.01,40.)/sampleRate;
        if(s.mode==LfoMode::Envelope)
            phase_=std::min(1.0,phase_);
        else
            phase_-=std::floor(phase_);
    }
    return out;
}
float RandomGenerator::randomValue() noexcept {
    std::uint32_t x=state_;
    x^=x<<13;x^=x>>17;x^=x<<5;state_=x;
    return static_cast<float>((state_>>8)&0x00ffffffu)/16777215.0f*2.0f-1.0f;
}

float RandomGenerator::next(const RandomSettings& s,double sampleRate) noexcept {
    if(!std::isfinite(sampleRate) || sampleRate<=0) return value_;

    const double delay=std::clamp(double(s.delaySeconds),0.0,5.0);
    if(delayElapsed_<delay) {
        delayElapsed_+=1.0/sampleRate;
        value_=0.0f;
        return value_;
    }

    if(!initialized_) {
        current_=randomValue();
        next_=randomValue();
        value_=current_;
        initialized_=true;
        phase_=0.0;
    }

    const double rate=std::clamp(double(s.rateHz),.01,40.0);
    phase_+=rate/sampleRate;
    while(phase_>=1.0) {
        phase_-=1.0;
        current_=next_;
        next_=randomValue();
    }

    const float hold=std::clamp(s.hold,0.0f,.98f);
    const float smoothing=std::clamp(s.smoothing,0.0f,1.0f);

    // With Smooth at zero this is a true sample-and-hold. Increasing Smooth
    // progressively morphs the held value toward the NEXT random target after
    // the Hold portion of the cycle. At 100% the transition is continuous
    // across cycle boundaries.
    if(smoothing<=1.0e-5f || phase_<=hold) {
        value_=current_;
    } else {
        const float t=std::clamp(
            (static_cast<float>(phase_)-hold)/std::max(1.0e-5f,1.0f-hold),
            0.0f,1.0f);
        const float eased=t*t*(3.0f-2.0f*t);
        value_=current_+(next_-current_)*(eased*smoothing);
    }

    return std::clamp(value_,-1.0f,1.0f);
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

float ChaosGenerator::next(const ChaosSettings& s,double sampleRate) noexcept {
    if(!std::isfinite(sampleRate) || sampleRate<=0) return value_;
    const double rate=std::clamp(double(s.rateHz),.01,40.);
    phase_+=rate/sampleRate;
    if(phase_>=1.0) {
        phase_-=std::floor(phase_);
        x_=std::clamp(3.93f*x_*(1.0f-x_),0.0001f,0.9999f);
        target_=x_*2.0f-1.0f;
    }
    const float alpha=static_cast<float>(1.0-std::exp(-(rate*7.0)/sampleRate));
    value_+=alpha*(target_-value_);
    return std::clamp(value_,-1.0f,1.0f);
}

float DriftGenerator::next(const DriftSettings& s,double sampleRate) noexcept {
    if(!std::isfinite(sampleRate) || sampleRate<=0) return value_;
    const double rate=std::clamp(double(s.rateHz),.01,40.);
    phase_+=rate/sampleRate;
    if(phase_>=1.0) {
        phase_-=std::floor(phase_);
        std::uint32_t x=state_;
        x^=x<<13;x^=x>>17;x^=x<<5;state_=x;
        target_=static_cast<float>((x>>8)&0x00ffffffu)/16777215.0f*2.0f-1.0f;
    }
    const float alpha=static_cast<float>(1.0-std::exp(-(rate*2.2)/sampleRate));
    value_+=alpha*(target_-value_);
    return std::clamp(value_,-1.0f,1.0f);
}

float SequencerGenerator::next(const SequencerSettings& s,double sampleRate) noexcept {
    const float out=s.steps[step_%s.steps.size()];
    if(std::isfinite(sampleRate) && sampleRate>0) {
        phase_+=std::clamp(double(s.rateHz),.01,40.)/sampleRate;
        while(phase_>=1.0) {
            phase_-=1.0;
            step_=(step_+1)%s.steps.size();
        }
    }
    return out;
}

void CompiledModulation::compile(const ModulationState& state,const std::array<OscillatorModuleState,16>& modules,bool immediate) noexcept {
    const auto old=groups_;const auto oldCount=count_;
    count_=voiceCount_=0;voiceFilter_=false;groups_={};globalSourceUsed_.fill(false);
    smoothingActive_=false;
    filterEnabled_=state.filterEnabled;
    for(const auto& route:state.routes) {
        if(!route.id || !route.enabled || route.amount==0) continue;
        std::size_t slot=0;
        if(!isGlobalDestination(route.destination.parameter)) {
            while(slot<modules.size() && modules[slot].id!=route.destination.oscillator) ++slot;
            if(slot==modules.size()) continue;
        }
        std::size_t i=0;while(i<count_ && !(groups_[i].address==route.destination)) ++i;
        if(i==count_) {groups_[i].address=route.destination;groups_[i].slot=slot;++count_;}
        const auto sourceSlot=slotFor(route.source,state);
        groups_[i].target[sourceSlot]+=route.amount;
        if(sourceSlot<globalSourceCount) globalSourceUsed_[sourceSlot]=true;
    }
    for(std::size_t i=0;i<count_;++i) {
        auto& g=groups_[i];g.weight=g.target;
        if(!immediate) {
            g.weight={};
            for(std::size_t j=0;j<oldCount;++j)
                if(old[j].address==g.address) {g.weight=old[j].weight;break;}
            for(std::size_t s=0;s<sourceSlotCount;++s)
                if(std::abs(g.target[s]-g.weight[s])>1.0e-6f) smoothingActive_=true;
        }
        g.globalSlotCount=0;g.voiceSlotCount=0;
        for(std::size_t s=0;s<globalSourceCount;++s)
            if(g.target[s]!=0.0f || g.weight[s]!=0.0f) g.globalSlots[g.globalSlotCount++]=static_cast<std::uint8_t>(s);
        for(std::size_t s=0;s<voiceSourceCount;++s)
            if(g.target[globalSourceCount+s]!=0.0f || g.weight[globalSourceCount+s]!=0.0f) g.voiceSlots[g.voiceSlotCount++]=static_cast<std::uint8_t>(s);
        const bool voice=g.voiceSlotCount!=0;
        if(voice) {
            voiceGroups_[voiceCount_++]=i;
            if(g.address.parameter==ModDestination::Cutoff || g.address.parameter==ModDestination::Resonance) voiceFilter_=true;
        }
    }
}
void CompiledModulation::advance(float alpha) noexcept {
    if(!smoothingActive_) return;
    bool stillMoving=false;
    for(std::size_t i=0;i<count_;++i) {
        for(std::size_t s=0;s<sourceSlotCount;++s) {
            auto& value=groups_[i].weight[s];
            const float target=groups_[i].target[s];
            const float delta=target-value;
            if(std::abs(delta)<=1.0e-5f) {
                value=target;
                continue;
            }
            value+=alpha*delta;
            if(std::abs(target-value)>1.0e-5f) stillMoving=true;
            else value=target;
        }
    }
    smoothingActive_=stillMoving;
}
float CompiledModulation::read(const ModulationFrame& f,const Group& g) noexcept {
    const auto& m=f.modules[g.slot];
    switch(g.address.parameter) {
        case ModDestination::Cutoff:return f.cutoff;case ModDestination::Resonance:return f.resonance;
        case ModDestination::MasterGain:return f.master;case ModDestination::WtPosition:return m.wtPosition;
        case ModDestination::Octave:return m.octave;case ModDestination::Semitone:return m.semitone;
        case ModDestination::Fine:return m.fineCents;case ModDestination::Detune:return m.detuneCents;
        case ModDestination::Pan:return m.pan;case ModDestination::Level:return m.level;
        case ModDestination::Process1Amount:return m.process1Amount;
        case ModDestination::Process2Amount:return m.process2Amount;
        case ModDestination::Route1Amount:return m.route1Amount;
        case ModDestination::Route2Amount:return m.route2Amount;
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
        case ModDestination::Process1Amount:m.process1Amount=v;break;
        case ModDestination::Process2Amount:m.process2Amount=v;break;
        case ModDestination::Route1Amount:m.route1Amount=v;break;
        case ModDestination::Route2Amount:m.route2Amount=v;break;
    }
}
const dsp::LowPassCoefficients& CompiledModulation::globalFilter(
    double rate,float cutoff,float resonance) const noexcept {
    const float safeCutoff=std::isfinite(cutoff)?std::clamp(cutoff,20.0f,20000.0f):8000.0f;
    const float safeRes=std::isfinite(resonance)?std::clamp(resonance,0.0f,1.0f):0.1f;
    const float cutoffKey=std::round(safeCutoff*0.25f)*4.0f;
    const float resKey=std::round(safeRes*4096.0f)/4096.0f;
    if(rate!=cachedFilterRate_ || cutoffKey!=cachedFilterCutoff_ || resKey!=cachedFilterResonance_) {
        cachedFilter_=dsp::LowPassCoefficients::make(rate,safeCutoff,safeRes);
        cachedFilterRate_=rate;cachedFilterCutoff_=cutoffKey;cachedFilterResonance_=resKey;
    }
    return cachedFilter_;
}

void CompiledModulation::globalFrame(ModulationFrame& f,const std::array<float,globalSourceCount>& sources,double rate) const noexcept {
    f.filterEnabled=filterEnabled_;
    for(std::size_t i=0;i<count_;++i) {
        const auto& g=groups_[i];float n=modulationToNormalized(g.address.parameter,read(f,g));
        for(std::size_t k=0;k<g.globalSlotCount;++k) {
            const auto s=static_cast<std::size_t>(g.globalSlots[k]);
            n+=(std::isfinite(g.weight[s])?g.weight[s]:0.0f)*(std::isfinite(sources[s])?sources[s]:0.0f);
        }
        if(!std::isfinite(n)) n=0.0f;
        f.normalized[i]=std::clamp(n,-4.0f,4.0f);write(f,g,n);
    }
    if(f.filterEnabled) f.filter=globalFilter(rate,f.cutoff,f.resonance);
}
void CompiledModulation::voiceFrame(ModulationFrame& f,const std::array<float,voiceSourceCount>& sources,double rate) const noexcept {
    for(std::size_t j=0;j<voiceCount_;++j) {
        const auto i=voiceGroups_[j];const auto& g=groups_[i];
        float n=std::isfinite(f.normalized[i])?f.normalized[i]:0.0f;
        for(std::size_t k=0;k<g.voiceSlotCount;++k) {
            const auto s=static_cast<std::size_t>(g.voiceSlots[k]);
            const float w=g.weight[globalSourceCount+s];
            n+=(std::isfinite(w)?w:0.0f)*(std::isfinite(sources[s])?sources[s]:0.0f);
        }
        if(!std::isfinite(n)) n=0.0f;write(f,g,n);
    }
    if(voiceFilter_) f.filter=dsp::LowPassCoefficients::make(rate,f.cutoff,f.resonance);
}
}
