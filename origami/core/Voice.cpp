#include "Voice.h"
#include <algorithm>
#include <cmath>
namespace mct::origami {
void Voice::prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; envelope_.prepare(sampleRate); reset(); }
void Voice::reset() noexcept { for (auto& module : moduleOscillators_) for (auto& oscillator : module) oscillator.reset(); envelope_.reset(); for (auto& filter : moduleFilters_) filter.reset(); active_ = releasing_ = false; velocity_ = 0; order_ = 0; }
void Voice::start(NoteAddress address, float velocity, std::uint64_t order, const dsp::EnvelopeSettings& settings) noexcept {
    reset(); address_ = address; velocity_ = velocity; order_ = order;
    frequency_ = dsp::midiFrequency(address.note); active_ = true; envelope_.noteOn(settings);
}
void Voice::release(const dsp::EnvelopeSettings& settings) noexcept { if (active_) { releasing_ = true; envelope_.noteOff(settings); } }
Voice::ModuleSamples Voice::nextModules(
    const dsp::Wavetable& table,
    const std::array<OscillatorModuleState,16>& modules,
    float sustain,
    const dsp::LowPassCoefficients& filter) noexcept {
    ModuleSamples outputs{};
    if(!active_) return outputs;

    const float envelopeValue=envelope_.next(sustain)*velocity_;
    bool filtersQuiet=true;

    for(std::size_t m=0;m<modules.size();++m) {
        const auto& module=modules[m];
        if(!module.enabled) continue;

        const double semitones =
            static_cast<double>(module.octave)*12.0 +
            static_cast<double>(module.semitone) +
            static_cast<double>(module.fineCents)/100.0;
        const double frequencyScale=std::exp2(semitones/12.0);
        const unsigned count=std::clamp(module.unison,1u,maxUnisonVoices);
        const float spreadCents=std::clamp(module.detuneCents,0.0f,100.0f);
        const float position=std::clamp(module.waveform/3.0f,0.0f,1.0f);

        float oscillatorMix=0.0f;
        if(count==1) {
            oscillatorMix=moduleOscillators_[m][0].next(
                table,frequency_*frequencyScale,sampleRate_,position);
        } else {
            for(unsigned u=0;u<count;++u) {
                const double unit=(2.0*static_cast<double>(u)/static_cast<double>(count-1))-1.0;
                const double detuneRatio=std::exp2((unit*static_cast<double>(spreadCents))/1200.0);
                oscillatorMix+=moduleOscillators_[m][u].next(
                    table,frequency_*frequencyScale*detuneRatio,sampleRate_,position);
            }
            oscillatorMix/=static_cast<float>(count);
        }

        outputs[m]=moduleFilters_[m].next(oscillatorMix*envelopeValue,filter);
        filtersQuiet=filtersQuiet && moduleFilters_[m].quiet();
    }

    if(envelope_.stage()==dsp::Envelope::Stage::Idle && filtersQuiet) reset();
    return outputs;
}
VoiceInfo Voice::info() const noexcept { return {address_, order_, active_, releasing_, envelope_.value()}; }
}
