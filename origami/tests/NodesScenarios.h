// mct-origami-nodes-n07-consolidation
#pragma once
#include "core/modulation/Modulation.h"
#include <array>
#include <cstddef>

// Deterministic NODES graphs shared by the benchmark tool (tools/nodes_bench.cpp)
// and the regression tests. Every graph is valid for the default instrument
// (oscillator modules 1..4).
namespace mct::origami::scenarios {

inline ControlInput src(ModSource s) { return {ControlInput::Kind::Source,s,0}; }
inline ControlInput opIn(std::uint32_t id,std::uint8_t port=0) { return {ControlInput::Kind::Operator,ModSource::None,id,port}; }

// Up to 32 distinct direct routes (4 sources x 8 destinations).
inline ModulationState directRoutes(std::size_t count) {
    ModulationState m;
    std::size_t written=0;
    // Walk the 4 x 8 x 4 space and keep the first `count` unique pairs.
    for(std::size_t s=0;s<4 && written<count;++s)
        for(std::size_t d=0;d<8 && written<count;++d) {
            static constexpr ModSource sources[]{ModSource::Lfo1,ModSource::Lfo2,ModSource::Macro1,ModSource::Env2};
            static constexpr ModDestination destinations[]{ModDestination::WtPosition,ModDestination::Pan,ModDestination::Level,ModDestination::Fine,
                                                           ModDestination::Detune,ModDestination::Semitone,ModDestination::Cutoff,ModDestination::Resonance};
            ModRoute r;
            r.id=std::uint32_t(written+1); r.enabled=true; r.amount=0.05f; r.bipolar=true;
            r.source=sources[s];
            const bool global=destinations[d]==ModDestination::Cutoff || destinations[d]==ModDestination::Resonance;
            r.destination={destinations[d],global ? OscillatorModuleId(0) : OscillatorModuleId(1),0};
            m.routes[written++]=r;
        }
    m.nextRouteId=std::uint32_t(written+1);
    return m;
}

// LFO 1 -> a chain of `count` CONTROL operators -> CUTOFF.
inline ModulationState controlChain(std::size_t count) {
    ModulationState m;
    static constexpr ControlOpType kinds[]{ControlOpType::ScaleOffset,ControlOpType::Curve,ControlOpType::Smooth,ControlOpType::Clamp,
                                           ControlOpType::Remap,ControlOpType::Quantize,ControlOpType::Abs,ControlOpType::Invert};
    for(std::size_t i=0;i<count;++i) {
        auto& op=m.operators[i];
        op=makeControlOperator(kinds[i%8],std::uint32_t(i+1));
        op.inputs[0]=i==0 ? src(ModSource::Lfo1) : opIn(std::uint32_t(i));
    }
    m.nextOperatorId=std::uint32_t(count+1);
    m.routes[0]={1,true,operatorSource(std::uint32_t(count)),{ModDestination::Cutoff,0,0},0.4f,true};
    m.nextRouteId=2;
    return m;
}

// 24 mixed CONTROL operators in 4 parallel chains with 2-input math.
inline ModulationState mixedControl() {
    ModulationState m;
    std::uint32_t id=1;
    std::array<std::uint32_t,4> tails{};
    static constexpr ModSource roots[]{ModSource::Lfo1,ModSource::Lfo2,ModSource::Macro1,ModSource::Lfo3};
    for(std::size_t chain=0;chain<4;++chain) {
        for(std::size_t k=0;k<5;++k) {
            auto& op=m.operators[id-1];
            static constexpr ControlOpType kinds[]{ControlOpType::ScaleOffset,ControlOpType::Smooth,ControlOpType::Curve,ControlOpType::Remap,ControlOpType::Clamp};
            op=makeControlOperator(kinds[k],id);
            op.inputs[0]=k==0 ? src(roots[chain]) : opIn(id-1);
            tails[chain]=id++;
        }
    }
    const auto add2=[&](ControlOpType t,std::uint32_t a,std::uint32_t b) {
        auto& op=m.operators[id-1]; op=makeControlOperator(t,id); op.inputs[0]=opIn(a); op.inputs[1]=opIn(b); return id++; };
    const auto x=add2(ControlOpType::Add,tails[0],tails[1]);
    const auto y=add2(ControlOpType::Multiply,tails[2],tails[3]);
    const auto z=add2(ControlOpType::Max,x,y);
    const auto w=add2(ControlOpType::Min,x,z);
    m.nextOperatorId=id;
    m.routes[0]={1,true,operatorSource(z),{ModDestination::Cutoff,0,0},0.4f,true};
    m.routes[1]={2,true,operatorSource(w),{ModDestination::Resonance,0,0},0.2f,false};
    m.routes[2]={3,true,operatorSource(y),{ModDestination::Level,1,0},0.2f,false};
    m.nextRouteId=4;
    return m;
}

// Clocks, logic, stateful nodes (all global).
inline ModulationState eventHeavy() {
    ModulationState m;
    using T=ControlOpType;
    std::uint32_t id=1;
    const auto add=[&](T t)->ControlOperator& { auto& op=m.operators[id-1]; op=makeControlOperator(t,id); ++id; return op; };
    auto& clock=add(T::Clock); clock.params[0]=0.0f; clock.params[1]=40.0f;            // 1
    add(T::Clock).params[2]=4.0f;                                                     // 2 (1/16 tempo)
    add(T::Threshold).inputs[0]=src(ModSource::Lfo1);                                 // 3
    add(T::Edge).inputs[0]=opIn(3);                                                   // 4
    { auto& o=add(T::EventMerge); o.inputs[0]=opIn(1); o.inputs[1]=opIn(4); o.inputs[2]=opIn(2); } // 5
    add(T::Toggle).inputs[0]=opIn(5);                                                 // 6
    { auto& o=add(T::SampleHold); o.inputs[0]=src(ModSource::Lfo2); o.inputs[1]=opIn(5); } // 7
    add(T::Counter).inputs[0]=opIn(1);                                                // 8
    add(T::Pulse).inputs[0]=opIn(2);                                                  // 9
    { auto& o=add(T::And); o.inputs[0]=opIn(6); o.inputs[1]=opIn(9); }                // 10
    { auto& o=add(T::TrackHold); o.inputs[0]=src(ModSource::Lfo3); o.inputs[1]=opIn(10); } // 11
    add(T::RandomTrigger).inputs[0]=opIn(4);                                          // 12
    { auto& o=add(T::Compare); o.inputs[0]=src(ModSource::Lfo1); o.inputs[1]=src(ModSource::Lfo2); } // 13
    { auto& o=add(T::Switch); o.inputs[0]=opIn(7); o.inputs[1]=opIn(11); o.inputs[2]=opIn(13); } // 14
    m.nextOperatorId=id;
    m.routes[0]={1,true,operatorSource(14),{ModDestination::Cutoff,0,0},0.4f,true};
    m.routes[1]={2,true,operatorSource(8),{ModDestination::Resonance,0,0},0.2f,false};
    m.routes[2]={3,true,operatorSource(12),{ModDestination::Level,1,0},0.2f,false};
    m.nextRouteId=4;
    return m;
}

// The N06 sequencing / generative graph.
inline ModulationState sequencing() {
    ModulationState m;
    using T=ControlOpType;
    m.operators[0]=makeControlOperator(T::Clock,1); m.operators[0].params[2]=4.0f;
    m.operators[1]=makeControlOperator(T::Euclidean,2); m.operators[1].params[1]=5.0f; m.operators[1].inputs[0]=opIn(1);
    m.operators[2]=makeControlOperator(T::EventDelay,3); m.operators[2].params[0]=1.0f; m.operators[2].params[2]=5.0f; m.operators[2].inputs[0]=opIn(2);
    m.operators[3]=makeControlOperator(T::Sequencer,4); m.operators[3].params[0]=1.0f; m.operators[3].inputs[0]=opIn(3);
    m.operators[4]=makeControlOperator(T::RandomWalk,5); m.operators[4].inputs[0]=opIn(4,2);
    m.operators[5]=makeControlOperator(T::ChanceSplit,6); m.operators[5].inputs[0]=opIn(1);
    m.operators[6]=makeControlOperator(T::Counter,7); m.operators[6].params[1]=2.0f; m.operators[6].inputs[0]=opIn(6,0); m.operators[6].inputs[1]=opIn(6,1);
    m.operators[7]=makeControlOperator(T::Probability,8); m.operators[7].inputs[0]=opIn(4,2);
    m.operators[8]=makeControlOperator(T::Pattern,9); m.operators[8].inputs[0]=opIn(1);
    m.operators[9]=makeControlOperator(T::ClockDivider,10); m.operators[9].inputs[0]=opIn(1);
    m.nextOperatorId=11;
    m.routes[0]={1,true,operatorSource(4),{ModDestination::Cutoff,0,0},0.6f,true};
    m.routes[1]={2,true,operatorSource(5),{ModDestination::Level,1,0},0.3f,false};
    m.routes[2]={3,true,operatorSource(7),{ModDestination::Resonance,0,0},0.3f,false};
    m.routes[3]={4,true,operatorSource(4,1),{ModDestination::Pan,1,0},0.3f,false};
    m.nextRouteId=5;
    return m;
}

// 32 operators: CONTROL math, stateful, event logic, multi-output, sequencer,
// generative, per-voice and global, with fan-out. The N07 stress graph.
inline ModulationState maximal() {
    auto m=sequencing();                                    // ids 1..10
    using T=ControlOpType;
    std::uint32_t id=11;
    const auto add=[&](T t)->ControlOperator& { auto& op=m.operators[id-1]; op=makeControlOperator(t,id); ++id; return op; };
    add(T::NoteOn);                                         // 11 per-voice
    add(T::RandomWalk).inputs[0]=opIn(11);                  // 12 per-voice
    add(T::Counter).inputs[0]=opIn(11);                     // 13 per-voice
    { auto& o=add(T::SampleHold); o.inputs[0]=src(ModSource::Env2); o.inputs[1]=opIn(1); } // 14 per-voice (ENV)
    add(T::ScaleOffset).inputs[0]=opIn(12);                 // 15
    { auto& o=add(T::Add); o.inputs[0]=opIn(15); o.inputs[1]=opIn(14); } // 16
    add(T::Smooth).inputs[0]=opIn(16);                      // 17
    add(T::Threshold).inputs[0]=src(ModSource::Lfo1);       // 18
    add(T::Edge).inputs[0]=opIn(18);                        // 19
    { auto& o=add(T::EventMerge); o.inputs[0]=opIn(19); o.inputs[1]=opIn(10,1); o.inputs[2]=opIn(9); } // 20
    add(T::Toggle).inputs[0]=opIn(20);                      // 21
    { auto& o=add(T::TrackHold); o.inputs[0]=src(ModSource::Lfo2); o.inputs[1]=opIn(21); } // 22
    add(T::Curve).inputs[0]=opIn(22);                       // 23
    add(T::RandomTrigger).inputs[0]=opIn(6,1);              // 24
    { auto& o=add(T::Multiply); o.inputs[0]=opIn(23); o.inputs[1]=opIn(24); } // 25
    add(T::Clamp).inputs[0]=opIn(25);                       // 26
    add(T::Pulse).inputs[0]=opIn(8);                        // 27
    { auto& o=add(T::Switch); o.inputs[0]=opIn(26); o.inputs[1]=opIn(5); o.inputs[2]=opIn(27); } // 28
    add(T::Remap).inputs[0]=opIn(28);                       // 29
    add(T::Quantize).inputs[0]=opIn(4,0);                   // 30
    { auto& o=add(T::Max); o.inputs[0]=opIn(29); o.inputs[1]=opIn(30); } // 31
    add(T::EnvelopeTrigger).inputs[0]=opIn(11);             // 32 per-voice target
    m.nextOperatorId=id;
    m.routes[4]={5,true,operatorSource(17),{ModDestination::WtPosition,1,0},0.3f,true};
    m.routes[5]={6,true,operatorSource(31),{ModDestination::Detune,1,0},0.3f,true};
    m.routes[6]={7,true,operatorSource(13),{ModDestination::Fine,1,0},0.2f,false};
    m.nextRouteId=8;
    return m;
}

// High-polyphony per-voice processing: NOTE ON / ENV driven chains per voice.
inline ModulationState perVoice() {
    ModulationState m;
    using T=ControlOpType;
    std::uint32_t id=1;
    const auto add=[&](T t)->ControlOperator& { auto& op=m.operators[id-1]; op=makeControlOperator(t,id); ++id; return op; };
    add(T::NoteOn);                                          // 1
    add(T::RandomWalk).inputs[0]=opIn(1);                    // 2
    { auto& o=add(T::SampleHold); o.inputs[0]=src(ModSource::Env1); o.inputs[1]=opIn(1); } // 3
    add(T::Smooth).inputs[0]=src(ModSource::Env2);           // 4
    { auto& o=add(T::Multiply); o.inputs[0]=opIn(4); o.inputs[1]=src(ModSource::Velocity); } // 5
    add(T::Curve).inputs[0]=opIn(5);                         // 6
    { auto& o=add(T::Add); o.inputs[0]=opIn(6); o.inputs[1]=opIn(2); } // 7
    add(T::Clamp).inputs[0]=opIn(7);                         // 8
    add(T::Threshold).inputs[0]=src(ModSource::Env2);        // 9
    add(T::Edge).inputs[0]=opIn(9);                          // 10
    add(T::Counter).inputs[0]=opIn(10);                      // 11
    m.nextOperatorId=id;
    m.routes[0]={1,true,operatorSource(8),{ModDestination::Level,1,0},0.4f,false};
    m.routes[1]={2,true,operatorSource(11),{ModDestination::WtPosition,1,0},0.3f,false};
    m.routes[2]={3,true,operatorSource(3),{ModDestination::Pan,1,0},0.3f,true};
    m.nextRouteId=4;
    return m;
}

}
