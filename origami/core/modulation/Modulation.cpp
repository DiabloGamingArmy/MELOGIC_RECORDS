// mct-origami-fx-modulation-graph-ux-p03
// mct-origami-v40.3.1-sequence-expression
// mct-origami-v40.2.0-sequence-transport
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
#include "core/dsp/FastMath.h"
#include <algorithm>
#include <cmath>
namespace mct::origami {
namespace {
// Signed generator slots (LFOs, random, function, chaos, drift, sequencer):
// raw -1..1, so routes apply a polarity transform.
inline bool signedGeneratorSlot(std::size_t slot) noexcept {
    return slot<=3u || (slot>=8u && slot<=12u) || (slot>=16u && slot<=19u);
}
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
        case ModSource::None:return false;
    }
    return false;
}
struct Range {float lo,hi;};
Range limits(ModDestination d) {
    switch(d) {
        case ModDestination::Cutoff:return {20,20000};
        case ModDestination::MainTuning:return {-1,1};
        case ModDestination::Transpose:return {-24,24};
        case ModDestination::PortaTime:return {0,5};
        case ModDestination::Swing:return {0,0.75f};
        case ModDestination::EnvelopeScaling:
        case ModDestination::LfoScaling:return {0,2};
        case ModDestination::Octave:return {-4,4};
        case ModDestination::Semitone:return {-12,12};
        case ModDestination::Fine:return {-100,100};
        case ModDestination::Detune:return {0,100};
        case ModDestination::Pan:
        case ModDestination::Process1Amount:
        case ModDestination::Process2Amount:
        case ModDestination::Route1Amount:
        case ModDestination::Route2Amount:
        case ModDestination::ProcessAmount:
        case ModDestination::RouteAmount:
            return {-1,1};
        default:return {0,1};
    }
}
std::size_t slotFor(ModSource source,const ModulationState& state) {
    if(isOperatorSource(source))
        return CompiledModulation::sourceSlotCount+std::min(controlOperatorSlot(state,operatorIdOf(source)),
                                                            ModulationState::maxControlOperators-1);
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
        case ModSource::None:break; // incomplete routes are never compiled
    }
    return 0u;
}
}

float performanceSourceCurveValue(const PerformanceSourceCurve& curve,float input) noexcept {
    const float x=std::clamp(std::isfinite(input)?input:0.0f,0.0f,1.0f);
    const std::size_t count=std::min<std::size_t>(curve.pointCount,curve.points.size());
    if(count<2) return x;
    std::size_t hi=1;
    while(hi<count && x>curve.points[hi].x) ++hi;
    hi=std::min(hi,count-1);
    const auto& a=curve.points[hi-1];
    const auto& b=curve.points[hi];
    const float span=std::max(1.0e-5f,b.x-a.x);
    float t=std::clamp((x-a.x)/span,0.0f,1.0f);
    const float cv=std::clamp(b.curve,-1.0f,1.0f);
    if(cv>0.0f) t=std::pow(t,1.0f+cv*4.0f);
    else if(cv<0.0f) t=1.0f-std::pow(1.0f-t,1.0f+(-cv)*4.0f);
    return std::clamp(a.y+(b.y-a.y)*t,0.0f,1.0f);
}

const LfoSettings& lfoSettings(const ModulationState& s,std::size_t i) noexcept {
    switch(i) {case 0:return s.lfo1;case 1:return s.lfo2;case 2:return s.lfo3;default:return s.lfo4;}
}
LfoSettings& lfoSettings(ModulationState& s,std::size_t i) noexcept {
    switch(i) {case 0:return s.lfo1;case 1:return s.lfo2;case 2:return s.lfo3;default:return s.lfo4;}
}

