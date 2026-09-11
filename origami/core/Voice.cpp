// mct-origami-v32.0.0-dynamic-mod-filter-collections
// mct-origami-v31.0.0-matrix-routing-expansion
// mct-origami-v29.0.0-spectral-process-native-routing
// mct-origami-v28.1.0-env-hold-live-tracer
// mct-origami-v27.1.0-expanded-cross-osc-routing
// mct-origami-v27.0.0-cross-osc-routing-foundation
// mct-origami-v26.0.0-osc-process-foundation
// mct-origami-modulation-completion-v24.0.1
// mct-origami-glide-mono-legato-v23.4.3
// mct-origami-pitch-mod-real-v23.3
// mct-origami-v33.1.2-osc-blend-engine
#include "Voice.h"
#include <algorithm>
#include <cmath>
namespace mct::origami {
void Voice::prepare(double sampleRate) noexcept { sampleRate_=sampleRate;envelope_.prepare(sampleRate);env2_.prepare(sampleRate);env3_.prepare(sampleRate);reset(); }
void Voice::reset() noexcept { for(auto& lfo:noteLfos_)lfo.reset();for(auto& module:moduleOscillators_)for(auto& oscillator:module)oscillator.reset();for(auto& oscillator:moduleBlendCenters_)oscillator.reset();previousOscillatorSamples_.fill(0.0f);envelope_.reset();env2_.reset();env3_.reset();for(auto& filter:moduleFilters_)filter.reset();active_=releasing_=false;velocity_=0;order_=0; }
void Voice::start(NoteAddress address,float velocity,std::uint64_t order,const dsp::EnvelopeSettings& settings,const dsp::EnvelopeSettings& env2,const dsp::EnvelopeSettings& env3) noexcept {
    reset();address_=address;velocity_=velocity;order_=order;
    frequency_=targetFrequency_=dsp::midiFrequency(address.note);glideRatio_=1.0;glideRemaining_=0;
    active_=true;envelope_.noteOn(settings);env2_.noteOn(env2);env3_.noteOn(env3);
}
void Voice::retarget(NoteAddress address,float velocity,std::uint64_t order,const dsp::EnvelopeSettings& settings,const dsp::EnvelopeSettings& env2,const dsp::EnvelopeSettings& env3,float glideSeconds,bool retriggerEnvelope) noexcept {
    address_=address;velocity_=velocity;order_=order;active_=true;releasing_=false;
    targetFrequency_=dsp::midiFrequency(address.note);
    const auto samples=glideSeconds>0.0f ? static_cast<std::size_t>(std::round(glideSeconds*sampleRate_)) : 0u;
    if(samples==0 || frequency_<=0.0 || targetFrequency_<=0.0) {
        frequency_=targetFrequency_;glideRatio_=1.0;glideRemaining_=0;
    } else {
        glideRemaining_=samples;
        glideRatio_=std::exp(std::log(targetFrequency_/frequency_)/static_cast<double>(samples));
    }
    if(retriggerEnvelope) {envelope_.noteOn(settings);env2_.noteOn(env2);env3_.noteOn(env3);for(auto& lfo:noteLfos_)lfo.reset();}
}
void Voice::release(const dsp::EnvelopeSettings& settings,const dsp::EnvelopeSettings& env2,const dsp::EnvelopeSettings& env3) noexcept {
    if(active_){releasing_=true;envelope_.noteOff(settings);env2_.noteOff(env2);env3_.noteOff(env3);}
}
Voice::Samples Voice::nextModules(const dsp::Wavetable& table,const ModulationFrame& global,
    float sustain,const CompiledModulation& compiled,const ModulationState& modulation,
    float pitchBendSemitones,float pitchBendNormalized,float modWheel,float aftertouch) noexcept {
    Samples outputs{};
    if(!active_) return outputs;
    if(glideRemaining_) {
        frequency_*=glideRatio_;
        if(--glideRemaining_==0) {frequency_=targetFrequency_;glideRatio_=1.0;}
    }
    const float envelope=envelope_.next(sustain);
    const float envelopeValue=envelope*velocity_;
    const float env2=env2_.next(modulation.env2.sustain),env3=env3_.next(modulation.env3.sustain);
    std::array<float,CompiledModulation::voiceSourceCount> voiceSources{};
    voiceSources[0]=envelope;voiceSources[1]=env2;voiceSources[2]=env3;
    for(std::size_t i=0;i<4;++i){const auto& l=lfoSettings(modulation,i);voiceSources[3+i]=l.mode!=LfoMode::Free?noteLfos_[i].next(l,sampleRate_):0.0f;}
    voiceSources[7]=velocity_;voiceSources[8]=modWheel;
    voiceSources[9]=std::clamp(static_cast<float>(address_.note)/127.0f,0.0f,1.0f);
    voiceSources[10]=aftertouch;
    voiceSources[11]=std::clamp(pitchBendNormalized,-1.0f,1.0f);
    voiceSources[12]=releasing_ ? 0.0f : 1.0f;
    ModulationFrame local;const ModulationFrame* effective=&global;
    if(compiled.hasVoiceRoutes()){local=global;compiled.voiceFrame(local,voiceSources,sampleRate_);effective=&local;}
    const auto& modules=effective->modules;
    bool filtersQuiet=true;

    for(std::size_t m=0;m<modules.size();++m) {
        const auto& module=modules[m];
        if(moduleIds_[m]!=module.id) {
            for(auto& oscillator:moduleOscillators_[m]) oscillator.reset();
            moduleBlendCenters_[m].reset();
            moduleFilters_[m].reset();moduleIds_[m]=module.id;
        }
        if(module.id==0 || !module.enabled) continue;

        const double semitones =
            static_cast<double>(module.octave)*12.0 +
            static_cast<double>(module.semitone) +
            static_cast<double>(module.fineCents)/100.0 + static_cast<double>(pitchBendSemitones);
        const double frequencyScale=std::exp2(semitones/12.0);
        const unsigned count=std::clamp(module.unison,1u,maxUnisonVoices);
        const float spreadCents=std::clamp(module.detuneCents,0.0f,100.0f);
        const float position=module.wtPosition;

        auto sourceSampleFor=[&](OscillatorModuleId sourceId) noexcept {
            if(sourceId==0) return 0.0f;
            for(std::size_t sourceIndex=0;sourceIndex<moduleIds_.size();++sourceIndex)
                if(moduleIds_[sourceIndex]==sourceId)
                    return previousOscillatorSamples_[sourceIndex];
            return 0.0f;
        };

        double routedFrequencyScale=1.0;
        double routedPhaseOffset=0.0;
        double routedPhaseSkew=0.0;

        // Pre-generation routing belongs in the phase/frequency domain.
        auto applyPreRoute=[&](OscillatorModuleId sourceId,OscRouteType type,float rawAmount) noexcept {
            if(type==OscRouteType::Off || sourceId==0) return;
            const float source=std::clamp(sourceSampleFor(sourceId),-1.0f,1.0f);
            const float amount=std::clamp(rawAmount,-1.0f,1.0f);

            switch(type) {
                case OscRouteType::PhaseMod:
                    // PD: +/- half a cycle of source-driven phase displacement.
                    routedPhaseOffset+=static_cast<double>(source*amount)*0.5;
                    break;

                case OscRouteType::FrequencyMod:
                    // FM: exponential audio-rate frequency modulation. Full
                    // amount spans approximately +/-24 semitones.
                    routedFrequencyScale*=std::exp2(static_cast<double>(source*amount)*2.0);
                    break;

                case OscRouteType::PhaseSkew:
                    // PSK: source dynamically bends the oscillator's internal
                    // phase midpoint rather than merely translating phase.
                    routedPhaseSkew+=static_cast<double>(source*amount)*0.42;
                    routedPhaseSkew=std::clamp(routedPhaseSkew,-0.44,0.44);
                    break;

                case OscRouteType::RingMod:
                case OscRouteType::AmpMod:
                case OscRouteType::Crossfade:
                case OscRouteType::WaveFold:
                case OscRouteType::LogicXor:
                case OscRouteType::RectifyMod:
                case OscRouteType::Off:
                case OscRouteType::Count:
                    break;
            }
        };

        applyPreRoute(module.route1SourceId,module.route1Type,module.route1Amount);
        applyPreRoute(module.route2SourceId,module.route2Type,module.route2Amount);

        const double baseFrequency=frequency_*frequencyScale*routedFrequencyScale;
        float oscillatorMix=0.0f;
        if(count==1) {
            oscillatorMix=moduleOscillators_[m][0].next(
                table,baseFrequency,sampleRate_,position,
                module.process1,module.process1Amount,module.process2,module.process2Amount,
                routedPhaseOffset,routedPhaseSkew,module.process1Seed,module.process2Seed);
        } else {
            float unisonStack=0.0f;
            for(unsigned u=0;u<count;++u) {
                const double unit=(2.0*static_cast<double>(u)/static_cast<double>(count-1))-1.0;
                const double detuneRatio=std::exp2((unit*static_cast<double>(spreadCents))/1200.0);
                unisonStack+=moduleOscillators_[m][u].next(
                    table,baseFrequency*detuneRatio,sampleRate_,position,
                    module.process1,module.process1Amount,module.process2,module.process2Amount,
                    routedPhaseOffset,routedPhaseSkew,module.process1Seed,module.process2Seed);
            }
            unisonStack/=static_cast<float>(count);

            const float centre=moduleBlendCenters_[m].next(
                table,baseFrequency,sampleRate_,position,
                module.process1,module.process1Amount,module.process2,module.process2Amount,
                routedPhaseOffset,routedPhaseSkew,module.process1Seed,module.process2Seed);
            const float blend=std::clamp(module.blend,0.0f,1.0f);
            oscillatorMix=centre+(unisonStack-centre)*blend;
        }

        // Post-generation routes are intentionally executed in slot order.
        // This makes combinations such as WF -> XOR or RM -> RECT genuinely
        // different from the reverse order.
        auto applyPostRoute=[&](float signal,OscillatorModuleId sourceId,
                                OscRouteType type,float rawAmount) noexcept {
            if(type==OscRouteType::Off || sourceId==0) return signal;

            const float source=std::clamp(sourceSampleFor(sourceId),-1.0f,1.0f);
            const float amount=std::clamp(rawAmount,-1.0f,1.0f);
            const float depth=std::abs(amount);

            switch(type) {
                case OscRouteType::RingMod:
                    // RM: continuously morph dry -> signed multiplication.
                    return signal*(1.0f-depth)+signal*source*amount;

                case OscRouteType::AmpMod: {
                    // AM: source controls gain while retaining target polarity.
                    const float modulated=signal*std::max(0.0f,1.0f+source*amount);
                    return signal*(1.0f-depth)+modulated*depth;
                }

                case OscRouteType::Crossfade: {
                    // XF: replace target progressively with the source oscillator.
                    // Negative amount crossfades toward an inverted source.
                    const float sourceSignal=amount>=0.0f ? source : -source;
                    return signal*(1.0f-depth)+sourceSignal*depth;
                }

                case OscRouteType::WaveFold: {
                    // WF: source amplitude drives an audio-rate sine wavefolder.
                    // This is deliberately aggressive while remaining bounded.
                    const float drive=1.0f+std::abs(source)*depth*7.0f;
                    const float folded=static_cast<float>(
                        std::asin(std::sin(static_cast<double>(signal*drive)*1.5707963267948966))
                        *0.6366197723675814);
                    const float signedFold=amount>=0.0f ? folded : -folded;
                    return signal*(1.0f-depth)+signedFold*depth;
                }

                case OscRouteType::LogicXor: {
                    // XOR: square-polarity interaction. Unlike RM it responds
                    // only to the source sign, producing hard digital sidebands.
                    const float sourcePolarity=source>=0.0f ? 1.0f : -1.0f;
                    const float polarity=amount>=0.0f ? sourcePolarity : -sourcePolarity;
                    const float logical=signal*polarity;
                    return signal*(1.0f-depth)+logical*depth;
                }

                case OscRouteType::RectifyMod: {
                    // RECT: source magnitude controls how strongly the target is
                    // driven toward positive or negative full-wave rectification.
                    const float sourceDepth=depth*std::abs(source);
                    const float rectified=amount>=0.0f ? std::abs(signal) : -std::abs(signal);
                    return signal*(1.0f-sourceDepth)+rectified*sourceDepth;
                }

                case OscRouteType::PhaseMod:
                case OscRouteType::FrequencyMod:
                case OscRouteType::PhaseSkew:
                case OscRouteType::Off:
                case OscRouteType::Count:
                    return signal;
            }
            return signal;
        };

        oscillatorMix=applyPostRoute(oscillatorMix,module.route1SourceId,
                                     module.route1Type,module.route1Amount);
        oscillatorMix=applyPostRoute(oscillatorMix,module.route2SourceId,
                                     module.route2Type,module.route2Amount);

        previousOscillatorSamples_[m]=std::clamp(oscillatorMix,-1.0f,1.0f);

        float sampleValue=oscillatorMix*envelopeValue;
        if(effective->filterEnabled) {
            sampleValue=moduleFilters_[m].next(sampleValue,effective->filter);
            filtersQuiet=filtersQuiet && moduleFilters_[m].quiet();
        } else {
            moduleFilters_[m].reset();
        }
        sampleValue*=module.level;
        const double panAngle=(static_cast<double>(module.pan)+1)*.7853981633974483;
        outputs.left+=sampleValue*std::cos(panAngle);
        outputs.right+=sampleValue*std::sin(panAngle);
        outputs.mono+=sampleValue;
    }

    if(envelope_.stage()==dsp::Envelope::Stage::Idle && filtersQuiet) reset();
    outputs.left*=effective->master;outputs.right*=effective->master;outputs.mono*=effective->master;
    return outputs;
}
VoiceInfo Voice::info() const noexcept {
    VoiceInfo info;
    info.address=address_;info.order=order_;info.active=active_;info.releasing=releasing_;
    info.envelope=envelope_.value();
    info.envelopes={{
        {envelope_.stage(),envelope_.stageProgress(),envelope_.value()},
        {env2_.stage(),env2_.stageProgress(),env2_.value()},
        {env3_.stage(),env3_.stageProgress(),env3_.value()}
    }};
    return info;
}
}
