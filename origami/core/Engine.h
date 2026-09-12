// mct-origami-audio-reengineer-p09-lightweight-voice-steal
// mct-origami-audio-reengineer-p06.3-local-source
// mct-origami-v32.1.1-extended-mod-sources-hotfix
// mct-origami-v28.0.0-interactive-envelope-editor
// mct-origami-modulation-completion-v24.0.1
// mct-origami-glide-mono-legato-v23.4.3
// mct-origami-pitch-mod-real-v23.3
// mct-origami-v34.2.1-performance-reinforcement
#pragma once
#include "ParameterRegistry.h"
#include "Voice.h"
#include "OscillatorModule.h"
#include "InstrumentState.h"
#include "RenderBudget.h"
#include <array>
#include <atomic>
#include <cstddef>
namespace mct::origami {
class OrigamiEngine {
public:
    static constexpr std::size_t voiceCount = 16;
    OrigamiEngine() noexcept;
    // Non-realtime, exclusive access. prepare may allocate or throw bad_alloc.
    bool prepare(double sampleRate, std::size_t maximumBlockSize, unsigned outputChannels);
    bool installWavetable(dsp::Wavetable table); // validate/move with processing stopped
    bool applyPatchState(const ParameterValues& values) noexcept; // exclusive, resets voices
    InstrumentState instrumentState() const noexcept; // serialize writers externally
    bool restoreInstrumentState(const InstrumentState&) noexcept; // exclusive, transactional
    bool setModulationState(const ModulationState&) noexcept; // serialized non-realtime writer
    ParameterValues parameterState() const noexcept;
    // Atomic targets are the sole cross-thread API. Multi-parameter patch commits
    // require exclusive access; hosts dispatch MIDI/process/reset on the audio thread.
    bool setParameter(ParameterId id, float physicalValue) noexcept;
    bool setParameter(std::string_view id, float physicalValue) noexcept;
    void reset() noexcept;
    bool noteOn(int note, float velocity, std::uint8_t channel = 0, std::uint32_t noteId = 0) noexcept;
    bool noteOff(int note, std::uint8_t channel = 0, std::uint32_t noteId = 0) noexcept;
    void allNotesOff() noexcept;
    void pitchWheel(std::uint8_t channel,int value14) noexcept;
    void modWheel(std::uint8_t channel,int value7) noexcept;
    void aftertouch(std::uint8_t channel,int value7) noexcept;
    bool setPitchBendRange(float semitones) noexcept;
    float pitchBendRange() const noexcept { return pitchBendRange_.load(std::memory_order_relaxed); }
    bool setPerformanceState(const PerformanceState&) noexcept;
    PerformanceState performanceState() const noexcept;
    // Replaces output, planar mono/stereo. Buffers must be distinct and valid for
    // sampleCount. Any block length is supported; zero frames is a harmless no-op.
    bool process(float* const* output, unsigned channels, std::size_t sampleCount) noexcept;
    bool beginHostBlock(unsigned channels) noexcept;
    bool processSpan(float* const* output, unsigned channels, std::size_t sampleCount) noexcept;
    void endHostBlock() noexcept;
    VoiceInfo voiceInfo(std::size_t index) const noexcept;
    std::size_t activeVoiceCount() const noexcept;
    RenderLoad renderLoad() const noexcept;
    void setVoiceAdmissionCeiling(std::size_t ceiling) noexcept;
    std::size_t voiceAdmissionCeiling() const noexcept { return voiceAdmissionCeiling_; }
    // mct-origami-multi-osc-foundation-v20
    OscillatorModuleId addOscillatorModule() noexcept;
    bool removeOscillatorModule(OscillatorModuleId id) noexcept;
    std::size_t oscillatorModuleCount() const noexcept { return oscillatorModules_.count(); }
    const OscillatorModuleBank& oscillatorModules() const noexcept { return oscillatorModules_; }
    bool setOscillatorModuleState(OscillatorModuleId id,const OscillatorModuleState& state) noexcept;
    OscillatorModuleState oscillatorModuleState(OscillatorModuleId id) const noexcept;
    bool setOscillatorModuleEnabled(OscillatorModuleId id,bool enabled) noexcept;
    bool oscillatorModuleEnabled(OscillatorModuleId id) const noexcept;
private:
    struct Smoothed { float value=0, target=0; double step=0; std::size_t remaining=0; };
    dsp::EnvelopeSettings envelopeSettings() const noexcept;
    dsp::EnvelopeSettings modulationEnvelopeSettings(unsigned index) const noexcept;
    void publishModEnvelopeTargets(const ModulationState&) noexcept;
    void latchParameters() noexcept;
    float value(ParameterId id) const noexcept { return smooth_[static_cast<std::size_t>(id)].value; }
    ModulationState modulation_{}; // non-realtime model; never read in process
    LatestStateMailbox<ModulationState> modulationMailbox_;
    ModulationState audioModulation_{};
    CompiledModulation compiledModulation_;
    std::array<OscillatorModuleId,16> compiledModuleIds_{};
    std::array<Lfo,4> globalLfos_{};
    RandomGenerator globalRandom_{};
    FunctionGenerator globalFunction_{};
    ChaosGenerator globalChaos_{};
    DriftGenerator globalDrift_{};
    SequencerGenerator globalSequencer_{};
    std::array<float,4> smoothedMacros_{};
    float modulationSmoothing_=1;
    OscillatorModuleBank oscillatorModules_;
    std::uint64_t hostModuleGeneration_=0;
    std::array<std::atomic<float>, parameterCount> targets_;
    std::array<Smoothed, parameterCount> smooth_ {};
    std::array<OscillatorModuleState, OscillatorModuleBank::capacity> hostModules_ {};
    double hostNormalization_ = 1.0;
    float hostBendRange_ = 2.0f;
    unsigned hostChannels_ = 0;
    bool hostBlockActive_ = false;
    std::array<Voice, voiceCount> voices_;
    // Patch 09/19: voice stealing must not clone and double-render a complete
    // wavetable/modulation/filter Voice at the exact moment polyphony is saturated.
    // Preserve click-free continuity with a tiny residual sample tail instead.
    std::array<Voice::Samples, voiceCount> lastVoiceSamples_{};
    std::array<Voice::Samples, voiceCount> stealResidual_{};
    std::array<std::size_t, voiceCount> tailRemaining_{};
    dsp::Wavetable wavetable_;
    double sampleRate_ = 48000;
    unsigned outputChannels_ = 2;
    std::size_t stealFadeSamples_ = 144;
    std::uint64_t order_ = 0;
    struct HeldNote { NoteAddress address{}; float velocity=0; std::uint64_t order=0; bool held=false; };
    bool sameAddress(const NoteAddress&,const NoteAddress&) const noexcept;
    const HeldNote* selectedMonoHeld() const noexcept;
    std::size_t selectVoiceStealCandidate() const noexcept;
    void clearHeldNotes() noexcept;
    std::array<float,16> pitchBendNormalized_{};
    std::array<float,16> modWheel_{},aftertouch_{};
    std::array<std::atomic<float>,17> modEnvelopeTargets_{};
    std::atomic<float> pitchBendRange_{2.0f};
    PerformanceState performance_{};
    std::array<HeldNote,128> heldNotes_{};
    std::size_t heldCount_=0;
    // Deep Audit P07: this limits only future polyphonic admissions. Existing
    // voices are never terminated when the ceiling drops.
    std::size_t voiceAdmissionCeiling_=voiceCount;
    bool prepared_ = false;
};
static_assert(std::atomic<float>::is_always_lock_free, "Origami requires lock-free float parameter targets");
}