bool isGlobalDestination(ModDestination d) noexcept {
    return d==ModDestination::Cutoff || d==ModDestination::Resonance || d==ModDestination::MasterGain ||
           d==ModDestination::MainTuning || d==ModDestination::Transpose ||
           d==ModDestination::PortaTime || d==ModDestination::EnvelopeScaling ||
           d==ModDestination::LfoScaling || d==ModDestination::Swing;
}
bool validModulation(const ModulationState& s,const std::array<OscillatorModuleState,16>& modules) noexcept {
    if((s.envActiveMask&~0x7u)!=0 || (s.envActiveMask&0x1u)==0) return false;
    if((s.lfoActiveMask&~0xFu)!=0) return false;
    if((s.generatorActiveMask&~0x1Fu)!=0) return false;
    if((s.performanceSourceActiveMask&~0x3u)!=0) return false;
    for(const auto* curve:{&s.velocityCurve,&s.noteCurve}) {
        if(curve->pointCount<2 || curve->pointCount>curve->points.size()) return false;
        float previous=-1.0f;
        for(std::size_t i=0;i<curve->pointCount;++i) {
            const auto& p=curve->points[i];
            if(!range(p.x,0.0f,1.0f)||!range(p.y,0.0f,1.0f)||!range(p.curve,-1.0f,1.0f)) return false;
            if(i>0 && p.x<=previous) return false;
            previous=p.x;
        }
        if(std::abs(curve->points[0].x)>1.0e-6f ||
           std::abs(curve->points[curve->pointCount-1].x-1.0f)>1.0e-6f) return false;
    }
    for(std::size_t i=0;i<4;++i) if(!validLfo(lfoSettings(s,i))) return false;
    if(!validEnvelope(s.env2) || !validEnvelope(s.env3)) return false;
    for(float c:s.env1Curves) if(!range(c,-1.f,1.f)) return false;
    if(!range(s.random.rateHz,.01f,40.f) ||
       !range(s.random.smoothing,0.f,1.f) ||
       !range(s.random.hold,0.f,.98f) ||
       !range(s.random.delaySeconds,0.f,5.f) ||
       !range(s.function.rateHz,.01f,40.f) || !range(s.function.curve,-1.f,1.f) ||
       !range(s.chaos.rateHz,.01f,40.f) ||
       !range(s.chaos.chaos,0.f,1.f) || !range(s.chaos.flow,0.f,1.f) ||
       !range(s.chaos.damping,0.f,1.f) || !range(s.chaos.warp,0.f,1.f) ||
       !range(s.chaos.smoothing,0.f,1.f) ||
       !(s.chaos.axis==ChaosAxis::X || s.chaos.axis==ChaosAxis::Y || s.chaos.axis==ChaosAxis::Z) ||
       !(s.chaos.method==ChaosMethod::Lorenz || s.chaos.method==ChaosMethod::Rossler ||
         s.chaos.method==ChaosMethod::Thomas) ||
       !range(s.drift.rateHz,.01f,40.f) ||
       !range(s.sequencer.rateHz,.01f,40.f) || s.sequencer.activeSteps<1 || s.sequencer.activeSteps>s.sequencer.steps.size() ||
       !(s.sequencer.direction==SequenceDirection::Forward || s.sequencer.direction==SequenceDirection::Reverse || s.sequencer.direction==SequenceDirection::PingPong)) return false;
    for(float step:s.sequencer.steps) if(!range(step,-1.f,1.f)) return false;
    for(float probability:s.sequencer.probability) if(!range(probability,0.f,1.f)) return false;
    for(auto ratchet:s.sequencer.ratchets) if(ratchet<1u || ratchet>4u) return false;
    if(!range(s.sequencer.humanize,0.f,.35f)) return false;
    for(float v:s.macros) if(!range(v,0,1)) return false;
    // N04 operators: unique ids below nextOperatorId, known types, bounded
    // parameters, inputs that reference canonical sources or existing
    // operators, and no cycles (the control graph is a DAG).
    if(s.nextOperatorId==0) return false;
    for(std::size_t i=0;i<s.operators.size();++i) {
        const auto& op=s.operators[i];
        if(!op.id) continue;
        const auto* info=controlOpInfo(op.type);
        if(info==nullptr || op.id>=s.nextOperatorId) return false;
        for(std::size_t j=0;j<i;++j) if(s.operators[j].id==op.id) return false;
        for(std::size_t p=0;p<controlOpParameterCount;++p) {
            if(!std::isfinite(op.params[p])) return false;
            if(p<info->parameterCount && !range(op.params[p],info->parameters[p].minimum,info->parameters[p].maximum)) return false;
            if(p>=info->parameterCount && op.params[p]!=0.0f) return false;
        }
        for(std::size_t k=0;k<op.inputs.size();++k) {
            const auto& in=op.inputs[k];
            if(k>=info->inputs && in.kind!=ControlInput::Kind::None) return false;
            if(in.kind==ControlInput::Kind::None) { if(in.source!=ModSource::None || in.op!=0) return false; }
            else if(in.kind==ControlInput::Kind::Source) {
                // Canonical sources are CONTROL: never into a GATE / EVENT input.
                if(!known(in.source) || in.op!=0 || info->inputSignals[k]!=ControlSignal::Control) return false;
            } else if(in.kind==ControlInput::Kind::Operator) {
                const auto* upstream=findControlOperator(s,in.op);
                if(in.source!=ModSource::None || in.op==op.id || upstream==nullptr) return false;
                const auto* upstreamInfo=controlOpInfo(upstream->type);
                // Strict typing: CONTROL->CONTROL, GATE->GATE, EVENT->EVENT only.
                if(upstreamInfo==nullptr || upstreamInfo->output!=info->inputSignals[k]) return false;
                if(controlOperatorReaches(s,op.id,in.op)) return false; // would close a cycle
            } else return false;
        }
    }
    std::uint32_t previous=0;bool empty=false;
    if(s.nextRouteId==0) return false;
    for(const auto& r:s.routes) {
        if(!r.id) {empty=true;continue;}
        if(empty || r.id<=previous || r.id>=s.nextRouteId || !range(r.amount,-1,1)) return false;
        if(isOperatorSource(r.source)) {
            // Only a CONTROL output can drive a parameter (GATE / EVENT need a converter).
            const auto* op=findControlOperator(s,operatorIdOf(r.source));
            const auto* info=op ? controlOpInfo(op->type) : nullptr;
            if(info==nullptr || info->output!=ControlSignal::Control) return false;
        }
        else if(r.source!=ModSource::None && !known(r.source)) return false;
        previous=r.id;
        // Complete routes are unique per (source, destination).
        if(routeComplete(r) && routeDuplicates(s,r)) return false;
        if(r.destination.parameter==ModDestination::None) {
            if(r.destination.oscillator!=0 || r.destination.itemId!=0) return false;
        } else if(isFxDestination(r.destination.parameter)) {
            // FX graph existence is enforced by the host boundary, which prunes
            // routes whose node/parameter no longer exists.
            if(r.destination.oscillator==0 || fxAddressParameter(r.destination)==0) return false;
        } else if(isGlobalDestination(r.destination.parameter)) {
            if(r.destination.oscillator!=0) return false;
        } else {
            const auto d=r.destination.parameter;
            if(d<ModDestination::WtPosition || d>ModDestination::RouteAmount) return false;
            const OscillatorModuleState* module=nullptr;
            for(const auto& m:modules) if(m.id && m.id==r.destination.oscillator) {module=&m;break;}
            if(!module) return false;
            if(d==ModDestination::ProcessAmount) {
                if(!r.destination.itemId) return false;
                bool found=false;
                for(std::size_t i=0;i<module->processCount;++i)
                    if(module->processes[i].id==r.destination.itemId) {found=true;break;}
                if(!found) return false;
            } else if(d==ModDestination::RouteAmount) {
                if(!r.destination.itemId) return false;
                bool found=false;
                for(std::size_t i=0;i<module->routeCount;++i)
                    if(module->routes[i].id==r.destination.itemId) {found=true;break;}
                if(!found) return false;
            } else if(r.destination.itemId!=0) return false;
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
    if(d==ModDestination::Cutoff) return r.lo*static_cast<float>(dsp::fastExp2Audio(static_cast<double>(value)*9.965784284662087));
    return r.lo+value*(r.hi-r.lo);
}
float Lfo::shape(LfoShape type,double phase) noexcept {
    if(!std::isfinite(phase)) return 0;
    phase-=std::floor(phase);
    switch(type) {
        case LfoShape::Sine:return static_cast<float>(dsp::fastSinCycle(phase));
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
    if(cv>0.0f) t=static_cast<float>(dsp::fastPow01(t,1.0f+cv*4.0f));
    else if(cv<0.0f) t=1.0f-static_cast<float>(dsp::fastPow01(1.0f-t,1.0f+(-cv)*4.0f));
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
    const float exponent=static_cast<float>(dsp::fastExp2Audio(std::clamp(curve,-1.f,1.f)*2.0f));
    return std::copysign(static_cast<float>(dsp::fastPow01(std::abs(raw),exponent)),raw);
}
float FunctionGenerator::next(const FunctionSettings& s,double sampleRate) noexcept {
    const float out=shape(s.curve,phase_);
    if(std::isfinite(sampleRate) && sampleRate>0) {
        phase_+=std::clamp(double(s.rateHz),.01,40.)/sampleRate;
        phase_-=std::floor(phase_);
    }
    return out;
}

void ChaosGenerator::resetForMethod(ChaosMethod method) noexcept {
    method_=method;value_=0.0f;
    switch(method) {
        case ChaosMethod::Rossler:x_=0.1f;y_=0.0f;z_=0.0f;break;
        case ChaosMethod::Thomas:x_=0.1f;y_=0.0f;z_=-0.1f;break;
        case ChaosMethod::Lorenz:default:x_=0.11f;y_=0.0f;z_=0.0f;break;
    }
}
void ChaosGenerator::integrate(const ChaosSettings& s,float dt) noexcept {
    float dx=0.0f,dy=0.0f,dz=0.0f;
    switch(s.method) {
        case ChaosMethod::Rossler: {
            const float a=0.10f+std::clamp(s.flow,0.0f,1.0f)*0.28f;
            const float b=0.10f+std::clamp(s.damping,0.0f,1.0f)*0.30f;
            const float c=4.2f+std::clamp(s.chaos,0.0f,1.0f)*4.0f;
            dx=-y_-z_;dy=x_+a*y_;dz=b+z_*(x_-c);break;
        }
        case ChaosMethod::Thomas: {
            const float b=0.235f-std::clamp(s.chaos,0.0f,1.0f)*0.085f;
            const float coupling=0.75f+std::clamp(s.flow,0.0f,1.0f)*0.50f;
            const float loss=0.72f+std::clamp(s.damping,0.0f,1.0f)*0.56f;
            dx=coupling*std::sin(y_)-b*loss*x_;
            dy=coupling*std::sin(z_)-b*loss*y_;
            dz=coupling*std::sin(x_)-b*loss*z_;break;
        }
        case ChaosMethod::Lorenz:default: {
            const float sigma=6.0f+std::clamp(s.flow,0.0f,1.0f)*14.0f;
            const float rho=24.0f+std::clamp(s.chaos,0.0f,1.0f)*21.0f;
            const float beta=1.5f+std::clamp(s.damping,0.0f,1.0f)*5.5f;
            dx=sigma*(y_-x_);dy=x_*(rho-z_)-y_;dz=x_*y_-beta*z_;break;
        }
    }
    x_+=dx*dt;y_+=dy*dt;z_+=dz*dt;
}
float ChaosGenerator::xNormalized() const noexcept {
    if(method_==ChaosMethod::Thomas) return std::clamp(x_/3.0f,-1.0f,1.0f);
    if(method_==ChaosMethod::Rossler) return std::clamp((x_-2.0f)/12.0f,-1.0f,1.0f);
    return std::clamp(x_/24.0f,-1.0f,1.0f);
}
float ChaosGenerator::yNormalized() const noexcept {
    if(method_==ChaosMethod::Thomas) return std::clamp(y_/3.0f,-1.0f,1.0f);
    if(method_==ChaosMethod::Rossler) return std::clamp((y_+2.0f)/12.0f,-1.0f,1.0f);
    return std::clamp(y_/32.0f,-1.0f,1.0f);
}
float ChaosGenerator::zNormalized() const noexcept {
    if(method_==ChaosMethod::Thomas) return std::clamp(z_/3.0f,-1.0f,1.0f);
    if(method_==ChaosMethod::Rossler) return std::clamp((z_-6.0f)/12.0f,-1.0f,1.0f);
    return std::clamp((z_-24.0f)/24.0f,-1.0f,1.0f);
}
float ChaosGenerator::next(const ChaosSettings& s,double sampleRate) noexcept {
    if(!std::isfinite(sampleRate) || sampleRate<=0.0) return value_;
    if(s.method!=method_) resetForMethod(s.method);
    const float rate=std::clamp(s.rateHz,0.01f,40.0f);
    // Each attractor has a substantially different natural time scale.
    // RATE is a musician-facing common control, so normalize method speed
    // here rather than forcing Rossler/Thomas to feel much slower than Lorenz.
    float methodTimeScale=0.55f;
    if(s.method==ChaosMethod::Rossler) methodTimeScale=2.20f;
    else if(s.method==ChaosMethod::Thomas) methodTimeScale=4.50f;
    const float elapsed=rate*methodTimeScale/static_cast<float>(sampleRate);
    const int steps=std::clamp(static_cast<int>(std::ceil(elapsed/0.0025f)),1,384);
    const float dt=elapsed/static_cast<float>(steps);
    for(int i=0;i<steps;++i) integrate(s,dt);
    if(!std::isfinite(x_)||!std::isfinite(y_)||!std::isfinite(z_)||
       std::abs(x_)>1000.0f||std::abs(y_)>1000.0f||std::abs(z_)>1000.0f)
        resetForMethod(s.method);
    float raw=xNormalized();
    if(s.axis==ChaosAxis::Y) raw=yNormalized();
    else if(s.axis==ChaosAxis::Z) raw=zNormalized();
    const float warp=std::clamp(s.warp,0.0f,1.0f);
    if(warp>1.0e-5f) {
        const float drive=1.0f+warp*5.0f;
        raw=std::tanh(raw*drive)/std::tanh(drive);
    }
    const float smooth=std::clamp(s.smoothing,0.0f,1.0f);
    const float alpha=1.0f-smooth*0.985f;
    value_+=alpha*(raw-value_);
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
    const float alpha=dsp::fastOneMinusExpNeg((rate*2.2)/sampleRate);
    value_+=alpha*(target_-value_);
    return std::clamp(value_,-1.0f,1.0f);
}

float SequencerGenerator::next(const SequencerSettings& s,double sampleRate) noexcept {
    const std::size_t count=std::clamp<std::size_t>(s.activeSteps,1,s.steps.size());
    if(step_>=count) { step_=(s.direction==SequenceDirection::Reverse)?count-1:0; forward_=s.direction!=SequenceDirection::Reverse; finished_=false; phase_=0.0; substep_=0; }
    auto random01=[this]() noexcept { rng_=rng_*1664525u+1013904223u; return static_cast<float>(rng_&0x00ffffffu)/16777215.0f; };
    auto beginStep=[&]() noexcept { const float chance=std::clamp(s.probability[step_],0.0f,1.0f); held_=(random01()<=chance)?s.steps[step_]:0.0f; const float jitter=(random01()*2.0f-1.0f)*std::clamp(s.humanize,0.0f,0.35f); stepScale_=std::clamp(1.0+static_cast<double>(jitter),0.65,1.35); substep_=0; };
    if(phase_==0.0 && substep_==0) beginStep();
    const float out=held_;
    if(finished_ || !std::isfinite(sampleRate) || sampleRate<=0) return out;
    const auto ratchet=std::clamp<std::uint32_t>(s.ratchets[step_],1u,4u);
    phase_+=std::clamp(double(s.rateHz),.01,40.)*double(ratchet)/(sampleRate*stepScale_);
    while(phase_>=1.0) {
        phase_-=1.0; ++substep_;
        if(substep_<ratchet) { const float chance=std::clamp(s.probability[step_],0.0f,1.0f); held_=(random01()<=chance)?s.steps[step_]:0.0f; continue; }
        substep_=0;
        if(s.direction==SequenceDirection::Forward) { if(step_+1<count) ++step_; else if(s.loop) step_=0; else finished_=true; }
        else if(s.direction==SequenceDirection::Reverse) { if(step_>0) --step_; else if(s.loop) step_=count-1; else finished_=true; }
        else { if(count==1) { if(!s.loop) finished_=true; } else if(forward_) { if(step_+1<count) ++step_; else { forward_=false;step_=count-2;if(!s.loop) finished_=true; } } else { if(step_>0) --step_; else { forward_=true;step_=1;if(!s.loop) finished_=true; } } }
        if(!finished_) beginStep();
    }
    return out;
}

void CompiledModulation::compile(const ModulationState& state,const std::array<OscillatorModuleState,16>& modules,bool immediate) noexcept {
    const auto old=groups_;const auto oldCount=count_;
    count_=voiceCount_=0;fxCount_=0;fxVoice_=false;++generation_;
    voiceFilter_=false;groups_={};globalSourceUsed_.fill(false);
    voiceProcessModules_.fill(false);
    smoothingActive_=false;
    filterEnabled_=state.filterEnabled;
    // N04: operators in topological order, inputs resolved to slots, ranges
    // and execution domains propagated. Fixed arrays; no allocation.
    opCount_=globalOpCount_=voiceOpCount_=0;
    envelopeTriggerCount_=0;
    eventOps_=false;
    opRange_.fill(ControlRange::Unipolar);
    opVoice_.fill(false);
    {
        std::array<bool,operatorSlotCount> placed{};
        bool progress=true;
        while(progress) {
            progress=false;
            for(std::size_t slot=0;slot<state.operators.size();++slot) {
                const auto& op=state.operators[slot];
                if(!op.id || placed[slot] || controlOpInfo(op.type)==nullptr) continue;
                bool ready=true;
                for(const auto& in:op.inputs)
                    if(in.kind==ControlInput::Kind::Operator) {
                        const auto from=controlOperatorSlot(state,in.op);
                        if(from>=operatorSlotCount || !placed[from]) ready=false;
                    }
                if(!ready) continue;
                auto& c=ops_[opCount_++];
                c=CompiledOp{};
                c.op=op;
                c.slot=static_cast<std::uint8_t>(slot);
                const auto* info=controlOpInfo(op.type);
                std::array<bool,3> connected{};
                for(std::size_t k=0;k<op.inputs.size();++k) {
                    const auto& in=op.inputs[k];
                    if(in.kind==ControlInput::Kind::Source) {
                        const auto s=slotFor(in.source,state);
                        c.input[k]=static_cast<std::int16_t>(s);
                        c.range[k]=signedGeneratorSlot(s) ? ControlRange::Bipolar : ControlRange::Unipolar;
                        if(s<globalSourceCount) globalSourceUsed_[s]=true; else c.voice=true;
                        connected[k]=true;
                    } else if(in.kind==ControlInput::Kind::Operator) {
                        const auto from=controlOperatorSlot(state,in.op);
                        c.input[k]=static_cast<std::int16_t>(sourceSlotCount+from);
                        c.range[k]=opRange_[from];
                        c.voice=c.voice || opVoice_[from];
                        connected[k]=true;
                    }
                }
                c.prepared=prepareControlOp(op,sampleRate_);
                // Note sources and envelope targets live inside each voice.
                if(info->voiceOnly) c.voice=true;
                c.event=info->output==ControlSignal::Event;
                if(info->family) eventOps_=true;
                if(op.type==ControlOpType::EnvelopeTrigger && envelopeTriggerCount_<operatorSlotCount) {
                    envelopeTriggerSlots_[envelopeTriggerCount_]=static_cast<std::uint8_t>(slot);
                    envelopeTriggerTargets_[envelopeTriggerCount_++]=static_cast<std::uint8_t>(std::lround(op.params[0]));
                }
                opRange_[slot]=controlOpOutputRange(op,c.range[0],connected[0],c.range[1],connected[1]);
                opVoice_[slot]=c.voice;
                (c.voice ? voiceOpCount_ : globalOpCount_)++;
                placed[slot]=true;
                progress=true;
            }
        }
    }
    for(const auto& route:state.routes) {
        if(!route.id || !route.enabled || route.amount==0 || !routeComplete(route)) continue;
        if(isOperatorSource(route.source)) {
            const auto from=controlOperatorSlot(state,operatorIdOf(route.source));
            // A per-voice result never drives a global destination (no
            // voice-reduction policy exists); such a route stays inert.
            if(from>=operatorSlotCount || (opVoice_[from] && destinationIsGlobal(route.destination.parameter))) continue;
            const auto* info=controlOpInfo(state.operators[from].type);
            if(info==nullptr || info->output!=ControlSignal::Control) continue; // only CONTROL drives parameters
        }
        std::size_t slot=0;
        if(!isGlobalDestination(route.destination.parameter) && !isFxDestination(route.destination.parameter)) {
            while(slot<modules.size() && modules[slot].id!=route.destination.oscillator) ++slot;
            if(slot==modules.size()) continue;
        }
        std::size_t i=0;while(i<count_ && !(groups_[i].address==route.destination)) ++i;
        if(i==count_) {
            groups_[i].address=route.destination;
            groups_[i].slot=slot;
            groups_[i].itemSlot=0;
            const auto generic=limits(route.destination.parameter);
            groups_[i].minimum=generic.lo;
            groups_[i].maximum=generic.hi;
            if(route.destination.parameter==ModDestination::Process1Amount)
                groups_[i].minimum=dsp::oscProcessAmountMinimum(modules[slot].process1);
            else if(route.destination.parameter==ModDestination::Process2Amount)
                groups_[i].minimum=dsp::oscProcessAmountMinimum(modules[slot].process2);
            else if(route.destination.parameter==ModDestination::ProcessAmount) {
                while(groups_[i].itemSlot<modules[slot].processCount &&
                      modules[slot].processes[groups_[i].itemSlot].id!=route.destination.itemId)
                    ++groups_[i].itemSlot;
                if(groups_[i].itemSlot>=modules[slot].processCount) continue;
                groups_[i].minimum=dsp::oscProcessAmountMinimum(modules[slot].processes[groups_[i].itemSlot].type);
            } else if(route.destination.parameter==ModDestination::RouteAmount) {
                while(groups_[i].itemSlot<modules[slot].routeCount &&
                      modules[slot].routes[groups_[i].itemSlot].id!=route.destination.itemId)
                    ++groups_[i].itemSlot;
                if(groups_[i].itemSlot>=modules[slot].routeCount) continue;
            }
            ++count_;
        }
        const auto sourceSlot=slotFor(route.source,state);
        groups_[i].target[sourceSlot]+=route.amount;
        groups_[i].bipolar[sourceSlot]=route.bipolar;
        if(sourceSlot<globalSourceCount) globalSourceUsed_[sourceSlot]=true;
    }
    for(std::size_t i=0;i<count_;++i) {
        auto& g=groups_[i];g.weight=g.target;
        if(!immediate) {
            g.weight={};
            for(std::size_t j=0;j<oldCount;++j)
                if(old[j].address==g.address) {g.weight=old[j].weight;break;}
            for(std::size_t s=0;s<totalSlotCount;++s)
                if(std::abs(g.target[s]-g.weight[s])>1.0e-6f) smoothingActive_=true;
        }
        g.globalSlotCount=0;g.voiceSlotCount=0;
        for(std::size_t s=0;s<globalSourceCount;++s)
            if(g.target[s]!=0.0f || g.weight[s]!=0.0f) g.globalSlots[g.globalSlotCount++]=static_cast<std::uint8_t>(s);
        for(std::size_t s=0;s<voiceSourceCount;++s)
            if(g.target[globalSourceCount+s]!=0.0f || g.weight[globalSourceCount+s]!=0.0f) g.voiceSlots[g.voiceSlotCount++]=static_cast<std::uint8_t>(s);
        g.globalOpSlotCount=0;g.voiceOpSlotCount=0;
        for(std::size_t s=0;s<operatorSlotCount;++s)
            if(g.target[sourceSlotCount+s]!=0.0f || g.weight[sourceSlotCount+s]!=0.0f) {
                if(opVoice_[s]) g.voiceOpSlots[g.voiceOpSlotCount++]=static_cast<std::uint8_t>(s);
                else g.globalOpSlots[g.globalOpSlotCount++]=static_cast<std::uint8_t>(s);
            }
        const bool voice=g.voiceSlotCount!=0 || g.voiceOpSlotCount!=0;
        if(isFxDestination(g.address.parameter)) {
            // Evaluated once per block by fxFrame(); never written into voices.
            fxGroups_[fxCount_++]=i;
            fxVoice_=fxVoice_ || voice;
            continue;
        }
        if(voice) {
            voiceGroups_[voiceCount_++]=i;
            if(g.address.parameter==ModDestination::ProcessAmount ||
               g.address.parameter==ModDestination::Process1Amount ||
               g.address.parameter==ModDestination::Process2Amount) voiceProcessModules_[g.slot]=true;
            if(g.address.parameter==ModDestination::Cutoff || g.address.parameter==ModDestination::Resonance) voiceFilter_=true;
        }
    }
}
void CompiledModulation::advance(float alpha) noexcept {
    if(!smoothingActive_) return;
    bool stillMoving=false;
    for(std::size_t i=0;i<count_;++i) {
        for(std::size_t s=0;s<totalSlotCount;++s) {
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
        case ModDestination::MasterGain:return f.master;case ModDestination::MainTuning:return f.mainTuning;
        case ModDestination::Transpose:return f.transpose;case ModDestination::PortaTime:return f.portaTime;
        case ModDestination::EnvelopeScaling:return f.envelopeScaling;case ModDestination::LfoScaling:return f.lfoScaling;
        case ModDestination::Swing:return f.swing;
        case ModDestination::WtPosition:return m.wtPosition;
        case ModDestination::Octave:return m.octave;case ModDestination::Semitone:return m.semitone;
        case ModDestination::Fine:return m.fineCents;case ModDestination::Detune:return m.detuneCents;
        case ModDestination::Pan:return m.pan;case ModDestination::Level:return m.level;
        case ModDestination::Process1Amount:return m.process1Amount;
        case ModDestination::Process2Amount:return m.process2Amount;
        case ModDestination::Route1Amount:return m.route1Amount;
        case ModDestination::Route2Amount:return m.route2Amount;
        case ModDestination::ProcessAmount:
            return g.itemSlot<m.processCount?m.processes[g.itemSlot].amount:0.0f;
        case ModDestination::RouteAmount:
            return g.itemSlot<m.routeCount?m.routes[g.itemSlot].amount:0.0f;
        case ModDestination::FxParameter:return 0.0f; // evaluated by fxFrame()
        case ModDestination::None:return 0.0f; // incomplete routes are never compiled
    }
    return 0;
}
void CompiledModulation::write(ModulationFrame& f,const Group& g,float n) noexcept {
    if(!std::isfinite(n)) n=0.0f;
    n=std::clamp(n,0.0f,1.0f);
    float v=g.minimum+n*(g.maximum-g.minimum);
    if(g.address.parameter==ModDestination::Cutoff)
        v=g.minimum*static_cast<float>(dsp::fastExp2Audio(
            static_cast<double>(n)*std::log2(g.maximum/g.minimum)));
    auto& m=f.modules[g.slot];
    switch(g.address.parameter) {
        case ModDestination::Cutoff:f.cutoff=v;break;case ModDestination::Resonance:f.resonance=v;break;
        case ModDestination::MasterGain:f.master=v;break;case ModDestination::MainTuning:f.mainTuning=v;break;
        case ModDestination::Transpose:f.transpose=v;break;case ModDestination::PortaTime:f.portaTime=v;break;
        case ModDestination::EnvelopeScaling:f.envelopeScaling=v;break;case ModDestination::LfoScaling:f.lfoScaling=v;break;
        case ModDestination::Swing:f.swing=v;break;
        case ModDestination::WtPosition:m.wtPosition=v;break;
        case ModDestination::Octave:m.octave=v;break;case ModDestination::Semitone:m.semitone=v;break;
        case ModDestination::Fine:m.fineCents=v;break;case ModDestination::Detune:m.detuneCents=v;break;
        case ModDestination::Pan:m.pan=v;break;case ModDestination::Level:m.level=v;break;
        case ModDestination::Process1Amount:m.process1Amount=v;break;
        case ModDestination::Process2Amount:m.process2Amount=v;break;
        case ModDestination::Route1Amount:m.route1Amount=v;break;
        case ModDestination::Route2Amount:m.route2Amount=v;break;
        case ModDestination::ProcessAmount:
            if(g.itemSlot<m.processCount) m.processes[g.itemSlot].amount=v;
            break;
        case ModDestination::RouteAmount:
            if(g.itemSlot<m.routeCount) m.routes[g.itemSlot].amount=v;
            break;
        case ModDestination::FxParameter:break; // FX parameters live in the FX renderer
        case ModDestination::None:break;
    }
}
void CompiledModulation::prepare(double sampleRate) noexcept {
    sampleRate_=sampleRate>0.0 ? sampleRate : 48000.0;
    filterTable_.prepare(sampleRate);
    cachedFilterRate_=0.0;
    cachedFilterCutoff_=-1.0f;
    cachedFilterResonance_=-1.0f;
    cachedFilter_={};
}
const dsp::LowPassCoefficients& CompiledModulation::globalFilter(
    double rate,float cutoff,float resonance) const noexcept {
    const float safeCutoff=std::isfinite(cutoff)?std::clamp(cutoff,20.0f,20000.0f):8000.0f;
    const float safeRes=std::isfinite(resonance)?std::clamp(resonance,0.0f,1.0f):0.1f;
    const float cutoffKey=std::round(safeCutoff*0.25f)*4.0f;
    const float resKey=std::round(safeRes*4096.0f)/4096.0f;
    if(rate!=cachedFilterRate_ || cutoffKey!=cachedFilterCutoff_ || resKey!=cachedFilterResonance_) {
        cachedFilter_=filterTable_.make(safeCutoff,safeRes);
        cachedFilterRate_=rate;cachedFilterCutoff_=cutoffKey;cachedFilterResonance_=resKey;
    }
    return cachedFilter_;
}

namespace {
inline float routeSourceValue(std::size_t slot,float raw,bool bipolar) noexcept {
    if(!std::isfinite(raw)) return 0.0f;
    if(!signedGeneratorSlot(slot)) return raw;
    // Route depth is expressed as a fraction of the destination's full span.
    // A 100% bipolar generator therefore contributes +/- 50% of that span:
    // a destination centred at 50% traverses exactly 0..100% without spending
    // half of each LFO cycle clipped at the endpoints.
    if(bipolar) return raw*0.5f;
    return std::clamp(raw*0.5f+0.5f,0.0f,1.0f);
}
}
static_assert(modulationSourceSlotCount==CompiledModulation::totalSlotCount,"monitor slots mirror the evaluator");

// ---------------------------------------------------------------- N04 operators

namespace {
using P=ControlOpParameterInfo;
const std::array<ControlOpInfo,36>& opTable() noexcept {
    using S=ControlSignal;
    static const std::array<ControlOpInfo,36> table{{
        {ControlOpType::Add,"ADD","Math",2,0,{}},
        {ControlOpType::Subtract,"SUBTRACT","Math",2,0,{}},
        {ControlOpType::Multiply,"MULTIPLY","Math",2,0,{}},
        {ControlOpType::Min,"MIN","Math",2,0,{}},
        {ControlOpType::Max,"MAX","Math",2,0,{}},
        {ControlOpType::ScaleOffset,"SCALE / OFFSET","Shaping",1,2,{{P{"SCALE",-4.0f,4.0f,1.0f,false},P{"OFFSET",-2.0f,2.0f,0.0f,false}}}},
        {ControlOpType::Remap,"REMAP","Shaping",1,5,{{P{"IN MIN",-1.0f,1.0f,0.0f,false},P{"IN MAX",-1.0f,1.0f,1.0f,false},
                                                     P{"OUT MIN",-1.0f,1.0f,0.0f,false},P{"OUT MAX",-1.0f,1.0f,1.0f,false},
                                                     P{"CLAMP",0.0f,1.0f,1.0f,true}}}},
        {ControlOpType::Curve,"CURVE","Shaping",1,2,{{P{"MODE",0.0f,3.0f,1.0f,true},P{"AMOUNT",0.0f,1.0f,0.5f,false}}}},
        {ControlOpType::Abs,"ABS","Shaping",1,0,{}},
        {ControlOpType::Invert,"INVERT","Shaping",1,0,{}},
        {ControlOpType::Clamp,"CLAMP","Shaping",1,2,{{P{"MIN",-1.0f,1.0f,0.0f,false},P{"MAX",-1.0f,1.0f,1.0f,false}}}},
        {ControlOpType::Constant,"CONSTANT","Utility",0,1,{{P{"VALUE",-1.0f,1.0f,0.5f,false}}}},
        {ControlOpType::Smooth,"SMOOTH","Utility",1,2,{{P{"RISE",0.001f,10.0f,0.05f,false},P{"FALL",0.001f,10.0f,0.05f,false}}}},
        {ControlOpType::Quantize,"QUANTIZE","Utility",1,1,{{P{"STEPS",2.0f,64.0f,8.0f,true}}}},
        // ---- N05 EVENT / LOGIC family ------------------------------------
        {ControlOpType::Clock,"CLOCK","Sources",0,4,{{P{"SYNC",0.0f,1.0f,1.0f,true},P{"RATE",0.05f,50.0f,2.0f,false},
                                                      P{"DIVISION",0.0f,11.0f,3.0f,true},P{"PHASE",0.0f,1.0f,0.0f,false}}},
         {{S::Control,S::Control,S::Control}},S::Event,{{nullptr,nullptr,nullptr}},false,true},
        {ControlOpType::NoteOn,"NOTE ON","Sources",0,0,{},{{S::Control,S::Control,S::Control}},S::Event,{{nullptr,nullptr,nullptr}},true,true},
        {ControlOpType::NoteOff,"NOTE OFF","Sources",0,0,{},{{S::Control,S::Control,S::Control}},S::Event,{{nullptr,nullptr,nullptr}},true,true},
        {ControlOpType::NoteGate,"GATE","Sources",0,0,{},{{S::Control,S::Control,S::Control}},S::Gate,{{nullptr,nullptr,nullptr}},true,true},
        {ControlOpType::Retrigger,"RETRIGGER","Sources",0,0,{},{{S::Control,S::Control,S::Control}},S::Event,{{nullptr,nullptr,nullptr}},true,true},
        {ControlOpType::Transport,"TRANSPORT","Sources",0,1,{{P{"MODE",0.0f,1.0f,0.0f,true}}},
         {{S::Control,S::Control,S::Control}},S::Event,{{nullptr,nullptr,nullptr}},false,true},
        {ControlOpType::Threshold,"THRESHOLD","Conversion",1,2,{{P{"THRESHOLD",-1.0f,1.0f,0.5f,false},P{"HYSTERESIS",0.0f,1.0f,0.05f,false}}},
         {{S::Control,S::Control,S::Control}},S::Gate,{{"IN",nullptr,nullptr}},false,true},
        {ControlOpType::Edge,"EDGE","Conversion",1,1,{{P{"MODE",0.0f,2.0f,0.0f,true}}},
         {{S::Gate,S::Control,S::Control}},S::Event,{{"GATE",nullptr,nullptr}},false,true},
        {ControlOpType::Pulse,"PULSE","Conversion",1,1,{{P{"LENGTH",0.001f,10.0f,0.05f,false}}},
         {{S::Event,S::Control,S::Control}},S::Gate,{{"TRIG",nullptr,nullptr}},false,true},
        {ControlOpType::Compare,"COMPARE","Logic",2,2,{{P{"MODE",0.0f,5.0f,0.0f,true},P{"TOLERANCE",0.0f,0.5f,0.001f,false}}},
         {{S::Control,S::Control,S::Control}},S::Gate,{{"A","B",nullptr}},false,true},
        {ControlOpType::And,"AND","Logic",2,0,{},{{S::Gate,S::Gate,S::Control}},S::Gate,{{"A","B",nullptr}},false,true},
        {ControlOpType::Or,"OR","Logic",2,0,{},{{S::Gate,S::Gate,S::Control}},S::Gate,{{"A","B",nullptr}},false,true},
        {ControlOpType::Xor,"XOR","Logic",2,0,{},{{S::Gate,S::Gate,S::Control}},S::Gate,{{"A","B",nullptr}},false,true},
        {ControlOpType::Not,"NOT","Logic",1,0,{},{{S::Gate,S::Control,S::Control}},S::Gate,{{"GATE",nullptr,nullptr}},false,true},
        {ControlOpType::Switch,"SWITCH","Logic",3,1,{{P{"GLIDE",0.0f,1.0f,0.0f,false}}},
         {{S::Control,S::Control,S::Gate}},S::Control,{{"A","B","SELECT"}},false,true},
        {ControlOpType::SampleHold,"SAMPLE & HOLD","Stateful",2,0,{},{{S::Control,S::Event,S::Control}},S::Control,{{"VALUE","TRIG",nullptr}},false,true},
        {ControlOpType::TrackHold,"TRACK & HOLD","Stateful",2,0,{},{{S::Control,S::Gate,S::Control}},S::Control,{{"VALUE","GATE",nullptr}},false,true},
        {ControlOpType::RandomTrigger,"RANDOM","Stateful",1,3,{{P{"MIN",-1.0f,1.0f,0.0f,false},P{"MAX",-1.0f,1.0f,1.0f,false},P{"SEED",0.0f,65535.0f,1.0f,true}}},
         {{S::Event,S::Control,S::Control}},S::Control,{{"TRIG",nullptr,nullptr}},false,true},
        {ControlOpType::Toggle,"TOGGLE","Stateful",1,0,{},{{S::Event,S::Control,S::Control}},S::Gate,{{"TRIG",nullptr,nullptr}},false,true},
        {ControlOpType::Counter,"COUNTER","Stateful",1,2,{{P{"STEPS",2.0f,64.0f,8.0f,true},P{"MODE",0.0f,1.0f,0.0f,true}}},
         {{S::Event,S::Control,S::Control}},S::Control,{{"TRIG",nullptr,nullptr}},false,true},
        {ControlOpType::EnvelopeTrigger,"ENV TRIGGER","Targets",1,1,{{P{"ENVELOPE",2.0f,3.0f,2.0f,true}}},
         {{S::Event,S::Control,S::Control}},S::None,{{"TRIG",nullptr,nullptr}},true,true}
    }};
    return table;
}
float finiteOr0(float v) noexcept { return std::isfinite(v) ? v : 0.0f; }
float curveShape(ControlCurveMode mode,float x,float amount) noexcept {
    // x in [0,1]; amount 0..1 sets the strength.
    const float k=1.0f+4.0f*std::clamp(amount,0.0f,1.0f);
    switch(mode) {
    case ControlCurveMode::Linear: return x;
    case ControlCurveMode::Exponential: return std::pow(x,k);
    case ControlCurveMode::Logarithmic: return 1.0f-std::pow(1.0f-x,k);
    case ControlCurveMode::SCurve: {
        const float s=x*x*(3.0f-2.0f*x);
        return x+(s-x)*std::clamp(amount,0.0f,1.0f);
    }
    }
    return x;
}
}

const ControlOpInfo* controlOpInfo(ControlOpType type) noexcept {
    for(const auto& info:opTable()) if(info.type==type) return &info;
    return nullptr;
}

const std::array<ControlOpType,21>& controlEventOpCatalog() noexcept {
    static const std::array<ControlOpType,21> catalog{{
        ControlOpType::Clock,ControlOpType::NoteOn,ControlOpType::NoteOff,ControlOpType::NoteGate,ControlOpType::Retrigger,ControlOpType::Transport,
        ControlOpType::Threshold,ControlOpType::Edge,ControlOpType::Pulse,
        ControlOpType::Compare,ControlOpType::And,ControlOpType::Or,ControlOpType::Xor,ControlOpType::Not,ControlOpType::Switch,
        ControlOpType::SampleHold,ControlOpType::TrackHold,ControlOpType::RandomTrigger,ControlOpType::Toggle,ControlOpType::Counter,
        ControlOpType::EnvelopeTrigger}};
    return catalog;
}

const char* controlInputName(const ControlOpInfo& info,std::size_t input) noexcept {
    if(input<info.inputNames.size() && info.inputNames[input]!=nullptr) return info.inputNames[input];
    return info.inputs==1 ? "IN" : input==0 ? "A" : input==1 ? "B" : "C";
}

double clockDivisionBeats(int index) noexcept {
    static constexpr double beats[clockDivisionCount]{4.0,2.0,1.0,0.5,0.25,0.125,2.0/3.0,1.0/3.0,1.0/6.0,1.5,0.75,0.375};
    return beats[std::clamp(index,0,int(clockDivisionCount)-1)];
}

const char* clockDivisionLabel(int index) noexcept {
    static constexpr const char* labels[clockDivisionCount]{"1/1","1/2","1/4","1/8","1/16","1/32","1/4T","1/8T","1/16T","1/4D","1/8D","1/16D"};
    return labels[std::clamp(index,0,int(clockDivisionCount)-1)];
}

ControlOpPrepared prepareControlOp(const ControlOperator& op,double sampleRate) noexcept {
    ControlOpPrepared prepared;
    const double rate=sampleRate>0.0 ? sampleRate : 48000.0;
    switch(op.type) {
    case ControlOpType::Smooth:
        prepared.rise=controlSmoothingCoefficient(op.params[0],rate);
        prepared.fall=controlSmoothingCoefficient(op.params[1],rate);
        break;
    case ControlOpType::Pulse:
        prepared.pulseSamples=std::max<std::int32_t>(1,static_cast<std::int32_t>(std::lround(double(op.params[0])*rate)));
        break;
    case ControlOpType::Clock:
        prepared.clockStep=double(op.params[1])/rate;
        prepared.divisionBeats=clockDivisionBeats(static_cast<int>(std::lround(op.params[2])));
        break;
    case ControlOpType::Switch:
        prepared.switchStep=op.params[0]>0.0f ? 1.0/(double(op.params[0])*rate) : 1.0;
        break;
    default: break;
    }
    return prepared;
}

const std::array<ControlOpType,15>& controlOpCatalog() noexcept {
    static const std::array<ControlOpType,15> catalog{{
        ControlOpType::Add,ControlOpType::Subtract,ControlOpType::Multiply,ControlOpType::Min,ControlOpType::Max,
        ControlOpType::ScaleOffset,ControlOpType::Remap,ControlOpType::Curve,ControlOpType::Abs,ControlOpType::Invert,ControlOpType::Clamp,
        ControlOpType::Constant,ControlOpType::Smooth,ControlOpType::Quantize,ControlOpType::None}};
    return catalog;
}

ControlOperator makeControlOperator(ControlOpType type,std::uint32_t id) noexcept {
    ControlOperator op;
    op.id=id;
    op.type=type;
    if(const auto* info=controlOpInfo(type))
        for(std::size_t i=0;i<info->parameterCount;++i) op.params[i]=info->parameters[i].defaultValue;
    return op;
}

float controlSmoothingCoefficient(float seconds,double sampleRate) noexcept {
    if(!(seconds>0.0f) || !(sampleRate>0.0)) return 1.0f;
    return static_cast<float>(1.0-std::exp(-1.0/(static_cast<double>(seconds)*sampleRate)));
}

ControlRange controlOpOutputRange(const ControlOperator& op,ControlRange a,bool aConnected,ControlRange b,bool bConnected) noexcept {
    const auto bipolar=[](bool connected,ControlRange r){ return connected && r==ControlRange::Bipolar; };
    switch(op.type) {
    case ControlOpType::Add: case ControlOpType::Subtract: case ControlOpType::Multiply:
    case ControlOpType::Min: case ControlOpType::Max:
        return bipolar(aConnected,a) || bipolar(bConnected,b) ? ControlRange::Bipolar : ControlRange::Unipolar;
    case ControlOpType::Abs: return ControlRange::Unipolar;
    case ControlOpType::Remap: return op.params[2]<0.0f || op.params[3]<0.0f ? ControlRange::Bipolar : ControlRange::Unipolar;
    case ControlOpType::Clamp: return std::min(op.params[0],op.params[1])<0.0f ? ControlRange::Bipolar : ControlRange::Unipolar;
    case ControlOpType::Constant: return op.params[0]<0.0f ? ControlRange::Bipolar : ControlRange::Unipolar;
    case ControlOpType::Switch: return bipolar(aConnected,a) || bipolar(bConnected,b) ? ControlRange::Bipolar : ControlRange::Unipolar;
    case ControlOpType::RandomTrigger: return std::min(op.params[0],op.params[1])<0.0f ? ControlRange::Bipolar : ControlRange::Unipolar;
    case ControlOpType::Counter: return ControlRange::Unipolar;
    default:
        if(const auto* info=controlOpInfo(op.type); info!=nullptr && info->output!=ControlSignal::Control) return ControlRange::Unipolar;
        return aConnected ? a : ControlRange::Unipolar; // range-preserving unary operators (incl. S&H / T&H VALUE)
    }
}

namespace {
std::uint32_t xorshift(std::uint32_t& x) noexcept {
    if(x==0) x=0x9e3779b9u;
    x^=x<<13; x^=x>>17; x^=x<<5;
    return x;
}
std::uint32_t seedFor(float seed,std::uint32_t id) noexcept {
    // Deterministic per operator: the same preset recalls the same sequence.
    std::uint32_t h=static_cast<std::uint32_t>(std::lround(seed))*2654435761u ^ (id*0x85ebca6bu);
    h^=h>>16; h*=0x7feb352du; h^=h>>15;
    return h==0 ? 0x1234567u : h;
}
float unitRandom(std::uint32_t& x) noexcept { return float(xorshift(x)>>8)/float(1u<<24); }
}

float evaluateControlOp(const ControlOperator& op,const ControlOpInputs& in,ControlOpRuntime& state,
                        const ControlOpPrepared& prepared,const ControlEventContext& ctx) noexcept {
    float a=finiteOr0(in.value[0]),b=finiteOr0(in.value[1]),c=finiteOr0(in.value[2]);
    const bool aConnected=in.connected[0],bConnected=in.connected[1];
    const auto aRange=in.range[0];
    const auto& p=op.params;
    // Typed reads: an EVENT input fires when non-zero at this sample; a GATE
    // input is open when 1. (Typing guarantees these values are exact.)
    const auto event=[&](std::size_t i){ return in.connected[i] && in.value[i]!=0.0f; };
    const auto gate=[&](std::size_t i){ return in.connected[i] && in.value[i]>=0.5f; };
    float out=0.0f;
    switch(op.type) {
    case ControlOpType::None: out=0.0f; break;
    case ControlOpType::Add: out=(aConnected ? a : 0.0f)+(bConnected ? b : 0.0f); break;
    case ControlOpType::Subtract: out=(aConnected ? a : 0.0f)-(bConnected ? b : 0.0f); break;
    case ControlOpType::Multiply: out=(aConnected ? a : 1.0f)*(bConnected ? b : 1.0f); break;
    case ControlOpType::Min: out=aConnected && bConnected ? std::min(a,b) : aConnected ? a : bConnected ? b : 0.0f; break;
    case ControlOpType::Max: out=aConnected && bConnected ? std::max(a,b) : aConnected ? a : bConnected ? b : 0.0f; break;
    case ControlOpType::ScaleOffset: out=a*p[0]+p[1]; break;
    case ControlOpType::Remap: {
        const float span=p[1]-p[0];
        float t=span!=0.0f ? (a-p[0])/span : 0.0f; // inverted input ranges invert naturally
        if(p[4]>=0.5f) t=std::clamp(t,0.0f,1.0f);
        out=p[2]+t*(p[3]-p[2]);
        break;
    }
    case ControlOpType::Curve: {
        const auto mode=static_cast<ControlCurveMode>(std::clamp(static_cast<int>(std::lround(p[0])),0,3));
        // Shapes the nominal range: unipolar on [0,1]; bipolar odd-symmetrically on |x|.
        if(aRange==ControlRange::Bipolar) {
            const float magnitude=std::min(std::abs(a),1.0f);
            out=std::copysign(curveShape(mode,magnitude,p[1]),a);
        } else out=curveShape(mode,std::clamp(a,0.0f,1.0f),p[1]);
        break;
    }
    case ControlOpType::Abs: out=std::abs(a); break;
    case ControlOpType::Invert: out=aRange==ControlRange::Bipolar ? -a : 1.0f-a; break;
    case ControlOpType::Clamp: out=std::clamp(a,std::min(p[0],p[1]),std::max(p[0],p[1])); break;
    case ControlOpType::Constant: out=p[0]; break;
    case ControlOpType::Smooth:
        if(!state.initialized) { state.value=a; state.initialized=true; }
        else state.value+=(a>state.value ? prepared.rise : prepared.fall)*(a-state.value);
        out=state.value;
        break;
    case ControlOpType::Quantize: {
        const float steps=std::max(1.0f,std::round(p[0])-1.0f);
        if(aRange==ControlRange::Bipolar) out=2.0f*(std::round((a+1.0f)*0.5f*steps)/steps)-1.0f;
        else out=std::round(a*steps)/steps;
        break;
    }
    // ---- N05 sources -----------------------------------------------------
    case ControlOpType::Clock:
        if(p[0]>=0.5f) {
            // Tempo: a tick whenever the division grid cell changes (host
            // position resyncs each block; loops and jumps tick once).
            const double position=ctx.beats/prepared.divisionBeats+double(p[3]);
            const auto cell=static_cast<std::int64_t>(std::floor(position));
            if(!state.initialized) {
                state.initialized=true;
                state.index=cell;
                const double perSample=ctx.beatsPerSample/prepared.divisionBeats;
                out=position-double(cell)<perSample ? 1.0f : 0.0f; // starting exactly on the grid
            } else if(cell!=state.index) { state.index=cell; out=1.0f; }
        } else {
            // Free: RATE Hz from PHASE, independent of tempo.
            if(!state.initialized) { state.initialized=true; state.phase=double(p[3]); out=state.phase==0.0 ? 1.0f : 0.0f; }
            else {
                state.phase+=prepared.clockStep;
                if(state.phase>=1.0) { state.phase-=std::floor(state.phase); out=1.0f; }
            }
        }
        break;
    case ControlOpType::NoteOn: out=ctx.noteOn ? 1.0f : 0.0f; break;
    case ControlOpType::NoteOff: out=ctx.noteOff ? 1.0f : 0.0f; break;
    case ControlOpType::NoteGate: out=ctx.gate ? 1.0f : 0.0f; break;
    case ControlOpType::Retrigger: out=ctx.retrigger ? 1.0f : 0.0f; break;
    case ControlOpType::Transport: out=(p[0]>=0.5f ? ctx.transportStop : ctx.transportStart) ? 1.0f : 0.0f; break;
    // ---- conversion --------------------------------------------------------
    case ControlOpType::Threshold: {
        // CONTROL -> GATE with hysteresis (no chatter around the threshold).
        const float half=0.5f*p[1];
        if(!state.initialized) { state.initialized=true; state.gate=a>p[0]; }
        else if(!state.gate && a>p[0]+half) state.gate=true;
        else if(state.gate && a<p[0]-half) state.gate=false;
        out=state.gate ? 1.0f : 0.0f;
        break;
    }
    case ControlOpType::Edge: {
        // GATE transition -> EVENT. The initial previous state is closed.
        const bool now=gate(0);
        const int mode=static_cast<int>(std::lround(p[0]));
        const bool rising=now && !state.previous,falling=!now && state.previous;
        out=(mode==0 && rising) || (mode==1 && falling) || (mode==2 && (rising || falling)) ? 1.0f : 0.0f;
        state.previous=now;
        break;
    }
    case ControlOpType::Pulse:
        // EVENT -> GATE open for LENGTH, starting at the event's sample.
        if(event(0)) state.counter=prepared.pulseSamples;
        out=state.counter>0 ? 1.0f : 0.0f;
        if(state.counter>0) --state.counter;
        break;
    // ---- logic -----------------------------------------------------------
    case ControlOpType::Compare: {
        const float x=aConnected ? a : 0.0f,y=bConnected ? b : 0.0f;
        bool result=false;
        switch(static_cast<int>(std::lround(p[0]))) {
        case 0: result=x>y; break;
        case 1: result=x<y; break;
        case 2: result=x>=y; break;
        case 3: result=x<=y; break;
        case 4: result=std::abs(x-y)<=p[1]; break; // == within TOLERANCE
        default: result=std::abs(x-y)>p[1]; break; // != beyond TOLERANCE
        }
        out=result ? 1.0f : 0.0f;
        break;
    }
    case ControlOpType::And: out=gate(0) && gate(1) ? 1.0f : 0.0f; break;
    case ControlOpType::Or: out=gate(0) || gate(1) ? 1.0f : 0.0f; break;
    case ControlOpType::Xor: out=gate(0)!=gate(1) ? 1.0f : 0.0f; break;
    case ControlOpType::Not: out=gate(0) ? 0.0f : 1.0f; break;
    case ControlOpType::Switch: {
        // SELECT closed -> A, open -> B. GLIDE 0 switches instantly (a
        // deliberate discontinuity); GLIDE > 0 crossfades over that time.
        const double target=gate(2) ? 1.0 : 0.0;
        if(!state.initialized) { state.initialized=true; state.phase=target; }
        else if(state.phase<target) state.phase=std::min(target,state.phase+prepared.switchStep);
        else if(state.phase>target) state.phase=std::max(target,state.phase-prepared.switchStep);
        const float mix=static_cast<float>(state.phase);
        out=(aConnected ? a : 0.0f)*(1.0f-mix)+(bConnected ? b : 0.0f)*mix;
        break;
    }
    // ---- stateful --------------------------------------------------------
    case ControlOpType::SampleHold:
        // The first sample captures VALUE; afterwards only a TRIG does, and it
        // captures VALUE as evaluated at the trigger's own sample.
        if(!state.initialized || event(1)) { state.value=a; state.initialized=true; }
        out=state.value;
        break;
    case ControlOpType::TrackHold:
        if(!state.initialized || gate(1)) { state.value=a; state.initialized=true; }
        out=state.value;
        break;
    case ControlOpType::RandomTrigger:
        if(!state.initialized) {
            state.initialized=true;
            state.rng=seedFor(p[2],op.id);
            state.value=p[0]+(p[1]-p[0])*unitRandom(state.rng); // a value exists from the first sample
        } else if(event(0)) state.value=p[0]+(p[1]-p[0])*unitRandom(state.rng);
        out=state.value;
        break;
    case ControlOpType::Toggle:
        if(event(0)) state.gate=!state.gate;
        out=state.gate ? 1.0f : 0.0f;
        break;
    case ControlOpType::Counter: {
        const int steps=std::max(2,static_cast<int>(std::lround(p[0])));
        if(event(0)) {
            if(p[1]>=0.5f) state.counter=std::min(state.counter+1,steps-1); // CLAMP
            else state.counter=(state.counter+1)%steps;                    // WRAP
        }
        out=float(state.counter)/float(steps-1);
        break;
    }
    case ControlOpType::EnvelopeTrigger: out=event(0) ? 1.0f : 0.0f; break;
    }
    (void)c;
    return finiteOr0(out);
}

float evaluateControlOp(const ControlOperator& op,float a,bool aConnected,ControlRange aRange,
                        float b,bool bConnected,ControlRange bRange,
                        ControlOpRuntime& state,float rise,float fall) noexcept {
    ControlOpInputs in;
    in.value={a,b,0.0f}; in.connected={aConnected,bConnected,false}; in.range={aRange,bRange,ControlRange::Unipolar};
    ControlOpPrepared prepared;
    prepared.rise=rise; prepared.fall=fall;
    return evaluateControlOp(op,in,state,prepared,ControlEventContext{});
}

const ControlOperator* findControlOperator(const ModulationState& state,std::uint32_t id) noexcept {
    if(id==0) return nullptr;
    for(const auto& op:state.operators) if(op.id==id) return &op;
    return nullptr;
}

std::size_t controlOperatorSlot(const ModulationState& state,std::uint32_t id) noexcept {
    if(id!=0) for(std::size_t i=0;i<state.operators.size();++i) if(state.operators[i].id==id) return i;
    return ModulationState::maxControlOperators;
}

bool controlOperatorReaches(const ModulationState& state,std::uint32_t from,std::uint32_t target) noexcept {
    // Iterative DFS over operator inputs, bounded by the operator capacity.
    std::array<std::uint32_t,ModulationState::maxControlOperators*3> stack{};
    std::array<bool,ModulationState::maxControlOperators> seen{};
    std::size_t top=0;
    stack[top++]=target;
    while(top>0) {
        const auto id=stack[--top];
        if(id==from) return true;
        const auto slot=controlOperatorSlot(state,id);
        if(slot>=state.operators.size() || seen[slot]) continue;
        seen[slot]=true;
        for(const auto& in:state.operators[slot].inputs)
            if(in.kind==ControlInput::Kind::Operator && top<stack.size()) stack[top++]=in.op;
    }
    return false;
}

std::size_t routeRootSources(const ModulationState& state,const ModRoute& route,std::array<ModSource,16>& out) noexcept {
    std::size_t count=0;
    const auto push=[&](ModSource s){
        for(std::size_t i=0;i<count;++i) if(out[i]==s) return;
        if(count<out.size()) out[count++]=s;
    };
    if(!isOperatorSource(route.source)) { if(route.source!=ModSource::None) push(route.source); return count; }
    std::array<std::uint32_t,ModulationState::maxControlOperators*3> stack{};
    std::array<bool,ModulationState::maxControlOperators> seen{};
    std::size_t top=0;
    stack[top++]=operatorIdOf(route.source);
    while(top>0) {
        const auto slot=controlOperatorSlot(state,stack[--top]);
        if(slot>=state.operators.size() || seen[slot]) continue;
        seen[slot]=true;
        for(const auto& in:state.operators[slot].inputs) {
            if(in.kind==ControlInput::Kind::Source) push(in.source);
            else if(in.kind==ControlInput::Kind::Operator && top<stack.size()) stack[top++]=in.op;
        }
    }
    return count;
}

std::size_t modulationSourceSlot(ModSource source,const ModulationState& state) noexcept { return slotFor(source,state); }

bool destinationIsGlobal(ModDestination d) noexcept {
    return d==ModDestination::PortaTime || d==ModDestination::LfoScaling || d==ModDestination::Swing || d==ModDestination::FxParameter;
}

namespace {
template<typename Fn> bool walkOperator(const ModulationState& state,std::uint32_t id,int depth,Fn&& visitSource) {
    // Depth-first over the operator chain (acyclic, at most capacity deep).
    if(depth>int(ModulationState::maxControlOperators)) return false;
    const auto* op=findControlOperator(state,id);
    if(op==nullptr) return false;
    bool any=false;
    for(const auto& in:op->inputs) {
        if(in.kind==ControlInput::Kind::Source) any|=visitSource(in.source);
        else if(in.kind==ControlInput::Kind::Operator) any|=walkOperator(state,in.op,depth+1,visitSource);
    }
    return any;
}
ControlRange operatorRange(const ModulationState& state,std::uint32_t id,int depth) noexcept {
    const auto* op=findControlOperator(state,id);
    if(op==nullptr || depth>int(ModulationState::maxControlOperators)) return ControlRange::Unipolar;
    std::array<ControlRange,2> range{{ControlRange::Unipolar,ControlRange::Unipolar}};
    std::array<bool,2> connected{};
    for(std::size_t i=0;i<2;++i) {
        const auto& in=op->inputs[i];
        connected[i]=in.kind!=ControlInput::Kind::None;
        if(in.kind==ControlInput::Kind::Source) range[i]=sourceRange(in.source,state);
        else if(in.kind==ControlInput::Kind::Operator) range[i]=operatorRange(state,in.op,depth+1);
    }
    return controlOpOutputRange(*op,range[0],connected[0],range[1],connected[1]);
}
}

ControlRange sourceRange(ModSource source,const ModulationState& state) noexcept {
    if(isOperatorSource(source)) return operatorRange(state,operatorIdOf(source),0);
    if(source==ModSource::None) return ControlRange::Unipolar;
    return signedGeneratorSlot(slotFor(source,state)) ? ControlRange::Bipolar : ControlRange::Unipolar;
}

bool sourceIsVoice(ModSource source,const ModulationState& state) noexcept {
    if(isOperatorSource(source)) {
        // An operator is per-voice when it is a voice-only node (note events)
        // or anything upstream is per-voice.
        std::array<std::uint32_t,ModulationState::maxControlOperators*3> stack{};
        std::array<bool,ModulationState::maxControlOperators> seen{};
        std::size_t top=0;
        stack[top++]=operatorIdOf(source);
        while(top>0) {
            const auto slot=controlOperatorSlot(state,stack[--top]);
            if(slot>=state.operators.size() || seen[slot]) continue;
            seen[slot]=true;
            const auto& op=state.operators[slot];
            if(const auto* info=controlOpInfo(op.type); info!=nullptr && info->voiceOnly) return true;
            for(const auto& in:op.inputs) {
                if(in.kind==ControlInput::Kind::Source && slotFor(in.source,state)>=CompiledModulation::globalSourceCount) return true;
                if(in.kind==ControlInput::Kind::Operator && top<stack.size()) stack[top++]=in.op;
            }
        }
        return false;
    }
    if(source==ModSource::None) return false;
    return slotFor(source,state)>=CompiledModulation::globalSourceCount;
}


bool routeDuplicates(const ModulationState& state,const ModRoute& candidate) noexcept {
    if(!routeComplete(candidate)) return false;
    for(const auto& r:state.routes)
        if(r.id!=0 && r.id!=candidate.id && r.source==candidate.source && r.destination==candidate.destination)
            return true;
    return false;
}

std::size_t mergeDuplicateRoutes(ModulationState& state) noexcept {
    std::size_t removed=0;
    for(std::size_t i=0;i<state.routes.size();++i) {
        auto& keep=state.routes[i];
        if(!keep.id || !routeComplete(keep)) continue;
        float sum=keep.enabled ? keep.amount : 0.0f;
        bool anyEnabled=keep.enabled;
        for(std::size_t j=i+1;j<state.routes.size();++j) {
            auto& other=state.routes[j];
            if(!other.id || other.source!=keep.source || !(other.destination==keep.destination)) continue;
            if(other.enabled) { sum+=other.amount; anyEnabled=true; keep.bipolar=other.bipolar; }
            other.id=0;
            ++removed;
        }
        if(anyEnabled) { keep.enabled=true; keep.amount=std::clamp(sum,-1.0f,1.0f); }
    }
    if(removed!=0) {
        std::size_t write=0;
        for(const auto& r:state.routes) if(r.id) state.routes[write++]=r;
        while(write<state.routes.size()) state.routes[write++]={};
    }
    return removed;
}

float routeContribution(const ModRoute& route,const ModulationState& state,const ModulationSourceSlots& slots) noexcept {
    if(!route.id || !route.enabled || !routeComplete(route) || route.amount==0.0f) return 0.0f;
    const auto slot=slotFor(route.source,state);
    float source=0.0f;
    if(isOperatorSource(route.source)) {
        // A bipolar operator output takes the same polarity transform as a
        // signed generator, so SCALE x1 between an LFO and its parameter is inert.
        const float raw=std::isfinite(slots[slot]) ? slots[slot] : 0.0f;
        source=sourceRange(route.source,state)==ControlRange::Bipolar
            ? (route.bipolar ? raw*0.5f : std::clamp(raw*0.5f+0.5f,0.0f,1.0f)) : raw;
    } else source=routeSourceValue(slot,slots[slot],route.bipolar);
    const float contribution=route.amount*source;
    return std::isfinite(contribution) ? std::clamp(contribution,-1.0f,1.0f) : 0.0f;
}
float CompiledModulation::operatorRouteValue(std::size_t slot,float raw,bool bipolar) const noexcept {
    if(!std::isfinite(raw)) return 0.0f;
    if(opRange_[slot]!=ControlRange::Bipolar) return raw;
    return bipolar ? raw*0.5f : std::clamp(raw*0.5f+0.5f,0.0f,1.0f);
}

float CompiledModulation::operatorInput(std::int16_t input,const std::array<float,voiceSourceCount>* voice,const ModulationFrame& f) noexcept {
    if(input<0) return 0.0f;
    const auto i=static_cast<std::size_t>(input);
    if(i<globalSourceCount) return f.globalSources[i];
    if(i<sourceSlotCount) return voice!=nullptr ? (*voice)[i-globalSourceCount] : 0.0f;
    return f.operatorOutputs[i-sourceSlotCount];
}

float CompiledModulation::runOperator(const CompiledOp& c,const std::array<float,voiceSourceCount>* voice,
                                      const ModulationFrame& f,ControlOpRuntime& state) const noexcept {
    if(state.id!=c.op.id) { state=ControlOpRuntime{}; state.id=c.op.id; } // a new operator in this slot starts fresh
    ControlOpInputs in;
    for(std::size_t k=0;k<3;++k) {
        in.value[k]=operatorInput(c.input[k],voice,f);
        in.connected[k]=c.input[k]>=0;
        in.range[k]=c.range[k];
    }
    return evaluateControlOp(c.op,in,state,c.prepared,f.events);
}

// Same-sample ordering (N05): sources -> global operators (topological) ->
// per-voice operators (topological) -> destinations -> targets. An event at
// sample N is seen by every downstream node at sample N.
void CompiledModulation::evaluateGlobalOperators(ModulationFrame& f,const std::array<float,globalSourceCount>& sources) noexcept {
    f.globalSources=sources;
    for(std::size_t i=0;i<opCount_;++i) {
        const auto& c=ops_[i];
        if(c.voice) continue;
        const float v=runOperator(c,nullptr,f,globalOpState_[c.slot]);
        f.operatorOutputs[c.slot]=v;
        if(c.event && v!=0.0f) ++globalEventCounts_[c.slot]; // monitoring only
    }
}

void CompiledModulation::evaluateVoiceOperators(ModulationFrame& f,const std::array<float,voiceSourceCount>& sources,
                                                OperatorState& state,std::array<std::uint32_t,operatorSlotCount>* counts) const noexcept {
    for(std::size_t i=0;i<opCount_;++i) {
        const auto& c=ops_[i];
        if(!c.voice) continue;
        const float v=runOperator(c,&sources,f,state[c.slot]);
        f.operatorOutputs[c.slot]=v;
        if(counts!=nullptr && c.event && v!=0.0f) ++(*counts)[c.slot];
    }
}

std::uint8_t CompiledModulation::envelopeTriggers(const ModulationFrame& f) const noexcept {
    std::uint8_t mask=0;
    for(std::size_t i=0;i<envelopeTriggerCount_;++i)
        if(f.operatorOutputs[envelopeTriggerSlots_[i]]!=0.0f) mask|=std::uint8_t(envelopeTriggerTargets_[i]==3 ? 4u : 2u);
    return mask;
}

void CompiledModulation::globalFrame(ModulationFrame& f,const std::array<float,globalSourceCount>& sources,double rate) const noexcept {
    f.filterEnabled=filterEnabled_;
    for(std::size_t i=0;i<count_;++i) {
        const auto& g=groups_[i];
        if(isFxDestination(g.address.parameter)) continue;
        const float base=std::clamp(read(f,g),g.minimum,g.maximum);
        float n=g.address.parameter==ModDestination::Cutoff
            ? std::log(base/g.minimum)/std::log(g.maximum/g.minimum)
            : (base-g.minimum)/(g.maximum-g.minimum);
        for(std::size_t k=0;k<g.globalSlotCount;++k) {
            const auto s=static_cast<std::size_t>(g.globalSlots[k]);
            const float src=routeSourceValue(s,sources[s],g.bipolar[s]);
            n+=(std::isfinite(g.weight[s])?g.weight[s]:0.0f)*src;
        }
        for(std::size_t k=0;k<g.globalOpSlotCount;++k) {
            const auto s=static_cast<std::size_t>(g.globalOpSlots[k]);
            const float w=g.weight[sourceSlotCount+s];
            n+=(std::isfinite(w)?w:0.0f)*operatorRouteValue(s,f.operatorOutputs[s],g.bipolar[sourceSlotCount+s]);
        }
        if(!std::isfinite(n)) n=0.0f;
        f.normalized[i]=std::clamp(n,-4.0f,4.0f);write(f,g,n);
    }
    if(f.filterEnabled) f.filter=globalFilter(rate,f.cutoff,f.resonance);
}
void CompiledModulation::voiceFrame(ModulationFrame& f,const std::array<float,voiceSourceCount>& sources,double /*rate*/) const noexcept {
    for(std::size_t j=0;j<voiceCount_;++j) {
        const auto i=voiceGroups_[j];const auto& g=groups_[i];
        float n=std::isfinite(f.normalized[i])?f.normalized[i]:0.0f;
        for(std::size_t k=0;k<g.voiceSlotCount;++k) {
            const auto s=static_cast<std::size_t>(g.voiceSlots[k]);
            const auto slot=globalSourceCount+s;
            const float w=g.weight[slot];
            const float src=routeSourceValue(slot,sources[s],g.bipolar[slot]);
            n+=(std::isfinite(w)?w:0.0f)*src;
        }
        for(std::size_t k=0;k<g.voiceOpSlotCount;++k) {
            const auto s=static_cast<std::size_t>(g.voiceOpSlots[k]);
            const float w=g.weight[sourceSlotCount+s];
            n+=(std::isfinite(w)?w:0.0f)*operatorRouteValue(s,f.operatorOutputs[s],g.bipolar[sourceSlotCount+s]);
        }
        if(!std::isfinite(n)) n=0.0f;write(f,g,n);
    }
    if(voiceFilter_) f.filter=filterTable_.make(f.cutoff,f.resonance);
}
void CompiledModulation::fxFrame(FxModulationOutput& out,const std::array<float,globalSourceCount>& global,
                                 const std::array<float,voiceSourceCount>* voice,
                                 const std::array<float,operatorSlotCount>* operators) const noexcept {
    out.generation=generation_;
    out.count=fxCount_;
    for(std::size_t k=0;k<fxCount_;++k) {
        const auto& g=groups_[fxGroups_[k]];
        out.bus[k]=fxAddressBus(g.address);
        out.node[k]=g.address.oscillator;
        out.parameter[k]=fxAddressParameter(g.address);
        float n=0.0f;
        for(std::size_t j=0;j<g.globalSlotCount;++j) {
            const auto s=static_cast<std::size_t>(g.globalSlots[j]);
            n+=(std::isfinite(g.weight[s])?g.weight[s]:0.0f)*routeSourceValue(s,global[s],g.bipolar[s]);
        }
        if(voice!=nullptr) {
            for(std::size_t j=0;j<g.voiceSlotCount;++j) {
                const auto s=static_cast<std::size_t>(g.voiceSlots[j]);
                const auto slot=globalSourceCount+s;
                n+=(std::isfinite(g.weight[slot])?g.weight[slot]:0.0f)*routeSourceValue(slot,(*voice)[s],g.bipolar[slot]);
            }
        }
        if(operators!=nullptr)
            for(std::size_t j=0;j<g.globalOpSlotCount;++j) {
                const auto s=static_cast<std::size_t>(g.globalOpSlots[j]);
                const float w=g.weight[sourceSlotCount+s];
                n+=(std::isfinite(w)?w:0.0f)*operatorRouteValue(s,(*operators)[s],g.bipolar[sourceSlotCount+s]);
            }
        out.offset[k]=std::isfinite(n) ? std::clamp(n,-2.0f,2.0f) : 0.0f;
    }
}
}
