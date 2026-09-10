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
bool OrigamiEngine::process(float* const* output,unsigned channels,std::size_t sampleCount) noexcept {
    if(!sampleCount) return true;
    if(!output || channels<1 || channels>2) return false;
    for(unsigned c=0;c<channels;++c) if(!output[c]) return false;
    for(unsigned c=0;c<channels;++c) std::fill_n(output[c],sampleCount,0.f);
    if(!prepared_ || channels!=outputChannels_) return false;

    latchParameters();
    auto modules=oscillatorModules_.snapshot();

    for(std::size_t sample=0;sample<sampleCount;++sample) {
        for(auto& s:smooth_) if(s.remaining) {
            s.value+=static_cast<float>(s.step);
            if(--s.remaining==0) s.value=s.target;
        }

        modules[0].id=1;
        // Preserve OSC1 power state from the module snapshot.
        modules[0].waveform=value(ParameterId::Waveform);
        modules[0].octave=value(ParameterId::OscOctave);
        modules[0].semitone=value(ParameterId::OscSemitone);
        modules[0].fineCents=value(ParameterId::OscFine);
        modules[0].unison=static_cast<unsigned>(std::clamp(
            static_cast<int>(std::lround(value(ParameterId::OscUnison))),1,16));
        modules[0].detuneCents=value(ParameterId::OscDetune);
        modules[0].pan=value(ParameterId::OscPan);
        modules[0].level=value(ParameterId::OscLevel);

        const auto filter=dsp::LowPassCoefficients::make(
            sampleRate_,value(ParameterId::Cutoff),value(ParameterId::Resonance));
        const float sustain=value(ParameterId::Sustain);

        double left=0.0,right=0.0,mono=0.0;
        std::size_t activeModules=0;
        for(const auto& m:modules) if(m.enabled) ++activeModules;
        const double normalization=activeModules ? 1.0/static_cast<double>(activeModules) : 1.0;

        for(std::size_t v=0;v<voiceCount;++v) {
            auto fresh=voices_[v].nextModules(wavetable_,modules,sustain,filter);
            Voice::ModuleSamples old{};
            float oldWeight=0.0f;

            if(tailRemaining_[v]) {
                oldWeight=static_cast<float>(tailRemaining_[v])/static_cast<float>(stealFadeSamples_);
                old=stealTails_[v].nextModules(wavetable_,modules,sustain,filter);
                if(--tailRemaining_[v]==0) stealTails_[v].reset();
            }

            for(std::size_t m=0;m<modules.size();++m) {
                if(!modules[m].enabled) continue;
                const float sampleValue=(fresh[m]*(1.0f-oldWeight)+old[m]*oldWeight)*modules[m].level;
                if(channels==1) {
                    mono+=sampleValue;
                } else {
                    const double angle=(static_cast<double>(modules[m].pan)+1.0)*0.7853981633974483;
                    left+=sampleValue*std::cos(angle);
                    right+=sampleValue*std::sin(angle);
                }
            }
        }

        const float master=value(ParameterId::MasterGain)*static_cast<float>(normalization);
        if(channels==1) output[0][sample]=static_cast<float>(mono)*master;
        else {
            output[0][sample]=static_cast<float>(left)*master;
            output[1][sample]=static_cast<float>(right)*master;
        }
    }
    return true;
}
OscillatorModuleId OrigamiEngine::addOscillatorModule() noexcept {
    OscillatorModuleState s;
    s.enabled=true;
    s.waveform=targets_[static_cast<std::size_t>(ParameterId::Waveform)].load(std::memory_order_relaxed);
    s.octave=targets_[static_cast<std::size_t>(ParameterId::OscOctave)].load(std::memory_order_relaxed);
    s.semitone=targets_[static_cast<std::size_t>(ParameterId::OscSemitone)].load(std::memory_order_relaxed);
    s.fineCents=targets_[static_cast<std::size_t>(ParameterId::OscFine)].load(std::memory_order_relaxed);
    s.unison=static_cast<unsigned>(std::clamp(
        static_cast<int>(std::lround(targets_[static_cast<std::size_t>(ParameterId::OscUnison)].load(std::memory_order_relaxed))),1,16));
    s.detuneCents=targets_[static_cast<std::size_t>(ParameterId::OscDetune)].load(std::memory_order_relaxed);
    s.pan=targets_[static_cast<std::size_t>(ParameterId::OscPan)].load(std::memory_order_relaxed);
    s.level=targets_[static_cast<std::size_t>(ParameterId::OscLevel)].load(std::memory_order_relaxed);
    return oscillatorModules_.add(s);
}
bool OrigamiEngine::removeOscillatorModule(OscillatorModuleId id) noexcept {
    return oscillatorModules_.remove(id);
}
bool OrigamiEngine::setOscillatorModuleState(OscillatorModuleId id,const OscillatorModuleState& state) noexcept {
    if(id==1) return false;
    return oscillatorModules_.set(id,state);
}
OscillatorModuleState OrigamiEngine::oscillatorModuleState(OscillatorModuleId id) const noexcept {
    return oscillatorModules_.state(id);
}
bool OrigamiEngine::setOscillatorModuleEnabled(OscillatorModuleId id,bool enabled) noexcept {
    return oscillatorModules_.setEnabled(id,enabled);
}
bool OrigamiEngine::oscillatorModuleEnabled(OscillatorModuleId id) const noexcept {
    return oscillatorModules_.enabled(id);
}

VoiceInfo OrigamiEngine::voiceInfo(std::size_t index) const noexcept { return index < voiceCount ? voices_[index].info() : VoiceInfo{}; }
std::size_t OrigamiEngine::activeVoiceCount() const noexcept { std::size_t count=0; for (const auto& voice : voices_) if (voice.info().active) ++count; return count; }
}
