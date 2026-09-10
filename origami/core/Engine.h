#pragma once
#include "ParameterRegistry.h"
#include "Voice.h"
#include "OscillatorModule.h"
#include "InstrumentState.h"
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
    // Replaces output, planar mono/stereo. Buffers must be distinct and valid for
    // sampleCount. Any block length is supported; zero frames is a harmless no-op.
    bool process(float* const* output, unsigned channels, std::size_t sampleCount) noexcept;
    VoiceInfo voiceInfo(std::size_t index) const noexcept;
    std::size_t activeVoiceCount() const noexcept;
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
    void latchParameters() noexcept;
    float value(ParameterId id) const noexcept { return smooth_[static_cast<std::size_t>(id)].value; }
    ModulationState modulation_{}; // non-realtime model; never read in process
    LatestStateMailbox<ModulationState> modulationMailbox_;
    ModulationState audioModulation_{};
    CompiledModulation compiledModulation_;
    Lfo globalLfo_;
    std::array<float,4> smoothedMacros_{};
    float modulationSmoothing_=1;
    OscillatorModuleBank oscillatorModules_;
    std::array<std::atomic<float>, parameterCount> targets_;
    std::array<Smoothed, parameterCount> smooth_ {};
    std::array<Voice, voiceCount> voices_, stealTails_;
    std::array<std::size_t, voiceCount> tailRemaining_ {};
    dsp::Wavetable wavetable_;
    double sampleRate_ = 48000;
    unsigned outputChannels_ = 2;
    std::size_t stealFadeSamples_ = 144;
    std::uint64_t order_ = 0;
    bool prepared_ = false;
};
static_assert(std::atomic<float>::is_always_lock_free, "Origami requires lock-free float parameter targets");
}
