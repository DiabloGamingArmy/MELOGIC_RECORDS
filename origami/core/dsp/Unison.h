#pragma once
#include "FastMath.h"
#include <array>
#include <algorithm>
#include <cmath>
#include <cstdint>

namespace mct::origami::dsp {
inline constexpr unsigned maxUnison = 16;
// Symmetry is in cents (geometric frequency mean), not linear Hz.
inline double unisonPosition(unsigned lane,unsigned count) noexcept {
    return count<=1 ? 0.0 : 2.0*double(lane)/double(count-1)-1.0;
}
inline double unisonRatio(unsigned lane,unsigned count,float cents) noexcept {
    const double position=unisonPosition(lane,count);
    const double lower=fastExp2Audio(-std::abs(position)*double(cents)/1200.0);
    return position>0 ? 1.0/lower : lower; // mirrored ratios are exact reciprocals
}
inline double unisonRandomPhase(std::uint32_t seed) noexcept {
    seed^=seed>>16;seed*=0x7feb352du;seed^=seed>>15;seed*=0x846ca68bu;seed^=seed>>16;
    return double(seed)/4294967296.0;
}
// Equal-power normalization preserves the RMS of decorrelated voices. For
// fixed/common phases near zero detune, interpolate to coherent 1/N instead:
// zero-detune stacks cannot multiply the peak. No limiter or nonlinear shaping.
inline float unisonGain(unsigned count,float cents,bool commonPhase) noexcept {
    const float n=float(std::clamp(count,1u,maxUnison));
    const float rms=1.0f/std::sqrt(n),coherent=1.0f/n;
    const float decorrelation=commonPhase ? std::clamp(cents/5.0f,0.0f,1.0f) : 1.0f;
    return coherent+(rms-coherent)*decorrelation;
}
// Fixed storage; count edits fade old lanes out/new lanes in over 20 ms.
// Only active/fading lanes render. BLEND remains an independent center mix.
struct UnisonMixer {
    std::array<float,maxUnison> left{},right{},targetLeft{},targetRight{};
    float center=0,targetCenter=0;
    unsigned count=0,renderCount=0,remaining=0;
    float lastBlend=-1,lastCents=-1;
    bool lastCommon=false;
    void reset() noexcept {*this={};lastBlend=lastCents=-1;}
    bool prepare(unsigned requested,float blend,float cents,bool common,double sampleRate) noexcept {
        requested=std::clamp(requested,1u,maxUnison);
        const bool first=count==0;
        if(count==requested && blend==lastBlend && cents==lastCents && common==lastCommon) return false;
        const unsigned previous=count;count=requested;lastBlend=blend;lastCents=cents;lastCommon=common;
        const float stackBlend=count==1 ? 1.0f : blend;
        const float gain=unisonGain(count,cents,common)*stackBlend;
        targetLeft.fill(0);targetRight.fill(0);
        for(unsigned u=0;u<count;++u) {
            const float width=float(unisonPosition(u,count))*.7f;
            // Relative width: the existing overall oscillator pan is applied
            // after this ensemble, retaining hard-pan isolation.
            targetLeft[u]=std::sqrt(1.0f-width)*gain;
            targetRight[u]=std::sqrt(1.0f+width)*gain;
        }
        targetCenter=count==1 ? 0.0f : 1.0f-blend;
        if(first) {left=targetLeft;right=targetRight;center=targetCenter;renderCount=count;remaining=0;}
        else {renderCount=std::max(renderCount,count);if(previous!=count) remaining=std::max(1u,unsigned(sampleRate*.020));
            // Continuous modulation retargets the short coefficient glide without
            // restarting the count fade every sample.
            else if(!remaining) remaining=std::max(1u,unsigned(sampleRate*.005));}
        return first;
    }
    void advance() noexcept {
        if(!remaining) return;
        const float step=1.0f/float(remaining);
        for(unsigned u=0;u<renderCount;++u) {left[u]+=(targetLeft[u]-left[u])*step;right[u]+=(targetRight[u]-right[u])*step;}
        center+=(targetCenter-center)*step;
        if(!--remaining) {left=targetLeft;right=targetRight;center=targetCenter;renderCount=count;}
    }
};
}
