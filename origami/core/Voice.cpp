// mct-origami-unified-routing-core-fx-p04
// mct-origami-audio-reengineer-p08-compiled-route-indices
// mct-origami-audio-reengineer-p07-prepared-oscillator-modules
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
#include "dsp/FastMath.h"
#include <algorithm>
#include <cmath>
namespace mct::origami {

void Voice::bindMorphHints() noexcept {
    for(std::size_t m=0;m<maxOscillatorModules;++m) {
        for(std::size_t u=0;u<maxUnisonVoices;++u) moduleOscillators_[m][u].setMorphHints(morphHints_[m][u].data());
        moduleBlendCenters_[m].setMorphHints(blendMorphHints_[m].data());
    }
}
void Voice::prepare(double sampleRate) noexcept { sampleRate_=sampleRate;filterSmoothing_=float(1-std::exp(-1/(.005*sampleRate)));for(auto& r:instanceRuntime_) r.envelope.prepare(sampleRate);envelope_.prepare(sampleRate);env2_.prepare(sampleRate);env3_.prepare(sampleRate);reset();seedLfos(); }
// Per-voice LFO streams: a distinct, repeatable ENTROPY stream per voice
// lifecycle (the NODES voice-seed family); FRACTURE structure per LFO index.
void Voice::seedLfos() noexcept {
    for(std::size_t i=0;i<noteLfos_.size();++i) noteLfos_[i].setStreams(Lfo::voiceStream(voiceSeed(),i),Lfo::fractureSeed(i));
}
void Voice::reset() noexcept {for(auto& f:synthFilterRuntime_) f.reset(); instanceRevision_=~std::uint64_t{0}; instanceCount_=0; instanceRetrigger_=false; for(auto& r:instanceRuntime_) {r.id=0;r.envelope.reset();r.lfo.reset();}  topologyGeneration_=0; bindMorphHints(); for(auto& lfo:noteLfos_)lfo.reset();for(auto& module:moduleOscillators_)for(auto& oscillator:module)oscillator.reset();for(auto& oscillator:moduleBlendCenters_)oscillator.reset();for(auto& hints:rightSpectralHints_)hints={};for(auto& runtime:oscillatorRuntime_)runtime.invalidate();previousOscillatorSamples_.fill(0.0f);previousOscillatorSamplesRight_.fill(0.0f);rightTapMask_=rightPhaseModules_=0;oneShotRelease_=false;envelope_.reset();env2_.reset();env3_.reset();for(auto& filter:moduleFilters_)filter.reset();for(auto& filter:moduleFiltersRight_)filter.reset();rightFilterLive_=0;operatorState_={};active_=releasing_=false;velocity_=0;order_=0;visualization_={}; }
void Voice::start(NoteAddress address,float velocity,std::uint64_t order,const dsp::EnvelopeSettings& settings,const dsp::EnvelopeSettings& env2,const dsp::EnvelopeSettings& env3,std::uint8_t graphOwnedEnvelopes) noexcept {
    reset();ampSettings_=settings;address_=address;velocity_=velocity;order_=order;++lifecycle_;seedLfos();
    frequency_=targetFrequency_=dsp::midiFrequency(address.note);glideRatio_=1.0;glideRemaining_=0;
    active_=true;
    if(!(graphOwnedEnvelopes&1u)) envelope_.noteOn(settings);
    if(!(graphOwnedEnvelopes&2u)) env2_.noteOn(env2);
    if(!(graphOwnedEnvelopes&4u)) env3_.noteOn(env3);
    // A fresh (or stolen) voice: NOTE ON, never RETRIGGER; state was reset.
    pendingNoteOn_=true;pendingNoteOff_=false;pendingRetrigger_=false;
}
void Voice::retarget(NoteAddress address,float velocity,std::uint64_t order,const dsp::EnvelopeSettings& settings,const dsp::EnvelopeSettings& env2,const dsp::EnvelopeSettings& env3,float glideSeconds,bool retriggerEnvelope,std::uint8_t graphOwnedEnvelopes) noexcept {
    ampSettings_=settings;
    // RETRIGGER: a new note on a voice that is still sounding (mono/legato).
    pendingRetrigger_=active_;pendingNoteOn_=true;pendingNoteOff_=false;
    address_=address;velocity_=velocity;order_=order;active_=true;releasing_=false;
    targetFrequency_=dsp::midiFrequency(address.note);
    const auto samples=glideSeconds>0.0f ? static_cast<std::size_t>(std::round(glideSeconds*sampleRate_)) : 0u;
    if(samples==0 || frequency_<=0.0 || targetFrequency_<=0.0) {
        frequency_=targetFrequency_;glideRatio_=1.0;glideRemaining_=0;
    } else {
        glideRemaining_=samples;
        glideRatio_=std::exp(std::log(targetFrequency_/frequency_)/static_cast<double>(samples));
    }
    instanceRetrigger_=retriggerEnvelope;
    if(retriggerEnvelope) {if(!(graphOwnedEnvelopes&1u)) envelope_.noteOn(settings);if(!(graphOwnedEnvelopes&2u)) env2_.noteOn(env2);if(!(graphOwnedEnvelopes&4u)) env3_.noteOn(env3);for(auto& lfo:noteLfos_)lfo.reset();operatorState_={};++lifecycle_;seedLfos();}
}
void Voice::release(const dsp::EnvelopeSettings& settings,const dsp::EnvelopeSettings& env2,const dsp::EnvelopeSettings& env3) noexcept {
    ampSettings_=settings;
    if(active_){releasing_=true;envelope_.noteOff(settings);env2_.noteOff(env2);env3_.noteOff(env3);pendingNoteOff_=true;}
}
Voice::Samples Voice::nextModules(const std::array<const dsp::Wavetable*,16>& tables,const ModulationFrame& global,
    float sustain,const CompiledModulation& compiled,const ModulationState& modulation,
    float pitchBendSemitones,float pitchBendNormalized,float modWheel,float aftertouch,const OscillatorRenderPlan& topology,const OscillatorProcessPlans& sharedProcesses,bool observe) noexcept {
    // mct-origami-stereo-modulation: two instantiations of one renderer. The
    // mono one (no stereo plan) compiles every stereo branch away and is the
    // pre-stereo code path.
    if(topology.synthFilters.count) return compiled.hasStereoPlan()
        ? render<true,true>(tables,global,sustain,compiled,modulation,pitchBendSemitones,pitchBendNormalized,modWheel,aftertouch,topology,sharedProcesses,observe)
        : render<false,true>(tables,global,sustain,compiled,modulation,pitchBendSemitones,pitchBendNormalized,modWheel,aftertouch,topology,sharedProcesses,observe);
    return compiled.hasStereoPlan()
        ? render<true,false>(tables,global,sustain,compiled,modulation,pitchBendSemitones,pitchBendNormalized,modWheel,aftertouch,topology,sharedProcesses,observe)
        : render<false,false>(tables,global,sustain,compiled,modulation,pitchBendSemitones,pitchBendNormalized,modWheel,aftertouch,topology,sharedProcesses,observe);
}

namespace {
// Post-generation cross-oscillator shaping of one channel by one source
// sample (already clamped to [-1, 1]). LEFT and RIGHT share it exactly.
inline float shapePostRoute(float signal,float source,OscRouteType type,float rawAmount) noexcept {
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
            const float folded=dsp::triangleFold(signal*drive);
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
}
}
// mct-origami-nested-modulation-manual-qa: the prepared voice program
// (per-voice LFOs at this voice's effective rate, per-voice operators and
// route depths, in dependency order). Out of line: the renderers' hot loops
// keep their code when no nested modulation exists.
template<bool Stereo>
__attribute__((noinline)) void Voice::runVoiceProgram(const CompiledModulation& compiled,const ModulationState& modulation,
    const ModulationFrame& global,ModulationFrame& local,std::array<float,CompiledModulation::voiceSourceCount>& voiceSources,
    StereoSourceValues& voiceStereo,float sourceLfoScale,bool observe) noexcept {
    using Step=CompiledModulation::ProgramStep::Kind;
    for(std::size_t p=0;p<compiled.voiceProgramSize();++p) {
        const auto& step=compiled.voiceProgramStep(p);
        switch(step.kind) {
            case Step::Lfo: {
                const std::size_t i=step.index;
                if(i>=4) {
                    const auto slot=i-4;const auto& a=modulation.instances[slot];auto& r=instanceRuntime_[slot];const auto output=CompiledModulation::instanceLfoSlot(slot);
                    const auto rate=compiled.voiceLfoRate(i,a.lfo.rateHz,global,voiceSources,local);
                    bool pair=false;
                    if constexpr(Stereo) if(a.lfo.stereo>0) {float right=0;voiceSources[output]=r.lfo.nextStereo(a.lfo,sampleRate_,rate,right)*sourceLfoScale;voiceStereo.instances[slot]=right*sourceLfoScale;voiceStereo.instanceMask|=1u<<slot;pair=true;}
                    if(!pair) voiceSources[output]=r.lfo.next(a.lfo,sampleRate_,rate)*sourceLfoScale;
                    if(observe) visualization_.instancePhases[slot]=float(r.lfo.readPosition());
                    break;
                }
                const auto& l=lfoSettings(modulation,i);
                if(l.mode==LfoMode::Free) { voiceSources[3+i]=0.0f; break; }
                const float rate=compiled.voiceLfoRate(i,l.rateHz,global,voiceSources,local);
                bool done=false;
                if constexpr(Stereo) if(l.stereo>0.0f) {
                    float right=0.0f;
                    voiceSources[3+i]=noteLfos_[i].nextStereo(l,sampleRate_,rate,right)*sourceLfoScale;
                    voiceStereo.lfo[i]=right*sourceLfoScale; voiceStereo.mask|=std::uint8_t(1u<<i);
                    done=true;
                }
                if(!done) voiceSources[3+i]=noteLfos_[i].next(l,sampleRate_,rate)*sourceLfoScale;
                if(observe) visualization_.lfoPhases[i]=static_cast<float>(noteLfos_[i].readPosition());
                break;
            }
            case Step::Operator:
                compiled.evaluateVoiceOperator(step.index,local,voiceSources,operatorState_,&operatorEventCounts_,&global,Stereo ? &voiceStereo : nullptr);
                break;
            case Step::Depth:
                compiled.voiceRouteDepth(step.index,local,voiceSources);
                break;
            case Step::Macro: break; // macros are global
        }
    }
}
template<bool Stereo,bool Synth>
Voice::Samples Voice::render(const std::array<const dsp::Wavetable*,16>& tables,const ModulationFrame& global,
    float sustain,const CompiledModulation& compiled,const ModulationState& modulation,
    float pitchBendSemitones,float pitchBendNormalized,float modWheel,float aftertouch,const OscillatorRenderPlan& topology,const OscillatorProcessPlans& sharedProcesses,bool observe) noexcept {
    Samples outputs{};
    if(topology.auxActive) aux_.fill(0.0f);
    if(!active_) return outputs;
    if(glideRemaining_) {
        frequency_*=glideRatio_;
        if(--glideRemaining_==0) {frequency_=targetFrequency_;glideRatio_=1.0;}
    }
    if(instanceRevision_!=compiled.stateRevision()) {
        instanceRevision_=compiled.stateRevision(); instanceCount_=0;
        for(std::size_t i=0;i<maxSourceInstances;++i) {
            const auto& a=modulation.instances[i];
            if(a.id && (a.family==SourceFamily::Envelope || (a.family==SourceFamily::Lfo && a.lfo.mode!=LfoMode::Free)))
                instanceSlots_[instanceCount_++]=static_cast<std::uint8_t>(i);
        }
    }
    const float envelope=envelope_.next(sustain);
    const float env2=env2_.next(modulation.env2.sustain),env3=env3_.next(modulation.env3.sustain);
    std::array<float,CompiledModulation::voiceSourceCount> voiceSources;
    // Legacy slots are all written below. Spare slots are read only by a
    // pool route, or copied for observation/newest-voice monitoring. Avoid
    // clearing 64 unused floats per voice per sample in ordinary patches.
    if(instanceCount_ || observe || compiled.hasFxVoiceRoutes() || compiled.needsNewestVoiceSources())
        std::fill(voiceSources.begin()+13,voiceSources.end(),0.0f);
    const float sourceEnvelopeScale=std::clamp(global.envelopeScaling,0.0f,2.0f);
    const float sourceLfoScale=std::clamp(global.lfoScaling,0.0f,2.0f);
    voiceSources[0]=envelope*sourceEnvelopeScale;voiceSources[1]=env2*sourceEnvelopeScale;voiceSources[2]=env3*sourceEnvelopeScale;
    StereoSourceValues voiceStereo; // only mask-marked RIGHT values are read
    for(std::size_t n=0;n<instanceCount_;++n) {
        const auto i=instanceSlots_[n]; const auto& a=modulation.instances[i];auto& r=instanceRuntime_[i];
        if(r.id!=a.id) {
            r.id=a.id;r.envelope.reset();r.lfo.reset();
            r.lfo.setStreams(Lfo::voiceStream(voiceSeed(),a.id+4),Lfo::fractureSeed(a.id+4));
            if(!releasing_) r.envelope.noteOn(a.envelope);
        } else if(instanceRetrigger_) {r.envelope.noteOn(a.envelope);r.lfo.reset();}
        if(pendingNoteOff_) r.envelope.noteOff(a.envelope);
        if(a.family==SourceFamily::Envelope)
            voiceSources[CompiledModulation::instanceEnvelopeSlot(i)]=r.envelope.next(a.envelope.sustain)*sourceEnvelopeScale;
        else {
            if(compiled.hasVoiceNestedPlan()) continue;
            if constexpr(Stereo) {if(a.lfo.stereo>0) {float right=0;voiceSources[CompiledModulation::instanceLfoSlot(i)]=r.lfo.nextStereo(a.lfo,sampleRate_,right)*sourceLfoScale;voiceStereo.instances[i]=right*sourceLfoScale;voiceStereo.instanceMask|=1u<<i;continue;}}
            voiceSources[CompiledModulation::instanceLfoSlot(i)]=r.lfo.next(a.lfo,sampleRate_)*sourceLfoScale;
        }
    }
    if(observe) for(std::size_t n=0;n<instanceCount_;++n) {const auto i=instanceSlots_[n];const auto& r=instanceRuntime_[i]; visualization_.instancePhases[i]=float(r.lfo.readPosition());visualization_.instanceEnvelopes[i]={r.envelope.stage(),r.envelope.stageProgress(),r.envelope.value()};}
    instanceRetrigger_=false;
    // mct-origami-stereo-modulation: per-voice LFO pairs (RIGHT only when the
    // plan is stereo and that LFO's STEREO is non-zero; LEFT is unchanged).
    constexpr bool stereoPlan=Stereo;
    // mct-origami-nested-modulation-manual-qa: with a voice nested plan the
    // per-voice LFOs run in the prepared order (after what feeds their rate).
    const bool nestedVoice=compiled.hasVoiceNestedPlan();
    if(nestedVoice) std::fill_n(voiceSources.begin()+3,4,0.0f); // FREE LFO voice slots are inert in the nested program
    if(!nestedVoice) for(std::size_t i=0;i<4;++i){
        const auto& l=lfoSettings(modulation,i);
        if(l.mode==LfoMode::Free) voiceSources[3+i]=0.0f;
        else if constexpr(!Stereo) voiceSources[3+i]=noteLfos_[i].next(l,sampleRate_)*sourceLfoScale;
        else if(l.stereo>0.0f) {
            float right=0.0f;
            voiceSources[3+i]=noteLfos_[i].nextStereo(l,sampleRate_,right)*sourceLfoScale;
            voiceStereo.lfo[i]=right*sourceLfoScale; voiceStereo.mask|=std::uint8_t(1u<<i);
        } else voiceSources[3+i]=noteLfos_[i].next(l,sampleRate_)*sourceLfoScale;
        if(observe) visualization_.lfoPhases[i]=static_cast<float>(noteLfos_[i].readPosition());
    }
    const auto cachedCurve=[&](CurveCache& cache,const PerformanceSourceCurve& curve,float input) {
        if(cache.input!=input || cache.revision!=compiled.stateRevision()) {
            cache.input=input; cache.revision=compiled.stateRevision(); cache.value=performanceSourceCurveValue(curve,input);
        }
        return cache.value;
    };
    if(compiled.usesVoiceSource(7) || observe) voiceSources[7]=cachedCurve(velocityCurve_,modulation.velocityCurve,velocity_);
    voiceSources[8]=modWheel;
    if(compiled.usesVoiceSource(9) || observe)
        voiceSources[9]=cachedCurve(noteCurve_,modulation.noteCurve,std::clamp(static_cast<float>(address_.note)/127.0f,0.0f,1.0f));
    voiceSources[10]=aftertouch;
    voiceSources[11]=std::clamp(pitchBendNormalized,-1.0f,1.0f);
    voiceSources[12]=releasing_ ? 0.0f : 1.0f;
    if(!nestedVoice) {
        if(observe) visualization_.sources=voiceSources;
        if(compiled.hasFxVoiceRoutes() || compiled.needsNewestVoiceSources()) lastSources_=voiceSources;
    }
    auto& local=localFrame_;const ModulationFrame* effective=&global;
    const bool voiceOperators=compiled.hasVoiceOperators();
    const bool noteOn=pendingNoteOn_,noteOff=pendingNoteOff_,retrigger=pendingRetrigger_;
    pendingNoteOn_=pendingNoteOff_=pendingRetrigger_=false;
    if(compiled.hasVoiceRoutes() || voiceOperators || nestedVoice) {
        // N07: only the active modules are copied per sample (full copy on the
        // decimated observation ticks, which publish every module slot).
        if(observe) local=global; else local.copyForVoice(global,topology.active,topology.activeCount,compiled.voiceModuleMask(),stereoPlan,compiled.hasNestedPlan());
        if(voiceOperators) {
            local.events.noteOn=noteOn;local.events.noteOff=noteOff;
            local.events.retrigger=retrigger;local.events.gate=!releasing_;
            local.events.voiceSeed=voiceSeed();
        }
        if(nestedVoice) {
            runVoiceProgram<Stereo>(compiled,modulation,global,local,voiceSources,voiceStereo,sourceLfoScale,observe);
            if(observe) visualization_.sources=voiceSources;
            if(compiled.hasFxVoiceRoutes() || compiled.needsNewestVoiceSources()) lastSources_=voiceSources;
        } else if(voiceOperators) {
            // N04 per-voice CONTROL operators: this voice's sources, this voice's state.
            compiled.evaluateVoiceOperators(local,voiceSources,operatorState_,&operatorEventCounts_,&global,stereoPlan ? &voiceStereo : nullptr);
        }
        if(compiled.hasVoiceRoutes()) compiled.voiceFrame(local,voiceSources,sampleRate_,stereoPlan ? &voiceStereo : nullptr,&global);
        effective=&local;
    }
    // N05 targets act after this sample's evaluation (effective next sample).
    if(compiled.hasEnvelopeTriggers()) {
        const auto mask=compiled.envelopeTriggers(*effective);
        if(mask&1u) {
            // Graph-owned ENV 1. After the note's release a trigger is a
            // one-shot (attack, decay, then release from sustain): it can
            // never leave a voice sustaining with no note-off to come.
            envelope_.noteOn(ampSettings_);
            oneShotRelease_=releasing_;
        }
        if(mask&2u) env2_.noteOn(modulation.env2);
        if(mask&4u) env3_.noteOn(modulation.env3);
    }
    if(observe && voiceOperators) visualization_.operators=effective->operatorOutputs;
    const auto& modules=effective->modules;
    // Some channel differs this sample: only then does any module take the
    // stereo render path (a right filter that went idle simply restarts from
    // LEFT's state the next time it is needed).
    bool stereoActive=false;
    if constexpr(Stereo) {
        stereoActive=effective->stereo.levelMask!=0 || effective->stereo.filterSplit() ||
                     (effective->stereo.rightMask&compiled.readStereoGroups())!=0 ||
                     rightTapMask_!=0 || rightPhaseModules_!=0;
        if(!stereoActive) rightFilterLive_=0;
    } else { rightFilterLive_=0; rightTapMask_=rightPhaseModules_=0; } // a later stereo plan restarts RIGHT from LEFT
    // Modules no voice route writes are read from the global frame (N07).
    const std::uint16_t localModules=effective==&local && !observe ? compiled.voiceModuleMask() : (effective==&local ? 0xffffu : 0u);
    const float envelopeValue=envelope*velocity_*std::clamp(effective->envelopeScaling,0.0f,2.0f);
    if(observe) {visualization_.modules=modules;visualization_.synthFilterIds.fill(0);}
    bool filtersQuiet=true;
    const auto& filterPlan=topology.synthFilters;
    struct FilterInput {double left,right;};
    std::array<FilterInput,maxSynthFilters> filterInputs;
    if constexpr(Synth) filterInputs.fill({});
    // One bend ratio per voice/sample, not one exp2 per active oscillator module.
    const double globalPitchSemitones=static_cast<double>(effective->mainTuning+effective->transpose);
    const double pitchBendScale=dsp::fastExp2Audio((static_cast<double>(pitchBendSemitones)+globalPitchSemitones)/12.0);

    if(topologyGeneration_!=topology.generation) {
        std::uint8_t mask=0;for(std::size_t n=0;n<filterPlan.count;++n) mask|=std::uint8_t(1u<<filterPlan.stages[n].slot);for(std::size_t f=0;f<maxSynthFilters;++f) if(!(mask&(1u<<f))) synthFilterRuntime_[f].reset();
        for(std::size_t m=0;m<modules.size();++m) if(moduleIds_[m]!=topology.ids[m]) {
            for(auto& oscillator:moduleOscillators_[m]) oscillator.reset();
            moduleBlendCenters_[m].reset();moduleFilters_[m].reset();moduleFiltersRight_[m].reset();rightFilterLive_&=std::uint16_t(~(1u<<m));
            rightSpectralHints_[m]={};
            moduleIds_[m]=topology.ids[m];oscillatorRuntime_[m].invalidate();
        }
        topologyGeneration_=topology.generation;
    }
    for(std::size_t active=0;active<topology.activeCount;++active) {
        const auto m=topology.active[active];
        const auto& module=((localModules>>m)&1u) ? local.modules[m] : global.modules[m];
        const auto& modulePlan=topology.modules[m];
        const auto* tablePtr=tables[m];
        // Engine::prepare/installWavetable/installWavetableForOscillator validate
        // complete tables before publication. Rechecking every sample here
        // scans every frame and band, multiplying callback cost by module count.
        if(tablePtr==nullptr) continue;
        const auto& table=*tablePtr;
        auto& runtime=oscillatorRuntime_[m];
        const unsigned count=std::clamp(module.unison,1u,maxUnisonVoices);
        runtime.prepareDetune(module.id,count,module.detuneCents);

        // Check the effective audio-rate controls every sample; reuse derived
        // math only when its exact input is unchanged.
        const double frequencyScale=
            runtime.controls.pitchRatio(module.octave,module.semitone,module.fineCents)*pitchBendScale;

        // Level/blend are already DSP-domain values. Do not copy them through
        // a prepared-state object every sample.
        const float level=std::isfinite(module.level)
            ? std::clamp(module.level,0.0f,1.0f) : 0.0f;
        const float blend=std::isfinite(module.blend)
            ? std::clamp(module.blend,0.0f,1.0f) : 0.0f;

        float panLeft,panRight;
        runtime.controls.pan(module.pan,panLeft,panRight);

        const float position=module.wtPosition;

        double routedFrequencyScale=1.0;
        double routedPhaseOffset=0.0;
        double routedPhaseSkew=0.0;

        // Pre-generation routing belongs in the phase/frequency domain.
        auto applyPreRoute=[&](int sourceIndex,OscRouteType type,float rawAmount) noexcept {
            if(type==OscRouteType::Off || sourceIndex<0 ||
               sourceIndex>=static_cast<int>(previousOscillatorSamples_.size())) return;
            const float source=std::clamp(previousOscillatorSamples_[static_cast<std::size_t>(sourceIndex)],-1.0f,1.0f);
            const float amount=std::clamp(rawAmount,-1.0f,1.0f);

            switch(type) {
                case OscRouteType::PhaseMod:
                    // PD: +/- half a cycle of source-driven phase displacement.
                    routedPhaseOffset+=static_cast<double>(source*amount)*0.5;
                    break;

                case OscRouteType::FrequencyMod:
                    // FM: exponential audio-rate frequency modulation. Full
                    // amount spans approximately +/-24 semitones.
                    routedFrequencyScale*=dsp::fastExp2Audio(static_cast<double>(source*amount)*2.0);
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

        const auto routeAmount=[&](const OscillatorRenderPlan::Route& route) noexcept {
            return modulePlan.dynamicRoutes ? module.routes[route.amountSlot].amount
                : (route.amountSlot==0 ? module.route1Amount : module.route2Amount);
        };
        for(std::size_t r=0;r<modulePlan.preCount;++r) {
            const auto& route=modulePlan.preRoutes[r];
            applyPreRoute(route.source,route.type,routeAmount(route));
        }

        double baseFrequency=frequency_*frequencyScale*routedFrequencyScale;
        if(!std::isfinite(baseFrequency) || baseFrequency<=0.0) baseFrequency=20.0;
        baseFrequency=std::clamp(baseFrequency,1.0,std::max(20.0,sampleRate_*0.49));
        const dsp::OscProcessPlan* processes=&sharedProcesses[m];
        if(!modulePlan.simple && compiled.hasVoiceProcessRoutes(m)) {
            topology.processPlan(m,module,processScratch_);
            processes=&processScratch_;
        }
        const auto& processPlan=*processes;

        // mct-origami-dsp-performance-stereo-chain: RIGHT read parameters when a
        // stereo group addresses this module's oscillator read (WT POSITION,
        // OSC CHAIN process / route amounts). The group -> target map is
        // prepared by the compiled plan; nothing is searched here.
        // mct-origami-dsp-performance-stereo-chain / -nested-modulation-manual-qa:
        // RIGHT read parameters when a stereo group addresses this module's
        // read (WT POSITION, OSC CHAIN amounts) or a cross-oscillator source's
        // RIGHT tap differs (PD / FM / PSK / post routes). Everything below is
        // compiled out of the mono renderer.
        std::uint32_t readMask=0;
        bool rightSplit=false,rightPhase=false,secondRead=false;
        float positionRight=position;
        dsp::OscProcessPlan processPlanRight;
        std::array<float,maxOscRoutes> routeAmountRight{};
        double phaseOffsetRight=routedPhaseOffset,phaseSkewRight=routedPhaseSkew;
        double baseFrequencyRight=baseFrequency;
        if constexpr(Stereo) if(stereoActive) {
            readMask=effective->stereo.rightMask&compiled.moduleReadStereoGroups(m);
            const auto moduleBit=std::uint16_t(1u<<m);
            bool sourceSplit=false;
            if(rightTapMask_!=0) {
                const auto splitSource=[&](int source) noexcept { return source>=0 && source<16 && ((rightTapMask_>>source)&1u)!=0; };
                for(std::size_t r=0;r<modulePlan.preCount;++r) sourceSplit|=splitSource(modulePlan.preRoutes[r].source);
                for(std::size_t r=0;r<modulePlan.postCount;++r) sourceSplit|=splitSource(modulePlan.postRoutes[r].source);
            }
            rightSplit=readMask!=0 || sourceSplit || (rightPhaseModules_&moduleBit)!=0;
            if(rightSplit) {
                processPlanRight=processPlan;
                const std::size_t routeSlots=modulePlan.dynamicRoutes ? std::min<std::size_t>(module.routeCount,maxOscRoutes) : 2u;
                for(std::size_t r=0;r<routeSlots;++r)
                    routeAmountRight[r]=modulePlan.dynamicRoutes ? module.routes[r].amount : (r==0 ? module.route1Amount : module.route2Amount);
                for(std::uint32_t bits=readMask;bits!=0;bits&=bits-1u) {
                    const auto i=static_cast<std::size_t>(__builtin_ctz(bits));
                    const auto& target=compiled.readTarget(i);
                    const float value=effective->stereo.right[i];
                    switch(target.parameter) {
                        case ModDestination::WtPosition: positionRight=value; break;
                        case ModDestination::ProcessAmount: case ModDestination::Process1Amount: case ModDestination::Process2Amount:
                            if(modulePlan.dynamicProcesses!=(target.parameter==ModDestination::ProcessAmount)) break;
                            for(std::size_t p=0;p<modulePlan.processCount;++p)
                                if(modulePlan.processes[p]==target.item) processPlanRight.stages[p].amount=value;
                            break;
                        case ModDestination::RouteAmount: case ModDestination::Route1Amount: case ModDestination::Route2Amount:
                            if(modulePlan.dynamicRoutes!=(target.parameter==ModDestination::RouteAmount)) break;
                            if(target.item<maxOscRoutes) routeAmountRight[target.item]=value;
                            break;
                        default: break;
                    }
                }
                // RIGHT pre routes: RIGHT source taps and RIGHT amounts, in the
                // same order and arithmetic as LEFT (equal inputs give equal
                // results). FM too: a different RIGHT frequency runs RIGHT on
                // its own phase (stereo FM).
                phaseOffsetRight=0.0; phaseSkewRight=0.0;
                double frequencyScaleRight=1.0;
                for(std::size_t r=0;r<modulePlan.preCount;++r) {
                    const auto& route=modulePlan.preRoutes[r];
                    if(route.type==OscRouteType::Off || route.source<0 || route.source>=static_cast<int>(previousOscillatorSamples_.size())) continue;
                    const float source=std::clamp(rightTap(static_cast<std::size_t>(route.source)),-1.0f,1.0f);
                    const float amount=std::clamp(routeAmountRight[route.amountSlot],-1.0f,1.0f);
                    if(route.type==OscRouteType::PhaseMod) phaseOffsetRight+=static_cast<double>(source*amount)*0.5;
                    else if(route.type==OscRouteType::FrequencyMod) frequencyScaleRight*=dsp::fastExp2Audio(static_cast<double>(source*amount)*2.0);
                    else if(route.type==OscRouteType::PhaseSkew) {
                        phaseSkewRight+=static_cast<double>(source*amount)*0.42;
                        phaseSkewRight=std::clamp(phaseSkewRight,-0.44,0.44);
                    }
                }
                baseFrequencyRight=frequency_*frequencyScale*frequencyScaleRight;
                if(!std::isfinite(baseFrequencyRight) || baseFrequencyRight<=0.0) baseFrequencyRight=20.0;
                baseFrequencyRight=std::clamp(baseFrequencyRight,1.0,std::max(20.0,sampleRate_*0.49));
                if(baseFrequencyRight!=baseFrequency && (rightPhaseModules_&moduleBit)==0) {
                    // RIGHT's frequency departs from LEFT's: its oscillators
                    // start their own phase from LEFT's (no jump) and keep it.
                    for(auto& oscillator:moduleOscillators_[m]) oscillator.restartRightPhase();
                    moduleBlendCenters_[m].restartRightPhase();
                    rightPhaseModules_|=moduleBit;
                }
                rightPhase=(rightPhaseModules_&moduleBit)!=0;
                // A second oscillator read only when RIGHT's read inputs differ.
                secondRead=readMask!=0 || rightPhase ||
                    phaseOffsetRight!=routedPhaseOffset || phaseSkewRight!=routedPhaseSkew;
            }
        }

        const auto renderOscillator=[&](dsp::WavetableOscillator& oscillator,double frequency) noexcept {
            return modulePlan.simple ? oscillator.nextSimple(table,frequency,sampleRate_,position)
                : oscillator.next(table,frequency,sampleRate_,position,processPlan,routedPhaseOffset,routedPhaseSkew);
        };
        float oscillatorMix=0.0f,oscillatorMixRight=0.0f;
        if(!secondRead) {
            if(count==1) {
                oscillatorMix=renderOscillator(moduleOscillators_[m][0],baseFrequency);
            } else {
                float unisonStack=0.0f;
                for(unsigned u=0;u<count;++u) {
                    unisonStack+=renderOscillator(moduleOscillators_[m][u],baseFrequency*runtime.detuneRatios[u]);
                }
                unisonStack/=static_cast<float>(count);

                const float centre=renderOscillator(moduleBlendCenters_[m],baseFrequency);
                oscillatorMix=centre+(unisonStack-centre)*blend;
            }
            // RIGHT differs only after a route reads a different RIGHT source.
            if(rightSplit) oscillatorMixRight=oscillatorMix;
        } else {
            // One phase advance per oscillator (two with stereo FM), LEFT and
            // RIGHT reads.
            auto& hints=rightSpectralHints_[m];
            const auto renderStereo=[&](dsp::WavetableOscillator& oscillator,double frequency,double frequencyRight,float& right) noexcept {
                return modulePlan.simple ? oscillator.nextStereoSimple(table,frequency,sampleRate_,position,positionRight,hints,right)
                    : oscillator.nextStereo(table,frequency,sampleRate_,position,processPlan,routedPhaseOffset,routedPhaseSkew,
                                            positionRight,processPlanRight,phaseOffsetRight,phaseSkewRight,hints,right,
                                            rightPhase ? frequencyRight : 0.0);
            };
            if(count==1) {
                oscillatorMix=renderStereo(moduleOscillators_[m][0],baseFrequency,baseFrequencyRight,oscillatorMixRight);
            } else {
                float unisonStack=0.0f,unisonStackRight=0.0f;
                for(unsigned u=0;u<count;++u) {
                    float right=0.0f;
                    unisonStack+=renderStereo(moduleOscillators_[m][u],baseFrequency*runtime.detuneRatios[u],
                                              baseFrequencyRight*runtime.detuneRatios[u],right);
                    unisonStackRight+=right;
                }
                unisonStack/=static_cast<float>(count);
                unisonStackRight/=static_cast<float>(count);
                float centreRight=0.0f;
                const float centre=renderStereo(moduleBlendCenters_[m],baseFrequency,baseFrequencyRight,centreRight);
                oscillatorMix=centre+(unisonStack-centre)*blend;
                oscillatorMixRight=centreRight+(unisonStackRight-centreRight)*blend;
            }
        }
        if(observe) {
            visualization_.moduleSamples[m]=oscillatorMix;
            visualization_.modulePhases[m]=static_cast<float>(moduleOscillators_[m][0].phase());
        }

        // Post-generation routes are intentionally executed in slot order.
        // This makes combinations such as WF -> XOR or RM -> RECT genuinely
        // different from the reverse order.
        auto applyPostRoute=[&](float signal,int sourceIndex,
                                OscRouteType type,float rawAmount) noexcept {
            if(type==OscRouteType::Off || sourceIndex<0 ||
               sourceIndex>=static_cast<int>(previousOscillatorSamples_.size())) return signal;
            return shapePostRoute(signal,std::clamp(previousOscillatorSamples_[static_cast<std::size_t>(sourceIndex)],-1.0f,1.0f),type,rawAmount);
        };

        for(std::size_t r=0;r<modulePlan.postCount;++r) {
            const auto& route=modulePlan.postRoutes[r];
            oscillatorMix=applyPostRoute(oscillatorMix,route.source,route.type,routeAmount(route));
            // RIGHT: the same post route with RIGHT's amount and the source
            // oscillator's RIGHT tap.
            if constexpr(Stereo) if(rightSplit && route.type!=OscRouteType::Off && route.source>=0 &&
                                    route.source<static_cast<int>(previousOscillatorSamples_.size()))
                oscillatorMixRight=shapePostRoute(oscillatorMixRight,std::clamp(rightTap(static_cast<std::size_t>(route.source)),-1.0f,1.0f),
                                                  route.type,routeAmountRight[route.amountSlot]);
        }
        if(rightSplit && !std::isfinite(oscillatorMixRight)) oscillatorMixRight=0.0f;

        if(!std::isfinite(oscillatorMix)) {
            for(auto& oscillator:moduleOscillators_[m]) oscillator.reset();
            moduleBlendCenters_[m].reset();oscillatorMix=0.0f;
        }
        previousOscillatorSamples_[m]=std::clamp(oscillatorMix,-1.0f,1.0f);
        if constexpr(Stereo) {
            if(rightSplit) { previousOscillatorSamplesRight_[m]=std::clamp(oscillatorMixRight,-1.0f,1.0f); rightTapMask_|=std::uint16_t(1u<<m); }
            else rightTapMask_&=std::uint16_t(~(1u<<m));
        }

        if constexpr(Synth) {
        {
            const float rightLevel=Stereo && ((effective->stereo.levelMask>>m)&1u) ? std::clamp(effective->stereo.level[m],0.0f,1.0f) : level;
            float left=oscillatorMix*envelopeValue,right=(rightSplit ? oscillatorMixRight : oscillatorMix)*envelopeValue;
            // Historical implicit filters stay in front of explicit routing.
            if(effective->filterEnabled) {
                const auto bit=std::uint16_t(1u<<m);const bool split=rightSplit || (Stereo && effective->stereo.filterSplit());
                if(split && !(rightFilterLive_&bit)) {moduleFiltersRight_[m]=moduleFilters_[m];rightFilterLive_|=bit;}
                left=moduleFilters_[m].next(left,effective->filter);
                if(split) right=moduleFiltersRight_[m].next(right,effective->stereo.filterSplit()?effective->stereo.filter:effective->filter);
                else right=left;
                filtersQuiet=filtersQuiet && moduleFilters_[m].quiet() && (!split || moduleFiltersRight_[m].quiet());
            }
            const float leveledLeft=left*level*panLeft,leveledRight=right*rightLevel*panRight;
            for(std::size_t f=0;f<maxSynthFilters;++f) if(modulePlan.filterSend[f]!=0) {auto& input=filterInputs[f];input.left+=leveledLeft*modulePlan.filterSend[f];input.right+=leveledRight*modulePlan.filterSend[f];}
            outputs.left+=leveledLeft*modulePlan.busSend[0];outputs.right+=leveledRight*modulePlan.busSend[0];outputs.mono+=.5f*(left*level+right*rightLevel)*modulePlan.busSend[0];
            if(modulePlan.auxSends) for(std::size_t b=1;b<filterPlan.busCount;++b) {aux_[2*(b-1)]+=leveledLeft*modulePlan.busSend[b];aux_[2*(b-1)+1]+=leveledRight*modulePlan.busSend[b];}
            continue;
        }
        }

        // mct-origami-stereo-modulation: a module whose LEVEL or filter differs
        // between channels renders LEFT and RIGHT from the same oscillator
        // signal (pitch / WT / processes stay shared); everything else keeps
        // the unchanged mono path below.
        if(!Stereo || !stereoActive) {
            // Mono plan (or no channel differs this sample): the original path.
            float sampleValue=oscillatorMix*envelopeValue;
            if(effective->filterEnabled) {
                sampleValue=moduleFilters_[m].next(sampleValue,effective->filter);
                filtersQuiet=filtersQuiet && moduleFilters_[m].quiet();
            } else {
                moduleFilters_[m].reset();
            }
            const float leveled=sampleValue*level;
            sampleValue=leveled*modulePlan.mainBusSend;
            if(!std::isfinite(sampleValue)) {moduleFilters_[m].reset();sampleValue=0.0f;}
            // Same post-filter signal, scaled per user bus. Each destination
            // receives exactly its own send; MAIN is unaffected by user sends.
            if(modulePlan.auxSends && std::isfinite(leveled)) {
                for(std::size_t b=1;b<topology.busCount;++b) {
                    const float send=modulePlan.busSend[b];
                    if(send==0.0f) continue;
                    aux_[2*(b-1)]+=leveled*send*panLeft;
                    aux_[2*(b-1)+1]+=leveled*send*panRight;
                }
            }
            outputs.left+=sampleValue*panLeft;
            outputs.right+=sampleValue*panRight;
            outputs.mono+=sampleValue;
            continue;
        }
        const auto& stereo=effective->stereo;
        const bool stereoLevel=((stereo.levelMask>>m)&1u)!=0;
        const bool stereoFilter=effective->filterEnabled && stereo.filterSplit();
        const auto rightBit=std::uint16_t(1u<<m);

        float sampleValue=oscillatorMix*envelopeValue;
        // A stereo READ already made RIGHT a different signal: it needs its own
        // filter state even when the coefficients are shared.
        const float inputRight=rightSplit ? oscillatorMixRight*envelopeValue : sampleValue;
        float sampleRight=inputRight;
        if(effective->filterEnabled) {
            const bool rightFilter=stereoFilter || rightSplit;
            if(rightFilter && (rightFilterLive_&rightBit)==0) { moduleFiltersRight_[m]=moduleFilters_[m]; rightFilterLive_|=rightBit; } // continue from LEFT's state: no click
            const float input=sampleValue;
            sampleValue=moduleFilters_[m].next(input,effective->filter);
            filtersQuiet=filtersQuiet && moduleFilters_[m].quiet();
            if(rightFilter) {
                sampleRight=moduleFiltersRight_[m].next(inputRight,stereoFilter ? stereo.filter : effective->filter);
                filtersQuiet=filtersQuiet && moduleFiltersRight_[m].quiet();
            } else { rightFilterLive_&=std::uint16_t(~rightBit); sampleRight=sampleValue; }
        } else {
            moduleFilters_[m].reset();
            moduleFiltersRight_[m].reset(); rightFilterLive_&=std::uint16_t(~rightBit);
        }
        const float leveled=sampleValue*level;
        sampleValue=leveled*modulePlan.mainBusSend;
        if(!std::isfinite(sampleValue)) {moduleFilters_[m].reset();sampleValue=0.0f;}
        if(!stereoLevel && !stereoFilter && !rightSplit) {
            // Same post-filter signal, scaled per user bus. Each destination
            // receives exactly its own send; MAIN is unaffected by user sends.
            if(modulePlan.auxSends && std::isfinite(leveled)) {
                for(std::size_t b=1;b<topology.busCount;++b) {
                    const float send=modulePlan.busSend[b];
                    if(send==0.0f) continue;
                    aux_[2*(b-1)]+=leveled*send*panLeft;
                    aux_[2*(b-1)+1]+=leveled*send*panRight;
                }
            }
            outputs.left+=sampleValue*panLeft;
            outputs.right+=sampleValue*panRight;
            outputs.mono+=sampleValue;
            continue;
        }
        // Stereo module: LEFT keeps every LEFT value; RIGHT uses its own
        // level and filter output. Pan (scalar) then places each channel.
        const float levelRight=stereoLevel ? (std::isfinite(stereo.level[m]) ? std::clamp(stereo.level[m],0.0f,1.0f) : 0.0f) : level;
        const float leveledRight=sampleRight*levelRight;
        float sampleRightOut=leveledRight*modulePlan.mainBusSend;
        if(!std::isfinite(sampleRightOut)) {moduleFiltersRight_[m].reset();sampleRightOut=0.0f;}
        if(modulePlan.auxSends && std::isfinite(leveled) && std::isfinite(leveledRight)) {
            for(std::size_t b=1;b<topology.busCount;++b) {
                const float send=modulePlan.busSend[b];
                if(send==0.0f) continue;
                aux_[2*(b-1)]+=leveled*send*panLeft;
                aux_[2*(b-1)+1]+=leveledRight*send*panRight;
            }
        }
        outputs.left+=sampleValue*panLeft;
        outputs.right+=sampleRightOut*panRight;
        outputs.mono+=0.5f*(sampleValue+sampleRightOut);
    }

    if constexpr(Synth) for(std::size_t n=0;n<filterPlan.count;++n) {
        const auto& stage=filterPlan.stages[n];const auto slot=stage.slot;
        const auto& authored=modulation.synthFilters.filters[slot];auto& runtime=synthFilterRuntime_[slot];runtime.adopt(authored.id,authored.type);
        auto target=effective->synthFilters[slot];if(!authored.power) target.mix=0;
        auto values=runtime.smooth(target,filterSmoothing_);
        if(runtime.noteKey!=address_.note || runtime.keytrackKey!=values.keytrack) {runtime.noteKey=address_.note;runtime.keytrackKey=values.keytrack;runtime.keytrackRatio=float(dsp::fastExp2Audio((address_.note-60)*values.keytrack/12.0));}
        values.cutoff=std::clamp(values.cutoff*runtime.keytrackRatio,20.0f,20000.0f);
        auto signal=filterInputs[slot];
        if(authored.power || values.mix>1e-5f) {
            if(runtime.cutoffKey!=values.cutoff || runtime.resonanceKey!=values.resonance || runtime.gainKey!=values.gain) {runtime.cutoffKey=values.cutoff;runtime.resonanceKey=values.resonance;runtime.gainKey=values.gain;runtime.coefficients=compiled.synthFilterCoefficients(values.cutoff,values.resonance);if(authored.type!=dsp::FilterType::LowPass) runtime.typedCoefficients=dsp::filterDesign(authored.type,runtime.coefficients,values.gain);}
            const auto& coefficients=runtime.coefficients;
            signal.left=runtime.process(float(signal.left),coefficients,values.drive,values.mix,false);
            signal.right=runtime.process(float(signal.right),coefficients,values.drive,values.mix,true);
            filtersQuiet=filtersQuiet && runtime.left.quiet() && runtime.right.quiet();
        } else {runtime.left.reset();runtime.right.reset();}
        if(observe) {visualization_.synthFilters[slot]=values;visualization_.synthFilterIds[slot]=authored.id;}
        if(stage.next>=0) {auto& next=filterInputs[static_cast<std::size_t>(stage.next)];next.left+=signal.left;next.right+=signal.right;}
        else {
            outputs.left+=signal.left*stage.sends[0];outputs.right+=signal.right*stage.sends[0];outputs.mono+=.5*(signal.left+signal.right)*stage.sends[0];
            for(std::size_t b=1;b<filterPlan.busCount;++b) {aux_[2*(b-1)]+=float(signal.left)*stage.sends[b];aux_[2*(b-1)+1]+=float(signal.right)*stage.sends[b];}
        }
    }

    if(oneShotRelease_ && envelope_.stage()==dsp::Envelope::Stage::Sustain) { envelope_.noteOff(ampSettings_); oneShotRelease_=false; }
    if(envelope_.stage()==dsp::Envelope::Stage::Idle && filtersQuiet &&
       (!(compiled.envelopeOwnedMask()&1u) || releasing_)) reset();
    // FX ORDER = PRE MASTER: master gain is applied after the FX graph instead.
    if(effective->applyMaster) {
        outputs.left*=effective->master;outputs.right*=effective->master;outputs.mono*=effective->master;
        if(topology.auxActive) for(auto& a:aux_) a*=effective->master;
    }
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
