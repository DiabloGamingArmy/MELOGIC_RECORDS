#include "Voice.h"
#include <algorithm>
#include <cmath>
namespace mct::origami {
void Voice::prepare(double sampleRate) noexcept { sampleRate_ = sampleRate; envelope_.prepare(sampleRate); reset(); }
void Voice::reset() noexcept { lfo1_.reset(); for (auto& module : moduleOscillators_) for (auto& oscillator : module) oscillator.reset(); envelope_.reset(); for (auto& filter : moduleFilters_) filter.reset(); active_ = releasing_ = false; velocity_ = 0; order_ = 0; }
void Voice::start(NoteAddress address, float velocity, std::uint64_t order, const dsp::EnvelopeSettings& settings) noexcept {
    reset(); address_ = address; velocity_ = velocity; order_ = order;
    frequency_ = dsp::midiFrequency(address.note); active_ = true; envelope_.noteOn(settings);
}
void Voice::release(const dsp::EnvelopeSettings& settings) noexcept { if (active_) { releasing_ = true; envelope_.noteOff(settings); } }
Voice::Samples Voice::nextModules(const dsp::Wavetable& table,const ModulationFrame& global,
    float sustain,const CompiledModulation& compiled,const LfoSettings& lfoSettings) noexcept {
    Samples outputs{};
    if(!active_) return outputs;
    const float envelope=envelope_.next(sustain);
    const float envelopeValue=envelope*velocity_;
    const float lfo=lfoSettings.mode==LfoMode::NoteRetrigger ? lfo1_.next(lfoSettings,sampleRate_) : 0;
    ModulationFrame local;
    const ModulationFrame* effective=&global;
    if(compiled.hasVoiceRoutes()) {
        local=global;compiled.voiceFrame(local,envelope,lfo,sampleRate_);effective=&local;
    }
    const auto& modules=effective->modules;
    bool filtersQuiet=true;

    for(std::size_t m=0;m<modules.size();++m) {
        const auto& module=modules[m];
        if(moduleIds_[m]!=module.id) {
            for(auto& oscillator:moduleOscillators_[m]) oscillator.reset();
            moduleFilters_[m].reset();moduleIds_[m]=module.id;
        }
        if(module.id==0 || !module.enabled) continue;

        const double semitones =
            static_cast<double>(module.octave)*12.0 +
            static_cast<double>(module.semitone) +
            static_cast<double>(module.fineCents)/100.0;
        const double frequencyScale=std::exp2(semitones/12.0);
        const unsigned count=std::clamp(module.unison,1u,maxUnisonVoices);
        const float spreadCents=std::clamp(module.detuneCents,0.0f,100.0f);
        const float position=module.wtPosition;

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

        const float sampleValue=moduleFilters_[m].next(oscillatorMix*envelopeValue,effective->filter)*module.level;
        const double panAngle=(static_cast<double>(module.pan)+1)*.7853981633974483;
        outputs.left+=sampleValue*std::cos(panAngle);
        outputs.right+=sampleValue*std::sin(panAngle);
        outputs.mono+=sampleValue;
        filtersQuiet=filtersQuiet && moduleFilters_[m].quiet();
    }

    if(envelope_.stage()==dsp::Envelope::Stage::Idle && filtersQuiet) reset();
    outputs.left*=effective->master;outputs.right*=effective->master;outputs.mono*=effective->master;
    return outputs;
}
VoiceInfo Voice::info() const noexcept { return {address_, order_, active_, releasing_, envelope_.value()}; }
}
