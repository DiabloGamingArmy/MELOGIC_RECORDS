// mct-origami-v31.0.0-matrix-routing-expansion
// mct-origami-v28.1.0-env-hold-live-tracer
// mct-origami-v27.0.0-cross-osc-routing-foundation
// mct-origami-modulation-completion-v24.0.1
// mct-origami-glide-mono-legato-v23.4.3
// mct-origami-pitch-mod-real-v23.3
#pragma once
#include "dsp/Wavetable.h"
#include "dsp/Envelope.h"
#include "dsp/Filter.h"
#include "OscillatorModule.h"
#include "modulation/Modulation.h"
#include <cstdint>
#include <array>
namespace mct::origami {
struct NoteAddress { int note = 60; std::uint8_t channel = 0; std::uint32_t noteId = 0; };
struct EnvelopeRuntimeInfo {
    dsp::Envelope::Stage stage=dsp::Envelope::Stage::Idle;
    float progress=0.0f;
    float value=0.0f;
};
struct VoiceInfo {
    NoteAddress address{};
    std::uint64_t order=0;
    bool active=false,releasing=false;
    float envelope=0.0f;
    std::array<EnvelopeRuntimeInfo,3> envelopes{};
};
struct EnvelopeTraceSnapshot {
    bool active=false;
    std::uint64_t order=0;
    std::array<EnvelopeRuntimeInfo,3> envelopes{};
};
class Voice {
public:
    void prepare(double sampleRate) noexcept;
    void reset() noexcept;
    void start(NoteAddress address,float velocity,std::uint64_t order,const dsp::EnvelopeSettings& settings,const dsp::EnvelopeSettings& env2,const dsp::EnvelopeSettings& env3) noexcept;
    void retarget(NoteAddress address,float velocity,std::uint64_t order,const dsp::EnvelopeSettings& settings,const dsp::EnvelopeSettings& env2,const dsp::EnvelopeSettings& env3,float glideSeconds,bool retriggerEnvelope) noexcept;
    void release(const dsp::EnvelopeSettings& settings,const dsp::EnvelopeSettings& env2,const dsp::EnvelopeSettings& env3) noexcept;
    struct Samples {double left=0,right=0,mono=0;};
    Samples nextModules(const dsp::Wavetable&,const ModulationFrame&,float sustain,
                        const CompiledModulation&,const ModulationState&,
                        float pitchBendSemitones,float pitchBendNormalized,
                        float modWheel,float aftertouch) noexcept;
    VoiceInfo info() const noexcept;
private:
    // mct-origami-unison-detune-v19.2
    static constexpr unsigned maxOscillatorModules = 16;
    static constexpr unsigned maxUnisonVoices = 16;
    using ModuleOscillators = std::array<dsp::WavetableOscillator, maxUnisonVoices>;
    std::array<ModuleOscillators, maxOscillatorModules> moduleOscillators_{};
    std::array<OscillatorModuleId,maxOscillatorModules> moduleIds_{};

    // One-sample-delayed oscillator taps used for cross-osc routing.
    // The delay guarantees deterministic routing with no oscillator-order
    // dependency and prevents algebraic feedback loops.
    std::array<float,maxOscillatorModules> previousOscillatorSamples_{};

    dsp::Envelope envelope_,env2_,env3_;
    std::array<Lfo,4> noteLfos_{};
    std::array<dsp::LowPassFilter,maxOscillatorModules> moduleFilters_{};
    NoteAddress address_ {};
    std::uint64_t order_ = 0;
    double sampleRate_ = 48000, frequency_ = 440, targetFrequency_ = 440, glideRatio_ = 1;
    std::size_t glideRemaining_ = 0;
    float velocity_ = 0;
    bool active_ = false, releasing_ = false;
};
}
