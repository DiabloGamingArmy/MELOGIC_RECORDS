// mct-origami-v29.1.0-rand-amp-variants-ui-polish
// mct-origami-v29.0.0-spectral-process-native-routing
// mct-origami-v27.1.0-expanded-cross-osc-routing
// mct-origami-v27.0.0-cross-osc-routing-foundation
// mct-origami-v26.3.1-bend-bipolar-global-knob-shortcuts
// mct-origami-v26.3.0-bipolar-osc-process-amounts
// mct-origami-v26.2.0-native-process-library
// mct-origami-v26.1.0-live-wavetable-process-view
// mct-origami-v26.0.0-osc-process-foundation
#pragma once
#include <array>
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
    RandAmp=37, RandSparse=38, OddFocus=39, SpectralComb=40, HarmonicTilt=41, FormantPeaks=42,
    Count=43
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
        case OscProcessType::RandAmp:
        case OscProcessType::RandSparse:
        case OscProcessType::OddFocus:
        case OscProcessType::SpectralComb:
        case OscProcessType::HarmonicTilt:
        case OscProcessType::FormantPeaks:
            return false;

        case OscProcessType::Count:
            return false;
    }
    return false;
}

constexpr float oscProcessAmountMinimum(OscProcessType type) noexcept {
    return oscProcessIsBipolar(type) ? -1.0f : 0.0f;
}

constexpr bool oscProcessIsSpectral(OscProcessType type) noexcept {
    switch(type) {
        case OscProcessType::RandAmp:
        case OscProcessType::RandSparse:
        case OscProcessType::OddFocus:
        case OscProcessType::SpectralComb:
        case OscProcessType::HarmonicTilt:
        case OscProcessType::FormantPeaks:
            return true;

        case OscProcessType::Off:
        case OscProcessType::BendPlus:
        case OscProcessType::BendMinus:
        case OscProcessType::BendBoth:
        case OscProcessType::Sync:
        case OscProcessType::Mirror:
        case OscProcessType::Asym:
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
        case OscProcessType::PhaseShift:
        case OscProcessType::SineWarp:
        case OscProcessType::Ripple:
        case OscProcessType::Twist:
        case OscProcessType::ZigZag:
        case OscProcessType::Staircase:
        case OscProcessType::Reverse:
        case OscProcessType::Quantize4:
        case OscProcessType::Quantize8:
        case OscProcessType::Quantize16:
        case OscProcessType::Scramble2:
        case OscProcessType::Scramble4:
        case OscProcessType::Chaos:
        case OscProcessType::Window:
        case OscProcessType::PulseWarp:
        case OscProcessType::Shred:
        case OscProcessType::Count:
            return false;
    }
    return false;
}
constexpr bool oscProcessUsesSeed(OscProcessType type) noexcept {
    return type==OscProcessType::RandAmp || type==OscProcessType::RandSparse;
}
inline constexpr float spectralAmountSteps=32.0f;
inline constexpr std::size_t maxOscProcessStages=8;
struct OscProcessStage {
    OscProcessType type=OscProcessType::Off;
    float amount=0.0f;
    std::uint32_t seed=0;
};
struct OscProcessPlan {
    std::array<OscProcessStage,maxOscProcessStages> stages{};
    std::uint8_t count=0;
};

const char* oscProcessName(OscProcessType type) noexcept;
const char* oscProcessCategory(OscProcessType type) noexcept;
double processOscillatorPhase(double phase,OscProcessType type,float amount) noexcept;
void renderProcessedFrame2048(const float* input,float* output,
                              OscProcessType process1,float amount1,std::uint32_t seed1,
                              OscProcessType process2,float amount2,std::uint32_t seed2) noexcept;
void renderProcessedFrame2048(const float* input,float* output,
                              const OscProcessPlan& plan) noexcept;

