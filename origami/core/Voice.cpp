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

void Voice::prepare(double sampleRate) noexcept { sampleRate_=sampleRate;envelope_.prepare(sampleRate);env2_.prepare(sampleRate);env3_.prepare(sampleRate);reset();seedLfos(); }
// Per-voice LFO streams: a distinct, repeatable ENTROPY stream per voice
// lifecycle (the NODES voice-seed family); FRACTURE structure per LFO index.
void Voice::seedLfos() noexcept {
    for(std::size_t i=0;i<noteLfos_.size();++i) noteLfos_[i].setStreams(Lfo::voiceStream(voiceSeed(),i),Lfo::fractureSeed(i));
}
void Voice::reset() noexcept { topologyGeneration_=0; for(auto& lfo:noteLfos_)lfo.reset();for(auto& module:moduleOscillators_)for(auto& oscillator:module)oscillator.reset();for(auto& oscillator:moduleBlendCenters_)oscillator.reset();for(auto& runtime:oscillatorRuntime_)runtime.invalidate();previousOscillatorSamples_.fill(0.0f);envelope_.reset();env2_.reset();env3_.reset();for(auto& filter:moduleFilters_)filter.reset();for(auto& filter:moduleFiltersRight_)filter.reset();rightFilterLive_=0;operatorState_={};active_=releasing_=false;velocity_=0;order_=0;visualization_={}; }
void Voice::start(NoteAddress address,float velocity,std::uint64_t order,const dsp::EnvelopeSettings& settings,const dsp::EnvelopeSettings& env2,const dsp::EnvelopeSettings& env3) noexcept {
    reset();address_=address;velocity_=velocity;order_=order;++lifecycle_;seedLfos();
    frequency_=targetFrequency_=dsp::midiFrequency(address.note);glideRatio_=1.0;glideRemaining_=0;
    active_=true;envelope_.noteOn(settings);env2_.noteOn(env2);env3_.noteOn(env3);
    // A fresh (or stolen) voice: NOTE ON, never RETRIGGER; state was reset.
    pendingNoteOn_=true;pendingNoteOff_=false;pendingRetrigger_=false;
}
void Voice::retarget(NoteAddress address,float velocity,std::uint64_t order,const dsp::EnvelopeSettings& settings,const dsp::EnvelopeSettings& env2,const dsp::EnvelopeSettings& env3,float glideSeconds,bool retriggerEnvelope) noexcept {
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
    if(retriggerEnvelope) {envelope_.noteOn(settings);env2_.noteOn(env2);env3_.noteOn(env3);for(auto& lfo:noteLfos_)lfo.reset();operatorState_={};++lifecycle_;seedLfos();}
}
void Voice::release(const dsp::EnvelopeSettings& settings,const dsp::EnvelopeSettings& env2,const dsp::EnvelopeSettings& env3) noexcept {
    if(active_){releasing_=true;envelope_.noteOff(settings);env2_.noteOff(env2);env3_.noteOff(env3);pendingNoteOff_=true;}
}
Voice::Samples Voice::nextModules(const std::array<const dsp::Wavetable*,16>& tables,const ModulationFrame& global,
    float sustain,const CompiledModulation& compiled,const ModulationState& modulation,
    float pitchBendSemitones,float pitchBendNormalized,float modWheel,float aftertouch,const OscillatorRenderPlan& topology,const OscillatorProcessPlans& sharedProcesses,bool observe) noexcept {
    // mct-origami-stereo-modulation: two instantiations of one renderer. The
    // mono one (no stereo plan) compiles every stereo branch away and is the
    // pre-stereo code path.
    return compiled.hasStereoPlan()
        ? render<true>(tables,global,sustain,compiled,modulation,pitchBendSemitones,pitchBendNormalized,modWheel,aftertouch,topology,sharedProcesses,observe)
        : render<false>(tables,global,sustain,compiled,modulation,pitchBendSemitones,pitchBendNormalized,modWheel,aftertouch,topology,sharedProcesses,observe);
}

