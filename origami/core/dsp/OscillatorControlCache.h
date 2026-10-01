#pragma once
#include "FastMath.h"

namespace mct::origami::dsp {
// Exact-input memoization only: modulation is still evaluated every sample.
// No quantization, smoothing, or change to the existing math functions.
class OscillatorControlCache {
public:
    void invalidate() noexcept { pitchValid_=panValid_=false; }

    double pitchRatio(float octave,float semitone,float fineCents) noexcept {
        const auto finiteOrZero=[](float v) noexcept { return std::isfinite(v)?v:0.0f; };
        const double pitch=static_cast<double>(finiteOrZero(octave))*12.0+
            static_cast<double>(finiteOrZero(semitone))+
            static_cast<double>(finiteOrZero(fineCents))/100.0;
        if(!pitchValid_ || pitch!=pitch_) {
            pitch_=pitch;ratio_=fastExp2Audio(pitch/12.0);pitchValid_=true;
        }
        return ratio_;
    }

    void pan(float value,float& left,float& right) noexcept {
        const float p=std::isfinite(value)?std::clamp(value,-1.0f,1.0f):0.0f;
        if(!panValid_ || p!=pan_) {
            pan_=p;
            const double cycle=(static_cast<double>(p)+1.0)*0.125;
            left_=static_cast<float>(fastSinCycle(0.25-cycle));
            right_=static_cast<float>(fastSinCycle(cycle));
            panValid_=true;
        }
        left=left_;right=right_;
    }
private:
    double pitch_=0.0,ratio_=1.0;
    float pan_=0.0f,left_=0.0f,right_=0.0f;
    bool pitchValid_=false,panValid_=false;
};
}
