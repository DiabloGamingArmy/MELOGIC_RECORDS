// mct-origami-v28.0.0-interactive-envelope-editor
// mct-origami-v27.0.0-cross-osc-routing-foundation
// mct-origami-v26.0.0-osc-process-foundation
// mct-origami-modulation-completion-v24.0.1
// mct-origami-performance-audio-ui-repair-v23.4.4
// mct-origami-glide-mono-legato-v23.4.3
// mct-origami-pitch-mod-real-v23.3
// mct-origami-wt-pos-real-morph-v22.2.1
// mct-origami-v22.1-engine-repair-1
#include "Engine.h"
#include <algorithm>
#include <cmath>
#include <limits>
#include <utility>
namespace mct::origami {
OrigamiEngine::OrigamiEngine() noexcept {
    for(const auto& p:parameterRegistry()) targets_[static_cast<std::size_t>(p.id)].store(p.defaultValue,std::memory_order_relaxed);
    publishModEnvelopeTargets(modulation_);reset();
}
bool OrigamiEngine::prepare(double sampleRate, std::size_t maximumBlockSize, unsigned outputChannels) {
    if (!std::isfinite(sampleRate) || sampleRate < 8000 || sampleRate > 384000 || maximumBlockSize == 0 || (outputChannels != 1 && outputChannels != 2)) return false;
    if (wavetable_.frames.empty()) wavetable_ = dsp::Wavetable::builtIns();
    modulationSmoothing_=static_cast<float>(1.0-std::exp(-1.0/(sampleRate*.005)));
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
    modulationMailbox_.consume(audioModulation_);
    audioModulation_=modulation_; // reset requires exclusive access
    smoothedMacros_=audioModulation_.macros;for(auto& lfo:globalLfos_)lfo.reset();globalRandom_.reset();globalFunction_.reset();
    compiledModulation_.compile(audioModulation_,oscillatorModules_.snapshot(),true);
    for (auto& voice : voices_) voice.reset();
    for (auto& voice : stealTails_) voice.reset();
    tailRemaining_.fill(0); order_ = 0; clearHeldNotes();
    pitchBendNormalized_.fill(0.0f);modWheel_.fill(0.0f);aftertouch_.fill(0.0f);
    for (std::size_t i = 0; i < parameterCount; ++i) { const float v = targets_[i].load(std::memory_order_relaxed); smooth_[i] = {v,v,0,0}; }
}
bool OrigamiEngine::applyPatchState(const ParameterValues& values) noexcept {
    ParameterValues sanitized {};
    for (std::size_t i = 0; i < parameterCount; ++i) if (!sanitizeParameter(static_cast<ParameterId>(i), values[i], sanitized[i])) return false;
    for (std::size_t i = 0; i < parameterCount; ++i) targets_[i].store(sanitized[i], std::memory_order_relaxed);
    reset(); return true;
}
InstrumentState OrigamiEngine::instrumentState() const noexcept {
    InstrumentState state;
    state.parameters=parameterState();
    state.oscillators=oscillatorModules_.snapshot();
    state.nextId=oscillatorModules_.nextId();
    state.modulation=modulation_;
    state.performance=performance_;
    state.performance.pitchBendRangeSemitones=pitchBendRange();
    applyLegacyOscillatorParameters(state.oscillators[0],state.parameters);
    return state;
}
bool OrigamiEngine::restoreInstrumentState(const InstrumentState& state) noexcept {
    if(!validInstrumentState(state)) return false;
    modulation_=state.modulation;publishModEnvelopeTargets(modulation_);modulationMailbox_.publish(modulation_);
    performance_=state.performance;
    pitchBendRange_.store(state.performance.pitchBendRangeSemitones,std::memory_order_relaxed);
    oscillatorModules_.restore(state.oscillators,state.nextId);
    for(std::size_t i=0;i<parameterCount;++i) targets_[i].store(state.parameters[i],std::memory_order_relaxed);
    reset();return true;
}
bool OrigamiEngine::setModulationState(const ModulationState& state) noexcept {
    if(!validModulation(state,oscillatorModules_.snapshot())) return false;
    modulation_=state;publishModEnvelopeTargets(state);modulationMailbox_.publish(state);return true;
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
    auto read=[this](ParameterId id){return targets_[static_cast<std::size_t>(id)].load(std::memory_order_relaxed);};
    dsp::EnvelopeSettings e{read(ParameterId::Attack),read(ParameterId::Decay),read(ParameterId::Sustain),read(ParameterId::Release)};
    e.attackCurve=modEnvelopeTargets_[0].load(std::memory_order_relaxed);
    e.decayCurve=modEnvelopeTargets_[1].load(std::memory_order_relaxed);
    e.releaseCurve=modEnvelopeTargets_[2].load(std::memory_order_relaxed);
    return e;
}
void OrigamiEngine::publishModEnvelopeTargets(const ModulationState& s) noexcept {
    const std::array<float,17> v{
        s.env1Curves[0],s.env1Curves[1],s.env1Curves[2],
        s.env2.attack,s.env2.decay,s.env2.sustain,s.env2.release,
        s.env2.attackCurve,s.env2.decayCurve,s.env2.releaseCurve,
        s.env3.attack,s.env3.decay,s.env3.sustain,s.env3.release,
        s.env3.attackCurve,s.env3.decayCurve,s.env3.releaseCurve
    };
    for(std::size_t i=0;i<v.size();++i) modEnvelopeTargets_[i].store(v[i],std::memory_order_relaxed);
}
dsp::EnvelopeSettings OrigamiEngine::modulationEnvelopeSettings(unsigned index) const noexcept {
    const std::size_t b=index?10u:3u;
    dsp::EnvelopeSettings e{
        modEnvelopeTargets_[b].load(std::memory_order_relaxed),
        modEnvelopeTargets_[b+1].load(std::memory_order_relaxed),
        modEnvelopeTargets_[b+2].load(std::memory_order_relaxed),
        modEnvelopeTargets_[b+3].load(std::memory_order_relaxed)
    };
    e.attackCurve=modEnvelopeTargets_[b+4].load(std::memory_order_relaxed);
    e.decayCurve=modEnvelopeTargets_[b+5].load(std::memory_order_relaxed);
    e.releaseCurve=modEnvelopeTargets_[b+6].load(std::memory_order_relaxed);
    return e;
}
bool OrigamiEngine::sameAddress(const NoteAddress& a,const NoteAddress& b) const noexcept {
    return a.note==b.note && a.channel==b.channel && (!a.noteId || !b.noteId || a.noteId==b.noteId);
}
void OrigamiEngine::clearHeldNotes() noexcept { for(auto& n:heldNotes_) n={};heldCount_=0; }
const OrigamiEngine::HeldNote* OrigamiEngine::selectedMonoHeld() const noexcept {
    const HeldNote* selected=nullptr;
    for(const auto& n:heldNotes_) if(n.held) {
        if(!selected) {selected=&n;continue;}
        if(performance_.notePriority==NotePriority::Last && n.order>selected->order) selected=&n;
        else if(performance_.notePriority==NotePriority::High && (n.address.note>selected->address.note || (n.address.note==selected->address.note && n.order>selected->order))) selected=&n;
        else if(performance_.notePriority==NotePriority::Low && (n.address.note<selected->address.note || (n.address.note==selected->address.note && n.order>selected->order))) selected=&n;
    }
    return selected;
}
bool OrigamiEngine::noteOn(int note,float velocity,std::uint8_t channel,std::uint32_t noteId) noexcept {
    if(!prepared_ || note<0 || note>127 || channel>15 || !std::isfinite(velocity)) return false;
    if(velocity<=0) {noteOff(note,channel,noteId);return true;}
    if(performance_.voiceMode==VoiceMode::Mono) {
        HeldNote* slot=nullptr;
        for(auto& h:heldNotes_) if(h.held && sameAddress(h.address,{note,channel,noteId})) {slot=&h;break;}
        if(!slot) for(auto& h:heldNotes_) if(!h.held) {slot=&h;break;}
        if(!slot) return false;
        const bool hadHeld=heldCount_>0;
        if(!slot->held) ++heldCount_;
        slot->held=true;slot->address={note,channel,noteId};slot->velocity=std::clamp(velocity,0.f,1.f);slot->order=++order_;
        const auto* selected=selectedMonoHeld();if(!selected) return false;
        const auto current=voices_[0].info();
        if(!current.active) voices_[0].start(selected->address,selected->velocity,selected->order,envelopeSettings(),modulationEnvelopeSettings(0),modulationEnvelopeSettings(1));
        else if(!sameAddress(current.address,selected->address)) voices_[0].retarget(selected->address,selected->velocity,selected->order,envelopeSettings(),modulationEnvelopeSettings(0),modulationEnvelopeSettings(1),performance_.glideSeconds,!performance_.legato || !hadHeld || current.releasing);
        else if(!performance_.legato) voices_[0].retarget(selected->address,selected->velocity,selected->order,envelopeSettings(),modulationEnvelopeSettings(0),modulationEnvelopeSettings(1),performance_.glideSeconds,true);
        return true;
    }
    std::size_t chosen=voiceCount;
    for(std::size_t i=0;i<voiceCount;++i) if(!voices_[i].info().active) {chosen=i;break;}
    if(chosen==voiceCount) {
        chosen=0;
        for(std::size_t i=1;i<voiceCount;++i) {
            const auto candidate=voices_[i].info(),best=voices_[chosen].info();
            if((candidate.releasing && !best.releasing) || (candidate.releasing && best.releasing && candidate.envelope<best.envelope) || (candidate.releasing==best.releasing && (!candidate.releasing || candidate.envelope==best.envelope) && candidate.order<best.order)) chosen=i;
        }
        stealTails_[chosen]=voices_[chosen];tailRemaining_[chosen]=stealFadeSamples_;
    }
    voices_[chosen].start({note,channel,noteId},std::clamp(velocity,0.f,1.f),++order_,envelopeSettings(),modulationEnvelopeSettings(0),modulationEnvelopeSettings(1));return true;
}
bool OrigamiEngine::noteOff(int note,std::uint8_t channel,std::uint32_t noteId) noexcept {
    if(!prepared_ || note<0 || note>127 || channel>15) return false;
    if(performance_.voiceMode==VoiceMode::Mono) {
        HeldNote* removed=nullptr;
        for(auto& h:heldNotes_) if(h.held && h.address.note==note && h.address.channel==channel && (!noteId || h.address.noteId==noteId) && (!removed || h.order<removed->order)) removed=&h;
        if(!removed) return true;
        const auto removedAddress=removed->address;removed->held=false;if(heldCount_) --heldCount_;
        const auto current=voices_[0].info();
        if(current.active && sameAddress(current.address,removedAddress)) {
            if(const auto* selected=selectedMonoHeld()) voices_[0].retarget(selected->address,selected->velocity,selected->order,envelopeSettings(),modulationEnvelopeSettings(0),modulationEnvelopeSettings(1),performance_.glideSeconds,!performance_.legato);
            else voices_[0].release(envelopeSettings(),modulationEnvelopeSettings(0),modulationEnvelopeSettings(1));
        }
        return true;
    }
    std::size_t chosen=voiceCount;
    for(std::size_t i=0;i<voiceCount;++i) {
        const auto info=voices_[i].info();
        if(!info.active || info.releasing || info.address.note!=note || info.address.channel!=channel || (noteId && info.address.noteId!=noteId)) continue;
        if(chosen==voiceCount || info.order<voices_[chosen].info().order) chosen=i;
    }
    if(chosen!=voiceCount) voices_[chosen].release(envelopeSettings(),modulationEnvelopeSettings(0),modulationEnvelopeSettings(1));return true;
}
void OrigamiEngine::allNotesOff() noexcept {clearHeldNotes();const auto settings=envelopeSettings(),e2=modulationEnvelopeSettings(0),e3=modulationEnvelopeSettings(1);for(auto& voice:voices_)voice.release(settings,e2,e3);}
void OrigamiEngine::pitchWheel(std::uint8_t channel,int value14) noexcept {
    if(channel>15) return;value14=std::clamp(value14,0,16383);
    pitchBendNormalized_[channel]=static_cast<float>(value14-8192)/static_cast<float>(value14>=8192?8191:8192);
}
void OrigamiEngine::modWheel(std::uint8_t channel,int value7) noexcept {
    if(channel>15)return;modWheel_[channel]=static_cast<float>(std::clamp(value7,0,127))/127.0f;
}
void OrigamiEngine::aftertouch(std::uint8_t channel,int value7) noexcept {
    if(channel>15)return;aftertouch_[channel]=static_cast<float>(std::clamp(value7,0,127))/127.0f;
}
bool OrigamiEngine::setPitchBendRange(float semitones) noexcept {
    if(!std::isfinite(semitones) || semitones<1.0f || semitones>48.0f) return false;
    pitchBendRange_.store(semitones,std::memory_order_relaxed);return true;
}
bool OrigamiEngine::setPerformanceState(const PerformanceState& state) noexcept {
    InstrumentState probe=instrumentState();probe.performance=state;
    if(!validInstrumentState(probe)) return false;
    const bool modeChanged=performance_.voiceMode!=state.voiceMode;
    performance_=state;pitchBendRange_.store(state.pitchBendRangeSemitones,std::memory_order_relaxed);
    if(modeChanged) {
        clearHeldNotes();
        for(auto& voice:voices_) voice.reset();
        for(auto& voice:stealTails_) voice.reset();
        tailRemaining_.fill(0);
    }
    return true;
}
PerformanceState OrigamiEngine::performanceState() const noexcept {
    auto s=performance_;s.pitchBendRangeSemitones=pitchBendRange();return s;
}
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
    modulationMailbox_.consume(audioModulation_);
    // Resolve stable IDs only once per block; at most 32 routes / 16 modules.
    compiledModulation_.compile(audioModulation_,modules);
    for(std::size_t sample=0;sample<sampleCount;++sample) {
        for(auto& s:smooth_) if(s.remaining) {
            s.value+=static_cast<float>(s.step);
            if(--s.remaining==0) s.value=s.target;
        }

        modules[0].id=1;
        // Preserve OSC1 power state from the module snapshot.
        modules[0].waveform=value(ParameterId::Waveform);
        modules[0].wtPosition=std::clamp((value(ParameterId::Waveform))/3.0f,0.0f,1.0f);
        modules[0].octave=value(ParameterId::OscOctave);
        modules[0].semitone=value(ParameterId::OscSemitone);
        modules[0].fineCents=value(ParameterId::OscFine);
        modules[0].unison=static_cast<unsigned>(std::clamp(
            static_cast<int>(std::lround(value(ParameterId::OscUnison))),1,16));
        modules[0].detuneCents=value(ParameterId::OscDetune);
        modules[0].pan=value(ParameterId::OscPan);
        modules[0].level=value(ParameterId::OscLevel);

        std::array<float,CompiledModulation::globalSourceCount> sources{};
        for(std::size_t i=0;i<4;++i){const auto& l=lfoSettings(audioModulation_,i);sources[i]=l.mode==LfoMode::Free?globalLfos_[i].next(l,sampleRate_):0.0f;}
        for(std::size_t i=0;i<smoothedMacros_.size();++i){smoothedMacros_[i]+=modulationSmoothing_*(audioModulation_.macros[i]-smoothedMacros_[i]);sources[4+i]=smoothedMacros_[i];}
        sources[8]=globalRandom_.next(audioModulation_.random,sampleRate_);
        sources[9]=globalFunction_.next(audioModulation_.function,sampleRate_);
        compiledModulation_.advance(modulationSmoothing_);
        ModulationFrame frame;
        frame.modules=modules;frame.cutoff=value(ParameterId::Cutoff);
        frame.resonance=value(ParameterId::Resonance);frame.master=value(ParameterId::MasterGain);
        compiledModulation_.globalFrame(frame,sources,sampleRate_);
        const float sustain=value(ParameterId::Sustain);

        double left=0.0,right=0.0,mono=0.0;
        std::size_t activeModules=0;
        for(const auto& m:modules) if(m.enabled) ++activeModules;
        const double normalization=activeModules ? 1.0/static_cast<double>(activeModules) : 1.0;

        for(std::size_t v=0;v<voiceCount;++v) {
            const auto info=voices_[v].info();
            const auto channel=std::min<std::size_t>(info.address.channel,15);
            const float bend=pitchBendNormalized_[channel]*pitchBendRange();
            auto fresh=voices_[v].nextModules(wavetable_,frame,sustain,compiledModulation_,audioModulation_,bend,modWheel_[channel],aftertouch_[channel]);
            Voice::Samples old{};
            float oldWeight=0.0f;

            if(tailRemaining_[v]) {
                oldWeight=static_cast<float>(tailRemaining_[v])/static_cast<float>(stealFadeSamples_);
                const auto oldInfo=stealTails_[v].info();const auto oldChannel=std::min<std::size_t>(oldInfo.address.channel,15);
                old=stealTails_[v].nextModules(wavetable_,frame,sustain,compiledModulation_,audioModulation_,pitchBendNormalized_[oldChannel]*pitchBendRange(),modWheel_[oldChannel],aftertouch_[oldChannel]);
                if(--tailRemaining_[v]==0) stealTails_[v].reset();
            }

            left+=fresh.left*(1-oldWeight)+old.left*oldWeight;
            right+=fresh.right*(1-oldWeight)+old.right*oldWeight;
            mono+=fresh.mono*(1-oldWeight)+old.mono*oldWeight;
        }

        const float master=static_cast<float>(normalization);
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
    s.wtPosition=std::clamp(s.waveform/3.0f,0.0f,1.0f);
    s.tableId=dsp::BuiltinWavetableId::BasicShapes;
    return oscillatorModules_.add(s);
}
bool OrigamiEngine::removeOscillatorModule(OscillatorModuleId id) noexcept {
    if(!oscillatorModules_.remove(id)) return false;

    // Clear cross-oscillator routing slots whose source just disappeared.
    // Stable module IDs are authoritative, so a later oscillator cannot inherit
    // a stale source relationship.
    for(const auto& existing:oscillatorModules_.snapshot()) {
        if(existing.id==0) continue;
        auto updatedModule=existing;
        bool changed=false;

        if(updatedModule.route1SourceId==id) {
            updatedModule.route1SourceId=0;
            updatedModule.route1Type=OscRouteType::Off;
            updatedModule.route1Amount=0.0f;
            changed=true;
        }

        if(updatedModule.route2SourceId==id) {
            updatedModule.route2SourceId=0;
            updatedModule.route2Type=OscRouteType::Off;
            updatedModule.route2Amount=0.0f;
            changed=true;
        }

        if(changed)
            oscillatorModules_.set(existing.id,updatedModule);
    }

    // Deletion removes addressed modulation routes. Reused display ordinals never retarget them.
    auto updated=modulation_;std::size_t out=0;
    for(const auto& route:modulation_.routes)
        if(route.id && route.destination.oscillator!=id) updated.routes[out++]=route;
    while(out<updated.routes.size()) updated.routes[out++]={};
    setModulationState(updated);return true;
}
bool OrigamiEngine::setOscillatorModuleState(OscillatorModuleId id,const OscillatorModuleState& state) noexcept {
    if(oscillatorModules_.state(id).id==0) return false;
    auto canonical=state;
    const auto old=oscillatorModules_.state(id);

    if(id==1) {
        applyLegacyOscillatorParameters(canonical,parameterState());
    } else {
        if(canonical.wtPosition==old.wtPosition && canonical.waveform!=old.waveform)
            canonical.wtPosition=canonical.waveform/3.0f;
        canonical.waveform=canonical.wtPosition*3.0f;
    }

    auto candidate=instrumentState();
    for(auto& m:candidate.oscillators) if(m.id==id) {canonical.id=id;canonical.enabled=m.enabled;m=canonical;}
    if(!validInstrumentState(candidate)) return false;
    return oscillatorModules_.set(id,canonical);
}
OscillatorModuleState OrigamiEngine::oscillatorModuleState(OscillatorModuleId id) const noexcept {
    auto state=oscillatorModules_.state(id);
    if(id==1) applyLegacyOscillatorParameters(state,parameterState());
    return state;
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