template<bool Stereo>
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
    const float envelope=envelope_.next(sustain);
    const float env2=env2_.next(modulation.env2.sustain),env3=env3_.next(modulation.env3.sustain);
    std::array<float,CompiledModulation::voiceSourceCount> voiceSources{};
    const float sourceEnvelopeScale=std::clamp(global.envelopeScaling,0.0f,2.0f);
    const float sourceLfoScale=std::clamp(global.lfoScaling,0.0f,2.0f);
    voiceSources[0]=envelope*sourceEnvelopeScale;voiceSources[1]=env2*sourceEnvelopeScale;voiceSources[2]=env3*sourceEnvelopeScale;
    // mct-origami-stereo-modulation: per-voice LFO pairs (RIGHT only when the
    // plan is stereo and that LFO's STEREO is non-zero; LEFT is unchanged).
    StereoSourceValues voiceStereo{};
    constexpr bool stereoPlan=Stereo;
    for(std::size_t i=0;i<4;++i){
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
    if(observe) visualization_.sources=voiceSources;
    if(compiled.hasFxVoiceRoutes()) lastSources_=voiceSources;
    auto& local=localFrame_;const ModulationFrame* effective=&global;
    const bool voiceOperators=compiled.hasVoiceOperators();
    const bool noteOn=pendingNoteOn_,noteOff=pendingNoteOff_,retrigger=pendingRetrigger_;
    pendingNoteOn_=pendingNoteOff_=pendingRetrigger_=false;
    if(compiled.hasVoiceRoutes() || voiceOperators) {
        // N07: only the active modules are copied per sample (full copy on the
        // decimated observation ticks, which publish every module slot).
        if(observe) local=global; else local.copyForVoice(global,topology.active,topology.activeCount,compiled.voiceModuleMask(),stereoPlan);
        // N04 per-voice CONTROL operators: this voice's sources, this voice's state.
        if(voiceOperators) {
            local.events.noteOn=noteOn;local.events.noteOff=noteOff;
            local.events.retrigger=retrigger;local.events.gate=!releasing_;
            local.events.voiceSeed=voiceSeed();
            compiled.evaluateVoiceOperators(local,voiceSources,operatorState_,&operatorEventCounts_,&global,stereoPlan ? &voiceStereo : nullptr);
        }
        if(compiled.hasVoiceRoutes()) compiled.voiceFrame(local,voiceSources,sampleRate_,stereoPlan ? &voiceStereo : nullptr);
        effective=&local;
    }
    // N05 targets act after this sample's evaluation (effective next sample).
    if(compiled.hasEnvelopeTriggers()) {
        const auto mask=compiled.envelopeTriggers(*effective);
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
        stereoActive=effective->stereo.levelMask!=0 || effective->stereo.filterSplit();
        if(!stereoActive) rightFilterLive_=0;
    }
    // Modules no voice route writes are read from the global frame (N07).
    const std::uint16_t localModules=effective==&local && !observe ? compiled.voiceModuleMask() : (effective==&local ? 0xffffu : 0u);
    const float envelopeValue=envelope*velocity_*std::clamp(effective->envelopeScaling,0.0f,2.0f);
    if(observe) visualization_.modules=modules;
    bool filtersQuiet=true;
    // One bend ratio per voice/sample, not one exp2 per active oscillator module.
    const double globalPitchSemitones=static_cast<double>(effective->mainTuning+effective->transpose);
    const double pitchBendScale=dsp::fastExp2Audio((static_cast<double>(pitchBendSemitones)+globalPitchSemitones)/12.0);

    if(topologyGeneration_!=topology.generation) {
        for(std::size_t m=0;m<modules.size();++m) if(moduleIds_[m]!=topology.ids[m]) {
            for(auto& oscillator:moduleOscillators_[m]) oscillator.reset();
            moduleBlendCenters_[m].reset();moduleFilters_[m].reset();moduleFiltersRight_[m].reset();rightFilterLive_&=std::uint16_t(~(1u<<m));
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

        const auto renderOscillator=[&](dsp::WavetableOscillator& oscillator,double frequency) noexcept {
            return modulePlan.simple ? oscillator.nextSimple(table,frequency,sampleRate_,position)
                : oscillator.next(table,frequency,sampleRate_,position,processPlan,routedPhaseOffset,routedPhaseSkew);
        };
        float oscillatorMix=0.0f;
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

            const float source=std::clamp(previousOscillatorSamples_[static_cast<std::size_t>(sourceIndex)],-1.0f,1.0f);
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
        };

        for(std::size_t r=0;r<modulePlan.postCount;++r) {
            const auto& route=modulePlan.postRoutes[r];
            oscillatorMix=applyPostRoute(oscillatorMix,route.source,route.type,routeAmount(route));
        }

        if(!std::isfinite(oscillatorMix)) {
            for(auto& oscillator:moduleOscillators_[m]) oscillator.reset();
            moduleBlendCenters_[m].reset();oscillatorMix=0.0f;
        }
        previousOscillatorSamples_[m]=std::clamp(oscillatorMix,-1.0f,1.0f);

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
        float sampleRight=sampleValue;
        if(effective->filterEnabled) {
            if(stereoFilter && (rightFilterLive_&rightBit)==0) { moduleFiltersRight_[m]=moduleFilters_[m]; rightFilterLive_|=rightBit; } // continue from LEFT's state: no click
            const float input=sampleValue;
            sampleValue=moduleFilters_[m].next(input,effective->filter);
            filtersQuiet=filtersQuiet && moduleFilters_[m].quiet();
            if(stereoFilter) {
                sampleRight=moduleFiltersRight_[m].next(input,stereo.filter);
                filtersQuiet=filtersQuiet && moduleFiltersRight_[m].quiet();
            } else { rightFilterLive_&=std::uint16_t(~rightBit); sampleRight=sampleValue; }
        } else {
            moduleFilters_[m].reset();
            moduleFiltersRight_[m].reset(); rightFilterLive_&=std::uint16_t(~rightBit);
        }
        const float leveled=sampleValue*level;
        sampleValue=leveled*modulePlan.mainBusSend;
        if(!std::isfinite(sampleValue)) {moduleFilters_[m].reset();sampleValue=0.0f;}
        if(!stereoLevel && !stereoFilter) {
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

    if(envelope_.stage()==dsp::Envelope::Stage::Idle && filtersQuiet) reset();
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
