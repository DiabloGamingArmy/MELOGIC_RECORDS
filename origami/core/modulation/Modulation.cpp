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
#include <cstring>
namespace mct::origami {
namespace {
// Signed generator slots (LFOs, random, function, chaos, drift, sequencer):
// raw -1..1, so routes apply a polarity transform.
inline bool signedGeneratorSlot(std::size_t slot) noexcept {
    constexpr std::size_t voice=CompiledModulation::globalSourceCount; // voice LFOs are voice sources 3..6
    return slot<=3u || (slot>=8u && slot<=12u) || (slot>=voice+3u && slot<=voice+6u);
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
    if(isMacroSource(s)) return true; // existence is checked against macroMask
    switch(s) {
        case ModSource::Env1:case ModSource::Env2:case ModSource::Env3:
        case ModSource::Lfo1:case ModSource::Lfo2:case ModSource::Lfo3:case ModSource::Lfo4:
        case ModSource::Macro1:case ModSource::Macro2:case ModSource::Macro3:case ModSource::Macro4:
        case ModSource::ModWheel:case ModSource::Velocity:case ModSource::Keytrack:case ModSource::Aftertouch:
        case ModSource::PitchBend:case ModSource::NoteGate:
        case ModSource::Random:case ModSource::Function:
        case ModSource::Chaos:case ModSource::Drift:case ModSource::Sequencer:return true;
        default:return false;
    }
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
        return CompiledModulation::sourceSlotCount+operatorOutputIndex(std::min(controlOperatorSlot(state,operatorIdOf(source)),
                                                                                ModulationState::maxControlOperators-1),
                                                                       std::min<std::size_t>(operatorPortOf(source),maxControlOutputs-1));
    if(const auto id=macroIdOf(source)) return CompiledModulation::macroSlot(id);
    constexpr std::size_t v=CompiledModulation::globalSourceCount; // first voice slot
    switch(source) {
        case ModSource::Lfo1:return state.lfo1.mode==LfoMode::Free?0u:v+3u;
        case ModSource::Lfo2:return state.lfo2.mode==LfoMode::Free?1u:v+4u;
        case ModSource::Lfo3:return state.lfo3.mode==LfoMode::Free?2u:v+5u;
        case ModSource::Lfo4:return state.lfo4.mode==LfoMode::Free?3u:v+6u;
        case ModSource::Random:return 8u;case ModSource::Function:return 9u;
        case ModSource::Chaos:return 10u;case ModSource::Drift:return 11u;case ModSource::Sequencer:return 12u;
        case ModSource::Env1:return v+0u;case ModSource::Env2:return v+1u;case ModSource::Env3:return v+2u;
        case ModSource::Velocity:return v+7u;case ModSource::ModWheel:return v+8u;
        case ModSource::Keytrack:return v+9u;case ModSource::Aftertouch:return v+10u;
        case ModSource::PitchBend:return v+11u;case ModSource::NoteGate:return v+12u;
        default:break; // None: incomplete routes are never compiled
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
bool knownModSource(ModSource s) noexcept { return known(s); }
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
        // N06: one canonical sequencer, driven only from the global domain.
        if(op.type==ControlOpType::Sequencer) {
            for(std::size_t j=0;j<i;++j) if(s.operators[j].id && s.operators[j].type==ControlOpType::Sequencer) return false;
        }
        for(std::size_t k=0;k<op.inputs.size();++k) {
            const auto& in=op.inputs[k];
            if(k>=info->inputs && in.kind!=ControlInput::Kind::None) return false;
            if(in.kind==ControlInput::Kind::None) { if(in.source!=ModSource::None || in.op!=0 || in.port!=0) return false; }
            else if(in.kind==ControlInput::Kind::Source) {
                // Canonical sources are CONTROL: never into a GATE / EVENT input.
                if(!known(in.source) || in.op!=0 || in.port!=0 || info->inputSignals[k]!=ControlSignal::Control) return false;
                if(isMacroSource(in.source) && !macroActive(s,macroIdOf(in.source))) return false; // a removed macro
            } else if(in.kind==ControlInput::Kind::Operator) {
                const auto* upstream=findControlOperator(s,in.op);
                if(in.source!=ModSource::None || in.op==op.id || upstream==nullptr) return false;
                const auto* upstreamInfo=controlOpInfo(upstream->type);
                // Strict typing: CONTROL->CONTROL, GATE->GATE, EVENT->EVENT only
                // (per output port, N06).
                if(upstreamInfo==nullptr || in.port>=upstreamInfo->outputCount ||
                   controlOutputSignalOf(*upstreamInfo,in.port)!=info->inputSignals[k]) return false;
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
            const auto port=operatorPortOf(r.source);
            if(info==nullptr || port>=info->outputCount || controlOutputSignalOf(*info,port)!=ControlSignal::Control) return false;
        }
        else if(r.source!=ModSource::None && !known(r.source)) return false;
        else if(isMacroSource(r.source) && !macroActive(s,macroIdOf(r.source))) return false; // never a dangling macro
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

float SequencerGenerator::random01() noexcept { rng_=rng_*1664525u+1013904223u; return static_cast<float>(rng_&0x00ffffffu)/16777215.0f; }

void SequencerGenerator::beginStep(const SequencerSettings& s) noexcept {
    const float chance=std::clamp(s.probability[step_],0.0f,1.0f);
    held_=(random01()<=chance)?s.steps[step_]:0.0f;
    const float jitter=(random01()*2.0f-1.0f)*std::clamp(s.humanize,0.0f,0.35f);
    stepScale_=std::clamp(1.0+static_cast<double>(jitter),0.65,1.35);
    substep_=0;
    begun_=true;
    ++stepEvents_;
}

void SequencerGenerator::stepForward(const SequencerSettings& s,std::size_t count) noexcept {
    if(s.direction==SequenceDirection::Forward) { if(step_+1<count) ++step_; else if(s.loop) step_=0; else finished_=true; }
    else if(s.direction==SequenceDirection::Reverse) { if(step_>0) --step_; else if(s.loop) step_=count-1; else finished_=true; }
    else { if(count==1) { if(!s.loop) finished_=true; } else if(forward_) { if(step_+1<count) ++step_; else { forward_=false;step_=count-2;if(!s.loop) finished_=true; } } else { if(step_>0) --step_; else { forward_=true;step_=1;if(!s.loop) finished_=true; } } }
}

std::size_t SequencerGenerator::normalize(const SequencerSettings& s) noexcept {
    const std::size_t count=std::clamp<std::size_t>(s.activeSteps,1,s.steps.size());
    if(step_>=count) { step_=(s.direction==SequenceDirection::Reverse)?count-1:0; forward_=s.direction!=SequenceDirection::Reverse; finished_=false; phase_=0.0; substep_=0; }
    return count;
}

float SequencerGenerator::next(const SequencerSettings& s,double sampleRate) noexcept {
    // Operation order is the pre-N06 one exactly (bit-identical legacy path).
    const std::size_t count=normalize(s);
    if(phase_==0.0 && substep_==0) beginStep(s);
    const float out=held_;
    if(finished_ || !std::isfinite(sampleRate) || sampleRate<=0) return out;
    const auto ratchet=std::clamp<std::uint32_t>(s.ratchets[step_],1u,4u);
    phase_+=std::clamp(double(s.rateHz),.01,40.)*double(ratchet)/(sampleRate*stepScale_);
    while(phase_>=1.0) {
        phase_-=1.0; ++substep_;
        if(substep_<ratchet) { const float chance=std::clamp(s.probability[step_],0.0f,1.0f); held_=(random01()<=chance)?s.steps[step_]:0.0f; ++stepEvents_; continue; }
        substep_=0;
        stepForward(s,count);
        if(!finished_) beginStep(s);
    }
    return out;
}

float SequencerGenerator::hold(const SequencerSettings& s) noexcept {
    // Armed (after reset / RESET, before the first ADVANCE): the start step's
    // value is shown, but the step has not begun (no STEP EVENT, no roll).
    normalize(s);
    if(!begun_) held_=s.steps[step_];
    return held_;
}

void SequencerGenerator::advance(const SequencerSettings& s) noexcept {
    const std::size_t count=normalize(s);
    // The first ADVANCE after a reset plays the start step itself.
    if(!begun_) { beginStep(s); return; }
    if(finished_) return;
    // External advance: one whole step per event (ratchets and humanize shape
    // only the internal clock); per-step probability applies when a step begins.
    stepForward(s,count);
    if(!finished_) beginStep(s);
}

void SequencerGenerator::restart(const SequencerSettings& s) noexcept {
    const std::size_t count=std::clamp<std::size_t>(s.activeSteps,1,s.steps.size());
    step_=(s.direction==SequenceDirection::Reverse)?count-1:0;
    forward_=s.direction!=SequenceDirection::Reverse;
    finished_=false; phase_=0.0; substep_=0; begun_=false;
}

bool CompiledModulation::ModulePlanKey::operator==(const ModulePlanKey& o) const noexcept {
    return id==o.id && process1==o.process1 && process2==o.process2 && processCount==o.processCount && routeCount==o.routeCount
        && processIds==o.processIds && processTypes==o.processTypes && routeIds==o.routeIds;
}

namespace {
bool sameRoute(const ModRoute& a,const ModRoute& b) noexcept {
    return a.id==b.id && a.enabled==b.enabled && a.source==b.source && a.destination==b.destination
        && std::memcmp(&a.amount,&b.amount,sizeof(float))==0 && a.bipolar==b.bipolar;
}
bool sameParams(const ControlOperator& a,const ControlOperator& b) noexcept {
    return std::memcmp(a.params.data(),b.params.data(),sizeof(float)*a.params.size())==0;
}
}

CompiledModulation::PlanChange CompiledModulation::classifyChange(const ModulationState& state,const std::array<OscillatorModuleState,16>& modules) const noexcept {
    const auto& k=planKey_;
    if(!k.valid || k.sampleRate!=sampleRate_ || k.filterEnabled!=state.filterEnabled) return PlanChange::Topology;
    for(std::size_t i=0;i<4;++i) if(k.lfoModes[i]!=lfoSettings(state,i).mode) return PlanChange::Topology;
    for(std::size_t i=0;i<state.routes.size();++i) if(!sameRoute(k.routes[i],state.routes[i])) return PlanChange::Topology;
    for(std::size_t i=0;i<modules.size();++i) {
        ModulePlanKey m;
        const auto& s=modules[i];
        m.id=s.id; m.process1=s.process1; m.process2=s.process2; m.processCount=s.processCount; m.routeCount=s.routeCount;
        for(std::size_t p=0;p<s.processCount && p<maxOscProcesses;++p) { m.processIds[p]=s.processes[p].id; m.processTypes[p]=s.processes[p].type; }
        for(std::size_t r=0;r<s.routeCount && r<maxOscRoutes;++r) m.routeIds[r]=s.routes[r].id;
        if(!(m==k.modules[i])) return PlanChange::Topology;
    }
    bool params=false;
    for(std::size_t i=0;i<state.operators.size();++i) {
        const auto& a=k.operators[i]; const auto& b=state.operators[i];
        if(a.id!=b.id || a.type!=b.type || !(a.inputs==b.inputs)) return PlanChange::Topology;
        if(!sameParams(a,b)) params=true;
    }
    return params ? PlanChange::Parameters : PlanChange::None;
}

void CompiledModulation::storePlanKey(const ModulationState& state,const std::array<OscillatorModuleState,16>& modules) noexcept {
    auto& k=planKey_;
    k.valid=true; k.sampleRate=sampleRate_; k.filterEnabled=state.filterEnabled;
    for(std::size_t i=0;i<4;++i) k.lfoModes[i]=lfoSettings(state,i).mode;
    k.routes=state.routes; k.operators=state.operators;
    for(std::size_t i=0;i<modules.size();++i) {
        auto& m=k.modules[i]; m=ModulePlanKey{};
        const auto& s=modules[i];
        m.id=s.id; m.process1=s.process1; m.process2=s.process2; m.processCount=s.processCount; m.routeCount=s.routeCount;
        for(std::size_t p=0;p<s.processCount && p<maxOscProcesses;++p) { m.processIds[p]=s.processes[p].id; m.processTypes[p]=s.processes[p].type; }
        for(std::size_t r=0;r<s.routeCount && r<maxOscRoutes;++r) m.routeIds[r]=s.routes[r].id;
    }
}

bool CompiledModulation::updateParameters(const ModulationState& state) noexcept {
    // Pass 1 (no mutation): every changed operator must keep its output ranges
    // (ranges flow into downstream inputs and route polarity), and envelope
    // targets are compiled tables, so they force a full compile.
    for(std::size_t i=0;i<opCount_;++i) {
        const auto& c=ops_[i];
        const auto& next=state.operators[c.slot];
        if(sameParams(c.op,next)) continue;
        if(c.op.type==ControlOpType::EnvelopeTrigger) return false;
        auto probe=c.op; probe.params=next.params;
        const bool a=c.input[0]>=0,b=c.input[1]>=0;
        for(std::size_t port=0;port<c.outputCount;++port)
            if(controlOpOutputRangeAt(probe,port,c.range[0],a,c.range[1],b)!=outputRange_[operatorOutputIndex(c.slot,port)]) return false;
    }
    // Pass 2: apply. Runtime state is kept (same operators, same connections).
    for(std::size_t i=0;i<opCount_;++i) {
        auto& c=ops_[i];
        const auto& next=state.operators[c.slot];
        if(sameParams(c.op,next)) continue;
        c.op.params=next.params;
        c.prepared=prepareControlOp(c.op,sampleRate_);
        resolveKernel(c,{{c.input[0]>=0,c.input[1]>=0,c.input[2]>=0}});
    }
    return true;
}

void CompiledModulation::compile(const ModulationState& state,const std::array<OscillatorModuleState,16>& modules,bool immediate) noexcept {
    if(!immediate) {
        const auto change=classifyChange(state,modules);
        if(change==PlanChange::None) { ++counters_.skipped; return; }
        if(change==PlanChange::Parameters && updateParameters(state)) {
            planKey_.operators=state.operators;
            ++counters_.parameterUpdates;
            return;
        }
    }
    storePlanKey(state,modules);
    ++counters_.compiles;
    const auto old=groups_;const auto oldCount=count_;
    count_=voiceCount_=0;fxCount_=0;fxVoice_=false;++generation_;
    voiceFilter_=false;groups_={};globalSourceUsed_.fill(false);voiceSourceUsed_.fill(false);
    voiceProcessModules_.fill(false);
    voiceModuleMask_=0;
    smoothingActive_=false;
    filterEnabled_=state.filterEnabled;
    // N04: operators in topological order, inputs resolved to slots, ranges
    // and execution domains propagated. Fixed arrays; no allocation.
    opCount_=globalOpCount_=voiceOpCount_=0;
    envelopeTriggerCount_=0;
    eventOps_=false;
    outputRange_.fill(ControlRange::Unipolar);
    opVoice_.fill(false);
    const auto oldRouted=routedOutput_;const auto oldRoutedCount=routedCount_;
    routedCount_=0;
    sequencerNode_=false;
    std::size_t sequencerSlot=operatorSlotCount;
    for(std::size_t slot=0;slot<state.operators.size();++slot)
        if(state.operators[slot].id && state.operators[slot].type==ControlOpType::Sequencer) { sequencerSlot=slot; break; }
    {
        std::array<bool,operatorSlotCount> placed{};
        bool progress=true;
        while(progress) {
            progress=false;
            for(std::size_t slot=0;slot<state.operators.size();++slot) {
                const auto& op=state.operators[slot];
                if(!op.id || placed[slot] || controlOpInfo(op.type)==nullptr) continue;
                bool ready=true;
                for(const auto& in:op.inputs) {
                    if(in.kind==ControlInput::Kind::Operator) {
                        const auto from=controlOperatorSlot(state,in.op);
                        if(from>=operatorSlotCount || !placed[from]) ready=false;
                    }
                    // N06: a SEQ source read waits for the SEQUENCER node (same-sample value).
                    if(in.kind==ControlInput::Kind::Source && in.source==ModSource::Sequencer &&
                       sequencerSlot<operatorSlotCount && sequencerSlot!=slot && !placed[sequencerSlot]) ready=false;
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
                        if(s<globalSourceCount) globalSourceUsed_[s]=true; else { c.voice=true; voiceSourceUsed_[s-globalSourceCount]=true; }
                        connected[k]=true;
                    } else if(in.kind==ControlInput::Kind::Operator) {
                        const auto from=controlOperatorSlot(state,in.op);
                        const auto output=operatorOutputIndex(from,std::min<std::size_t>(in.port,maxControlOutputs-1));
                        c.input[k]=static_cast<std::int16_t>(sourceSlotCount+output);
                        c.range[k]=outputRange_[output];
                        if(!opVoice_[from]) c.globalOperatorInputs|=std::uint8_t(1u<<k);
                        c.voice=c.voice || opVoice_[from];
                        connected[k]=true;
                    }
                }
                c.prepared=prepareControlOp(op,sampleRate_);
                resolveKernel(c,connected);
                // Note sources and envelope targets live inside each voice.
                if(info->voiceOnly) c.voice=true;
                c.event=info->output==ControlSignal::Event;
                c.outputCount=info->outputCount;
                for(std::size_t port=0;port<info->outputCount;++port)
                    if(controlOutputSignalOf(*info,port)==ControlSignal::Event) c.eventPorts|=std::uint8_t(1u<<port);
                if(info->family) eventOps_=true;
                if(op.type==ControlOpType::Sequencer) {
                    // The canonical sequencer is global (a voice-domain input never drives it).
                    if(c.voice) { --opCount_; placed[slot]=true; progress=true; continue; }
                    sequencerNode_=true;
                }
                if(op.type==ControlOpType::EnvelopeTrigger && envelopeTriggerCount_<operatorSlotCount) {
                    envelopeTriggerSlots_[envelopeTriggerCount_]=static_cast<std::uint8_t>(slot);
                    envelopeTriggerTargets_[envelopeTriggerCount_++]=static_cast<std::uint8_t>(std::lround(op.params[0]));
                }
                for(std::size_t port=0;port<info->outputCount;++port)
                    outputRange_[operatorOutputIndex(slot,port)]=controlOpOutputRangeAt(op,port,c.range[0],connected[0],c.range[1],connected[1]);
                if(c.voice) voiceOrder_[voiceOpCount_]=static_cast<std::uint8_t>(opCount_-1);
                else globalOrder_[globalOpCount_]=static_cast<std::uint8_t>(opCount_-1);
                opVoice_[slot]=c.voice;
                (c.voice ? voiceOpCount_ : globalOpCount_)++;
                placed[slot]=true;
                progress=true;
            }
        }
    }
    // N06: the operator outputs that drive routes get compact group slots
    // (ascending output index), so groups stay 26 + 32 wide.
    const auto routeOutput=[&](const ModRoute& route)->std::size_t {
        const auto from=controlOperatorSlot(state,operatorIdOf(route.source));
        const auto port=operatorPortOf(route.source);
        if(from>=operatorSlotCount || !state.operators[from].id) return operatorOutputSlotCount;
        const auto* info=controlOpInfo(state.operators[from].type);
        // Only a CONTROL output drives parameters; a per-voice result never
        // drives a global destination (no voice-reduction policy exists).
        if(info==nullptr || port>=info->outputCount || controlOutputSignalOf(*info,port)!=ControlSignal::Control) return operatorOutputSlotCount;
        if(opVoice_[from] && destinationIsGlobal(route.destination.parameter)) return operatorOutputSlotCount;
        bool compiled=false;
        for(std::size_t i=0;i<opCount_;++i) if(ops_[i].slot==from) { compiled=true; break; }
        return compiled ? operatorOutputIndex(from,port) : operatorOutputSlotCount;
    };
    {
        std::array<bool,operatorOutputSlotCount> used{};
        for(const auto& route:state.routes)
            if(route.id && route.enabled && route.amount!=0 && routeComplete(route) && isOperatorSource(route.source))
                if(const auto o=routeOutput(route); o<operatorOutputSlotCount) used[o]=true;
        for(std::size_t o=0;o<operatorOutputSlotCount && routedCount_<operatorSlotCount;++o)
            if(used[o]) {
                routedOutput_[routedCount_]=static_cast<std::uint8_t>(o);
                routedRange_[routedCount_]=outputRange_[o];
                routedVoice_[routedCount_]=opVoice_[o/maxControlOutputs];
                ++routedCount_;
            }
    }
    const auto groupSlotFor=[&](const ModRoute& route)->std::size_t {
        if(!isOperatorSource(route.source)) return slotFor(route.source,state);
        const auto o=routeOutput(route);
        for(std::size_t r=0;r<routedCount_;++r) if(routedOutput_[r]==o) return sourceSlotCount+r;
        return totalSlotCount;
    };
    for(const auto& route:state.routes) {
        if(!route.id || !route.enabled || route.amount==0 || !routeComplete(route)) continue;
        if(isOperatorSource(route.source) && groupSlotFor(route)>=totalSlotCount) continue;
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
        const auto sourceSlot=groupSlotFor(route);
        groups_[i].target[sourceSlot]+=route.amount;
        groups_[i].bipolar[sourceSlot]=route.bipolar;
        if(sourceSlot<globalSourceCount) globalSourceUsed_[sourceSlot]=true;
        else if(sourceSlot<sourceSlotCount) voiceSourceUsed_[sourceSlot-globalSourceCount]=true;
    }
    for(std::size_t i=0;i<count_;++i) {
        auto& g=groups_[i];g.weight=g.target;
        g.logSpan=std::log(g.maximum/g.minimum);
        g.log2Span=std::log2(g.maximum/g.minimum);
        if(!immediate) {
            g.weight={};
            for(std::size_t j=0;j<oldCount;++j)
                if(old[j].address==g.address) {
                    g.weight=old[j].weight;
                    // Routed operator slots are compact: carry weights by output index.
                    for(std::size_t r=0;r<operatorSlotCount;++r) g.weight[sourceSlotCount+r]=0.0f;
                    for(std::size_t r=0;r<routedCount_;++r)
                        for(std::size_t q=0;q<oldRoutedCount;++q)
                            if(oldRouted[q]==routedOutput_[r]) { g.weight[sourceSlotCount+r]=old[j].weight[sourceSlotCount+q]; break; }
                    break;
                }
            for(std::size_t s=0;s<totalSlotCount;++s)
                if(std::abs(g.target[s]-g.weight[s])>1.0e-6f) smoothingActive_=true;
        }
        g.globalSlotCount=0;g.voiceSlotCount=0;
        for(std::size_t s=0;s<globalSourceCount;++s)
            if(g.target[s]!=0.0f || g.weight[s]!=0.0f) g.globalSlots[g.globalSlotCount++]=static_cast<std::uint8_t>(s);
        for(std::size_t s=0;s<voiceSourceCount;++s)
            if(g.target[globalSourceCount+s]!=0.0f || g.weight[globalSourceCount+s]!=0.0f) g.voiceSlots[g.voiceSlotCount++]=static_cast<std::uint8_t>(s);
        g.globalOpSlotCount=0;g.voiceOpSlotCount=0;
        for(std::size_t s=0;s<routedCount_;++s)
            if(g.target[sourceSlotCount+s]!=0.0f || g.weight[sourceSlotCount+s]!=0.0f) {
                if(routedVoice_[s]) g.voiceOpSlots[g.voiceOpSlotCount++]=static_cast<std::uint8_t>(s);
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
            if(!isGlobalDestination(g.address.parameter)) voiceModuleMask_|=std::uint16_t(1u<<g.slot);
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
            static_cast<double>(n)*g.log2Span));
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
static_assert(modulationSourceSlotCount==CompiledModulation::sourceSlotCount+operatorOutputSlotCount,"monitor slots mirror the evaluator outputs");

// ---------------------------------------------------------------- N04 operators

namespace {
using P=ControlOpParameterInfo;
const std::array<ControlOpInfo,45>& opTable() noexcept {
    using S=ControlSignal;
    static const std::array<ControlOpInfo,45> table{{
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
        // N06: RANDOM, TOGGLE and COUNTER gain a RESET input (applied before
        // the sample's TRIG / ADVANCE); COUNTER gains a WRAP event output.
        {ControlOpType::RandomTrigger,"RANDOM","Stateful",2,3,{{P{"MIN",-1.0f,1.0f,0.0f,false},P{"MAX",-1.0f,1.0f,1.0f,false},P{"SEED",0.0f,65535.0f,1.0f,true}}},
         {{S::Event,S::Event,S::Control}},S::Control,{{"TRIG","RESET",nullptr}},false,true},
        {ControlOpType::Toggle,"TOGGLE","Stateful",2,0,{},{{S::Event,S::Event,S::Control}},S::Gate,{{"TRIG","RESET",nullptr}},false,true},
        {ControlOpType::Counter,"COUNTER","Stateful",2,2,{{P{"LENGTH",2.0f,64.0f,8.0f,true},P{"MODE",0.0f,2.0f,0.0f,true}}},
         {{S::Event,S::Event,S::Control}},S::Control,{{"ADVANCE","RESET",nullptr}},false,true,2,{{S::Event,S::None,S::None}},{{"VALUE","WRAP",nullptr,nullptr}}},
        {ControlOpType::EnvelopeTrigger,"ENV TRIGGER","Targets",1,1,{{P{"ENVELOPE",2.0f,3.0f,2.0f,true}}},
         {{S::Event,S::Control,S::Control}},S::None,{{"TRIG",nullptr,nullptr}},true,true},
        // ---- N06 SEQUENCING / GENERATIVE --------------------------------
        {ControlOpType::ClockDivider,"CLOCK DIVIDER","Sequencing",2,0,{},{{S::Event,S::Event,S::Control}},S::Event,{{"CLOCK","RESET",nullptr}},false,true,
         4,{{S::Event,S::Event,S::Event}},{{"/2","/4","/8","/16"}}},
        {ControlOpType::EventDelay,"EVENT DELAY","Sequencing",1,3,{{P{"SYNC",0.0f,1.0f,0.0f,true},P{"TIME",1.0f,2000.0f,100.0f,false},P{"DIVISION",0.0f,11.0f,3.0f,true}}},
         {{S::Event,S::Control,S::Control}},S::Event,{{"IN",nullptr,nullptr}},false,true},
        {ControlOpType::Probability,"PROBABILITY","Generative",1,2,{{P{"CHANCE",0.0f,1.0f,0.5f,false},P{"SEED",0.0f,65535.0f,1.0f,true}}},
         {{S::Event,S::Control,S::Control}},S::Event,{{"IN",nullptr,nullptr}},false,true},
        {ControlOpType::ChanceSplit,"CHANCE SPLIT","Generative",1,2,{{P{"A CHANCE",0.0f,1.0f,0.5f,false},P{"SEED",0.0f,65535.0f,1.0f,true}}},
         {{S::Event,S::Control,S::Control}},S::Event,{{"IN",nullptr,nullptr}},false,true,2,{{S::Event,S::None,S::None}},{{"A","B",nullptr,nullptr}}},
        {ControlOpType::EventMerge,"EVENT MERGE","Sequencing",3,0,{},{{S::Event,S::Event,S::Event}},S::Event,{{"A","B","C"}},false,true},
        {ControlOpType::Euclidean,"EUCLIDEAN","Sequencing",2,3,{{P{"STEPS",1.0f,32.0f,8.0f,true},P{"PULSES",0.0f,32.0f,3.0f,true},P{"ROTATION",0.0f,31.0f,0.0f,true}}},
         {{S::Event,S::Event,S::Control}},S::Event,{{"CLOCK","RESET",nullptr}},false,true},
        {ControlOpType::Pattern,"PATTERN","Sequencing",2,3,{{P{"LENGTH",1.0f,32.0f,8.0f,true},P{"STEPS 1-16",0.0f,65535.0f,85.0f,true},P{"STEPS 17-32",0.0f,65535.0f,0.0f,true}}},
         {{S::Event,S::Event,S::Control}},S::Event,{{"CLOCK","RESET",nullptr}},false,true},
        {ControlOpType::RandomWalk,"RANDOM WALK","Generative",2,5,{{P{"STEP",0.001f,1.0f,0.1f,false},P{"MIN",-1.0f,1.0f,0.0f,false},P{"MAX",-1.0f,1.0f,1.0f,false},
                                                                   P{"SEED",0.0f,65535.0f,1.0f,true},P{"MODE",0.0f,1.0f,0.0f,true}}},
         {{S::Event,S::Event,S::Control}},S::Control,{{"TRIG","RESET",nullptr}},false,true},
        {ControlOpType::Sequencer,"SEQUENCER","Sequencing",2,1,{{P{"CLOCK",0.0f,1.0f,0.0f,true}}},
         {{S::Event,S::Event,S::Control}},S::Control,{{"ADVANCE","RESET",nullptr}},false,true,3,{{S::Control,S::Event,S::None}},
         {{"VALUE","STEP","STEP EVENT",nullptr}},true}
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

const std::array<ControlOpType,9>& controlSequencingOpCatalog() noexcept {
    static const std::array<ControlOpType,9> catalog{{
        ControlOpType::Sequencer,ControlOpType::ClockDivider,ControlOpType::EventDelay,ControlOpType::Euclidean,ControlOpType::Pattern,
        ControlOpType::EventMerge,ControlOpType::Probability,ControlOpType::ChanceSplit,ControlOpType::RandomWalk}};
    return catalog;
}

ControlSignal controlOutputSignalOf(const ControlOpInfo& info,std::size_t port) noexcept {
    if(port==0) return info.output;
    if(port>=info.outputCount || port>info.extraOutputs.size()) return ControlSignal::None;
    return info.extraOutputs[port-1];
}

const char* controlOutputName(const ControlOpInfo& info,std::size_t port) noexcept {
    if(port<info.outputNames.size() && info.outputNames[port]!=nullptr) return info.outputNames[port];
    return "OUT";
}

bool euclideanHit(int steps,int pulses,int rotation,int index) noexcept {
    // Even distribution of `pulses` over `steps` (a rotation of the Bjorklund
    // pattern): step i is a hit when (i * pulses) mod steps < pulses.
    if(steps<1) return false;
    pulses=std::clamp(pulses,0,steps);
    const int i=((index+rotation)%steps+steps)%steps;
    return (i*pulses)%steps<pulses;
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
    case ControlOpType::EventDelay:
        prepared.delaySamples=std::max<std::int32_t>(1,static_cast<std::int32_t>(std::lround(double(op.params[1])*0.001*rate)));
        prepared.divisionBeats=clockDivisionBeats(static_cast<int>(std::lround(op.params[2])));
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
    case ControlOpType::RandomWalk: return std::min(op.params[1],op.params[2])<0.0f ? ControlRange::Bipolar : ControlRange::Unipolar;
    case ControlOpType::Sequencer: return ControlRange::Bipolar; // SEQ step values are -1..1 (as the SEQ source)
    default:
        if(const auto* info=controlOpInfo(op.type); info!=nullptr && info->output!=ControlSignal::Control) return ControlRange::Unipolar;
        return aConnected ? a : ControlRange::Unipolar; // range-preserving unary operators (incl. S&H / T&H VALUE)
    }
}

ControlRange controlOpOutputRangeAt(const ControlOperator& op,std::size_t port,ControlRange a,bool aConnected,ControlRange b,bool bConnected) noexcept {
    if(port==0) return controlOpOutputRange(op,a,aConnected,b,bConnected);
    return ControlRange::Unipolar; // extra ports: EVENTs, or the 0..1 STEP position
}

namespace {
std::uint32_t xorshift(std::uint32_t& x) noexcept {
    if(x==0) x=0x9e3779b9u;
    x^=x<<13; x^=x>>17; x^=x<<5;
    return x;
}
std::uint32_t seedFor(float seed,std::uint32_t id,std::uint32_t voiceSeed=0) noexcept {
    // Deterministic per operator: the same preset recalls the same sequence.
    std::uint32_t h=static_cast<std::uint32_t>(std::lround(seed))*2654435761u ^ (id*0x85ebca6bu);
    h^=h>>16; h*=0x7feb352du; h^=h>>15;
    if(voiceSeed!=0) { // N07: a distinct, repeatable stream per voice lifecycle
        h^=voiceSeed*0x9e3779b9u; h^=h>>16; h*=0x85ebca6bu; h^=h>>13;
    }
    return h==0 ? 0x1234567u : h;
}
float unitRandom(std::uint32_t& x) noexcept { return float(xorshift(x)>>8)/float(1u<<24); }
}

float evaluateControlOp(const ControlOperator& op,const ControlOpInputs& in,ControlOpRuntime& state,
                        const ControlOpPrepared& prepared,const ControlEventContext& ctx) noexcept {
    std::array<float,maxControlOutputs> outputs{};
    evaluateControlOpOutputs(op,in,state,prepared,ctx,outputs);
    return outputs[0];
}

void evaluateControlOpOutputs(const ControlOperator& op,const ControlOpInputs& in,ControlOpRuntime& state,
                              const ControlOpPrepared& prepared,const ControlEventContext& ctx,
                              std::array<float,maxControlOutputs>& outputs) noexcept {
    outputs.fill(0.0f);
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
        // RESET (input B) restarts the seeded sequence before TRIG is seen.
        if(!state.initialized || event(1)) {
            state.initialized=true;
            state.rng=seedFor(p[2],op.id,ctx.voiceSeed);
            state.value=p[0]+(p[1]-p[0])*unitRandom(state.rng); // a value exists from the first sample
        }
        if(event(0)) state.value=p[0]+(p[1]-p[0])*unitRandom(state.rng);
        out=state.value;
        break;
    case ControlOpType::Toggle:
        if(event(1)) state.gate=false; // RESET first...
        if(event(0)) state.gate=!state.gate; // ...then TRIG
        out=state.gate ? 1.0f : 0.0f;
        break;
    case ControlOpType::Counter: {
        // VALUE = position / (LENGTH - 1): 0, 1/3, 2/3, 1 for LENGTH 4.
        const int length=std::max(2,static_cast<int>(std::lround(p[0])));
        const int mode=static_cast<int>(std::lround(p[1]));
        bool wrap=false;
        if(event(1)) { state.counter=0; state.forward=true; } // RESET first, then ADVANCE
        if(event(0)) {
            if(mode==1) {                                         // CLAMP: WRAP fires on reaching the end
                if(state.counter<length-1) { ++state.counter; wrap=state.counter==length-1; }
            } else if(mode==2) {                                  // PING-PONG: WRAP fires on reaching either end
                if(state.forward) { if(state.counter+1>=length) { state.forward=false; --state.counter; } else ++state.counter; }
                else { if(state.counter<=0) { state.forward=true; ++state.counter; } else --state.counter; }
                wrap=state.counter==0 || state.counter==length-1;
            } else {                                              // WRAP: WRAP fires on returning to 0
                state.counter=(state.counter+1)%length;
                wrap=state.counter==0;
            }
        }
        out=float(state.counter)/float(length-1);
        outputs[1]=wrap ? 1.0f : 0.0f; // same sample as the VALUE change
        break;
    }
    case ControlOpType::EnvelopeTrigger: out=event(0) ? 1.0f : 0.0f; break;
    // ---- N06 sequencing / generative --------------------------------------
    case ControlOpType::ClockDivider: {
        // The first CLOCK fires every output (downbeat); then /2 /4 /8 /16.
        if(event(1)) state.counter=0;
        if(event(0)) {
            static constexpr int divisions[4]{2,4,8,16};
            for(std::size_t k=0;k<4;++k) outputs[k]=state.counter%divisions[k]==0 ? 1.0f : 0.0f;
            state.counter=(state.counter+1)%16;
        }
        out=outputs[0];
        break;
    }
    case ControlOpType::EventDelay: {
        // Bounded scheduler: pending events count down; an event at N with a
        // delay of D samples fires at N + D. Capacity 8; when full, the NEWEST
        // event is dropped (earlier events keep their exact timing).
        bool fire=false;
        std::uint8_t kept=0;
        for(std::uint8_t i=0;i<state.pendingCount;++i) {
            if(--state.pending[i]<=0) fire=true; else state.pending[kept++]=state.pending[i];
        }
        state.pendingCount=kept;
        if(event(0)) {
            std::int32_t samples=prepared.delaySamples;
            if(p[0]>=0.5f && ctx.beatsPerSample>0.0)
                samples=std::max<std::int32_t>(1,static_cast<std::int32_t>(std::lround(prepared.divisionBeats/ctx.beatsPerSample)));
            if(state.pendingCount<ControlOpRuntime::delayCapacity) state.pending[state.pendingCount++]=samples;
            else if(ctx.eventOverflow!=nullptr) ++*ctx.eventOverflow;
        }
        out=fire ? 1.0f : 0.0f;
        break;
    }
    case ControlOpType::Probability:
        if(!state.initialized) { state.initialized=true; state.rng=seedFor(p[1],op.id,ctx.voiceSeed); }
        // The generator advances once per incoming event: deterministic per event index.
        out=event(0) && unitRandom(state.rng)<p[0] ? 1.0f : 0.0f;
        break;
    case ControlOpType::ChanceSplit:
        if(!state.initialized) { state.initialized=true; state.rng=seedFor(p[1],op.id,ctx.voiceSeed); }
        if(event(0)) { if(unitRandom(state.rng)<p[0]) outputs[0]=1.0f; else outputs[1]=1.0f; } // exactly one
        out=outputs[0];
        break;
    case ControlOpType::EventMerge: out=event(0) || event(1) || event(2) ? 1.0f : 0.0f; break;
    case ControlOpType::Euclidean: {
        const int steps=std::clamp(static_cast<int>(std::lround(p[0])),1,32);
        if(event(1)) state.counter=0;
        if(event(0)) {
            out=euclideanHit(steps,static_cast<int>(std::lround(p[1])),static_cast<int>(std::lround(p[2])),state.counter) ? 1.0f : 0.0f;
            state.counter=(state.counter+1)%steps;
        }
        break;
    }
    case ControlOpType::Pattern: {
        const int length=std::clamp(static_cast<int>(std::lround(p[0])),1,32);
        const std::uint32_t bits=static_cast<std::uint32_t>(std::lround(p[1]))|(static_cast<std::uint32_t>(std::lround(p[2]))<<16);
        if(event(1)) state.counter=0;
        if(event(0)) {
            out=((bits>>static_cast<std::uint32_t>(state.counter))&1u)!=0 ? 1.0f : 0.0f;
            state.counter=(state.counter+1)%length;
        }
        break;
    }
    case ControlOpType::RandomWalk: {
        const float lo=std::min(p[1],p[2]),hi=std::max(p[1],p[2]);
        if(!state.initialized || event(1)) { state.initialized=true; state.rng=seedFor(p[3],op.id,ctx.voiceSeed); state.value=0.5f*(lo+hi); }
        if(event(0)) {
            float v=state.value+(unitRandom(state.rng)*2.0f-1.0f)*p[0];
            if(p[4]>=0.5f) { // REFLECT at the bounds
                if(v>hi) v=hi-(v-hi);
                if(v<lo) v=lo+(lo-v);
            }
            state.value=std::clamp(v,lo,hi);
        }
        out=state.value;
        break;
    }
    case ControlOpType::Sequencer: {
        // The canonical sequencer: RESET first, then ADVANCE (EXTERNAL) or the
        // sequencer's own clock (INTERNAL). Never both clocks.
        auto* sequencer=ctx.sequencer;
        const auto* settings=ctx.sequencerSettings;
        if(sequencer==nullptr || settings==nullptr) break;
        const std::uint32_t before=sequencer->stepEvents();
        if(event(1)) sequencer->restart(*settings);
        if(p[0]>=0.5f) { if(event(0)) sequencer->advance(*settings); sequencer->hold(*settings); }
        else sequencer->next(*settings,ctx.sampleRate);
        const std::size_t count=std::clamp<std::size_t>(settings->activeSteps,1,settings->steps.size());
        out=sequencer->held(); // the step begun at this sample (consistent with STEP EVENT)
        outputs[1]=count>1 ? float(sequencer->currentStep())/float(count-1) : 0.0f;
        outputs[2]=sequencer->stepEvents()!=before ? 1.0f : 0.0f; // a step began at this sample
        break;
    }
    }
    (void)c;
    outputs[0]=finiteOr0(out);
    for(auto& o:outputs) o=finiteOr0(o);
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
    if(isOperatorSource(source)) {
        if(operatorPortOf(source)!=0) return ControlRange::Unipolar; // extra ports: EVENTs / 0..1 positions
        return operatorRange(state,operatorIdOf(source),0);
    }
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
    if(routedRange_[slot]!=ControlRange::Bipolar) return raw;
    return bipolar ? raw*0.5f : std::clamp(raw*0.5f+0.5f,0.0f,1.0f);
}

float CompiledModulation::operatorInput(std::int16_t input,const std::array<float,voiceSourceCount>* voice,const ModulationFrame& f,
                                        const ModulationFrame& operators) noexcept {
    if(input<0) return 0.0f;
    const auto i=static_cast<std::size_t>(input);
    if(i<globalSourceCount) return f.globalSources[i];
    if(i<sourceSlotCount) return voice!=nullptr ? (*voice)[i-globalSourceCount] : 0.0f;
    return operators.operatorOutputs[i-sourceSlotCount];
}

void CompiledModulation::resolveKernel(CompiledOp& c,const std::array<bool,3>& connected) noexcept {
    using K=CompiledOp::Kernel;
    const auto& p=c.op.params;
    const bool a=connected[0],b=connected[1];
    // One connected input of a two-input math node passes it through (the
    // general evaluator's identity element gives the same value).
    const auto passOrConstant=[&](float none){ if(a) { c.kernel=K::Pass; c.kernelInput=0; } else if(b) { c.kernel=K::Pass; c.kernelInput=1; } else { c.kernel=K::Constant; c.k0=none; } };
    switch(c.op.type) {
    case ControlOpType::Add: if(a && b) c.kernel=K::Sum; else passOrConstant(0.0f); break;
    case ControlOpType::Subtract:
        if(a && b) c.kernel=K::Difference;
        else if(a) { c.kernel=K::Pass; c.kernelInput=0; }
        else if(b) { c.kernel=K::Linear; c.kernelInput=1; c.k0=-1.0f; c.k1=0.0f; } // 0 - b
        else { c.kernel=K::Constant; c.k0=0.0f; }
        break;
    case ControlOpType::Multiply: if(a && b) c.kernel=K::Product; else passOrConstant(1.0f); break;
    case ControlOpType::Min: if(a && b) c.kernel=K::Minimum; else passOrConstant(0.0f); break;
    case ControlOpType::Max: if(a && b) c.kernel=K::Maximum; else passOrConstant(0.0f); break;
    case ControlOpType::ScaleOffset: c.kernel=K::Linear; c.k0=p[0]; c.k1=p[1]; break;
    // -a and 1-a are exactly a*-1+0 and a*-1+1 in IEEE arithmetic.
    case ControlOpType::Invert: c.kernel=K::Linear; c.k0=-1.0f; c.k1=c.range[0]==ControlRange::Bipolar ? 0.0f : 1.0f; break;
    case ControlOpType::Abs: c.kernel=K::Absolute; break;
    case ControlOpType::Clamp: c.kernel=K::ClampRange; c.k0=std::min(p[0],p[1]); c.k1=std::max(p[0],p[1]); break;
    case ControlOpType::Constant: c.kernel=K::Constant; c.k0=p[0]; break;
    case ControlOpType::Smooth: c.kernel=K::SmoothFollow; break;
    default: c.kernel=K::General; break;
    }
}

void CompiledModulation::runOperator(const CompiledOp& c,const std::array<float,voiceSourceCount>* voice,
                                     ModulationFrame& f,ControlOpRuntime& state,const ModulationFrame& global) const noexcept {
    if(state.id!=c.op.id) { state=ControlOpRuntime{}; state.id=c.op.id; } // a new operator in this slot starts fresh
    const std::size_t base=operatorOutputIndex(c.slot,0);
    if(c.kernel!=CompiledOp::Kernel::General) {
        // Prepared kernels: same arithmetic, same NaN guards as the general
        // evaluator (inputs and output), single output port.
        using K=CompiledOp::Kernel;
        const auto in=[&](std::size_t k){ return finiteOr0(operatorInput(c.input[k],voice,f,((c.globalOperatorInputs>>k)&1u)!=0 ? global : f)); };
        float out=0.0f;
        switch(c.kernel) {
        case K::Constant: out=c.k0; break;
        case K::Pass: out=in(c.kernelInput); break;
        case K::Linear: out=in(c.kernelInput)*c.k0+c.k1; break;
        case K::Sum: out=in(0)+in(1); break;
        case K::Difference: out=in(0)-in(1); break;
        case K::Product: out=in(0)*in(1); break;
        case K::Minimum: out=std::min(in(0),in(1)); break;
        case K::Maximum: out=std::max(in(0),in(1)); break;
        case K::Absolute: out=std::abs(in(0)); break;
        case K::ClampRange: out=std::clamp(in(0),c.k0,c.k1); break;
        case K::SmoothFollow: {
            const float a=in(0);
            if(!state.initialized) { state.value=a; state.initialized=true; }
            else state.value+=(a>state.value ? c.prepared.rise : c.prepared.fall)*(a-state.value);
            out=state.value;
            break;
        }
        case K::General: break;
        }
        f.operatorOutputs[base]=finiteOr0(out);
        return;
    }
    ControlOpInputs in;
    for(std::size_t k=0;k<3;++k) {
        in.value[k]=operatorInput(c.input[k],voice,f,((c.globalOperatorInputs>>k)&1u)!=0 ? global : f);
        in.connected[k]=c.input[k]>=0;
        in.range[k]=c.range[k];
    }
    std::array<float,maxControlOutputs> outputs{};
    evaluateControlOpOutputs(c.op,in,state,c.prepared,f.events,outputs);
    // Every port of this operator is written each sample (EVENT ports are 0
    // between events), at index slot*4 + port. Ports beyond outputCount are
    // never read (validation rejects them).
    for(std::size_t port=0;port<maxControlOutputs;++port) f.operatorOutputs[base+port]=outputs[port]; // fixed count: unrolled (unused ports are 0)
}

// Same-sample ordering (N05): sources -> global operators (topological) ->
// per-voice operators (topological) -> destinations -> targets. An event at
// sample N is seen by every downstream node at sample N.
void CompiledModulation::evaluateGlobalOperators(ModulationFrame& f,const std::array<float,globalSourceCount>& sources) noexcept {
    f.globalSources=sources;
    for(std::size_t i=0;i<globalOpCount_;++i) {
        const auto& c=ops_[globalOrder_[i]];
        runOperator(c,nullptr,f,globalOpState_[c.slot],f);
        const std::size_t base=operatorOutputIndex(c.slot,0);
        // The SEQUENCER node's VALUE is the canonical SEQ source this sample.
        if(c.op.type==ControlOpType::Sequencer) f.globalSources[12]=f.operatorOutputs[base];
        if(eventFired(c,f.operatorOutputs,base)) ++globalEventCounts_[c.slot]; // monitoring only
    }
}

void CompiledModulation::evaluateVoiceOperators(ModulationFrame& f,const std::array<float,voiceSourceCount>& sources,
                                                OperatorState& state,std::array<std::uint32_t,operatorSlotCount>* counts,
                                                const ModulationFrame* global) const noexcept {
    const ModulationFrame& globalOperators=global!=nullptr ? *global : f;
    for(std::size_t i=0;i<voiceOpCount_;++i) {
        const auto& c=ops_[voiceOrder_[i]];
        runOperator(c,&sources,f,state[c.slot],globalOperators);
        const std::size_t base=operatorOutputIndex(c.slot,0);
        if(counts!=nullptr && eventFired(c,f.operatorOutputs,base)) ++(*counts)[c.slot];
    }
}

std::uint8_t CompiledModulation::envelopeTriggers(const ModulationFrame& f) const noexcept {
    std::uint8_t mask=0;
    for(std::size_t i=0;i<envelopeTriggerCount_;++i)
        if(f.operatorOutputs[operatorOutputIndex(envelopeTriggerSlots_[i],0)]!=0.0f) mask|=std::uint8_t(envelopeTriggerTargets_[i]==3 ? 4u : 2u);
    return mask;
}

void CompiledModulation::globalFrame(ModulationFrame& f,const std::array<float,globalSourceCount>& sources,double rate) const noexcept {
    f.filterEnabled=filterEnabled_;
    for(std::size_t i=0;i<count_;++i) {
        const auto& g=groups_[i];
        if(isFxDestination(g.address.parameter)) continue;
        const float base=std::clamp(read(f,g),g.minimum,g.maximum);
        float n=g.address.parameter==ModDestination::Cutoff
            ? std::log(base/g.minimum)/g.logSpan
            : (base-g.minimum)/(g.maximum-g.minimum);
        for(std::size_t k=0;k<g.globalSlotCount;++k) {
            const auto s=static_cast<std::size_t>(g.globalSlots[k]);
            const float src=routeSourceValue(s,sources[s],g.bipolar[s]);
            n+=(std::isfinite(g.weight[s])?g.weight[s]:0.0f)*src;
        }
        for(std::size_t k=0;k<g.globalOpSlotCount;++k) {
            const auto s=static_cast<std::size_t>(g.globalOpSlots[k]);
            const float w=g.weight[sourceSlotCount+s];
            n+=(std::isfinite(w)?w:0.0f)*operatorRouteValue(s,f.operatorOutputs[routedOutput_[s]],g.bipolar[sourceSlotCount+s]);
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
            n+=(std::isfinite(w)?w:0.0f)*operatorRouteValue(s,f.operatorOutputs[routedOutput_[s]],g.bipolar[sourceSlotCount+s]);
        }
        if(!std::isfinite(n)) n=0.0f;write(f,g,n);
    }
    if(voiceFilter_) f.filter=filterTable_.make(f.cutoff,f.resonance);
}
void CompiledModulation::fxFrame(FxModulationOutput& out,const std::array<float,globalSourceCount>& global,
                                 const std::array<float,voiceSourceCount>* voice,
                                 const std::array<float,operatorOutputSlotCount>* operators) const noexcept {
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
                n+=(std::isfinite(w)?w:0.0f)*operatorRouteValue(s,(*operators)[routedOutput_[s]],g.bipolar[sourceSlotCount+s]);
            }
        out.offset[k]=std::isfinite(n) ? std::clamp(n,-2.0f,2.0f) : 0.0f;
    }
}
}
