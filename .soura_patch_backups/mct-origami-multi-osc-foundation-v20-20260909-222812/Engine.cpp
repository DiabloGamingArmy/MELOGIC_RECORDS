#include "Engine.h"
#include <algorithm>
#include <cmath>
#include <limits>
#include <utility>
namespace mct::origami {
OrigamiEngine::OrigamiEngine() noexcept {
    for (const auto& p : parameterRegistry()) targets_[static_cast<std::size_t>(p.id)].store(p.defaultValue, std::memory_order_relaxed);
    reset();
}
bool OrigamiEngine::prepare(double sampleRate, std::size_t maximumBlockSize, unsigned outputChannels) {
    if (!std::isfinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000 || maximumBlockSize == 0 || (outputChannels != 1 && outputChannels != 2)) return false;
    if (wavetable_.frames.empty()) wavetable_ = dsp::Wavetable::builtIns();
    sampleRate_ = sampleRate; outputChannels_ = outputChannels;
    stealFadeSamples_ = static_cast<std::size_t>(std::max(1.0, std::round(sampleRate * .003)));
    for (auto& voice : voices_) voice.prepare(sampleRate);
    for (auto& voice : stealTails_) voice.prepare(sampleRate);
    prepared_ = true; reset(); return true;
}
bool OrigamiEngine::installWavetable(dsp::Wavetable table) {
    if (!table.valid()) return false;
    wavetable_ = std::move(table); reset(); return true;
}
void OrigamiEngine::reset() noexcept {
    for (auto& voice : voices_) voice.reset();
    for (auto& voice : stealTails_) voice.reset();
    tailRemaining_.fill(0); order_ = 0;
    for (std::size_t i = 0; i < parameterCount; ++i) { const float v = targets_[i].load(std::memory_order_relaxed); smooth_[i] = {v,v,0,0}; }
}
bool OrigamiEngine::applyPatchState(const ParameterValues& values) noexcept {
    ParameterValues sanitized {};
    for (std::size_t i = 0; i < parameterCount; ++i) if (!sanitizeParameter(static_cast<ParameterId>(i), values[i], sanitized[i])) return false;
    for (std::size_t i = 0; i < parameterCount; ++i) targets_[i].store(sanitized[i], std::memory_order_relaxed);
    reset(); return true;
}
ParameterValues OrigamiEngine::parameterState() const noexcept {
    ParameterValues values {};
    for (std::size_t i = 0; i < parameterCount; ++i) values[i] = targets_[i].load(std::memory_order_relaxed);
    return values;
}
bool OrigamiEngine::setParameter(ParameterId id, float physicalValue) noexcept {
    float v = 0; if (!sanitizeParameter(id, physicalValue, v)) return false;
    targets_[static_cast<std::size_t>(id)].store(v, std::memory_order_relaxed); return true;
}
bool OrigamiEngine::setParameter(std::string_view id, float physicalValue) noexcept { const auto* p = findParameter(id); return p && setParameter(p->id, physicalValue); }
dsp::EnvelopeSettings OrigamiEngine::envelopeSettings() const noexcept {
    auto read = [this](ParameterId id) { return targets_[static_cast<std::size_t>(id)].load(std::memory_order_relaxed); };
    return {read(ParameterId::Attack),read(ParameterId::Decay),read(ParameterId::Sustain),read(ParameterId::Release)};
}
bool OrigamiEngine::noteOn(int note, float velocity, std::uint8_t channel, std::uint32_t noteId) noexcept {
    if (!prepared_ || note < 0 || note > 127 || channel > 15 || !std::isfinite(velocity)) return false;
    if (velocity <= 0) { noteOff(note, channel, noteId); return true; }
    std::size_t chosen = voiceCount;
    for (std::size_t i = 0; i < voiceCount; ++i) if (!voices_[i].info().active) { chosen = i; break; }
    if (chosen == voiceCount) {
        // Prefer the quietest releasing voice, then oldest held voice; lowest slot
        // breaks ties. One fixed three-ms tail per slot bounds stealing cost.
        chosen = 0;
        for (std::size_t i = 1; i < voiceCount; ++i) {
            const auto candidate = voices_[i].info(), best = voices_[chosen].info();
            if ((candidate.releasing && !best.releasing) ||
                (candidate.releasing && best.releasing && candidate.envelope < best.envelope) ||
                (candidate.releasing == best.releasing && (!candidate.releasing || candidate.envelope == best.envelope) && candidate.order < best.order)) chosen = i;
        }
        stealTails_[chosen] = voices_[chosen]; tailRemaining_[chosen] = stealFadeSamples_;
    }
    voices_[chosen].start({note,channel,noteId}, std::clamp(velocity,0.f,1.f), ++order_, envelopeSettings());
    return true;
}
bool OrigamiEngine::noteOff(int note, std::uint8_t channel, std::uint32_t noteId) noexcept {
    if (!prepared_ || note < 0 || note > 127 || channel > 15) return false;
    std::size_t chosen = voiceCount;
    for (std::size_t i = 0; i < voiceCount; ++i) {
        const auto info = voices_[i].info();
        if (!info.active || info.releasing || info.address.note != note || info.address.channel != channel || (noteId && info.address.noteId != noteId)) continue;
        if (chosen == voiceCount || info.order < voices_[chosen].info().order) chosen = i;
    }
    if (chosen != voiceCount) voices_[chosen].release(envelopeSettings());
    return true;
}
void OrigamiEngine::allNotesOff() noexcept { const auto settings = envelopeSettings(); for (auto& voice : voices_) voice.release(settings); }
void OrigamiEngine::latchParameters() noexcept {
    for (const auto& p : parameterRegistry()) {
        const auto i = static_cast<std::size_t>(p.id); const float target = targets_[i].load(std::memory_order_relaxed);
        auto& s = smooth_[i]; if (target == s.target) continue;
        s.target = target; s.remaining = static_cast<std::size_t>(std::round(sampleRate_ * p.smoothingSeconds));
        if (s.remaining) s.step = (double(target)-s.value)/static_cast<double>(s.remaining);
        else s.value = target;
    }
}
bool OrigamiEngine::process(float* const* output, unsigned channels, std::size_t sampleCount) noexcept {
    if (!sampleCount) return true;
    if (!output || channels < 1 || channels > 2) return false;
    for (unsigned c = 0; c < channels; ++c) if (!output[c]) return false;
    for (unsigned c = 0; c < channels; ++c) std::fill_n(output[c], sampleCount, 0.f);
    if (!prepared_ || channels != outputChannels_) return false;
    latchParameters();

    // mct-origami-tuning-engine-v17
    const double tuningSemitones =
        static_cast<double>(value(ParameterId::OscOctave)) * 12.0 +
        static_cast<double>(value(ParameterId::OscSemitone)) +
        static_cast<double>(value(ParameterId::OscFine)) / 100.0;
    const double oscillatorFrequencyScale = std::exp2(tuningSemitones / 12.0);

        const unsigned oscillatorUnison = static_cast<unsigned>(
        std::clamp(static_cast<int>(std::lround(value(ParameterId::OscUnison))), 1, 16));
    const float oscillatorDetune = value(ParameterId::OscDetune);
for (std::size_t sample = 0; sample < sampleCount; ++sample) {
        for (auto& s : smooth_) if (s.remaining) { s.value += static_cast<float>(s.step); if (--s.remaining == 0) s.value = s.target; }
        const auto filter = dsp::LowPassCoefficients::make(sampleRate_, value(ParameterId::Cutoff), value(ParameterId::Resonance));
        const float position = value(ParameterId::Waveform)/3, sustain = value(ParameterId::Sustain);
        double mix = 0;
        for (std::size_t v = 0; v < voiceCount; ++v) {
            float fresh = voices_[v].next(wavetable_, position, sustain, filter, oscillatorFrequencyScale, oscillatorUnison, oscillatorDetune);
            if (tailRemaining_[v]) {
                const float oldWeight = static_cast<float>(tailRemaining_[v]) / static_cast<float>(stealFadeSamples_);
                fresh = fresh * (1-oldWeight) + stealTails_[v].next(wavetable_, position, sustain, filter, oscillatorFrequencyScale, oscillatorUnison, oscillatorDetune) * oldWeight;
                if (--tailRemaining_[v] == 0) stealTails_[v].reset();
            }
            mix += fresh;
        }
        const float out = static_cast<float>(mix * value(ParameterId::OscLevel) * value(ParameterId::MasterGain));
        if (channels == 1) output[0][sample] = out;
        else {
            const double angle = (value(ParameterId::OscPan)+1) * .7853981633974483;
            output[0][sample] = out * static_cast<float>(std::cos(angle));
            output[1][sample] = out * static_cast<float>(std::sin(angle));
        }
    }
    return true;
}
VoiceInfo OrigamiEngine::voiceInfo(std::size_t index) const noexcept { return index < voiceCount ? voices_[index].info() : VoiceInfo{}; }
std::size_t OrigamiEngine::activeVoiceCount() const noexcept { std::size_t count=0; for (const auto& voice : voices_) if (voice.info().active) ++count; return count; }
}
