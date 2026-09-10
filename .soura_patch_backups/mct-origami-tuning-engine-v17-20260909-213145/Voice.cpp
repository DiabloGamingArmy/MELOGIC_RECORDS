#include "Voice.h"
namespace mct::origami {
void Voice::prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; envelope_.prepare(sampleRate); reset(); }
void Voice::reset() noexcept { oscillator_.reset(); envelope_.reset(); filter_.reset(); active_ = releasing_ = false; velocity_ = 0; order_ = 0; }
void Voice::start(NoteAddress address, float velocity, std::uint64_t order, const dsp::EnvelopeSettings& settings) noexcept {
    reset(); address_ = address; velocity_ = velocity; order_ = order;
    frequency_ = dsp::midiFrequency(address.note); active_ = true; envelope_.noteOn(settings);
}
void Voice::release(const dsp::EnvelopeSettings& settings) noexcept { if (active_) { releasing_ = true; envelope_.noteOff(settings); } }
float Voice::next(const dsp::Wavetable& table, float position, float sustain, const dsp::LowPassCoefficients& filter) noexcept {
    if (!active_) return 0;
    const float sample = oscillator_.next(table, frequency_, sampleRate_, position) * envelope_.next(sustain) * velocity_;
    const float output = filter_.next(sample, filter);
    if (envelope_.stage() == dsp::Envelope::Stage::Idle && filter_.quiet()) reset();
    return output;
}
VoiceInfo Voice::info() const noexcept { return {address_, order_, active_, releasing_, envelope_.value()}; }
}
