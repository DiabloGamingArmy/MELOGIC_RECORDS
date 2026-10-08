// mct-origami-unified-routing-core-fx-p04
// mct-origami-fx-modulation-graph-ux-p03
// mct-origami-deep-audit-p07-enforced-qos
// mct-origami-deep-audit-p01-no-rt-spectral-build
// mct-origami-audio-reengineer-p17-global-qos-budget
// mct-origami-audio-reengineer-p09-lightweight-voice-steal
// mct-origami-audio-reengineer-p06.3-local-source
// mct-origami-v32.1.1-extended-mod-sources-hotfix
// mct-origami-v31.2.1-mod-ring-retrigger-refine
// mct-origami-v31.0.0-matrix-routing-expansion
// mct-origami-v30.1.0-env-sync-native-menus-retrigger
// mct-origami-v28.0.0-interactive-envelope-editor
// mct-origami-v27.0.0-cross-osc-routing-foundation
// mct-origami-v26.0.0-osc-process-foundation
// mct-origami-modulation-completion-v24.0.1
// mct-origami-performance-audio-ui-repair-v23.4.4
// mct-origami-glide-mono-legato-v23.4.3
// mct-origami-pitch-mod-real-v23.3
// mct-origami-wt-pos-real-morph-v22.2.1
// mct-origami-v22.1-engine-repair-1
// mct-origami-v34.2.1-performance-reinforcement
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
    // Voices receive only tables validated before entering the render path.
    if (!wavetable_.valid()) return false;
    dsp::prepareSpectralCompiler();
    modulationSmoothing_=static_cast<float>(1.0-std::exp(-1.0/(sampleRate*.005)));
    sampleRate_ = sampleRate; outputChannels_ = outputChannels;
    compiledModulation_.prepare(sampleRate_);
    hostModules_=oscillatorModules_.snapshot();
    dezipModules_=hostModules_; dezipActive_=0;
    rebuildHostWavetables();
    stealFadeSamples_ = static_cast<std::size_t>(std::max(1.0, std::round(sampleRate * .003)));
    for (auto& voice : voices_) voice.prepare(sampleRate);
    for (std::size_t v=0;v<voices_.size();++v) voices_[v].setSlot(std::uint32_t(v));
    prepared_ = true; reset(); return true;
}
bool OrigamiEngine::installWavetable(dsp::Wavetable table) {
    if (!table.valid()) return false;
    dsp::assignWavetableGeneration(table);
    wavetable_ = std::move(table); reset(); return true;
}
OrigamiEngine::OscillatorWavetableSlot* OrigamiEngine::wavetableSlotFor(OscillatorModuleId id) noexcept {
    OscillatorWavetableSlot* destination=nullptr;
    for(auto& slot:oscillatorWavetables_) {
        if(slot.id==id) return &slot;
        if(destination==nullptr && slot.id==0) destination=&slot;
    }
    return destination;
}
bool OrigamiEngine::installWavetableForOscillator(OscillatorModuleId id,dsp::Wavetable table) {
    if(id==0 || oscillatorModules_.state(id).id==0 || !table.valid()) return false;
    dsp::assignWavetableGeneration(table);
    auto* destination=wavetableSlotFor(id);
    if(destination==nullptr) return false;
    destination->id=id;
    destination->table=std::move(table);
    rebuildHostWavetables();
    // Existing voices retain phase but their oscillator lookup caches key on
    // table pointer/generation, so the authored table becomes authoritative
    // without assigning it to unrelated oscillator modules.
    return true;
}
bool OrigamiEngine::publishWavetableForOscillator(OscillatorModuleId id,dsp::Wavetable table) {
    // All validation (a full scan of every sample) and the generation stamp
    // happen here, off the audio thread.
    if(id==0 || oscillatorModules_.state(id).id==0 || !table.valid()) return false;
    return publishWavetableForPendingOscillator(id,std::move(table));
}
bool OrigamiEngine::publishWavetableForPendingOscillator(OscillatorModuleId id,dsp::Wavetable table) {
    if(id==0 || !table.valid()) return false;
    dsp::assignWavetableGeneration(table);
    collectRetiredWavetables();
    auto* handoff=new WavetableHandoff{id,std::move(table),nullptr,0};
    handoff->next=wavetableIncoming_.load(std::memory_order_relaxed);
    while(!wavetableIncoming_.compare_exchange_weak(handoff->next,handoff,
                                                    std::memory_order_release,std::memory_order_relaxed)) {}
    return true;
}
void OrigamiEngine::collectRetiredWavetables() noexcept {
    for(auto* h=wavetableRetired_.exchange(nullptr,std::memory_order_acquire);h!=nullptr;) {
        auto* next=h->next; delete h; h=next;
    }
}
OrigamiEngine::~OrigamiEngine() {
    collectRetiredWavetables();
    for(auto* h=wavetableIncoming_.exchange(nullptr,std::memory_order_acquire);h!=nullptr;) {
        auto* next=h->next; delete h; h=next;
    }
}
// Audio thread, host-block boundary, after the module snapshot was consumed.
// `list` is newest-first; adopt in publication order so the latest table for
// a module wins. Every holder (now carrying the replaced table, or the
// rejected one) returns on the retired stack.
bool OrigamiEngine::adoptWavetableHandoffs(WavetableHandoff* list) noexcept {
    WavetableHandoff* ordered=nullptr;
    while(list) { auto* next=list->next; list->next=ordered; ordered=list; list=next; }
    bool installed=false;
    while(ordered) {
        auto* h=ordered; ordered=h->next;
        bool exists=false;
        for(const auto& m:hostModules_) exists|=m.id==h->id;
        if(!exists && ++h->waitBlocks<maxHandoffWaitBlocks) {
            // Its oscillator is not here yet (a restore in flight): back on
            // the incoming stack for the next block (pointer pushes only).
            h->next=wavetableIncoming_.load(std::memory_order_relaxed);
            while(!wavetableIncoming_.compare_exchange_weak(h->next,h,std::memory_order_release,std::memory_order_relaxed)) {}
            continue;
        }
        if(auto* destination=exists ? wavetableSlotFor(h->id) : nullptr) {
            using std::swap;
            swap(destination->table,h->table); // vector / string pointer swaps: no allocation
            destination->id=h->id;
            installed=true;
        }
        h->next=wavetableRetired_.load(std::memory_order_relaxed);
        while(!wavetableRetired_.compare_exchange_weak(h->next,h,std::memory_order_release,std::memory_order_relaxed)) {}
    }
    return installed;
}
void OrigamiEngine::rebuildHostWavetables() noexcept {
    // A slot id is only ever set for a table validated before it was
    // installed: no per-rebuild scan of every sample here (this runs on the
    // audio thread after every oscillator state edit).
    for(std::size_t i=0;i<hostWavetables_.size();++i) {
        hostWavetables_[i]=&wavetable_;
        const auto id=hostModules_[i].id;
        if(id==0) continue;
        for(const auto& slot:oscillatorWavetables_) {
            if(slot.id==id) {
                hostWavetables_[i]=&slot.table;
                break;
            }
        }
    }
}
void OrigamiEngine::reset() noexcept {
    modulationMailbox_.consume(pendingModulationUpdate_);
    audioModulation_=modulation_; audioSynthFilters_=preparedSynthFilters_;hostBusSlots_=slotMapFor(buses_); // reset requires exclusive access
    smoothedMacros_=audioModulation_.macros;
    // Global FREE LFOs: their lifecycle (DELAY / ATTACK) starts at engine reset;
    // one coherent ENTROPY stream per LFO index.
    for(auto& r:instanceRuntime_) r.reset();
    for(std::size_t i=0;i<globalLfos_.size();++i) { globalLfos_[i].reset(); globalLfos_[i].setStreams(Lfo::globalStream(i),Lfo::fractureSeed(i)); }
    globalRandom_.reset();globalFunction_.reset();globalChaos_.reset();globalDrift_.reset();globalSequencer_.reset();
    const auto resetModules=oscillatorModules_.snapshot();
    compiledModulation_.markStateRevision();
    compiledModulation_.compile(audioModulation_,resetModules,true);
    globalInstanceCount_=0;
    for(std::size_t i=0;i<maxSourceInstances;++i) {const auto& a=audioModulation_.instances[i];if(a.id && !sourceIsVoice(instanceSource(a.id),audioModulation_) && compiledModulation_.usesGlobalSource(CompiledModulation::instanceGlobalSlot(i))) globalInstanceSlots_[globalInstanceCount_++]=std::uint8_t(i);}
    publishNodesDiagnostics();
    compiledModulation_.resetOperatorState();
    oscillatorPlan_.compile(resetModules,slotMapFor(buses_));oscillatorPlan_.adoptSynthFilters(audioSynthFilters_);
    dezipModules_=resetModules; dezipActive_=0; // a reset never glides
    for(std::size_t i=0;i<resetModules.size();++i) compiledModuleIds_[i]=resetModules[i].id;
    for (auto& voice : voices_) { voice.reset(); voice.restartLifecycles(); }
    lastVoiceSamples_.fill({});
    stealResidual_.fill({});
    for(auto& a:lastAux_) a.fill(0.0f);
    for(auto& a:stealAuxResidual_) a.fill(0.0f);
    tailRemaining_.fill(0); order_ = 0; clearHeldNotes();
    pitchBendNormalized_.fill(0.0f);modWheel_.fill(0.0f);aftertouch_.fill(0.0f);
    for (std::size_t i = 0; i < parameterCount; ++i) { const float v = targets_[i].load(std::memory_order_relaxed); smooth_[i] = {v,v,0,0}; }
}
void OrigamiEngine::emergencyResetRuntime() noexcept {
    for(auto& voice:voices_) { voice.reset(); voice.restartLifecycles(); }
    for(auto& r:instanceRuntime_) r.reset();
    for(std::size_t i=0;i<globalLfos_.size();++i) {
        globalLfos_[i].reset();
        globalLfos_[i].setStreams(Lfo::globalStream(i),Lfo::fractureSeed(i));
    }
    globalRandom_.reset(); globalFunction_.reset(); globalChaos_.reset();
    globalDrift_.reset(); globalSequencer_.reset();
    compiledModulation_.resetOperatorState();
    lastVoiceSamples_.fill({}); stealResidual_.fill({});
    for(auto& a:lastAux_) a.fill(0.0f);
    for(auto& a:stealAuxResidual_) a.fill(0.0f);
    tailRemaining_.fill(0); clearHeldNotes();
    pitchBendNormalized_.fill(0.0f); modWheel_.fill(0.0f); aftertouch_.fill(0.0f);
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
    state.buses=buses_;
    state.performance.pitchBendRangeSemitones=pitchBendRange();
    state.performance.pitchBendDownSemitones=pitchBendDownRange();
    applyLegacyOscillatorParameters(state.oscillators[0],state.parameters);
    return state;
}
bool OrigamiEngine::restoreInstrumentState(const InstrumentState& state) noexcept {
    if(!validInstrumentState(state)) return false;
    modulation_=state.modulation;publishModEnvelopeTargets(modulation_);
    performance_=state.performance;
    buses_=state.buses;
    pitchBendRange_.store(state.performance.pitchBendRangeSemitones,std::memory_order_relaxed);
    pitchBendDownRange_.store(state.performance.pitchBendDownSemitones,std::memory_order_relaxed);
    oscillatorModules_.restore(state.oscillators,state.nextId);publishModulation();
    for(std::size_t i=0;i<parameterCount;++i) targets_[i].store(state.parameters[i],std::memory_order_relaxed);
    reset();return true;
}
BusSlotMap OrigamiEngine::slotMapFor(const BusState& state) noexcept {
    BusSlotMap map;
    map.count=std::clamp<std::size_t>(state.count,1,maxRenderBuses);
    for(std::size_t i=0;i<map.count;++i) map.ids[i]=state.buses[i].id;
    return map;
}
bool OrigamiEngine::setBusState(const BusState& state) noexcept {
    InstrumentState probe=instrumentState();probe.buses=state;
    if(!validInstrumentState(probe)) return false;
    buses_=state;
    publishModulation();
    return true;
}
bool OrigamiEngine::setModulationState(const ModulationState& state) noexcept {
    auto candidate=instrumentState();candidate.modulation=state;
    if(!validInstrumentState(candidate)) return false;
    modulation_=state;publishModEnvelopeTargets(state);publishModulation();return true;
}
void OrigamiEngine::publishModulation() noexcept {
    const auto slots=slotMapFor(buses_);
    preparedSynthFilters_=prepareSynthFilters(modulation_,oscillatorModules_.snapshot(),slots.ids,slots.count);
    modulationMailbox_.publish(ModulationUpdate{modulation_,preparedSynthFilters_});
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
std::size_t OrigamiEngine::selectVoiceStealCandidate() const noexcept {
    std::size_t chosen=voiceCount;
    for(std::size_t i=0;i<voiceCount;++i) {
        const auto candidate=voices_[i].info();
        if(!candidate.active) continue;
        if(chosen==voiceCount) { chosen=i; continue; }
        const auto best=voices_[chosen].info();
        if((candidate.releasing && !best.releasing)
           || (candidate.releasing && best.releasing && candidate.envelope<best.envelope)
           || (candidate.releasing==best.releasing
               && (!candidate.releasing || candidate.envelope==best.envelope)
               && candidate.order<best.order))
            chosen=i;
    }
    return chosen;
}

void OrigamiEngine::setVoiceAdmissionCeiling(std::size_t ceiling) noexcept {
    voiceAdmissionCeiling_=std::clamp<std::size_t>(ceiling,1u,voiceCount);
}
void OrigamiEngine::setGlobalSwingBase(float swing) noexcept {
    globalSwingBase_=std::isfinite(swing)?std::clamp(swing,0.0f,0.75f):0.0f;
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
        if(!current.active) voices_[0].start(selected->address,selected->velocity,selected->order,envelopeSettings(),modulationEnvelopeSettings(0),modulationEnvelopeSettings(1),compiledModulation_.envelopeOwnedMask());
        else if(!sameAddress(current.address,selected->address)) voices_[0].retarget(selected->address,selected->velocity,selected->order,envelopeSettings(),modulationEnvelopeSettings(0),modulationEnvelopeSettings(1),currentPortaTime_,!performance_.legato || !hadHeld || current.releasing,compiledModulation_.envelopeOwnedMask());
        else if(current.releasing || !performance_.legato)
            // Same pitch during a release tail is a NEW articulation even when
            // mono-legato is enabled. The old code treated "same address" as
            // already-held and silently left the envelope releasing.
            voices_[0].retarget(selected->address,selected->velocity,selected->order,
                                envelopeSettings(),modulationEnvelopeSettings(0),
                                modulationEnvelopeSettings(1),
                                currentPortaTime_,true,compiledModulation_.envelopeOwnedMask());
        return true;
    }
    std::size_t chosen=voiceCount;
    for(std::size_t i=0;i<voiceCount;++i) {
        const auto info=voices_[i].info();
        if(info.active && info.releasing &&
           info.address.note==note && info.address.channel==channel &&
           (!noteId || !info.address.noteId || info.address.noteId==noteId)) {
            chosen=i;
            stealResidual_[chosen]=lastVoiceSamples_[chosen];stealAuxResidual_[chosen]=lastAux_[chosen];
            tailRemaining_[chosen]=stealFadeSamples_;
            break;
        }
    }

    // Deep Audit P07: under measured Critical pressure, do not increase
    // concurrent polyphonic work above the current admission ceiling. Preserve
    // responsiveness by replacing the normal steal candidate instead of
    // dropping the incoming MIDI note. Existing sounding voices are not killed
    // merely because the ceiling changed.
    if(chosen==voiceCount && activeVoiceCount()>=voiceAdmissionCeiling_) {
        chosen=selectVoiceStealCandidate();
        if(chosen<voiceCount) {
            stealResidual_[chosen]=lastVoiceSamples_[chosen];stealAuxResidual_[chosen]=lastAux_[chosen];
            tailRemaining_[chosen]=stealFadeSamples_;
        }
    }

    if(chosen==voiceCount)
        for(std::size_t i=0;i<voiceCount;++i)
            if(!voices_[i].info().active) {chosen=i;break;}

    if(chosen==voiceCount) {
        chosen=selectVoiceStealCandidate();
        if(chosen==voiceCount) return false;
        stealResidual_[chosen]=lastVoiceSamples_[chosen];stealAuxResidual_[chosen]=lastAux_[chosen];
        tailRemaining_[chosen]=stealFadeSamples_;
    }
    voices_[chosen].start({note,channel,noteId},std::clamp(velocity,0.f,1.f),++order_,envelopeSettings(),modulationEnvelopeSettings(0),modulationEnvelopeSettings(1),compiledModulation_.envelopeOwnedMask());return true;
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
            if(const auto* selected=selectedMonoHeld()) voices_[0].retarget(selected->address,selected->velocity,selected->order,envelopeSettings(),modulationEnvelopeSettings(0),modulationEnvelopeSettings(1),currentPortaTime_,!performance_.legato,compiledModulation_.envelopeOwnedMask());
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
    return setPitchBendRanges(semitones,semitones);
}
bool OrigamiEngine::setPitchBendRanges(float upSemitones,float downSemitones) noexcept {
    // Signed endpoints (semitones at full up / full down), any direction.
    constexpr float maxBend=PerformanceState::maxBendSemitones;
    if(!std::isfinite(upSemitones) || !std::isfinite(downSemitones) ||
       std::abs(upSemitones)>maxBend || std::abs(downSemitones)>maxBend) return false;
    pitchBendRange_.store(upSemitones,std::memory_order_relaxed);
    pitchBendDownRange_.store(downSemitones,std::memory_order_relaxed);
    return true;
}
bool OrigamiEngine::setPerformanceState(const PerformanceState& state) noexcept {
    InstrumentState probe=instrumentState();probe.performance=state;
    if(!validInstrumentState(probe)) return false;
    const bool modeChanged=performance_.voiceMode!=state.voiceMode;
    performance_=state;currentPortaTime_=state.glideSeconds;
    pitchBendRange_.store(state.pitchBendRangeSemitones,std::memory_order_relaxed);
    pitchBendDownRange_.store(state.pitchBendDownSemitones,std::memory_order_relaxed);
    if(modeChanged) {
        clearHeldNotes();
        for(auto& voice:voices_) voice.reset();
        lastVoiceSamples_.fill({});
        stealResidual_.fill({});
        tailRemaining_.fill(0);
    }
    return true;
}
PerformanceState OrigamiEngine::performanceState() const noexcept {
    auto s=performance_;s.pitchBendRangeSemitones=pitchBendRange();s.pitchBendDownSemitones=pitchBendDownRange();return s;
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
namespace {
// mct-origami-nested-modulation-manual-qa: the continuous module values a
// manual edit glides (everything else is structure and applies at once).
template<class Module> auto* dezipField(Module& m,std::size_t i) noexcept {
    switch(i) {
        case 0: return &m.wtPosition; case 1: return &m.fineCents; case 2: return &m.detuneCents;
        case 3: return &m.blend; case 4: return &m.pan; case 5: return &m.level;
        case 6: return &m.process1Amount; case 7: return &m.process2Amount;
        case 8: return &m.route1Amount; case 9: return &m.route2Amount;
        default: break;
    }
    if(i<10+maxOscProcesses) return &m.processes[i-10].amount;
    return &m.routes[i-10-maxOscProcesses].amount;
}
bool sameDezipStructure(const OscillatorModuleState& a,const OscillatorModuleState& b) noexcept {
    if(a.id!=b.id || a.enabled!=b.enabled || a.tableId!=b.tableId || a.waveform!=b.waveform || a.octave!=b.octave ||
       a.semitone!=b.semitone || a.unison!=b.unison || a.process1!=b.process1 || a.process1Seed!=b.process1Seed ||
       a.process2!=b.process2 || a.process2Seed!=b.process2Seed || a.route1SourceId!=b.route1SourceId ||
       a.route1Type!=b.route1Type || a.route2SourceId!=b.route2SourceId || a.route2Type!=b.route2Type ||
       a.processCount!=b.processCount || a.routeCount!=b.routeCount || a.busRouteCount!=b.busRouteCount) return false;
    for(std::size_t i=0;i<a.processes.size();++i) {
        const auto& x=a.processes[i]; const auto& y=b.processes[i];
        if(x.id!=y.id || x.type!=y.type || x.seed!=y.seed || x.enabled!=y.enabled) return false;
    }
    for(std::size_t i=0;i<a.routes.size();++i) {
        const auto& x=a.routes[i]; const auto& y=b.routes[i];
        if(x.id!=y.id || x.sourceId!=y.sourceId || x.type!=y.type || x.enabled!=y.enabled) return false;
    }
    for(std::size_t i=0;i<a.busRoutes.size();++i)
        if(a.busRoutes[i].bus!=b.busRoutes[i].bus || a.busRoutes[i].level!=b.busRoutes[i].level) return false;
    return true;
}
}
// Audio thread, block boundary, after a new module snapshot.
void OrigamiEngine::startDezip() noexcept {
    const auto length=static_cast<std::uint32_t>(std::max(1.0,std::round(sampleRate_*dezipSeconds)));
    for(std::size_t m=0;m<hostModules_.size();++m) {
        const auto& target=hostModules_[m];
        auto& current=dezipModules_[m];
        auto& ramp=dezipRamps_[m];
        const auto bit=std::uint32_t(1u<<m);
        if(target.id==0 || !sameDezipStructure(current,target)) {
            current=target; ramp.remaining=0; dezipActive_&=~bit;
            continue;
        }
        // Same structure: glide every changed continuous value from where the
        // render is now (a drag in progress continues smoothly).
        bool changed=false;
        std::array<float,dezipFieldCount> from{};
        for(std::size_t i=0;i<dezipFieldCount;++i) from[i]=*dezipField(current,i);
        current=target;
        for(std::size_t i=0;i<dezipFieldCount;++i) {
            float& value=*dezipField(current,i);
            ramp.step[i]=0.0f;
            if(from[i]!=value && std::isfinite(from[i]) && std::isfinite(value)) {
                ramp.step[i]=(value-from[i])/static_cast<float>(length);
                value=from[i];
                changed=true;
            }
        }
        if(changed) { ramp.remaining=length; dezipActive_|=bit; }
        else { ramp.remaining=0; dezipActive_&=~bit; }
    }
}
// Audio thread, once per sample while something glides.
void OrigamiEngine::advanceDezip(std::array<OscillatorModuleState,OscillatorModuleBank::capacity>& modules) noexcept {
    for(std::uint32_t bits=dezipActive_;bits!=0;bits&=bits-1u) {
        const auto m=static_cast<std::size_t>(__builtin_ctz(bits));
        auto& current=dezipModules_[m];
        auto& ramp=dezipRamps_[m];
        if(--ramp.remaining==0) {
            current=hostModules_[m]; // exact target at the end
            dezipActive_&=~std::uint32_t(1u<<m);
        } else {
            for(std::size_t i=0;i<dezipFieldCount;++i) if(ramp.step[i]!=0.0f) *dezipField(current,i)+=ramp.step[i];
        }
        for(std::size_t i=0;i<dezipFieldCount;++i) *dezipField(modules[m],i)=*dezipField(current,i);
    }
}
bool OrigamiEngine::beginHostBlock(unsigned channels) noexcept {
    if(hostBlockActive_ || !prepared_ || channels<1 || channels>2 || channels!=outputChannels_) return false;
    latchParameters();
    // Take published editor tables BEFORE consuming the module snapshot: a
    // table is published after its module, so this block's snapshot then
    // already contains that module.
    auto* handoffs=wavetableIncoming_.load(std::memory_order_relaxed)!=nullptr
        ? wavetableIncoming_.exchange(nullptr,std::memory_order_acquire) : nullptr;
    const bool oscillatorGenerationChanged=
        oscillatorModules_.consumeSnapshot(hostModules_,hostModuleGeneration_);
    if(oscillatorGenerationChanged) startDezip();
    const bool modulationChanged=modulationMailbox_.consume(pendingModulationUpdate_);
    if(modulationChanged) {audioModulation_=pendingModulationUpdate_.state;audioSynthFilters_=pendingModulationUpdate_.filters;}
    if(hostMacrosValid_)
        for(std::size_t i=0;i<maxMacros;++i) {
            const float v=hostMacros_[i];
            if(std::isfinite(v)) audioModulation_.macros[i]=std::clamp(v,0.0f,1.0f);
        }
    bool moduleTopologyChanged=false;
    for(std::size_t i=0;i<hostModules_.size();++i) {
        if(compiledModuleIds_[i]!=hostModules_[i].id) {
            moduleTopologyChanged=true;
            compiledModuleIds_[i]=hostModules_[i].id;
        }
    }
    BusSlotMap slots;
    slots.ids=audioSynthFilters_.busIds;slots.count=audioSynthFilters_.busCount;
    const bool slotsChanged=modulationChanged && slots!=hostBusSlots_;
    if(slotsChanged) hostBusSlots_=slots;
    bool tablesChanged=false;
    if(oscillatorGenerationChanged || moduleTopologyChanged) {
        // A removed module's table is released here, on the audio thread, but
        // its storage is not freed: a later adopted table swaps it out.
        for(auto& slot:oscillatorWavetables_) if(slot.id) {
            bool exists=false;
            for(const auto& m:hostModules_) exists|=m.id==slot.id;
            if(!exists) slot.id=0;
        }
    }
    if(handoffs) tablesChanged=adoptWavetableHandoffs(handoffs);
    if(oscillatorGenerationChanged || moduleTopologyChanged || slotsChanged || tablesChanged) {
        oscillatorPlan_.compile(hostModules_,hostBusSlots_);
        rebuildHostWavetables();
    }
    if(modulationChanged || oscillatorGenerationChanged || moduleTopologyChanged || slotsChanged || tablesChanged) oscillatorPlan_.adoptSynthFilters(audioSynthFilters_);
    if(modulationChanged) compiledModulation_.markStateRevision();
    if(modulationChanged || moduleTopologyChanged || oscillatorGenerationChanged) {
        compiledModulation_.compile(audioModulation_,hostModules_);
        globalInstanceCount_=0;
        for(std::size_t i=0;i<maxSourceInstances;++i) {
            const auto& a=audioModulation_.instances[i];
            if(a.id && !sourceIsVoice(instanceSource(a.id),audioModulation_) && compiledModulation_.usesGlobalSource(CompiledModulation::instanceGlobalSlot(i)))
                globalInstanceSlots_[globalInstanceCount_++]=static_cast<std::uint8_t>(i);
        }
        publishNodesDiagnostics();
    }
    if(suppressVisualization_) diagSuppressedBlocks_.fetch_add(1,std::memory_order_relaxed);
    std::size_t activeModules=0;
    for(const auto& m:hostModules_) if(m.enabled) ++activeModules;
    hostNormalization_=activeModules ? 1.0/static_cast<double>(activeModules) : 1.0;
    hostMasterAfterFx_=masterAfterFx_.load(std::memory_order_relaxed);
    hostBendRange_=pitchBendRange();
    hostBendDownRange_=pitchBendDownRange();
    hostChannels_=channels;
    hostBlockActive_=true;
    return true;
}

void OrigamiEngine::publishNodesDiagnostics() noexcept {
    const auto& c=compiledModulation_.compileCounters();
    diagCompiles_.store(c.compiles,std::memory_order_relaxed);
    diagParameterUpdates_.store(c.parameterUpdates,std::memory_order_relaxed);
    diagCompileSkips_.store(c.skipped,std::memory_order_relaxed);
    diagStateRevision_.store(compiledModulation_.stateRevision(),std::memory_order_relaxed);
    diagEventOverflows_.store(eventOverflows_,std::memory_order_relaxed);
}

void OrigamiEngine::endHostBlock() noexcept {
    if(eventOverflows_!=diagEventOverflows_.load(std::memory_order_relaxed)) diagEventOverflows_.store(eventOverflows_,std::memory_order_relaxed);
    hostBlockActive_=false;
    hostChannels_=0;
}

bool OrigamiEngine::process(float* const* output,unsigned channels,std::size_t sampleCount) noexcept {
    if(!sampleCount) return true;
    if(!beginHostBlock(channels)) {
        if(output && channels>=1 && channels<=2)
            for(unsigned c=0;c<channels;++c)
                if(output[c]) std::fill_n(output[c],sampleCount,0.0f);
        return false;
    }
    const bool ok=processSpan(output,channels,sampleCount);
    endHostBlock();
    return ok;
}

bool OrigamiEngine::processSpan(float* const* output,unsigned channels,std::size_t sampleCount) noexcept {
    return processSpan(output,channels,sampleCount,nullptr);
}
bool OrigamiEngine::processSpan(float* const* output,unsigned channels,std::size_t sampleCount,float* const* aux) noexcept {
    if(!sampleCount) return true;
    // User-bus outputs: aux[2*(slot-1)+channel]. Cleared even when idle so a
    // removed send never leaves stale audio in a bus.
    const bool auxActive=aux!=nullptr && oscillatorPlan_.auxActive;
    if(aux!=nullptr)
        for(std::size_t b=1;b<maxRenderBuses;++b)
            for(std::size_t c=0;c<2;++c)
                if(aux[2*(b-1)+c]) std::fill_n(aux[2*(b-1)+c],sampleCount,0.f);
    if(!hostBlockActive_ || channels!=hostChannels_) return false;
    if(!output || channels<1 || channels>2) return false;
    for(unsigned c=0;c<channels;++c) if(!output[c]) return false;
    for(unsigned c=0;c<channels;++c) std::fill_n(output[c],sampleCount,0.f);
    auto modules=dezipModules_; // == hostModules_ unless a manual edit glides
    const double normalization=hostNormalization_;
    const float bendUpRange=hostBendRange_;
    const float bendDownRange=hostBendDownRange_;
    alignas(64) ModulationFrame frame;
    OscillatorProcessPlans sharedProcesses;
    const auto visualizationPeriod=std::max<std::size_t>(1,
        static_cast<std::size_t>(std::lround(sampleRate_/1000.0))) * (reduceVisualizationRate_ ? 4u : 1u);

    for(std::size_t sample=0;sample<sampleCount;++sample) {
        if(dezipActive_) advanceDezip(modules);
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

        // mct-origami-nested-modulation-manual-qa: GLOBAL nested targets read
        // the newest voice's per-voice sources of the previous sample.
        if(compiledModulation_.needsNewestVoiceSources()) {
            const Voice* newestVoice=nullptr;
            for(const auto& voice:voices_)
                if(voice.active() && (newestVoice==nullptr || voice.order()>newestVoice->order())) newestVoice=&voice;
            newestVoiceValid_=newestVoice!=nullptr;
            if(newestVoice!=nullptr) newestVoiceSources_=newestVoice->lastSources();
        } else newestVoiceValid_=false;
        std::array<float,CompiledModulation::globalSourceCount> sources{};
        // mct-origami-stereo-modulation: a stereo plan asks each FREE LFO for
        // its RIGHT value too (LEFT is bit-identical either way).
        const bool stereoPlan=compiledModulation_.hasStereoPlan();
        auto& globalStereo=frame.stereo.globalLfo;
        globalStereo.mask=0;globalStereo.instanceMask=0;
        // mct-origami-nested-modulation-manual-qa: with nested modulation the
        // FREE LFOs run in the prepared dependency order (below).
        const bool nested=compiledModulation_.hasNestedPlan();
        if(!nested) for(std::size_t i=0;i<4;++i) {
            if(!compiledModulation_.usesGlobalSource(i)) continue;
            const auto& l=lfoSettings(audioModulation_,i);
            if(l.mode!=LfoMode::Free) { sources[i]=0.0f; continue; }
            if(stereoPlan && l.stereo>0.0f) {
                float right=0.0f;
                sources[i]=globalLfos_[i].nextStereo(l,sampleRate_,right)*currentLfoScaling_;
                globalStereo.lfo[i]=right*currentLfoScaling_;
                globalStereo.mask|=std::uint8_t(1u<<i);
            } else sources[i]=globalLfos_[i].next(l,sampleRate_)*currentLfoScaling_;
        }
        for(std::size_t n=0;n<globalInstanceCount_;++n) {
            const auto i=globalInstanceSlots_[n];
            const auto& a=audioModulation_.instances[i];
            if(nested && a.family==SourceFamily::Lfo) continue;
            if(stereoPlan && a.family==SourceFamily::Lfo && a.lfo.stereo>0) {
                auto& r=instanceRuntime_[i];if(r.id!=a.id) r.reset(a.id);
                float right=0;
                sources[CompiledModulation::instanceGlobalSlot(i)]=r.lfo.nextStereo(a.lfo,sampleRate_,right)*currentLfoScaling_;
                globalStereo.instances[i]=right*currentLfoScaling_;globalStereo.instanceMask|=1u<<i;
                continue;
            }
            sources[CompiledModulation::instanceGlobalSlot(i)]=instanceRuntime_[i].next(a,sampleRate_)*
                (a.family==SourceFamily::Lfo ? currentLfoScaling_ : 1.0f);
        }
        // Macros by stable id (1..16); only routed ones smooth / publish.
        for(std::size_t i=0;i<smoothedMacros_.size();++i) {
            const auto slot=CompiledModulation::macroSlot(i+1);
            if(!compiledModulation_.usesGlobalSource(slot)) {
                smoothedMacros_[i]=audioModulation_.macros[i];
                continue;
            }
            smoothedMacros_[i]+=modulationSmoothing_*
                (audioModulation_.macros[i]-smoothedMacros_[i]);
            sources[slot]=smoothedMacros_[i];
        }
        if(compiledModulation_.usesGlobalSource(8) && (audioModulation_.generatorActiveMask&0x02u))
            sources[8]=globalRandom_.next(audioModulation_.random,sampleRate_);
        if(compiledModulation_.usesGlobalSource(9) && (audioModulation_.generatorActiveMask&0x01u))
            sources[9]=globalFunction_.next(audioModulation_.function,sampleRate_);
        if(compiledModulation_.usesGlobalSource(10) && (audioModulation_.generatorActiveMask&0x04u))
            sources[10]=globalChaos_.next(audioModulation_.chaos,sampleRate_);
        if(compiledModulation_.usesGlobalSource(11) && (audioModulation_.generatorActiveMask&0x08u))
            sources[11]=globalDrift_.next(audioModulation_.drift,sampleRate_);
        // N06: with a SEQUENCER node the plan drives the one sequencer (its
        // own clock or NODES events); the legacy source pass never also
        // advances it, so it is never double clocked.
        const bool sequencerActive=(audioModulation_.generatorActiveMask&0x10u)!=0;
        if(compiledModulation_.hasSequencerNode())
            sources[12]=sequencerActive ? globalSequencer_.held() : 0.0f; // replaced by the node below
        else if(compiledModulation_.usesGlobalSource(12) && sequencerActive)
            sources[12]=globalSequencer_.next(audioModulation_.sequencer,sampleRate_);

        // N05 timing context of this sample (beat position, transport events).
        const double beatsPerSample=transportBpm_/60.0/sampleRate_;
        if(compiledModulation_.hasOperators()) {
            frame.events.beats=beats_;
            frame.events.beatsPerSample=beatsPerSample;
            frame.events.sampleRate=sampleRate_;
            frame.events.transportStart=pendingTransportStart_;
            frame.events.transportStop=pendingTransportStop_;
            frame.events.sequencer=sequencerActive ? &globalSequencer_ : nullptr;
            frame.events.sequencerSettings=sequencerActive ? &audioModulation_.sequencer : nullptr;
            frame.events.eventOverflow=&eventOverflows_;
        }
        pendingTransportStart_=pendingTransportStop_=false;
        beats_+=beatsPerSample;
        // N04 global CONTROL operators: once per sample, before the global
        // frame reads their outputs (compiled plan; never when unused).
        if(nested) {
            // The prepared global program: FREE LFOs (at their effective
            // rate), macros with incoming modulation (effective value; the
            // stored base never moves), global NODES operators and route
            // depths, each after everything it reads.
            using Step=CompiledModulation::ProgramStep::Kind;
            const auto* newest=newestVoiceValid_ ? &newestVoiceSources_ : nullptr;
            for(std::size_t p=0;p<compiledModulation_.globalProgramSize();++p) {
                const auto& step=compiledModulation_.globalProgramStep(p);
                switch(step.kind) {
                    case Step::Lfo: {
                        const std::size_t i=step.index;
                        if(i>=4) {
                            const auto slot=i-4;const auto& a=audioModulation_.instances[slot];auto& r=instanceRuntime_[slot];
                            if(r.id!=a.id) r.reset(a.id);
                            const auto output=CompiledModulation::instanceGlobalSlot(slot);
                            const auto rate=compiledModulation_.globalLfoRate(i,a.lfo.rateHz,sources,frame,newest);
                            if(stereoPlan && a.lfo.stereo>0) {float right=0;sources[output]=r.lfo.nextStereo(a.lfo,sampleRate_,rate,right)*currentLfoScaling_;globalStereo.instances[slot]=right*currentLfoScaling_;globalStereo.instanceMask|=1u<<slot;}
                            else sources[output]=r.lfo.next(a.lfo,sampleRate_,rate)*currentLfoScaling_;
                            break;
                        }
                        const auto& l=lfoSettings(audioModulation_,i);
                        if(l.mode!=LfoMode::Free) { sources[i]=0.0f; break; }
                        const float rate=compiledModulation_.globalLfoRate(i,l.rateHz,sources,frame,newest);
                        if(stereoPlan && l.stereo>0.0f) {
                            float right=0.0f;
                            sources[i]=globalLfos_[i].nextStereo(l,sampleRate_,rate,right)*currentLfoScaling_;
                            globalStereo.lfo[i]=right*currentLfoScaling_;
                            globalStereo.mask|=std::uint8_t(1u<<i);
                        } else sources[i]=globalLfos_[i].next(l,sampleRate_,rate)*currentLfoScaling_;
                        break;
                    }
                    case Step::Macro: {
                        const std::size_t id=step.index;
                        sources[CompiledModulation::macroSlot(id)]=compiledModulation_.macroValue(id,smoothedMacros_[id-1],sources,frame,newest);
                        break;
                    }
                    case Step::Operator:
                        compiledModulation_.evaluateGlobalOperator(step.index,frame,sources);
                        if(compiledModulation_.hasSequencerNode()) sources[12]=frame.globalSources[12];
                        break;
                    case Step::Depth:
                        compiledModulation_.globalRouteDepth(step.index,frame,sources,newest);
                        break;
                }
            }
            frame.globalSources=sources; // per-voice nested terms read the global sources here
            for(std::size_t id=1;id<=maxMacros;++id) effectiveMacros_[id-1]=sources[CompiledModulation::macroSlot(id)];
        } else if(compiledModulation_.hasOperators()) {
            compiledModulation_.evaluateGlobalOperators(frame,sources);
            if(compiledModulation_.hasSequencerNode()) sources[12]=frame.globalSources[12]; // SEQ = the node's VALUE
        }
        // Keep UI observation off the 96 kHz hot path. Generators above still
        // advance at full audio rate; only copying/inspection is decimated.
        const bool observeVisualization=!suppressVisualization_ && runtimeVisualizationCountdown_==0;
        if(observeVisualization) {
            runtimeVisualization_.synthFilterIds.fill(0);
            for(std::size_t i=0;i<maxSourceInstances;++i) {runtimeVisualization_.instanceIds[i]=audioModulation_.instances[i].id;runtimeVisualization_.instancePhases[i]=float(instanceRuntime_[i].lfo.readPosition());}
            runtimeVisualizationCountdown_=visualizationPeriod-1;
            for(std::size_t i=0;i<4;++i) {
                runtimeVisualization_.sourceValues[3+i]=sources[i];
                runtimeVisualization_.sourcePhases[3+i]=static_cast<float>(globalLfos_[i].readPosition());
            }
            runtimeVisualization_.sourceValues[7]=sources[9];
            runtimeVisualization_.sourceValues[8]=sources[8];
            runtimeVisualization_.sourceValues[9]=sources[10];
            runtimeVisualization_.sourceValues[10]=sources[11];
            runtimeVisualization_.sourceValues[11]=sources[12];
            runtimeVisualization_.modulatedMacros=0;
            for(std::size_t id=1;id<=maxMacros;++id) {
                const bool modulated=compiledModulation_.macroModulated(id);
                runtimeVisualization_.effectiveMacros[id-1]=modulated ? effectiveMacros_[id-1] : smoothedMacros_[id-1];
                if(modulated) runtimeVisualization_.modulatedMacros|=1u<<(id-1);
            }
            runtimeVisualization_.sourcePhases[7]=static_cast<float>(globalFunction_.phase());
            runtimeVisualization_.sourcePhases[8]=static_cast<float>(globalRandom_.phase());
            runtimeVisualization_.sourcePhases[9]=std::clamp(globalChaos_.xNormalized()*0.5f+0.5f,0.0f,1.0f);
            runtimeVisualization_.sourcePhases[10]=static_cast<float>(globalDrift_.phase());
            runtimeVisualization_.sourcePhases[11]=static_cast<float>(
                (static_cast<double>(globalSequencer_.currentStep())+globalSequencer_.phase()) /
                static_cast<double>(std::max<std::uint32_t>(1,audioModulation_.sequencer.activeSteps)));
            runtimeVisualization_.chaosY=std::clamp(globalChaos_.yNormalized()*0.5f+0.5f,0.0f,1.0f);
            for(std::size_t i=0;i<CompiledModulation::globalSourceCount;++i)
                runtimeVisualization_.routeSources[i]=sources[i];
            for(std::size_t i=0;i<operatorOutputSlotCount;++i)
                runtimeVisualization_.routeSources[CompiledModulation::sourceSlotCount+i]=frame.operatorOutputs[i];
            runtimeVisualization_.sequencerStep=static_cast<std::uint32_t>(globalSequencer_.currentStep());
            if(compiledModulation_.needsEventContext()) {
                // Monotonic event counters (UI activity only; summed over voices
                // purely for display, never fed back into DSP).
                auto counts=compiledModulation_.globalEventCounts();
                for(const auto& voice:voices_)
                    for(std::size_t i=0;i<counts.size();++i) counts[i]+=voice.operatorEventCounts()[i];
                runtimeVisualization_.operatorEvents=counts;
            }
        } else if(runtimeVisualizationCountdown_>0) {
            --runtimeVisualizationCountdown_;
        }
        compiledModulation_.advance(modulationSmoothing_);
        // N07: the module slots are 8 KB; inactive modules never change within a
        // block (the plan changes only at block start), so after the first
        // sample only the active ones are refreshed.
        if(sample==0) frame.modules=modules;
        else for(std::size_t a=0;a<oscillatorPlan_.activeCount;++a) frame.modules[oscillatorPlan_.active[a]]=modules[oscillatorPlan_.active[a]];
        frame.cutoff=value(ParameterId::Cutoff);
        frame.resonance=value(ParameterId::Resonance);frame.master=value(ParameterId::MasterGain);
        frame.mainTuning=0.0f;frame.transpose=0.0f;
        frame.portaTime=performance_.glideSeconds;
        frame.envelopeScaling=1.0f;frame.lfoScaling=1.0f;frame.swing=globalSwingBase_;
        frame.applyMaster=!hostMasterAfterFx_;
        frame.synthFilterMask=0;
        for(std::size_t n=0;n<audioSynthFilters_.count;++n) {const auto f=audioSynthFilters_.stages[n].slot;frame.synthFilters[f]=audioModulation_.synthFilters.filters[f].values;frame.synthFilterMask|=std::uint8_t(1u<<f);}

        compiledModulation_.globalFrame(frame,sources,sampleRate_);
        if(hostMasterAfterFx_) blockMaster_=frame.master;
        if(compiledModulation_.hasFxRoutes()) { lastGlobalSources_=sources; lastGlobalOperators_=frame.operatorOutputs; }
        currentPortaTime_=std::clamp(frame.portaTime,0.0f,5.0f);
        currentEnvelopeScaling_=std::clamp(frame.envelopeScaling,0.0f,2.0f);
        currentLfoScaling_=std::clamp(frame.lfoScaling,0.0f,2.0f);
        currentSwing_=std::clamp(frame.swing,0.0f,0.75f);
        for(std::size_t a=0;a<oscillatorPlan_.activeCount;++a) {
            const auto m=oscillatorPlan_.active[a];
            oscillatorPlan_.processPlan(m,frame.modules[m],sharedProcesses[m]);
        }
        const float sustain=value(ParameterId::Sustain);

        double left=0.0,right=0.0,mono=0.0;
        std::array<double,2*(maxRenderBuses-1)> auxSum{};

        std::uint64_t newestOrder=0;
        if(observeVisualization) {
            for(std::size_t v=0;v<voiceCount;++v) {
                if(voices_[v].active()) newestOrder=std::max(newestOrder,voices_[v].order());
            }
            runtimeVisualization_.active=newestOrder!=0;
            if(newestOrder==0)
                std::fill(runtimeVisualization_.routeSources.begin()+CompiledModulation::globalSourceCount,
                          runtimeVisualization_.routeSources.end(),0.0f);
        }

        VoiceInfo observedInfo;
        for(std::size_t v=0;v<voiceCount;++v) {
            if(!voices_[v].active() && tailRemaining_[v]==0) continue;
            const bool observe=observeVisualization && voices_[v].order()==newestOrder;
            if(observe) observedInfo=voices_[v].info();
            const auto channel=std::min<std::size_t>(voices_[v].channel(),15);
            const float normalizedBend=pitchBendNormalized_[channel];
            // mct-origami-nested-modulation-manual-qa: signed wheel ENDPOINTS:
            // centre 0, full up = BEND UP, full down = BEND DOWN (default -2).
            const float bend=normalizedBend>=0.0f ? normalizedBend*bendUpRange : (-normalizedBend)*bendDownRange;
            auto fresh=voices_[v].nextModules(hostWavetables_,frame,sustain,compiledModulation_,audioModulation_,
                                                bend,pitchBendNormalized_[channel],
                                                modWheel_[channel],aftertouch_[channel],oscillatorPlan_,sharedProcesses,observe);
            if(observe) {
                const auto& visual=voices_[v].visualizationSnapshot();
                runtimeVisualization_.synthFilters=visual.synthFilters;runtimeVisualization_.synthFilterIds=visual.synthFilterIds;runtimeVisualization_.sampleRate=sampleRate_;
                runtimeVisualization_.instanceEnvelopes=visual.instanceEnvelopes;
                for(std::size_t i=0;i<maxSourceInstances;++i) if(audioModulation_.instances[i].family==SourceFamily::Envelope || (audioModulation_.instances[i].family==SourceFamily::Lfo && audioModulation_.instances[i].lfo.mode!=LfoMode::Free)) runtimeVisualization_.instancePhases[i]=visual.instancePhases[i];
                for(std::size_t i=0;i<CompiledModulation::voiceSourceCount;++i)
                    runtimeVisualization_.routeSources[CompiledModulation::globalSourceCount+i]=visual.sources[i];
                if(compiledModulation_.hasVoiceOperators())
                    for(std::size_t i=0;i<operatorOutputSlotCount;++i)
                        runtimeVisualization_.routeSources[CompiledModulation::sourceSlotCount+i]=visual.operators[i];
                runtimeVisualization_.performanceSources={{visual.sources[8],visual.sources[10],
                                                            visual.sources[11],visual.sources[12]}};
                for(std::size_t i=0;i<3;++i) {
                    runtimeVisualization_.sourceValues[i]=visual.sources[i];
                    const auto& envelope=observedInfo.envelopes[i];
                    runtimeVisualization_.sourcePhases[i]=std::clamp(envelope.progress,0.0f,1.0f);
                }
                for(std::size_t i=0;i<4;++i) {
                    if(lfoSettings(audioModulation_,i).mode!=LfoMode::Free) {
                        runtimeVisualization_.sourceValues[3+i]=visual.sources[3+i];
                        runtimeVisualization_.sourcePhases[3+i]=visual.lfoPhases[i];
                    }
                }
                for(std::size_t m=0;m<visual.modules.size();++m) {
                    const auto& observed=visual.modules[m];
                    auto& previous=runtimeVisualizationModules_[m];
                    const bool waveformChanged=previous.id!=observed.id ||
                        previous.wtPosition!=observed.wtPosition ||
                        previous.unison!=observed.unison || previous.blend!=observed.blend ||
                        previous.detuneCents!=observed.detuneCents ||
                        previous.process1!=observed.process1 ||
                        previous.process1Amount!=observed.process1Amount ||
                        previous.process1Seed!=observed.process1Seed ||
                        previous.process2!=observed.process2 ||
                        previous.process2Amount!=observed.process2Amount ||
                        previous.process2Seed!=observed.process2Seed;
                    if(waveformChanged) {
                        runtimeVisualization_.oscillatorWaveformValid[m].fill(0);
                        previous=observed;
                    }
                    runtimeVisualization_.moduleIds[m]=visual.modules[m].id;
                    runtimeVisualization_.oscillatorPhases[m]=visual.modulePhases[m];
                    if(visual.modules[m].id==0) continue;
                    const auto bin=std::min<std::size_t>(RuntimeVisualizationSnapshot::waveformBins-1,
                        static_cast<std::size_t>(visual.modulePhases[m]*RuntimeVisualizationSnapshot::waveformBins));
                    runtimeVisualization_.oscillatorWaveforms[m][bin]=visual.moduleSamples[m];
                    runtimeVisualization_.oscillatorWaveformValid[m][bin]=1;
                }
            }
            lastVoiceSamples_[v]=fresh;

            float oldWeight=0.0f;
            Voice::Samples residual{};
            if(tailRemaining_[v]) {
                const float linear=static_cast<float>(tailRemaining_[v])/
                                   static_cast<float>(stealFadeSamples_);
                // A squared residual envelope drops the frozen boundary sample
                // rapidly enough to avoid an audible DC-like tail, while the
                // fresh voice receives the complementary ramp.
                oldWeight=linear*linear;
                residual=stealResidual_[v];
                if(--tailRemaining_[v]==0) stealResidual_[v]={};
            }

            if(auxActive) {
                const auto& fresh2=voices_[v].aux();
                const auto& old2=stealAuxResidual_[v];
                for(std::size_t k=0;k<fresh2.size();++k)
                    auxSum[k]+=double(fresh2[k])*(1.0-oldWeight)+double(old2[k])*oldWeight;
                lastAux_[v]=fresh2;
            }
            left+=fresh.left*(1.0f-oldWeight)+residual.left*oldWeight;
            right+=fresh.right*(1.0f-oldWeight)+residual.right*oldWeight;
            mono+=fresh.mono*(1.0f-oldWeight)+residual.mono*oldWeight;
        }

        const float master=static_cast<float>(normalization);
        const auto finite=[](double value) noexcept {
            if(!std::isfinite(value)) return 0.0f;
            return static_cast<float>(std::clamp(value,-8.0,8.0));
        };
        if(channels==1) {
            output[0][sample]=finite(mono*master);
        } else {
            output[0][sample]=finite(left*master);
            output[1][sample]=finite(right*master);
        }
        if(auxActive)
            for(std::size_t k=0;k<auxSum.size();++k)
                if(aux[k]) aux[k][sample]=finite(auxSum[k]*master);
    }
    // FX parameter modulation: one evaluation per span, newest-voice policy
    // for per-voice sources. Fixed-size, allocation-free.
    if(compiledModulation_.hasFxRoutes()) {
        const Voice* newest=nullptr;
        for(const auto& voice:voices_)
            if(voice.active() && (newest==nullptr || voice.order()>newest->order())) newest=&voice;
        compiledModulation_.fxFrame(fxModulation_,lastGlobalSources_,
                                    newest!=nullptr && compiledModulation_.hasFxVoiceRoutes() ? &newest->lastSources() : nullptr,
                                    compiledModulation_.hasGlobalOperators() ? &lastGlobalOperators_ : nullptr);
    } else {
        fxModulation_.count=0;
        fxModulation_.generation=compiledModulation_.generation();
    }
    return true;
}
void OrigamiEngine::setHostTransport(const HostTransport& transport) noexcept {
    // Transport changes are reported at a block boundary: their event lands on
    // the block's first sample (the host provides nothing finer).
    if(transport.playing && !transportPlaying_) pendingTransportStart_=true;
    if(!transport.playing && transportPlaying_) pendingTransportStop_=true;
    transportPlaying_=transport.playing;
    transportBpm_=std::isfinite(transport.bpm) ? std::clamp(transport.bpm,20.0,400.0) : 120.0;
    // Host-synced: resync to the host position every block (no drift). Free:
    // keep advancing at the tempo from where we are.
    if(transport.playing && transport.ppqValid && std::isfinite(transport.ppq)) beats_=transport.ppq;
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
    const auto id=oscillatorModules_.add(s);if(id) publishModulation();return id;
}
bool OrigamiEngine::removeOscillatorModule(OscillatorModuleId id) noexcept {
    if(!oscillatorModules_.remove(id)) return false;
    // The module's table slot is NOT touched here: this runs beside a live
    // audio thread that may be reading it. beginHostBlock releases the slot
    // when the snapshot without this module arrives (see adoptWavetableHandoffs).

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

        for(std::size_t r=0;r<std::min<std::size_t>(updatedModule.routeCount,maxOscRoutes);++r) {
            auto& route=updatedModule.routes[r];
            if(route.sourceId==id) {
                route.sourceId=0;route.type=OscRouteType::Off;route.amount=0.0f;
                changed=true;
            }
        }
        if(changed)
            oscillatorModules_.set(existing.id,updatedModule);
    }

    // Deletion removes addressed modulation routes. Reused display ordinals never retarget them.
    auto updated=modulation_;for(auto& in:updated.synthFilters.inputs) if(in.oscillator==id) in={};std::size_t out=0;
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
    bool routingChanged=canonical.busRouteCount!=old.busRouteCount;
    for(std::size_t b=0;b<canonical.busRouteCount;++b) routingChanged|=canonical.busRoutes[b].bus!=old.busRoutes[b].bus || canonical.busRoutes[b].level!=old.busRoutes[b].level;
    const bool ok=oscillatorModules_.set(id,canonical);if(ok && routingChanged) publishModulation();return ok;
}
OscillatorModuleState OrigamiEngine::oscillatorModuleState(OscillatorModuleId id) const noexcept {
    auto state=oscillatorModules_.state(id);
    if(id==1) applyLegacyOscillatorParameters(state,parameterState());
    return state;
}
bool OrigamiEngine::setOscillatorModuleEnabled(OscillatorModuleId id,bool enabled) noexcept {
    const bool ok=oscillatorModules_.setEnabled(id,enabled);if(ok) publishModulation();return ok;
}
bool OrigamiEngine::oscillatorModuleEnabled(OscillatorModuleId id) const noexcept {
    return oscillatorModules_.enabled(id);
}

VoiceInfo OrigamiEngine::voiceInfo(std::size_t index) const noexcept { return index < voiceCount ? voices_[index].info() : VoiceInfo{}; }
std::size_t OrigamiEngine::activeVoiceCount() const noexcept { std::size_t count=0; for (const auto& voice : voices_) if (voice.info().active) ++count; return count; }

RenderLoad OrigamiEngine::renderLoad() const noexcept {
    RenderLoad load{};
    load.activeVoices=static_cast<std::uint32_t>(activeVoiceCount());
    std::uint32_t lanesPerVoice=0;
    for(const auto& module:hostModules_) {
        if(module.id==0 || !module.enabled) continue;
        ++load.activeModules;
        const auto unison=std::clamp(module.unison,1u,16u);
        load.totalUnison+=unison;
        // The blend-center oscillator executes only when unison > 1.
        lanesPerVoice+=unison+(unison>1u ? 1u : 0u);
    }
    load.oscillatorEvaluationsPerSample=load.activeVoices*lanesPerVoice;
    return load;
}

}
