#pragma once
#include <algorithm>
#include <cmath>
namespace mct::origami::dsp {
// Topology-preserving state variable low-pass; shared coefficients, per-voice state.
struct LowPassCoefficients {
    double g = 0, a1 = 1;
    static LowPassCoefficients make(double sampleRate, float cutoff, float resonance) noexcept {
        const double g = std::tan(3.14159265358979323846 * std::clamp(double(cutoff), 20.0, sampleRate * .45) / sampleRate);
        const double q = .5 + 3.5 * std::clamp(double(resonance), 0.0, 1.0);
        return {g, 1.0 / (1 + g * (g + 1.0 / q))};
    }
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