// mct-origami-deep-audit-p01-no-rt-spectral-build
bool prepareSpectralCompiler() noexcept;
void assignWavetableGeneration(struct Wavetable&) noexcept;
struct SpectralCompilerStats {
    std::uint64_t requests=0,prepared=0,fallbackReads=0,droppedRequests=0;
    // mct-origami-nested-modulation-manual-qa: reads served by the previous
    // table of the same frame / band while the new one is built, and table
    // switches crossfaded.
    std::uint64_t heldReads=0,transitions=0;
};
// Every read the cache could not serve with the requested table (held or dry).
inline std::uint64_t spectralMisses(const SpectralCompilerStats& s) noexcept { return s.fallbackReads+s.heldReads; }
// Length of a spectral table transition (a crossfade between two cached
// tables of the same frame / band): 2 ms.
inline constexpr double spectralTransitionSeconds=0.002;
SpectralCompilerStats spectralCompilerStats() noexcept;
// Owned, immutable during rendering. Samples contain one cycle (no guard sample).
// Frames share band limits and table length. Future importers can populate this
// representation off-thread; hosts must keep the bank alive until processing stops.
struct WavetableBand { unsigned maximumHarmonic = 1; std::vector<float> samples; };
struct WavetableFrame { std::vector<WavetableBand> bands; };
struct Wavetable {
    std::string name;
    std::size_t tableLength = 0;
    std::uint64_t generation = 0;
    std::vector<WavetableFrame> frames;
    bool valid() const noexcept;
    static Wavetable builtIns(); // Non-realtime generation only.
};
// Audio-owned lookup metadata only. Cache samples remain worker-owned and are
// read under a bounded pin; no pointer to recyclable sample storage escapes.
// mct-origami-dsp-performance-stereo-chain: the hint no longer carries a copy
// of the process plan (~100 B); it is validated against the pinned cache
// slot's own key instead (exact). Every oscillator holds two hints, so this
// is most of a voice's footprint.
struct SpectralReadHint {
    const Wavetable* table=nullptr;
    std::uint64_t generation=0,revision=0;
    std::uint32_t frame=0,band=0,slot=0;
    unsigned hits=0;
    // mct-origami-nested-modulation-manual-qa: transition state. A new table
    // for the same frame / band is crossfaded in from the previous one
    // (fromSlot); while a new table is still being built the previous one is
    // held (never the dry fallback). `quantized`: the hint slot holds the
    // quantized key of a chain whose phase-stage amounts are moving; `print`
    // / `stable` detect when the exact plan settles again.
    std::uint64_t fromRevision=0;
    std::uint32_t fromSlot=0,print=0;
    std::uint16_t fade=0,fadeLength=0,stable=0;
    bool quantized=false;
};
class WavetableOscillator {
public:
    void reset(double phase = 0) noexcept;
    float next(const Wavetable& table,double frequency,double sampleRate,float position,
               OscProcessType process1=OscProcessType::Off,float amount1=0.0f,
               OscProcessType process2=OscProcessType::Off,float amount2=0.0f,
               double phaseOffsetCycles=0.0,
               double phaseSkew=0.0,
               std::uint32_t process1Seed=0x13579bdfu,
               std::uint32_t process2Seed=0x2468ace1u) noexcept;
    float next(const Wavetable& table,double frequency,double sampleRate,float position,
               const OscProcessPlan& plan,double phaseOffsetCycles=0.0,
               double phaseSkew=0.0) noexcept;
    // Compiled topology guarantees no processes or cross-oscillator routing.
    float nextSimple(const Wavetable&,double frequency,double sampleRate,float position) noexcept;
    // Stereo modulation of the READ side (WT position, OSC CHAIN amounts,
    // PM / PSK): one phase advance, a second read at the same phase into
    // `right`. LEFT is bit-identical to next() / nextSimple().
    // frequencyRight > 0 (stereo FM): RIGHT advances its own phase at that
    // frequency, seeded from LEFT's phase the first time; otherwise RIGHT
    // reads at LEFT's phase and any separate RIGHT phase is dropped.
    float nextStereo(const Wavetable&,double frequency,double sampleRate,
                     float position,const OscProcessPlan&,double phaseOffsetCycles,double phaseSkew,
                     float positionRight,const OscProcessPlan& planRight,double phaseOffsetRight,double phaseSkewRight,
                     std::array<SpectralReadHint,2>& rightHints,float& right,double frequencyRight=0.0) noexcept;
    float nextStereoSimple(const Wavetable&,double frequency,double sampleRate,float position,float positionRight,
                           std::array<SpectralReadHint,2>& rightHints,float& right) noexcept;
    double phase() const noexcept { return phase_; }
    // The next separate RIGHT phase (stereo FM) starts again from LEFT's.
    void restartRightPhase() noexcept { rightPhaseLive_=false; }
private:
    void preparePitch(const Wavetable&,double frequency,double sampleRate) noexcept;
    template<bool Simple> float readAt(const Wavetable&,float position,const OscProcessPlan&,double,double,
                                       std::array<SpectralReadHint,2>&,double phase,std::size_t band,double sampleRate) noexcept;
    template<bool Simple> float nextImpl(const Wavetable&,double,double,float,
        const OscProcessPlan&,double,double) noexcept;
    template<bool Simple> float nextStereoImpl(const Wavetable&,double,double,float,const OscProcessPlan&,double,double,
        float,const OscProcessPlan&,double,double,std::array<SpectralReadHint,2>&,float&,double frequencyRight) noexcept;
    double phase_ = 0;
    // Pitch metadata is independent of phase and chain amounts. Exact keys
    // keep FM, glide and sample-rate changes audio-rate without rescanning
    // band limits for every stable-pitch unison sample.
    const Wavetable* pitchTable_=nullptr;
    std::uint64_t pitchGeneration_=0;
    double pitchFrequency_=0,pitchSampleRate_=0,increment_=0;
    std::size_t bandIndex_=0;
    std::array<SpectralReadHint,2> spectralHints_{};
    double phaseRight_ = 0;      // cold: stereo FM only
    bool rightPhaseLive_=false;
};
double midiFrequency(int note) noexcept;
}
