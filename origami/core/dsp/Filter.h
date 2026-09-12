#pragma once
// mct-origami-deep-audit-p06-fast-audio-math
#include <algorithm>
#include <array>
#include <cmath>
namespace mct::origami::dsp {
// Topology-preserving state variable low-pass; shared coefficients, per-voice state.
struct LowPassCoefficients {
    double g = 0, a1 = 1;
    // Exact/reference constructor. Keep for preparation/tests only.
    static LowPassCoefficients make(double sampleRate, float cutoff, float resonance) noexcept {
        const double g = std::tan(3.14159265358979323846 * std::clamp(double(cutoff), 20.0, sampleRate * .45) / sampleRate);
        const double q = .5 + 3.5 * std::clamp(double(resonance), 0.0, 1.0);
        return {g, 1.0 / (1 + g * (g + 1.0 / q))};
    }
};

class LowPassCoefficientTable {
public:
    static constexpr std::size_t size=4097;
    void prepare(double sampleRate) noexcept {
        sampleRate_=std::clamp(sampleRate,8000.0,384000.0);
        maxCutoff_=std::min(20000.0,sampleRate_*0.45);
        const double span=maxCutoff_-minCutoff_;
        step_=span/static_cast<double>(size-1);
        inverseStep_=step_>0.0 ? 1.0/step_ : 0.0;
        for(std::size_t i=0;i<size;++i) {
            const double cutoff=minCutoff_+step_*static_cast<double>(i);
            g_[i]=std::tan(3.14159265358979323846*cutoff/sampleRate_);
        }
        prepared_=true;
    }
    LowPassCoefficients make(float cutoff,float resonance) const noexcept {
        if(!prepared_) return {};
        const double c=std::clamp(
            std::isfinite(cutoff)?static_cast<double>(cutoff):8000.0,
            minCutoff_,maxCutoff_);
        const double position=(c-minCutoff_)*inverseStep_;
        const auto i=static_cast<std::size_t>(position);
        const auto j=std::min(i+1,size-1);
        const double f=position-static_cast<double>(i);
        const double g=g_[i]+(g_[j]-g_[i])*f;
        const double q=.5+3.5*std::clamp(
            std::isfinite(resonance)?static_cast<double>(resonance):0.1,0.0,1.0);
        return {g,1.0/(1.0+g*(g+1.0/q))};
    }
    bool prepared() const noexcept { return prepared_; }
private:
    static constexpr double minCutoff_=20.0;
    std::array<double,size> g_{};
    double sampleRate_=48000.0,maxCutoff_=20000.0,step_=1.0,inverseStep_=1.0;
    bool prepared_=false;
};
class LowPassFilter {
public:
    void reset() noexcept { ic1_ = ic2_ = 0; }
    float next(float input, const LowPassCoefficients& c) noexcept {
        // Never allow one invalid modulated sample to poison recursive state.
        if (!std::isfinite(input) || !std::isfinite(c.g) || !std::isfinite(c.a1) ||
            !std::isfinite(ic1_) || !std::isfinite(ic2_)) { reset(); return 0.0f; }
        const double v1 = c.a1 * (ic1_ + c.g * (static_cast<double>(input) - ic2_));
        const double v2 = ic2_ + c.g * v1;
        if (!std::isfinite(v1) || !std::isfinite(v2) || std::abs(v1)>1.0e12 || std::abs(v2)>1.0e12) {
            reset(); return 0.0f;
        }
        ic1_ = flush(2 * v1 - ic1_); ic2_ = flush(2 * v2 - ic2_);
        const float out=static_cast<float>(v2);
        return std::isfinite(out) ? out : 0.0f;
    }
    bool quiet() const noexcept { return std::abs(ic1_) + std::abs(ic2_) < 1e-9; }
private:
    static double flush(double value) noexcept { return std::abs(value) < 1e-20 ? 0 : value; }
    double ic1_ = 0, ic2_ = 0;
};
}
