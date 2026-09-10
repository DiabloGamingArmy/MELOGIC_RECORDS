#pragma once
#include <cstddef>
#include <string>
#include <vector>
namespace mct::origami::dsp {
// Owned, immutable during rendering. Samples contain one cycle (no guard sample).
// Frames share band limits and table length. Future importers can populate this
// representation off-thread; hosts must keep the bank alive until processing stops.
struct WavetableBand { unsigned maximumHarmonic = 1; std::vector<float> samples; };
struct WavetableFrame { std::vector<WavetableBand> bands; };
struct Wavetable {
    std::string name;
    std::size_t tableLength = 0;
    std::vector<WavetableFrame> frames;
    bool valid() const noexcept;
    static Wavetable builtIns(); // Non-realtime generation only.
};
class WavetableOscillator {
public:
    void reset(double phase = 0) noexcept;
    float next(const Wavetable& table, double frequency, double sampleRate, float position) noexcept;
    double phase() const noexcept { return phase_; }
private:
    double phase_ = 0;
};
double midiFrequency(int note) noexcept;
}
