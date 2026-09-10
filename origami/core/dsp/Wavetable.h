// mct-origami-v27.1.0-expanded-cross-osc-routing
// mct-origami-v27.0.0-cross-osc-routing-foundation
// mct-origami-v26.3.1-bend-bipolar-global-knob-shortcuts
// mct-origami-v26.3.0-bipolar-osc-process-amounts
// mct-origami-v26.2.0-native-process-library
// mct-origami-v26.1.0-live-wavetable-process-view
// mct-origami-v26.0.0-osc-process-foundation
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>
namespace mct::origami::dsp {

enum class OscProcessType : std::uint32_t {
    Off=0, BendPlus=1, BendMinus=2, BendBoth=3, Sync=4, Mirror=5, Asym=6,
    SCurve=7, Pinch=8, Expand=9, CenterPull=10, EdgePull=11,
    Sync2=12, Sync3=13, Sync4=14, Sync16=15,
    Fold=16, SoftFold=17, ReflectLeft=18, ReflectRight=19, AlternateReflect=20,
    PhaseShift=21, SineWarp=22, Ripple=23, Twist=24, ZigZag=25, Staircase=26, Reverse=27,
    Quantize4=28, Quantize8=29, Quantize16=30, Scramble2=31, Scramble4=32,
    Chaos=33, Window=34, PulseWarp=35, Shred=36,
    Count=37
};

constexpr bool validOscProcessType(OscProcessType type) noexcept {
    return static_cast<std::uint32_t>(type)<static_cast<std::uint32_t>(OscProcessType::Count);
}

constexpr bool oscProcessIsBipolar(OscProcessType type) noexcept {
    switch(type) {
        case OscProcessType::BendBoth:
        case OscProcessType::Asym:
        case OscProcessType::PhaseShift:
        case OscProcessType::SineWarp:
        case OscProcessType::Ripple:
        case OscProcessType::Twist:
        case OscProcessType::Window:
        case OscProcessType::PulseWarp:
        case OscProcessType::Shred:
            return true;

        case OscProcessType::Off:
        case OscProcessType::BendPlus:
        case OscProcessType::BendMinus:
        case OscProcessType::Sync:
        case OscProcessType::Mirror:
        case OscProcessType::SCurve:
        case OscProcessType::Pinch:
        case OscProcessType::Expand:
        case OscProcessType::CenterPull:
        case OscProcessType::EdgePull:
        case OscProcessType::Sync2:
        case OscProcessType::Sync3:
        case OscProcessType::Sync4:
        case OscProcessType::Sync16:
        case OscProcessType::Fold:
        case OscProcessType::SoftFold:
        case OscProcessType::ReflectLeft:
        case OscProcessType::ReflectRight:
        case OscProcessType::AlternateReflect:
        case OscProcessType::ZigZag:
        case OscProcessType::Staircase:
        case OscProcessType::Reverse:
        case OscProcessType::Quantize4:
        case OscProcessType::Quantize8:
        case OscProcessType::Quantize16:
        case OscProcessType::Scramble2:
        case OscProcessType::Scramble4:
        case OscProcessType::Chaos:
            return false;

        case OscProcessType::Count:
            return false;
    }
    return false;
}

constexpr float oscProcessAmountMinimum(OscProcessType type) noexcept {
    return oscProcessIsBipolar(type) ? -1.0f : 0.0f;
}

const char* oscProcessName(OscProcessType type) noexcept;
const char* oscProcessCategory(OscProcessType type) noexcept;
double processOscillatorPhase(double phase,OscProcessType type,float amount) noexcept;
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
               OscProcessType process2=OscProcessType::Off,float amount2=0.0f,
               double phaseOffsetCycles=0.0,
               double phaseSkew=0.0) noexcept;
    double phase() const noexcept { return phase_; }
private:
    double phase_ = 0;
};
double midiFrequency(int note) noexcept;
}
