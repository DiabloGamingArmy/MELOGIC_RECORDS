#pragma once
#include "OscillatorModule.h"
#include "dsp/Filter.h"
#include "dsp/FastMath.h"

namespace mct::origami {
using SynthFilterId=std::uint32_t;
inline constexpr std::size_t maxSynthFilters=8;
inline constexpr SynthFilterId maxSynthFilterId=0x7fffffffu;
struct SynthFilterValues {
    float cutoff=8000,resonance=.1f,drive=0,mix=1,keytrack=0,gain=0;
};
struct SynthFilterState {
    SynthFilterId id=0;
    SynthFilterValues values{};
    bool power=true;
    dsp::FilterType type=dsp::FilterType::LowPass;
    // Canonical type IDs; every voice owns its independent integrator state.
    SynthFilterId next=0;
    std::array<OscBusRoute,maxOscBusRoutes> buses{{OscBusRoute{mainBusId,1}}};
    std::uint8_t busCount=1;
};
struct SynthFilterInput {
    OscillatorModuleId oscillator=0; SynthFilterId filter=0;
    // Canonical typed output sends, published with filter topology atomically.
    // Zero count inherits the historical oscillator bus sends. The filter
    // field is retained solely for pre-v37 in-memory compatibility.
    std::array<OscBusRoute,maxOscBusRoutes> buses{};
    std::uint8_t busCount=0;
};
struct SynthFilterCollection {
    std::array<SynthFilterState,maxSynthFilters> filters{};
    std::array<SynthFilterInput,16> inputs{};
    SynthFilterId nextId=1;
};
// Prepared on the writer thread. Audio reads indices/order; it does not
// resolve filter identity, discover edges or sort a graph.
struct SynthFilterPlan {
    struct Stage {
        std::uint8_t slot=0;
        std::int8_t next=-1;
        std::array<float,8> sends{};
    };
    std::array<Stage,maxSynthFilters> stages{};
    std::array<OscillatorModuleId,16> oscillatorIds{};
    std::array<SynthFilterId,8> filterIds{};
    std::array<std::array<float,8>,16> filterSends{};
    std::array<std::array<float,8>,16> directSends{};
    std::array<BusId,8> busIds{{mainBusId}};
    std::uint8_t count=0,busCount=1;
};
inline std::size_t synthFilterSlot(const SynthFilterCollection& s,SynthFilterId id) noexcept {
    if(id) for(std::size_t i=0;i<s.filters.size();++i) if(s.filters[i].id==id) return i;
    return maxSynthFilters;
}
// Small per-voice stereo runtime; no delay buffers or heap storage.
struct SynthFilterRuntime {
    SynthFilterId id=0;
    dsp::LowPassFilter left{},right{};
    SynthFilterValues current{};
    bool primed=false;
    float driveKey=-1,driveGain=1,cutoffKey=-1,resonanceKey=-1,keytrackKey=-1,keytrackRatio=1;int noteKey=-1;
    dsp::LowPassCoefficients coefficients{};dsp::FilterCoefficients typedCoefficients{};
    dsp::FilterType type=dsp::FilterType::LowPass;float gainKey=-100;
    void reset() noexcept {left.reset();right.reset();id=0;primed=false;driveKey=cutoffKey=resonanceKey=keytrackKey=-1;noteKey=-1;gainKey=-100;type=dsp::FilterType::LowPass;}
    void adopt(SynthFilterId identity,dsp::FilterType selected=dsp::FilterType::LowPass) noexcept {if(id!=identity || type!=selected) {reset();id=identity;type=selected;}}
    SynthFilterValues smooth(const SynthFilterValues& target,float alpha) noexcept {
        if(!primed) {current=target;primed=true;}
        else {
            const auto glide=[alpha](float& value,float wanted) {const float delta=wanted-value;value=std::abs(delta)<1e-6f?wanted:value+alpha*delta;};
            glide(current.cutoff,target.cutoff);glide(current.resonance,target.resonance);glide(current.drive,target.drive);glide(current.mix,target.mix);glide(current.keytrack,target.keytrack);glide(current.gain,target.gain);
        }
        return current;
    }
    float process(float x,const dsp::LowPassCoefficients& c,float drive,float mix,bool isRight) noexcept {
        if(!std::isfinite(x)) {reset();return 0;}
        if(driveKey!=drive) {driveKey=drive;driveGain=static_cast<float>(dsp::fastExp2Audio(drive/6.020599913));}
        const float gain=driveGain;
        const float input=drive>.001f ? std::tanh(gain*x)/std::sqrt(gain) : x;
        auto& state=isRight ? right : left;const float wet=type==dsp::FilterType::LowPass ? state.next(input,c) : state.next(input,typedCoefficients);
        return x+mix*(wet-x);
    }
};
}
