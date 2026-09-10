#include "Voice.h"
#include <algorithm>
#include <cmath>
namespace mct::origami {
void Voice::prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; envelope_.prepare(sampleRate); reset(); }
void Voice::reset() noexcept { for (auto& oscillator : oscillators_) oscillator.reset(); envelope_.reset(); filter_.reset(); active_ = releasing_ = false; velocity_ = 0; order_ = 0; }
void Voice::start(NoteAddress address, float velocity, std::uint64_t order, const dsp::EnvelopeSettings& settings) noexcept {
    reset(); address_ = address; velocity_ = velocity; order_ = order;
    frequency_ = dsp::midiFrequency(address.note); active_ = true; envelope_.noteOn(settings);
}
void Voice::release(const dsp::EnvelopeSettings& settings) noexcept { if (active_) { releasing_ = true; envelope_.noteOff(settings); } }
float Voice::next(const dsp::Wavetable& table, float position, float sustain,
                  const dsp::LowPassCoefficients& filter, double frequencyScale,
                  unsigned unisonVoices, float detuneCents) noexcept {
    if (!active_) return 0;
    if (!std::isfinite(frequencyScale) || frequencyScale <= 0.0) frequencyScale = 1.0;

    const unsigned count = std::clamp(unisonVoices, 1u, maxUnisonVoices);
    const float spreadCents = std::clamp(detuneCents, 0.0f, 100.0f);

    float oscillatorMix = 0.0f;
    if (count == 1) {
        oscillatorMix = oscillators_[0].next(table, frequency_ * frequencyScale, sampleRate_, position);
    } else {
        for (unsigned i = 0; i < count; ++i) {
            const double unit = (2.0 * static_cast<double>(i) / static_cast<double>(count - 1)) - 1.0;
            const double detuneRatio = std::exp2((unit * static_cast<double>(spreadCents)) / 1200.0);
            oscillatorMix += oscillators_[i].next(
                table, frequency_ * frequencyScale * detuneRatio, sampleRate_, position);
        }
        oscillatorMix /= static_cast<float>(count);
    }

    const float sample = oscillatorMix * envelope_.next(sustain) * velocity_;
    const float output = filter_.next(sample, filter);
    if (envelope_.stage() == dsp::Envelope::Stage::Idle && filter_.quiet()) reset();
    return output;
}
VoiceInfo Voice::info() const noexcept { return {address_, order_, active_, releasing_, envelope_.value()}; }
}
