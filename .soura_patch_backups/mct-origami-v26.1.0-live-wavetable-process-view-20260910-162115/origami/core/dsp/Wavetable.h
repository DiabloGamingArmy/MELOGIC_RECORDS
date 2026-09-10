// mct-origami-v26.0.0-osc-process-foundation
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>
namespace mct::origami::dsp {

enum class OscProcessType : std::uint32_t {
    Off=0, BendPlus=1, BendMinus=2, BendBoth=3, Sync=4, Mirror=5, Asym=6
};

constexpr bool validOscProcessType(OscProcessType type) noexcept {
    return static_cast<std::uint32_t>(type)<=static_cast<std::uint32_t>(OscProcessType::Asym);
}
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
    float next(const Wavetable& table,double frequency,double sampleRate,float position,
               OscProcessType process1=OscProcessType::Off,float amount1=0.0f,
               OscProcessType process2=OscProcessType::Off,float amount2=0.0f) noexcept;
    double phase() const noexcept { return phase_; }
private:
    double phase_ = 0;
};
double midiFrequency(int note) noexcept;
}
