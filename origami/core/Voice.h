#pragma once
#include "dsp/Wavetable.h"
#include "dsp/Envelope.h"
#include "dsp/Filter.h"
#include "OscillatorModule.h"
#include <cstdint>
#include <array>
namespace mct::origami {
struct NoteAddress { int note = 60; std::uint8_t channel = 0; std::uint32_t noteId = 0; };
struct VoiceInfo { NoteAddress address {}; std::uint64_t order = 0; bool active = false, releasing = false; float envelope = 0; };
class Voice {
public:
    void prepare(double sampleRate) noexcept;
    void reset() noexcept;
    void start(NoteAddress address, float velocity, std::uint64_t order, const dsp::EnvelopeSettings& settings) noexcept;
    void release(const dsp::EnvelopeSettings& settings) noexcept;
    using ModuleSamples = std::array<float,16>;
    ModuleSamples nextModules(const dsp::Wavetable& table,
                              const std::array<OscillatorModuleState,16>& modules,
                              float sustain,
                              const dsp::LowPassCoefficients& filter) noexcept;
    VoiceInfo info() const noexcept;
private:
    // mct-origami-unison-detune-v19.2
    static constexpr unsigned maxOscillatorModules = 16;
    static constexpr unsigned maxUnisonVoices = 16;
    using ModuleOscillators = std::array<dsp::WavetableOscillator, maxUnisonVoices>;
    std::array<ModuleOscillators, maxOscillatorModules> moduleOscillators_{};
    std::array<OscillatorModuleId,maxOscillatorModules> moduleIds_{};
    dsp::Envelope envelope_;
    std::array<dsp::LowPassFilter,maxOscillatorModules> moduleFilters_{};
    NoteAddress address_ {};
    std::uint64_t order_ = 0;
    double sampleRate_ = 48000, frequency_ = 440;
    float velocity_ = 0;
    bool active_ = false, releasing_ = false;
};
}
