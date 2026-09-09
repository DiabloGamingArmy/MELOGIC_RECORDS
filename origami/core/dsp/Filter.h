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
        const double v1 = c.a1 * (ic1_ + c.g * (input - ic2_));
        const double v2 = ic2_ + c.g * v1;
        ic1_ = flush(2 * v1 - ic1_); ic2_ = flush(2 * v2 - ic2_);
        return static_cast<float>(v2);
    }
    bool quiet() const noexcept { return std::abs(ic1_) + std::abs(ic2_) < 1e-9; }
private:
    static double flush(double value) noexcept { return std::abs(value) < 1e-20 ? 0 : value; }
    double ic1_ = 0, ic2_ = 0;
};
}
