// mct-origami-unified-routing-core-fx-p04
// mct-origami-fx-modulation-graph-ux-p03
// mct-origami-fx-graph-dsp-bus-routing-p02
// mct-origami-deep-audit-p07-enforced-qos
// mct-origami-deep-audit-p03-fix2-canonical-state-repair
// mct-origami-deep-audit-p03-canonical-state
// mct-origami-deep-audit-p02-lockfree-ui-midi
// mct-origami-audio-reengineer-p17-global-qos-budget
// mct-origami-audio-reengineer-p16-arp-ui-coalescing
// mct-origami-audio-reengineer-p15-state-io-suspension
// mct-origami-audio-reengineer-p14-callback-lock-mailboxes
// mct-origami-audio-reengineer-p13-audioplayhead-boundary
// mct-origami-audio-reengineer-p12-host-block-ui-telemetry
// mct-origami-audio-reengineer-p10-persistent-preallocated-midi
// mct-origami-audio-reengineer-p06.3-local-source
// mct-origami-v30.1.0-env-sync-native-menus-retrigger
// mct-origami-v28.1.0-env-hold-live-tracer
// mct-origami-v25.3.0-arp-performance-expansion
// mct-origami-v25.2.0-arp-ux-visual-architecture
// mct-origami-v25.1.0-arp-advanced-page
// mct-origami-v25.0.0-arp-internal-clock
// mct-origami-modulation-completion-v24.0.1
// mct-origami-glide-mono-legato-v23.4.3
// mct-origami-pitch-mod-real-v23.3
// mct-origami-playable-keyboard-audio-v23.1
#include "PluginProcessor.h"
#include <cstring>
// mct-origami-audio-reengineer-p04-ui-telemetry-decimation
// mct-origami-audio-reengineer-p03-midi-preallocation
#include "PluginEditor.h"
#include "ui/WavetableFrameOps.h"
#include <array>
#include <algorithm>
#include <cmath>
#include <limits>
#include <optional>
#include "core/preset/StateCodec.h"
OrigamiAudioProcessor::OrigamiAudioProcessor()
    : AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)) {
    // NEW and browser INIT share authored content, independent of codec defaults.
    const bool initRestored=engine_.restoreInstrumentState(mct::origami::canonicalInitState());
    jassert(initRestored);
    juce::ignoreUnused(initRestored);
    // mct-origami-nested-modulation-manual-qa: 16 DAW macro parameters with
    // immutable IDs, created once (hosts expect a stable parameter list).
    for(unsigned id=1;id<=mct::origami::maxMacros;++id) {
        auto* parameter=new OrigamiMacroParameter(id,[this](unsigned macroId){ return macroDisplayName(macroId); });
        macroParameters_[id-1]=parameter;
        addParameter(parameter);
    }
    // Pre-audio-thread: establish the canonical host/UI model exactly once.
    uiInstrumentState_=engine_.instrumentState();
    setMacroParametersFromModel(uiInstrumentState_.modulation);
    bumpUiModelRevision();
    uiPerformanceState_=uiInstrumentState_.performance;
    uiArpState_=arpState_;
    // Every committed FX graph change recompiles (topology) or republishes
    // parameters. The audio thread only ever sees prepared plans.
    fxWorkspace_.onEditBegin=[this]{beginUiTransaction("Edit Nodes");};
    fxWorkspace_.onEditEnd=[this]{endUiTransaction();};
    fxWorkspace_.onChanged=[this]{syncFxRenderer();};
    syncFxRenderer();
    // mct-origami-content-browser: the factory INIT preset is exactly the
    // state of a freshly constructed instrument.
    getStateInformation(initState_);
    history_=std::make_unique<History>();
    history_->capture=[this]{return captureHistory();};
    history_->restore=[this](const auto& snapshot){return restoreHistory(snapshot);};
    history_->changed=[this]{sendChangeMessage();};
    history_->markSaved();
}
void OrigamiAudioProcessor::syncFxRenderer() {
    // Render slots follow the canonical bus order (== the engine's slot map).
    mct::origami::BusState buses;
    {
        const juce::ScopedLock lock(stateLock_);
        buses=uiInstrumentState_.buses;
    }
    std::vector<mct::origami::fx::FxEnvironment::BusGraph> slots;
    for(std::size_t i=0;i<buses.count && i<mct::origami::maxRenderBuses;++i) {
        const auto id=buses.buses[i].id;
        const auto* doc=fxWorkspace_.find(id);
        slots.push_back({id,doc!=nullptr ? &doc->graph() : nullptr});
    }
    {
        const juce::ScopedLock lock(fxCompileLock_);
        fxEnvironment_.sync(slots,fxWorkspace_.globals());
        setLatencySamples(fxEnvironment_.latencySamples());
    }
    engine_.setMasterAfterFx(fxWorkspace_.globals().order==mct::origami::fx::FxOrder::PreMaster);
    pruneFxModulationRoutes();
}
mct::origami::BusId OrigamiAudioProcessor::addUiBus() noexcept {
    UiEdit historyEdit(*this,"Add Bus");
    mct::origami::BusId id=0;
    {
        const juce::ScopedLock lock(stateLock_);
        auto buses=uiInstrumentState_.buses;
        id=mct::origami::addBus(buses);
        if(id==0)return 0;
        if(restorePending_.load(std::memory_order_acquire)) {auto candidate=uiInstrumentState_;candidate.buses=buses;if(!mct::origami::validInstrumentState(candidate))return 0;}
        else if(!engine_.setBusState(buses))return 0;
        uiInstrumentState_.buses=buses;
        bumpUiModelRevision();
        uiOscillatorRevision_.fetch_add(1,std::memory_order_release);
    }
    fxWorkspace_.document(id); // creates "<BUS> IN -> <BUS> OUT" and resyncs
    syncFxRenderer();
    return id;
}
bool OrigamiAudioProcessor::removeUiBus(mct::origami::BusId id) noexcept {
    UiEdit historyEdit(*this,"Remove Bus");
    if(id==mct::origami::mainBusId) return false;
    {
        const juce::ScopedLock lock(stateLock_);
        auto next=uiInstrumentState_;
        if(!mct::origami::removeBus(next,id)) return false;
        if(restorePending_.load(std::memory_order_acquire)) {
            if(!mct::origami::validInstrumentState(next))return false;
            uiInstrumentState_=next;bumpUiModelRevision();uiOscillatorRevision_.fetch_add(1,std::memory_order_release);
        } else {
            // Retarget oscillator sends first (the bus still exists), then drop it.
            for(const auto& module:next.oscillators)
                if(module.id && !engine_.setOscillatorModuleState(module.id,module)) return false;
            if(!publishUiModulation(next.modulation)) return false;
            uiInstrumentState_.modulation=next.modulation;
            if(!engine_.setBusState(next.buses)) return false;
            for(auto& module:uiInstrumentState_.oscillators)
                if(module.id) module=engine_.oscillatorModuleState(module.id);
            uiInstrumentState_.buses=next.buses;
            bumpUiModelRevision();
            uiOscillatorRevision_.fetch_add(1,std::memory_order_release);
        }
    }
    fxWorkspace_.removeBus(id);
    syncFxRenderer();
    return true;
}
void OrigamiAudioProcessor::pruneFxModulationRoutes() {
    // FX parameters are destinations of the ONE modulation system. When a node
    // (or the whole graph) disappears its routes go too: no dangling targets.
    using namespace mct::origami;
    const auto alive=[this](const ModRoute& r) {
        if(!isFxDestination(r.destination.parameter)) return true;
        const auto* doc=fxWorkspace_.find(fxAddressBus(r.destination));
        const auto* node=doc!=nullptr ? doc->graph().findNode(r.destination.oscillator) : nullptr;
        return node!=nullptr && node->parameter(fxAddressParameter(r.destination)).has_value();
    };
    const juce::ScopedLock lock(stateLock_);
    auto mod=uiInstrumentState_.modulation;
    std::size_t out=0;
    bool changed=false;
    for(const auto& route:mod.routes) {
        if(!route.id) continue;
        if(alive(route)) mod.routes[out++]=route; else changed=true;
    }
    if(!changed) return;
    while(out<mod.routes.size()) mod.routes[out++]={};
    if(publishUiModulation(mod)) { uiInstrumentState_.modulation=mod; bumpUiModelRevision(); }
}
void OrigamiAudioProcessor::prepareToPlay(double sampleRate, int samplesPerBlock) {
    sampleRate_=sampleRate>1.0?sampleRate:44100.0;
    runtimePreparedSampleRate_.store(sampleRate_,std::memory_order_relaxed);
    runtimePreparedBlockSize_.store(samplesPerBlock,std::memory_order_relaxed);
    runtimeMinCallbackSamples_.store(0,std::memory_order_relaxed);
    runtimeMaxCallbackSamples_.store(0,std::memory_order_relaxed);
    envUiSamplesUntilPublish_=0;
    highResolutionTicksPerSecond_=static_cast<double>(juce::Time::getHighResolutionTicksPerSecond());
    if(!(highResolutionTicksPerSecond_>0.0)) highResolutionTicksPerSecond_=1.0;
    renderBudget_.reset();
    prepared_ = engine_.prepare(sampleRate_, static_cast<std::size_t>(juce::jmax(1, samplesPerBlock)), 2u);
    prepared_=prepared_ && engine_.prepareSynthFilterStorage(getUiInstrumentState().modulation.synthFilters);
    {
        // Audio is stopped here: effect memory is (re)allocated for this rate.
        const juce::ScopedLock lock(fxCompileLock_);
        fxEnvironment_.prepare(sampleRate_);
        // User-bus buffers: generous fixed capacity, allocated here only.
        auxCapacity_=juce::jmax(8192,samplesPerBlock*2);
        auxStorage_.assign(std::size_t(auxCapacity_)*auxPointers_.size(),0.0f);
        for(std::size_t i=0;i<auxPointers_.size();++i) auxPointers_[i]=auxStorage_.data()+i*std::size_t(auxCapacity_);
    }
    syncFxRenderer();
    // Patch 03/19: commit scheduler storage before realtime rendering begins.
    inputMidiScratch_.clear();
    scheduledMidiScratch_.clear();
    inputMidiScratch_.ensureSize(midiScratchBytes_);
    scheduledMidiScratch_.ensureSize(midiScratchBytes_);
    resetArpeggiatorRuntime(false);
}
bool OrigamiAudioProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const {
    return layouts.getMainInputChannelSet().isDisabled()
        && layouts.getMainOutputChannelSet() == juce::AudioChannelSet::stereo();
}
void OrigamiAudioProcessor::renderRange(juce::AudioBuffer<float>& buffer, int start, int count) noexcept {
    if (count <= 0) return;
    continuityRequestedSamples_.fetch_add(static_cast<std::uint64_t>(count),std::memory_order_relaxed);
    std::array<float*, 2> channels { buffer.getWritePointer(0, start), buffer.getWritePointer(1, start) };
    std::array<float*,2*(mct::origami::maxRenderBuses-1)> aux{};
    if(auxThisBlock_) for(std::size_t i=0;i<aux.size();++i) aux[i]=auxPointers_[i]+start;
    const bool rendered=prepared_
        && engine_.processSpan(channels.data(),2u,static_cast<std::size_t>(count),auxThisBlock_ ? aux.data() : nullptr);
    if(!rendered) {
        continuitySpanFailures_.fetch_add(1,std::memory_order_relaxed);
        buffer.clear(start,count);
    } else {
        continuityRenderedSamples_.fetch_add(static_cast<std::uint64_t>(count),std::memory_order_relaxed);
    }
    // Patch 04/19: DSP span only. UI telemetry is published at a bounded
    // control rate from the host-block boundary below.
}
void OrigamiAudioProcessor::dispatchMidi(const juce::MidiMessage& message) noexcept {
    const auto channel = static_cast<std::uint8_t>(juce::jlimit(1, 16, message.getChannel()) - 1);
    if (message.isNoteOn()) engine_.noteOn(message.getNoteNumber(), message.getFloatVelocity(), channel, 0u);
    else if (message.isNoteOff()) engine_.noteOff(message.getNoteNumber(), channel, 0u);
    else if (message.isPitchWheel()) engine_.pitchWheel(channel,message.getPitchWheelValue());
    else if(message.isController() && message.getControllerNumber()==1) engine_.modWheel(channel,message.getControllerValue());
    else if(message.isChannelPressure()) engine_.aftertouch(channel,message.getChannelPressureValue());
    else if(message.isAftertouch()) engine_.aftertouch(channel,message.getAfterTouchValue());
    else if(message.isAllNotesOff() || message.isAllSoundOff()) engine_.allNotesOff();
}

bool OrigamiAudioProcessor::enqueueUiKeyboardNote(int note,bool noteOn,float velocity) noexcept {
    if(note<0 || note>127 || !std::isfinite(velocity)) return false;
    const auto write=uiMidiWrite_.load(std::memory_order_relaxed);
    const auto read=uiMidiRead_.load(std::memory_order_acquire);
    if(write-read>=uiMidiCapacity_) {
        uiMidiDropped_.fetch_add(1,std::memory_order_relaxed);
        // Never risk a permanently stuck UI note if a pathological producer
        // outruns 1024 pending events. The audio side performs an all-notes-off
        // safety recovery at the next block boundary.
        uiMidiOverflowRecovery_.store(true,std::memory_order_release);
        return false;
    }

    auto& event=uiMidiQueue_[write%uiMidiCapacity_];
    event.note=static_cast<std::uint8_t>(note);
    event.velocity=static_cast<std::uint8_t>(juce::jlimit(
        0,127,juce::roundToInt(velocity*127.0f)));
    event.noteOn=noteOn;
    uiMidiWrite_.store(write+1,std::memory_order_release);
    return true;
}

void OrigamiAudioProcessor::drainUiKeyboardMidi(juce::MidiBuffer& target) noexcept {
    auto read=uiMidiRead_.load(std::memory_order_relaxed);
    const auto write=uiMidiWrite_.load(std::memory_order_acquire);
    const auto drained=write-read;
    while(read<write) {
        const auto event=uiMidiQueue_[read%uiMidiCapacity_];
        if(event.noteOn) {
            target.addEvent(juce::MidiMessage::noteOn(
                1,static_cast<int>(event.note),
                static_cast<juce::uint8>(event.velocity)),0);
        } else {
            target.addEvent(juce::MidiMessage::noteOff(
                1,static_cast<int>(event.note)),0);
        }
        ++read;
    }
    uiMidiRead_.store(read,std::memory_order_release);
    continuityUiMidiEvents_.fetch_add(drained,std::memory_order_relaxed);

    if(uiMidiOverflowRecovery_.exchange(false,std::memory_order_acq_rel))
        target.addEvent(juce::MidiMessage::allNotesOff(1),0);
}

double OrigamiAudioProcessor::getUiHostBpm() noexcept {
    return static_cast<double>(cachedHostBpm_.load(std::memory_order_acquire));
}

double OrigamiAudioProcessor::currentArpBpm() const noexcept {
    double bpm=juce::jlimit(20.0,400.0,arpState_.internalTempo);
    if(arpState_.syncToDaw) bpm=static_cast<double>(cachedHostBpm_.load(std::memory_order_relaxed));
    return juce::jlimit(20.0,400.0,bpm);
}
double OrigamiAudioProcessor::arpStepBeats() const noexcept {
    static constexpr double beats[] {1.0,0.5,0.25,0.125,1.0/3.0,1.0/6.0,0.75};
    return beats[juce::jlimit(0,6,arpState_.rateIndex)];
}
void OrigamiAudioProcessor::publishEnvelopeUiSnapshot() noexcept {
    mct::origami::VoiceInfo newest{}; bool found=false;
    for(std::size_t i=0;i<mct::origami::OrigamiEngine::voiceCount;++i) {
        const auto info=engine_.voiceInfo(i);
        if(!info.active) continue;
        if(!found || info.order>=newest.order){newest=info;found=true;}
    }
    if(!found){envUiActive_.store(false,std::memory_order_release);return;}
    envUiOrder_.store(newest.order,std::memory_order_relaxed);
    for(std::size_t i=0;i<3;++i){
        envUiStage_[i].store(static_cast<std::uint32_t>(newest.envelopes[i].stage),std::memory_order_relaxed);
        envUiProgress_[i].store(newest.envelopes[i].progress,std::memory_order_relaxed);
        envUiValue_[i].store(newest.envelopes[i].value,std::memory_order_relaxed);
    }
    envUiActive_.store(true,std::memory_order_release);
}

void OrigamiAudioProcessor::serviceVisualTelemetry(int hostBlockSamples) noexcept {
    const bool allowed=!renderBudget_.snapshot().suppressVisualTelemetry;

    if(allowed && arpUiDirty_.exchange(false,std::memory_order_acq_rel))
        publishArpUiSnapshot();

    envUiSamplesUntilPublish_-=static_cast<std::int64_t>(hostBlockSamples);
    if(envUiSamplesUntilPublish_>0) return;

    const auto interval=static_cast<std::int64_t>(
        juce::jmax(1.0,sampleRate_/envelopeUiPublishHz_));

    if(!allowed) {
        envUiSamplesUntilPublish_=0;
        return;
    }

    publishEnvelopeUiSnapshot();
    visualizationMailbox_.publish(engine_.runtimeVisualizationSnapshot());
    do envUiSamplesUntilPublish_+=interval;
    while(envUiSamplesUntilPublish_<=0);
}

void OrigamiAudioProcessor::finalizeRenderBudget(std::int64_t startTicks,
                                                 int hostBlockSamples) noexcept {
    if(hostBlockSamples<=0 || !(sampleRate_>0.0)) return;

    const auto endTicks=juce::Time::getHighResolutionTicks();
    const auto elapsedTicks=endTicks-startTicks;
    const double elapsedSeconds=static_cast<double>(juce::jmax<std::int64_t>(0,elapsedTicks))
        / highResolutionTicksPerSecond_;
    const double deadlineSeconds=static_cast<double>(hostBlockSamples)/sampleRate_;
    const float deadlineFraction=deadlineSeconds>0.0
        ? static_cast<float>(elapsedSeconds/deadlineSeconds)
        : 0.0f;

    // P0 diagnostics: retain the real callback wall time separately from the
    // QoS policy so the Standalone log can distinguish marginal pressure from
    // catastrophic deadline excursions. Atomic publication only; no RT I/O.
    const double elapsedMs=elapsedSeconds*1000.0;
    const double deadlineMs=deadlineSeconds*1000.0;
    runtimeCallbackBudgetMs_.store(deadlineMs,std::memory_order_relaxed);
    runtimeLastCallbackMs_.store(elapsedMs,std::memory_order_relaxed);
    double priorWorst=runtimeWorstCallbackMs_.load(std::memory_order_relaxed);
    while(elapsedMs>priorWorst &&
          !runtimeWorstCallbackMs_.compare_exchange_weak(
              priorWorst,elapsedMs,std::memory_order_relaxed)) {}
    if(deadlineSeconds>0.0 && elapsedSeconds>=deadlineSeconds)
        runtimeCallbacksOverBudget_.fetch_add(1,std::memory_order_relaxed);

    auto load=engine_.renderLoad();
    const auto& snapshot=renderBudget_.observe(deadlineFraction,load);

    qosInstant_.store(snapshot.callbackDeadlineFraction,std::memory_order_relaxed);
    qosSmoothed_.store(snapshot.smoothedDeadlineFraction,std::memory_order_relaxed);
    qosPeak_.store(snapshot.peakDeadlineFraction,std::memory_order_relaxed);
    qosLevel_.store(static_cast<std::uint32_t>(snapshot.level),std::memory_order_relaxed);

    std::uint32_t flags=0;
    if(snapshot.suppressVisualTelemetry) flags|=1u<<0;
    if(snapshot.reduceControlRate) flags|=1u<<1;
    if(snapshot.reduceOptionalEffectQuality) flags|=1u<<2;
    if(snapshot.restrictNewHighCostVoices) flags|=1u<<3;
    if(snapshot.bypassNewestOptionalEffect) flags|=1u<<4;
    qosFlags_.store(flags,std::memory_order_relaxed);

    qosVoices_.store(snapshot.load.activeVoices,std::memory_order_relaxed);
    qosModules_.store(snapshot.load.activeModules,std::memory_order_relaxed);
    qosUnison_.store(snapshot.load.totalUnison,std::memory_order_relaxed);
    qosOscEvals_.store(snapshot.load.oscillatorEvaluationsPerSample,std::memory_order_relaxed);
    qosVoiceCeiling_.store(snapshot.voiceAdmissionCeiling,std::memory_order_relaxed);
    qosDeadlineMisses_.store(snapshot.deadlineMisses,std::memory_order_release);
}

void OrigamiAudioProcessor::publishArpUiSnapshot() noexcept {
    std::uint64_t low=0,high=0;
    for(int note=0;note<64;++note)
        if(arpHeld_[static_cast<std::size_t>(note)]) low|=(std::uint64_t{1}<<note);
    for(int note=64;note<128;++note)
        if(arpHeld_[static_cast<std::size_t>(note)]) high|=(std::uint64_t{1}<<(note-64));
    arpUiHeldLow_.store(low,std::memory_order_release);
    arpUiHeldHigh_.store(high,std::memory_order_release);
    arpUiActiveNote_.store(arpActiveNote_,std::memory_order_release);
}

void OrigamiAudioProcessor::resetArpeggiatorRuntime(bool silenceVoice) noexcept {
    if(silenceVoice && arpActiveNote_>=0)
        engine_.noteOff(arpActiveNote_,static_cast<std::uint8_t>(juce::jlimit(1,16,arpActiveChannel_)-1),0u);
    arpStepRemaining_=0.0;arpGateRemaining_=-1.0;arpActiveNote_=-1;
    arpSequenceIndex_=0;arpBounceDirection_=1;arpStepParity_=false;arpOrderCount_=0;
    arpHeld_.fill(false);arpPhysicalHeld_.fill(false);arpVelocity_.fill(0.0f);arpChannel_.fill(1);
    arpUiDirty_.store(true,std::memory_order_release);
}
void OrigamiAudioProcessor::captureArpNote(const juce::MidiMessage& m,juce::MidiBuffer& out,int samplePosition) noexcept {
    const int note=juce::jlimit(0,127,m.getNoteNumber());
    const auto noteIndex=static_cast<std::size_t>(note);
    if(m.isNoteOn()) {
        bool anyPhysical=false;
        for(bool down:arpPhysicalHeld_) if(down) {anyPhysical=true;break;}
        if(arpState_.latch && !anyPhysical) {
            arpHeld_.fill(false);arpOrderCount_=0;arpSequenceIndex_=0;arpBounceDirection_=1;
        }
        arpPhysicalHeld_[noteIndex]=true;
        if(!arpHeld_[noteIndex] && arpOrderCount_<128)
            arpOrder_[static_cast<std::size_t>(arpOrderCount_++)]=note;
        arpHeld_[noteIndex]=true;
        arpVelocity_[noteIndex]=m.getFloatVelocity();
        arpChannel_[noteIndex]=juce::jlimit(1,16,m.getChannel());
        if(arpState_.retriggerOnNote || arpActiveNote_<0) arpStepRemaining_=0.0;
    } else if(m.isNoteOff()) {
        arpPhysicalHeld_[noteIndex]=false;
        if(!arpState_.latch) {
            arpHeld_[noteIndex]=false;
            for(int i=0;i<arpOrderCount_;++i) {
                if(arpOrder_[static_cast<std::size_t>(i)]!=note) continue;
                for(int j=i+1;j<arpOrderCount_;++j)
                    arpOrder_[static_cast<std::size_t>(j-1)]=arpOrder_[static_cast<std::size_t>(j)];
                --arpOrderCount_;
                break;
            }
            if(note==arpActiveNote_) {
                out.addEvent(juce::MidiMessage::noteOff(arpActiveChannel_,arpActiveNote_),samplePosition);
                arpActiveNote_=-1;arpGateRemaining_=-1.0;
            }
        }
    }
    arpUiDirty_.store(true,std::memory_order_release);
}
int OrigamiAudioProcessor::chooseArpNote() noexcept {
    std::array<int,512> sequence{};
    int count=0;
    const int octaves=juce::jlimit(1,4,arpState_.octaveSpan);
    auto append=[&](int base) {
        for(int oct=0;oct<octaves && count<static_cast<int>(sequence.size());++oct) {
            const int note=base+12*oct;
            if(note<=127) sequence[static_cast<std::size_t>(count++)]=note;
        }
    };
    if(arpState_.direction==mct::origami::ArpeggiatorState::Direction::Order) {
        for(int i=0;i<arpOrderCount_;++i) {
            const int ordered=arpOrder_[static_cast<std::size_t>(i)];
            if(arpHeld_[static_cast<std::size_t>(ordered)]) append(ordered);
        }
    } else {
        for(int note=0;note<128;++note)
            if(arpHeld_[static_cast<std::size_t>(note)]) append(note);
        std::sort(sequence.begin(),sequence.begin()+count);
    }
    if(count<=0) return -1;
    if(arpState_.direction==mct::origami::ArpeggiatorState::Direction::Random) {
        arpRandomState_=arpRandomState_*1664525u+1013904223u;
        const auto index=static_cast<std::size_t>(arpRandomState_%static_cast<std::uint32_t>(count));
        return sequence[index];
    }
    if(arpState_.direction==mct::origami::ArpeggiatorState::Direction::InsideOut) {
        const int step=((arpSequenceIndex_%count)+count)%count;
        ++arpSequenceIndex_;
        int index=0;
        if((count%2)==0)
            index=(step%2==0)?(count/2-1-step/2):(count/2+step/2);
        else
            index=(step%2==0)?(count/2-step/2):(count/2+1+step/2);
        return sequence[static_cast<std::size_t>(juce::jlimit(0,count-1,index))];
    }
    if(arpState_.direction==mct::origami::ArpeggiatorState::Direction::OutsideIn) {
        const int step=((arpSequenceIndex_%count)+count)%count;
        ++arpSequenceIndex_;
        const int index=(step%2==0)?(step/2):(count-1-step/2);
        return sequence[static_cast<std::size_t>(juce::jlimit(0,count-1,index))];
    }
    if(arpState_.direction==mct::origami::ArpeggiatorState::Direction::Down) {
        const int idx=((arpSequenceIndex_%count)+count)%count;++arpSequenceIndex_;
        return sequence[static_cast<std::size_t>(count-1-idx)];
    }
    if(arpState_.direction==mct::origami::ArpeggiatorState::Direction::UpDown && count>1) {
        arpSequenceIndex_=juce::jlimit(0,count-1,arpSequenceIndex_);
        const int result=sequence[static_cast<std::size_t>(arpSequenceIndex_)];
        arpSequenceIndex_+=arpBounceDirection_;
        if(arpSequenceIndex_>=count){arpSequenceIndex_=count-2;arpBounceDirection_=-1;}
        else if(arpSequenceIndex_<0){arpSequenceIndex_=1;arpBounceDirection_=1;}
        return result;
    }
    const int idx=((arpSequenceIndex_%count)+count)%count;++arpSequenceIndex_;
    return sequence[static_cast<std::size_t>(idx)];
}
void OrigamiAudioProcessor::advanceArpeggiator(juce::MidiBuffer& out,int startSample,int endSample,double bpm) noexcept {
    if(endSample<=startSample) return;
    int cursor=startSample;
    while(cursor<endSample) {
        if(arpGateRemaining_>=0.0 && arpGateRemaining_<=0.000001 && arpActiveNote_>=0) {
            out.addEvent(juce::MidiMessage::noteOff(arpActiveChannel_,arpActiveNote_),cursor);
            arpActiveNote_=-1;arpGateRemaining_=-1.0;
            arpUiDirty_.store(true,std::memory_order_release);
        }
        if(arpStepRemaining_<=0.000001) {
            if(arpActiveNote_>=0) {
                out.addEvent(juce::MidiMessage::noteOff(arpActiveChannel_,arpActiveNote_),cursor);
                arpActiveNote_=-1;arpGateRemaining_=-1.0;
            }
            const int chosen=chooseArpNote();
            const double baseSamples=(60.0/juce::jmax(20.0,bpm))*arpStepBeats()*sampleRate_;
            const double swing=juce::jlimit(0.0,0.75,static_cast<double>(engine_.modulatedSwing()));
            const double stepSamples=juce::jmax(1.0,baseSamples*(arpStepParity_?(1.0+swing*0.5):(1.0-swing*0.5)));
            arpStepParity_=!arpStepParity_;arpStepRemaining_=stepSamples;
            if(chosen>=0) {
                arpChanceRandomState_=arpChanceRandomState_*1664525u+1013904223u;
                const float roll=static_cast<float>(arpChanceRandomState_ & 0x00ffffffu)/16777215.0f;
                if(roll<=arpState_.probability) {
                    int source=chosen;
                    while(source>=128 || (source>=0 && !arpHeld_[static_cast<std::size_t>(source)])) source-=12;
                    if(source<0 || !arpHeld_[static_cast<std::size_t>(source)]) {
                        source=-1;
                        for(int n=0;n<128;++n) {
                            if(arpHeld_[static_cast<std::size_t>(n)] && n%12==chosen%12){source=n;break;}
                        }
                    }
                    const float baseVelocity=source>=0?arpVelocity_[static_cast<std::size_t>(source)]:0.85f;
                    const float velocity=juce::jlimit(0.01f,1.0f,baseVelocity*arpState_.velocityScale);
                    const int outputNote=juce::jlimit(0,127,chosen+arpState_.transposeSemitones);
                    arpActiveChannel_=source>=0?arpChannel_[static_cast<std::size_t>(source)]:1;
                    arpActiveNote_=outputNote;
                    arpUiDirty_.store(true,std::memory_order_release);
                    out.addEvent(juce::MidiMessage::noteOn(arpActiveChannel_,outputNote,velocity),cursor);
                    arpGateRemaining_=juce::jmax(1.0,stepSamples*juce::jlimit(0.05,1.0,static_cast<double>(arpState_.gate)));
                }
            }
        }
        double next=static_cast<double>(endSample-cursor);
        if(arpStepRemaining_>0.0) next=juce::jmin(next,arpStepRemaining_);
        if(arpGateRemaining_>0.0) next=juce::jmin(next,arpGateRemaining_);
        const int advance=juce::jmax(1,juce::jmin(endSample-cursor,static_cast<int>(std::ceil(next))));
        cursor+=advance;arpStepRemaining_-=advance;if(arpGateRemaining_>=0.0) arpGateRemaining_-=advance;
    }
}

void OrigamiAudioProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) {
    continuityCallbacks_.fetch_add(1,std::memory_order_relaxed);
    const auto callbackStartTicks=juce::Time::getHighResolutionTicks();

    if(panicRequested_.exchange(false,std::memory_order_acq_rel)) {
        // All runtime mutation stays on the audio owner thread. Ignore MIDI in
        // this callback so a queued note cannot immediately undo the reset.
        engine_.emergencyResetRuntime();
        fxEnvironment_.emergencyResetRuntime();
        resetArpeggiatorRuntime(false);
        uiMidiRead_.store(uiMidiWrite_.load(std::memory_order_acquire),std::memory_order_release);
        performanceUiHeldLow_.store(0,std::memory_order_release);
        performanceUiHeldHigh_.store(0,std::memory_order_release);
        buffer.clear();
        runtimeOutputPeak_.store(0.0f,std::memory_order_relaxed);
        panicCount_.fetch_add(1,std::memory_order_release);
        return;
    }

    // Wavetable editor commits cross into DSP inside the engine's block
    // boundary (beginHostBlock): a pointer swap, no copy, no free here.
    juce::ScopedNoDenormals noDenormals;
    jassert(buffer.getNumChannels() >= 2);
    const int total = buffer.getNumSamples();
    runtimeLastCallbackSamples_.store(total,std::memory_order_relaxed);
    runtimeLastOutputChannels_.store(buffer.getNumChannels(),std::memory_order_relaxed);
    int observedMin=runtimeMinCallbackSamples_.load(std::memory_order_relaxed);
    while((observedMin==0 || total<observedMin) &&
          !runtimeMinCallbackSamples_.compare_exchange_weak(observedMin,total,std::memory_order_relaxed)) {}
    int observedMax=runtimeMaxCallbackSamples_.load(std::memory_order_relaxed);
    while(total>observedMax &&
          !runtimeMaxCallbackSamples_.compare_exchange_weak(observedMax,total,std::memory_order_relaxed)) {}

    // Deep Audit P03: complete host/session restores cross into the
    // renderer only at a host-block boundary. setStateInformation() never
    // mutates or suspends live DSP.
    // mct-origami-content-browser: a restore replaces every voice at once.
    // If the instrument is sounding, this block fades out (3 ms) on the old
    // state and the restore applies at the next boundary: no hard cut, one
    // block later. A silent instrument restores immediately, as before.
    bool fadeOutBlock=false;
    if(restoreDeferred_) {
        restoreMailbox_.consume(deferredRestore_); // newer edits/loads during the fade win
        restorePending_.store(false,std::memory_order_release);
        engine_.restoreInstrumentState(deferredRestore_);
        resetArpeggiatorRuntime(false);
        restoreDeferred_=false;
    } else if(restoreMailbox_.consume(deferredRestore_)) {
        if(runtimeOutputPeak_.load(std::memory_order_relaxed)>1.0e-4f) {
            restoreDeferred_=true; fadeOutBlock=true;
            fadedRestores_.fetch_add(1,std::memory_order_relaxed);
        } else {
            restorePending_.store(false,std::memory_order_release);
            engine_.restoreInstrumentState(deferredRestore_);
            // A full instrument generation replaces note/runtime ownership.
            resetArpeggiatorRuntime(false);
        }
    }

    // Patch 14/19: consume latest UI performance state after a restore. The
    // state-restore producer republishes its performance generation, so this is
    // coherent with the full state; a later UI edit naturally wins.
    mct::origami::PerformanceState pendingPerformance;
    if(performanceMailbox_.consume(pendingPerformance))
        engine_.setPerformanceState(pendingPerformance);
    mct::origami::ArpeggiatorState pendingArp;
    if(arpMailbox_.consume(pendingArp)) {
        const bool timingChanged=pendingArp.rateIndex!=arpState_.rateIndex
            || std::abs(pendingArp.swing-arpState_.swing)>1.0e-6f
            || pendingArp.syncToDaw!=arpState_.syncToDaw
            || std::abs(pendingArp.internalTempo-arpState_.internalTempo)>1.0e-9;
        arpState_=pendingArp;
        if(timingChanged) arpStepRemaining_=0.0;
    }
    if(pendingClearArpLatch_.exchange(false,std::memory_order_acq_rel))
        resetArpeggiatorRuntime(true);
    // Swing's base remains the ARP control; the Matrix supplies the derived
    // modulation value through the engine without duplicating a timing engine.
    engine_.setGlobalSwingBase(arpState_.swing);

    // Deep Audit P07: enforce the PREVIOUS completed callback's admission
    // decision for this callback. This avoids self-referential timing and makes
    // the policy deterministic at a host-block boundary.
    engine_.setVoiceAdmissionCeiling(
        static_cast<std::size_t>(renderBudget_.snapshot().voiceAdmissionCeiling));

    // Patch 13/19: sample host-owned playhead context exactly once per callback.
    float hostBpm=120.0f;
    mct::origami::OrigamiEngine::HostTransport transport;
    transport.bpm=juce::jlimit(20.0,400.0,arpState_.internalTempo); // Origami's internal tempo
    if(auto* playHead=getPlayHead()) {
        if(const auto position=playHead->getPosition()) {
            if(const auto bpm=position->getBpm(); bpm && std::isfinite(*bpm)) {
                hostBpm=static_cast<float>(juce::jlimit(20.0,400.0,*bpm));
                transport.bpm=hostBpm;
            }
            // N05: host position and transport, when the host reports them.
            if(const auto ppq=position->getPpqPosition()) { transport.ppq=*ppq; transport.ppqValid=std::isfinite(*ppq); }
            transport.playing=position->getIsPlaying();
        }
    }
    cachedHostBpm_.store(hostBpm,std::memory_order_release);
    engine_.setHostTransport(transport);

    // Patch 03/19: reuse capacity-prepared MIDI workspaces. Do not grow/mutate
    // the host wrapper's MIDI buffer with Origami-generated events.
    auto& inputMidi=inputMidiScratch_;
    auto& scheduled=scheduledMidiScratch_;
    inputMidi.clear();
    scheduled.clear();
    inputMidi.addEvents(midi,0,-1,0);

    if(const int pitch=pendingUiPitch_.exchange(-1,std::memory_order_acq_rel);pitch>=0)
        inputMidi.addEvent(juce::MidiMessage::pitchWheel(1,pitch),0);
    if(const int mod=pendingUiMod_.exchange(-1,std::memory_order_acq_rel);mod>=0)
        inputMidi.addEvent(juce::MidiMessage::controllerEvent(1,1,mod),0);

    // Deep Audit P02: fixed SPSC drain only. No MidiKeyboardState
    // CriticalSection can ever enter processBlock().
    drainUiKeyboardMidi(inputMidi);

    // V36: publish raw performance input independently of ARP state. The UI
    // consumes only lock-free atomics; the audio thread never waits on it.
    auto heldLow=performanceUiHeldLow_.load(std::memory_order_relaxed);
    auto heldHigh=performanceUiHeldHigh_.load(std::memory_order_relaxed);
    for(const auto metadata:inputMidi) {
        const auto& message=metadata.getMessage();
        if(!message.isNoteOnOrOff()) continue;
        const int note=juce::jlimit(0,127,message.getNoteNumber());
        const bool on=message.isNoteOn();
        const std::uint64_t bit=std::uint64_t{1}<<(note&63);
        if(note<64) { if(on) heldLow|=bit; else heldLow&=~bit; }
        else { if(on) heldHigh|=bit; else heldHigh&=~bit; }
        if(on) performanceUiVelocity_[static_cast<std::size_t>(note)].store(
            static_cast<std::uint8_t>(juce::jlimit(1,127,juce::roundToInt(message.getFloatVelocity()*127.0f))),
            std::memory_order_relaxed);
    }
    performanceUiHeldLow_.store(heldLow,std::memory_order_release);
    performanceUiHeldHigh_.store(heldHigh,std::memory_order_release);

    if(arpState_.enabled) {
        if(!arpWasEnabled_){resetArpeggiatorRuntime(true);arpWasEnabled_=true;}
        const double bpm=currentArpBpm();
        int schedulerCursor=0;
        for(const auto metadata:inputMidi) {
            const int eventSample=juce::jlimit(schedulerCursor,total,metadata.samplePosition);
            advanceArpeggiator(scheduled,schedulerCursor,eventSample,bpm);
            const auto& message=metadata.getMessage();
            if(message.isNoteOnOrOff()) captureArpNote(message,scheduled,eventSample);
            else scheduled.addEvent(message,eventSample);
            schedulerCursor=eventSample;
        }
        advanceArpeggiator(scheduled,schedulerCursor,total,bpm);
    } else {
        if(arpWasEnabled_){resetArpeggiatorRuntime(true);arpWasEnabled_=false;}
        scheduled.addEvents(inputMidi,0,-1,0);
    }

    // mct-origami-audio-reengineer-p06.3-local-source
    // One stable engine snapshot per DAW callback; exact MIDI offsets still split rendering.
    const auto visualPolicy=renderBudget_.snapshot();
    engine_.setVisualizationPolicy(visualPolicy.suppressVisualTelemetry,visualPolicy.reduceControlRate);
    // DAW macro parameters are the macro BASE values (host automation):
    // applied at the block boundary, after the modulation-state hand-over.
    {
        std::array<float,mct::origami::maxMacros> bases{};
        for(std::size_t i=0;i<bases.size();++i) bases[i]=macroParameters_[i]!=nullptr ? macroParameters_[i]->get() : 0.0f;
        engine_.setHostMacroBases(bases);
    }
    if(!prepared_ || !engine_.beginHostBlock(2u)) {
        continuityBeginFailures_.fetch_add(1,std::memory_order_relaxed);
        buffer.clear();
        serviceVisualTelemetry(total);
        finalizeRenderBudget(callbackStartTicks,total);
        return;
    }

    // User buses render into prepared buffers; an oversized host block (beyond
    // the prepared capacity) renders MAIN only rather than ever allocating.
    auxThisBlock_=auxCapacity_>=total && !auxStorage_.empty();
    const auto renderScheduled=[&](const juce::MidiBuffer& events) noexcept {
        int cursor=0;
        for(const auto metadata:events) {
            const int eventSample=juce::jlimit(cursor,total,metadata.samplePosition);
            renderRange(buffer,cursor,eventSample-cursor);
            dispatchMidi(metadata.getMessage());
            cursor=eventSample;
        }
        renderRange(buffer,cursor,total-cursor);
    };
    // Patch 10/19 FIX5: render the post-merge stream, not raw host MIDI.
    // inputMidi contains host MIDI + UI pitch/mod + lock-free UI keyboard notes.
    // scheduled contains the transformed ARP output.
    if(arpState_.enabled) renderScheduled(scheduled);
    else renderScheduled(inputMidi);
    engine_.endHostBlock();

    // Every bus -> its prepared FX graph -> master sum -> GLOBAL FX.
    // Allocation/lock free; MAIN-only neutral state is a bit-exact pass-through.
    if(buffer.getNumChannels()>=2)
        fxEnvironment_.process(buffer.getWritePointer(0),buffer.getWritePointer(1),
                               auxThisBlock_ ? auxPointers_.data() : nullptr,engine_.renderBusCount(),total,
                               &engine_.fxModulationOutput(),engine_.masterAfterFxActive(),engine_.blockMasterGain());
    if(fadeOutBlock) {
        const double rate=runtimePreparedSampleRate_.load(std::memory_order_relaxed);
        const int fade=std::max(1,std::min(total,static_cast<int>(std::lround(0.003*(rate>0.0 ? rate : 48000.0)))));
        for(int ch=0;ch<buffer.getNumChannels();++ch) {
            auto* x=buffer.getWritePointer(ch);
            for(int i=0;i<total;++i) x[i]*=i<fade ? 1.0f-static_cast<float>(i+1)/static_cast<float>(fade) : 0.0f;
        }
    }

    bool callbackHasSignal=false;
    float callbackPeak=0.0f,callbackMaxDelta=0.0f;
    std::uint64_t callbackNonFinite=0;
    for(int ch=0;ch<juce::jmin(2,buffer.getNumChannels());++ch) {
        float previous=0.0f; bool havePrevious=false;
        for(int i=0;i<total;++i) {
            const float sample=buffer.getSample(ch,i);
            if(!std::isfinite(sample)) { ++callbackNonFinite; continue; }
            callbackPeak=std::max(callbackPeak,std::abs(sample));
            callbackHasSignal|=std::abs(sample)>1.0e-8f;
            if(havePrevious) callbackMaxDelta=std::max(callbackMaxDelta,std::abs(sample-previous));
            previous=sample;havePrevious=true;
        }
    }
    runtimeOutputPeak_.store(callbackPeak,std::memory_order_relaxed);
    float priorDelta=runtimeMaxAdjacentDelta_.load(std::memory_order_relaxed);
    while(callbackMaxDelta>priorDelta &&
          !runtimeMaxAdjacentDelta_.compare_exchange_weak(priorDelta,callbackMaxDelta,std::memory_order_relaxed)) {}
    runtimeNonFiniteOutputSamples_.fetch_add(callbackNonFinite,std::memory_order_relaxed);
    if(total>0 && !callbackHasSignal)
        continuityZeroCallbacks_.fetch_add(1,std::memory_order_relaxed);

    serviceVisualTelemetry(total);
    finalizeRenderBudget(callbackStartTicks,total);
}
OrigamiAudioProcessor::AudioContinuityDiagnostics
OrigamiAudioProcessor::getAudioContinuityDiagnostics() const noexcept {
    AudioContinuityDiagnostics result;
    result.callbacks=continuityCallbacks_.load(std::memory_order_relaxed);
    result.beginHostBlockFailures=continuityBeginFailures_.load(std::memory_order_relaxed);
    result.processSpanFailures=continuitySpanFailures_.load(std::memory_order_relaxed);
    result.requestedSpanSamples=continuityRequestedSamples_.load(std::memory_order_relaxed);
    result.renderedSpanSamples=continuityRenderedSamples_.load(std::memory_order_relaxed);
    result.zeroOutputCallbacks=continuityZeroCallbacks_.load(std::memory_order_relaxed);
    result.uiMidiEventsDrained=continuityUiMidiEvents_.load(std::memory_order_relaxed);
    result.preparedSampleRate=runtimePreparedSampleRate_.load(std::memory_order_relaxed);
    result.preparedBlockSize=runtimePreparedBlockSize_.load(std::memory_order_relaxed);
    result.minCallbackSamples=runtimeMinCallbackSamples_.load(std::memory_order_relaxed);
    result.maxCallbackSamples=runtimeMaxCallbackSamples_.load(std::memory_order_relaxed);
    result.lastCallbackSamples=runtimeLastCallbackSamples_.load(std::memory_order_relaxed);
    result.lastOutputChannels=runtimeLastOutputChannels_.load(std::memory_order_relaxed);
    result.outputPeak=runtimeOutputPeak_.load(std::memory_order_relaxed);
    result.maxAdjacentDelta=runtimeMaxAdjacentDelta_.load(std::memory_order_relaxed);
    result.nonFiniteOutputSamples=runtimeNonFiniteOutputSamples_.load(std::memory_order_relaxed);
    result.callbackBudgetMs=runtimeCallbackBudgetMs_.load(std::memory_order_relaxed);
    result.lastCallbackMs=runtimeLastCallbackMs_.load(std::memory_order_relaxed);
    result.worstCallbackMs=runtimeWorstCallbackMs_.load(std::memory_order_relaxed);
    result.callbacksOverBudget=runtimeCallbacksOverBudget_.load(std::memory_order_relaxed);
    result.spectralProfile=mct::origami::dsp::spectralCompilerStats();
    return result;
}
void OrigamiAudioProcessor::resetAudioContinuityDiagnostics() noexcept {
    continuityCallbacks_.store(0,std::memory_order_relaxed);
    continuityBeginFailures_.store(0,std::memory_order_relaxed);
    continuitySpanFailures_.store(0,std::memory_order_relaxed);
    continuityRequestedSamples_.store(0,std::memory_order_relaxed);
    continuityRenderedSamples_.store(0,std::memory_order_relaxed);
    continuityZeroCallbacks_.store(0,std::memory_order_relaxed);
    continuityUiMidiEvents_.store(0,std::memory_order_relaxed);
    runtimeMinCallbackSamples_.store(0,std::memory_order_relaxed);
    runtimeMaxCallbackSamples_.store(0,std::memory_order_relaxed);
    runtimeLastCallbackSamples_.store(0,std::memory_order_relaxed);
    runtimeLastOutputChannels_.store(0,std::memory_order_relaxed);
    runtimeOutputPeak_.store(0.0f,std::memory_order_relaxed);
    runtimeMaxAdjacentDelta_.store(0.0f,std::memory_order_relaxed);
    runtimeNonFiniteOutputSamples_.store(0,std::memory_order_relaxed);
    runtimeCallbackBudgetMs_.store(0.0,std::memory_order_relaxed);
    runtimeLastCallbackMs_.store(0.0,std::memory_order_relaxed);
    runtimeWorstCallbackMs_.store(0.0,std::memory_order_relaxed);
    runtimeCallbacksOverBudget_.store(0,std::memory_order_relaxed);
}

void OrigamiAudioProcessor::getStateInformation(juce::MemoryBlock& dest) { writeStateInformation(dest,true); }
void OrigamiAudioProcessor::writeStateInformation(juce::MemoryBlock& dest,bool includeWavetables) {
    // Deep Audit P03: autosave serializes the canonical non-RT model. It never
    // suspends the processor and never interrogates mutable renderer internals.
    syncUiMacrosFromHost(); // automated macro bases belong to the saved state
    mct::origami::InstrumentState snapshot;
    {
        const juce::ScopedLock lock(stateLock_);
        snapshot=uiInstrumentState_;
    }
    auto bytes=mct::origami::encodeInstrumentState(snapshot);
    constexpr std::uint32_t visualMagic=0x56495331u;
    const auto appendWord=[&bytes](std::uint32_t value) {
        for(int shift=24;shift>=0;shift-=8)
            bytes.push_back(static_cast<std::uint8_t>(value>>shift));
    };
    // N03 CONTROL view trailer: [layout bytes][length][NCL1]. Positions only;
    // the relationships themselves are the instrument's ModRoutes above.
    if(!controlLayout_.entries().empty()) {
        const auto layout=controlLayout_.encode();
        bytes.insert(bytes.end(),layout.begin(),layout.end());
        appendWord(static_cast<std::uint32_t>(layout.size()));
        appendWord(controlLayoutMagic);
    }
    // FX trailer: [workspace bytes][length][FXW1] (all bus graphs + Global FX).
    // P02/P03 states carry [graph][length][FXG2]; older states none (neutral).
    const auto fx=fxWorkspace_.encode();
    bytes.insert(bytes.end(),fx.begin(),fx.end());
    appendWord(static_cast<std::uint32_t>(fx.size()));
    appendWord(fxWorkspaceMagic);
    const auto content=encodeContentTrailer(includeWavetables);
    bytes.insert(bytes.end(),content.begin(),content.end());
    appendWord(static_cast<std::uint32_t>(content.size()));
    appendWord(contentMagic);
    appendWord(visualMagic);
    appendWord(visualizationMask_.load(std::memory_order_acquire));
    dest.replaceAll(bytes.data(),bytes.size());
}
void OrigamiAudioProcessor::setStateInformation(const void* data, int size) {
    if(restoreState(data,size)) historyHostReset_.store(true,std::memory_order_release);
}
bool OrigamiAudioProcessor::restoreState(const void* data, int size) {
    if(size<=0) return false;

    int instrumentSize=size;
    auto restoredVisualization=visualizationMask_.load(std::memory_order_acquire);
    if(size>=8) {
        const auto* bytes=static_cast<const std::uint8_t*>(data);
        const auto readWord=[bytes](int offset) {
            std::uint32_t value=0;
            for(int i=0;i<4;++i) value=(value<<8)|bytes[offset+i];
            return value;
        };
        if(readWord(size-8)==0x56495331u) {
            restoredVisualization=readWord(size-4)&mct::origami::ui::validVisualizationMask;
            instrumentSize-=8;
        }
    }

    // mct-origami-content-browser trailer: preset identity + custom wavetables.
    struct RestoredTable { mct::origami::OscillatorModuleId id=0; juce::String contentId; mct::origami::content::WavetableData data; };
    std::vector<RestoredTable> restoredTables;
    UiPresetIdentity restoredPreset;
    bool haveContent=false;
    if(instrumentSize>=8) {
        const auto* bytes=static_cast<const std::uint8_t*>(data);
        const auto readWord=[bytes](int offset) {
            std::uint32_t value=0;
            for(int i=0;i<4;++i) value=(value<<8)|bytes[offset+i];
            return value;
        };
        if(readWord(instrumentSize-4)==contentMagic) {
            const auto length=static_cast<int>(readWord(instrumentSize-8));
            if(length<4 || length>instrumentSize-8) return false;
            const int start=instrumentSize-8-length;
            int pos=start; const int end=start+length;
            bool ok=true;
            const auto word=[&]()->std::uint32_t { if(pos+4>end) { ok=false; return 0; } const auto v=readWord(pos); pos+=4; return v; };
            const auto text=[&]()->juce::String {
                const auto n=word();
                if(!ok || n>4096 || pos+static_cast<int>(n)>end) { ok=false; return {}; }
                juce::String t=juce::String::fromUTF8(reinterpret_cast<const char*>(bytes+pos),static_cast<int>(n)); pos+=static_cast<int>(n); return t;
            };
            if(word()!=1u) return false;
            restoredPreset.id=text(); restoredPreset.name=text();
            const auto count=word();
            if(!ok || count>mct::origami::OscillatorModuleBank::capacity) return false;
            for(std::uint32_t k=0;k<count && ok;++k) {
                RestoredTable t; t.id=word(); t.contentId=text(); t.data.name=text();
                const auto frames=word();
                if(!ok || t.id==0 || frames<1 || frames>static_cast<std::uint32_t>(mct::origami::content::maxWavetableFrames)) return false;
                const auto samples=static_cast<std::size_t>(frames)*mct::origami::content::wavetableFrameSamples;
                if(pos+static_cast<int>(samples*4)>end) return false;
                t.data.samples.resize(samples);
                for(auto& v:t.data.samples) { const auto bits=word(); std::memcpy(&v,&bits,sizeof v); }
                if(!t.data.valid()) return false;
                restoredTables.push_back(std::move(t));
            }
            if(!ok || pos!=end) return false;
            haveContent=true;
            instrumentSize=start;
        }
    }

    std::vector<std::uint8_t> workspaceBytes;
    std::optional<mct::origami::fx::FxGraph> legacyGraph;
    if(instrumentSize>=8) {
        const auto* bytes=static_cast<const std::uint8_t*>(data);
        const auto readWord=[bytes](int offset) {
            std::uint32_t value=0;
            for(int i=0;i<4;++i) value=(value<<8)|bytes[offset+i];
            return value;
        };
        const auto tag=readWord(instrumentSize-4);
        if(tag==fxStateMagic || tag==fxWorkspaceMagic) {
            const auto length=static_cast<int>(readWord(instrumentSize-8));
            if(length<0 || length>instrumentSize-8) return false;
            const int start=instrumentSize-8-length;
            if(tag==fxWorkspaceMagic) {
                workspaceBytes.assign(bytes+start,bytes+start+length);
            } else {
                mct::origami::fx::FxGraph graph;
                if(!mct::origami::fx::decodeFxGraph(bytes+start,static_cast<std::size_t>(length),graph)) return false;
                legacyGraph=std::move(graph);
            }
            instrumentSize=start;
        }
    }
    std::optional<mct::origami::nodes::ControlLayout> controlLayout;
    if(instrumentSize>=8) {
        const auto* bytes=static_cast<const std::uint8_t*>(data);
        const auto readWord=[bytes](int offset) {
            std::uint32_t value=0;
            for(int i=0;i<4;++i) value=(value<<8)|bytes[offset+i];
            return value;
        };
        if(readWord(instrumentSize-4)==controlLayoutMagic) {
            const auto length=static_cast<int>(readWord(instrumentSize-8));
            if(length<0 || length>instrumentSize-8) return false;
            const int start=instrumentSize-8-length;
            mct::origami::nodes::ControlLayout decoded;
            if(!decoded.decode(bytes+start,static_cast<std::size_t>(length))) return false;
            controlLayout=std::move(decoded);
            instrumentSize=start;
        }
    }

    // Decode + validate completely before publication. The renderer receives one
    // complete fixed-size generation at the next callback boundary.
    mct::origami::InstrumentState state;
    if(!mct::origami::decodeInstrumentState(
            data,static_cast<std::size_t>(instrumentSize),state)) return false;
    if(!workspaceBytes.empty()) {
        mct::origami::fx::FxWorkspace probe; // validate before touching anything
        if(!probe.decode(workspaceBytes.data(),workspaceBytes.size())) return false;
    }

    {
    const juce::ScopedLock lock(stateLock_);
    if(!engine_.prepareSynthFilterStorage(state.modulation.synthFilters)) return false;
    uiInstrumentState_=state;
    bumpUiModelRevision();
    uiOscillatorRevision_.fetch_add(1,std::memory_order_release);
    uiPerformanceState_=state.performance;
    restorePending_.store(true,std::memory_order_release);
    restoreMailbox_.publish(uiInstrumentState_);
    // Keep the independent performance mailbox generation coherent with the
    // complete restore. Any subsequent UI performance edit overwrites this.
    performanceMailbox_.publish(uiPerformanceState_);
    }
    // Custom wavetables travel with the state: tables of the restored
    // oscillators are published (they wait for those oscillators to exist in
    // the renderer); an oscillator without one returns to BASIC SHAPES.
    {
        const juce::ScopedLock lock(stateLock_);
        const auto previous=std::move(wavetableSources_);
        wavetableSources_.clear();
        for(auto& t:restoredTables) {
            bool exists=false; for(const auto& m:state.oscillators) exists|=m.id!=0 && m.id==t.id;
            if(!exists) continue;
            if(engine_.publishWavetableForPendingOscillator(t.id,compileWavetable(t.data)))
                wavetableSources_[t.id]={std::make_shared<const mct::origami::content::WavetableData>(std::move(t.data)),t.contentId};
        }
        for(const auto& [id,source]:previous)
            if(wavetableSources_.count(id)==0) engine_.publishWavetableForPendingOscillator(id,mct::origami::dsp::Wavetable::builtIns());
        currentPreset_=haveContent ? restoredPreset : UiPresetIdentity{{},"UNTITLED"};
        uiOscillatorRevision_.fetch_add(1,std::memory_order_release);
    }
    // DAW macro parameters take the restored macro bases and names (outside
    // the model lock: this notifies the host).
    setMacroParametersFromModel(state.modulation);
    // FX: the saved bus graphs, else the P02/P03 MAIN graph (its globals become
    // Global FX), else neutral. Then exactly one graph per canonical bus.
    auto notify=std::move(fxWorkspace_.onChanged);
    fxWorkspace_.onChanged=nullptr;
    if(!workspaceBytes.empty()) fxWorkspace_.decode(workspaceBytes.data(),workspaceBytes.size());
    else if(legacyGraph) fxWorkspace_.adoptLegacyMainGraph(std::move(*legacyGraph));
    else fxWorkspace_.reset();
    for(std::size_t i=0;i<state.buses.count;++i) fxWorkspace_.document(state.buses.buses[i].id);
    for(const auto bus:fxWorkspace_.buses()) if(state.buses.find(bus)==nullptr) fxWorkspace_.removeBus(bus);
    fxWorkspace_.onChanged=std::move(notify);
    // States without the trailer (pre-N03) use the deterministic default layout.
    if(controlLayout) controlLayout_=std::move(*controlLayout); else controlLayout_.clear();
    controlLayout_.pruneSynthFilterDestinations(state.modulation);
    syncFxRenderer();
    visualizationMask_.store(restoredVisualization,std::memory_order_release);
    // Completion only: listeners read the latest fully restored state, never a queued snapshot.
    sendChangeMessage();
    return true;
}

std::uint32_t OrigamiAudioProcessor::getUiVisualizationMask() const noexcept {
    return visualizationMask_.load(std::memory_order_acquire);
}
void OrigamiAudioProcessor::setUiVisualizationMask(std::uint32_t mask) noexcept {
    UiEdit historyEdit(*this,"Change VisualizationMask");
    visualizationMask_.store(mask&mct::origami::ui::validVisualizationMask,
                             std::memory_order_release);
}
mct::origami::RuntimeVisualizationSnapshot
OrigamiAudioProcessor::getUiRuntimeVisualizationSnapshot() noexcept {
    visualizationMailbox_.consume(uiVisualizationSnapshot_);
    // The editor polls this every frame: free wavetables the audio thread
    // replaced (never freed on the audio thread), and follow DAW automation
    // of the macro bases in the model.
    engine_.collectRetiredWavetables();
    syncUiMacrosFromHost();
    return uiVisualizationSnapshot_;
}
bool OrigamiAudioProcessor::setUiMacro(unsigned index,float value) noexcept {
    UiEdit historyEdit(*this,"Change Macro");
    {
        const juce::ScopedLock lock(stateLock_);
        // `index` is the stable macro id - 1 (MACRO 1..4 keep indices 0..3).
        if(index>=mct::origami::maxMacros || !mct::origami::macroActive(uiInstrumentState_.modulation,index+1)) return false;
        auto mod=uiInstrumentState_.modulation;mod.macros[index]=value;
        if(!publishUiModulation(mod)) return false;
        uiInstrumentState_.modulation=mod;
        bumpUiModelRevision();
    }
    // The DAW parameter carries the new base (inside the UI's gesture); the
    // host is notified outside the model lock.
    if(auto* parameter=macroParameters_[index]; parameter!=nullptr && parameter->get()!=value)
        parameter->setValueNotifyingHost(parameter->convertTo0to1(value));
    return true;
}
void OrigamiAudioProcessor::beginUiMacroGesture(unsigned index) noexcept {
    if(auto* parameter=macroParameter(index)) {beginUiTransaction("Adjust Macro");parameter->beginChangeGesture();}
}
void OrigamiAudioProcessor::endUiMacroGesture(unsigned index) noexcept {
    if(auto* parameter=macroParameter(index)) {parameter->endChangeGesture();endUiTransaction();}
}
void OrigamiAudioProcessor::setMacroParametersFromModel(const mct::origami::ModulationState& modulation) noexcept {
    for(std::size_t i=0;i<macroParameters_.size();++i)
        if(auto* parameter=macroParameters_[i]; parameter!=nullptr && parameter->get()!=modulation.macros[i])
            parameter->setValueNotifyingHost(parameter->convertTo0to1(modulation.macros[i]));
    publishMacroNamesToHost(modulation);
}
bool OrigamiAudioProcessor::syncUiMacrosFromHost() noexcept {
    const juce::ScopedLock lock(stateLock_);
    auto mod=uiInstrumentState_.modulation;
    bool changed=false;
    for(std::size_t i=0;i<macroParameters_.size();++i) {
        if(macroParameters_[i]==nullptr) continue;
        const float v=macroParameters_[i]->get();
        if(std::isfinite(v) && v!=mod.macros[i]) { mod.macros[i]=std::clamp(v,0.0f,1.0f); ++macroAutomationRevision_[i]; changed=true; }
    }
    if(!changed || !publishUiModulation(mod)) return false;
    uiInstrumentState_.modulation=mod;
    bumpUiModelRevision();
    return true;
}
juce::String OrigamiAudioProcessor::macroDisplayName(unsigned macroId) const {
    std::array<char,mct::origami::ModulationState::macroNameCapacity> name{};
    bool active=false;
    if(macroId>=1 && macroId<=hostMacroNames_.size()) {
        const juce::SpinLock::ScopedLockType lock(macroNameLock_);
        name=hostMacroNames_[macroId-1];
        active=((hostMacroMask_>>(macroId-1))&1u)!=0;
    }
    // Every slot is always a host parameter (its ID never moves); a slot with
    // no macro says so, so the DAW's parameter list shows which are in use.
    if(!active) return "Macro "+juce::String(macroId)+" (inactive)";
    return name[0]!='\0' ? juce::String(name.data()) : "Macro "+juce::String(macroId);
}
void OrigamiAudioProcessor::publishMacroNamesToHost(const mct::origami::ModulationState& modulation) noexcept {
    bool changed=false;
    {
        const juce::SpinLock::ScopedLockType lock(macroNameLock_);
        changed=hostMacroNames_!=modulation.macroNames || hostMacroMask_!=modulation.macroMask;
        hostMacroNames_=modulation.macroNames;
        hostMacroMask_=modulation.macroMask;
    }
    // Same immutable IDs; only the display names change (hosts that cache
    // names may refresh them on this notification).
    if(changed) updateHostDisplay(juce::AudioProcessorListener::ChangeDetails{}.withParameterInfoChanged(true));
}
bool OrigamiAudioProcessor::setUiMacroName(unsigned index,const juce::String& name) noexcept {
    UiEdit historyEdit(*this,"Change MacroName");
    mct::origami::ModulationState mod;
    {
    const juce::ScopedLock lock(stateLock_);
    if(index>=mct::origami::maxMacros || !mct::origami::macroActive(uiInstrumentState_.modulation,index+1)) return false;
    mod=uiInstrumentState_.modulation;
    auto& target=mod.macroNames[index];
    target.fill('\0');
    const auto trimmed=name.trim();
    std::size_t length=0;
    for(int i=0;i<trimmed.length() && length+1<target.size();++i) {
        const auto c=trimmed[i];
        if(c>=32 && c<=126) target[length++]=static_cast<char>(c);
    }
    // The default label is not stored as a custom name.
    if(juce::String(target.data()).equalsIgnoreCase("MACRO "+juce::String(index+1))) target.fill('\0');
    if(!publishUiModulation(mod)) return false;
    uiInstrumentState_.modulation=mod;
    bumpUiModelRevision();
    }
    publishMacroNamesToHost(mod); // outside the model lock
    return true;
}
juce::String OrigamiAudioProcessor::getUiMacroName(unsigned index) const noexcept {
    const juce::ScopedLock lock(stateLock_);
    if(index>=mct::origami::maxMacros) return {};
    const auto& name=uiInstrumentState_.modulation.macroNames[index];
    return name[0]!='\0' ? juce::String(name.data()) : "MACRO "+juce::String(index+1);
}
bool OrigamiAudioProcessor::setUiLfo(const mct::origami::LfoSettings& settings) noexcept {
    UiEdit historyEdit(*this,"Change Lfo");
    const juce::ScopedLock lock(stateLock_);
    auto mod=uiInstrumentState_.modulation;mod.lfo1=settings;
    if(!publishUiModulation(mod)) return false;
    uiInstrumentState_.modulation=mod;
    bumpUiModelRevision();
    return true;
}
bool OrigamiAudioProcessor::setUiModulationState(const mct::origami::ModulationState& state) noexcept {
    UiEdit historyEdit(*this,"Change ModulationState");
    auto repaired=state;
    {
        const juce::ScopedLock lock(stateLock_);
        // mct-origami-nested-modulation-manual-qa: a view that removed a route
        // or a macro also removes what modulated it (depth routes, MACRO
        // destinations): one canonical repair, never a rejected deletion.
        mct::origami::pruneDanglingNestedRoutes(repaired);
        if(!publishUiModulation(repaired)) return false;
        uiInstrumentState_.modulation=repaired;
        controlLayout_.pruneSynthFilterDestinations(repaired);
        bumpUiModelRevision();
    }
    setMacroParametersFromModel(repaired); // DAW parameters follow the macro bases / names
    return true;
}
unsigned OrigamiAudioProcessor::addUiRoute() noexcept {
    UiEdit historyEdit(*this,"Add Route");
    const juce::ScopedLock lock(stateLock_);
    auto mod=uiInstrumentState_.modulation;
    if(mod.nextRouteId==std::numeric_limits<unsigned>::max()) return 0;
    for(auto& route:mod.routes) if(!route.id) {
        // ON / UNIPOLAR / no source / no destination / 0%: inert until both
        // ends are chosen (mct-origami-nodes-n01).
        route=mct::origami::ModRoute{};
        route.id=mod.nextRouteId++;
        if(!publishUiModulation(mod)) return 0;
        uiInstrumentState_.modulation=mod;
        bumpUiModelRevision();
        return route.id;
    }
    return 0;
}
bool OrigamiAudioProcessor::setUiRoute(const mct::origami::ModRoute& edited) noexcept {
    UiEdit historyEdit(*this,"Change Route");
    const juce::ScopedLock lock(stateLock_);
    if(!edited.id) return false;
    auto mod=uiInstrumentState_.modulation;
    for(auto& route:mod.routes) if(route.id==edited.id) {
        route=edited;
        if(!publishUiModulation(mod)) return false;
        uiInstrumentState_.modulation=mod;
        bumpUiModelRevision();
        return true;
    }
    return false;
}
bool OrigamiAudioProcessor::removeUiRoute(unsigned id) noexcept {
    UiEdit historyEdit(*this,"Remove Route");
    const juce::ScopedLock lock(stateLock_);
    auto mod=uiInstrumentState_.modulation;
    // Removes the route and every route on its depth (transitively).
    if(mct::origami::removeRouteCascade(mod,id)==0) return false;
    if(!publishUiModulation(mod)) return false;
    uiInstrumentState_.modulation=mod;
    bumpUiModelRevision();
    return true;
}
mct::origami::InstrumentState OrigamiAudioProcessor::getUiInstrumentState() const noexcept {
    const juce::ScopedLock lock(stateLock_);
    return uiInstrumentState_;
}
// mct-origami-functional-osc-controls-v15
bool OrigamiAudioProcessor::setUiParameter(mct::origami::ParameterId id,float value) noexcept {
    UiEdit historyEdit(*this,"Change Parameter");
    const juce::ScopedLock lock(stateLock_);
    if(!engine_.setParameter(id,value)) return false;
    float canonical=0;
    if(!mct::origami::sanitizeParameter(id,value,canonical))return false;
    uiInstrumentState_.parameters[static_cast<std::size_t>(id)]=canonical;
    mct::origami::applyLegacyOscillatorParameters(
        uiInstrumentState_.oscillators[0],uiInstrumentState_.parameters);
    bumpUiModelRevision();
    uiOscillatorRevision_.fetch_add(1,std::memory_order_release);
    return true;
}
float OrigamiAudioProcessor::getUiParameter(mct::origami::ParameterId id) const noexcept {
    const juce::ScopedLock lock(stateLock_);
    return uiInstrumentState_.parameters[static_cast<std::size_t>(id)];
}
mct::origami::OscillatorModuleId OrigamiAudioProcessor::addUiOscillator() noexcept {
    UiEdit historyEdit(*this,"Add Oscillator");
    const juce::ScopedLock lock(stateLock_);
    if(restorePending_.load(std::memory_order_acquire)) {
        mct::origami::OscillatorModuleBank bank;bank.restore(uiInstrumentState_.oscillators,uiInstrumentState_.nextId);
        mct::origami::OscillatorModuleState module; mct::origami::applyLegacyOscillatorParameters(module,uiInstrumentState_.parameters);
        const auto id=bank.add(module);if(!id)return 0;
        uiInstrumentState_.oscillators=bank.snapshot();uiInstrumentState_.nextId=id+1;
        bumpUiModelRevision();uiOscillatorRevision_.fetch_add(1,std::memory_order_release);return id;
    }
    const auto id=engine_.addOscillatorModule();
    if(id==0) return 0;
    for(auto& module:uiInstrumentState_.oscillators) {
        if(module.id!=0) continue;
        module=engine_.oscillatorModuleState(id);
        break;
    }
    uiInstrumentState_.nextId=std::max(uiInstrumentState_.nextId,id+1u);
    bumpUiModelRevision();
    uiOscillatorRevision_.fetch_add(1,std::memory_order_release);
    return id;
}
bool OrigamiAudioProcessor::removeUiOscillator(mct::origami::OscillatorModuleId id) noexcept {
    UiEdit historyEdit(*this,"Remove Oscillator");
    const juce::ScopedLock lock(stateLock_);
    if(restorePending_.load(std::memory_order_acquire)) {
        mct::origami::OscillatorModuleBank bank;bank.restore(uiInstrumentState_.oscillators,uiInstrumentState_.nextId);
        if(!bank.remove(id))return false;
        auto candidate=uiInstrumentState_;candidate.oscillators=bank.snapshot();
        for(auto& module:candidate.oscillators)if(module.id) {
            if(module.route1SourceId==id){module.route1SourceId=0;module.route1Type=mct::origami::OscRouteType::Off;module.route1Amount=0;}
            if(module.route2SourceId==id){module.route2SourceId=0;module.route2Type=mct::origami::OscRouteType::Off;module.route2Amount=0;}
            for(auto& route:module.routes)if(route.sourceId==id){route.sourceId=0;route.type=mct::origami::OscRouteType::Off;route.amount=0;}
        }
        auto& mod=candidate.modulation;for(auto& input:mod.synthFilters.inputs)if(input.oscillator==id)input={};
        std::size_t out=0;for(const auto& route:mod.routes)if(route.id && route.destination.oscillator!=id)mod.routes[out++]=route;
        while(out<mod.routes.size())mod.routes[out++]={};mct::origami::pruneDanglingNestedRoutes(mod);
        if(!mct::origami::validInstrumentState(candidate))return false;
        uiInstrumentState_=candidate;wavetableSources_.erase(id);bumpUiModelRevision();uiOscillatorRevision_.fetch_add(1,std::memory_order_release);return true;
    }
    if(!engine_.removeOscillatorModule(id)) return false;
    wavetableSources_.erase(id); // a removed oscillator's table goes with it

    std::array<mct::origami::OscillatorModuleState,
               mct::origami::OscillatorModuleBank::capacity> compact{};
    std::size_t out=0;
    for(const auto& previous:uiInstrumentState_.oscillators) {
        if(previous.id==0 || previous.id==id) continue;
        const auto current=engine_.oscillatorModuleState(previous.id);
        if(current.id!=0) compact[out++]=current;
    }
    uiInstrumentState_.oscillators=compact;
    bumpUiModelRevision();

    auto mod=uiInstrumentState_.modulation;for(auto& in:mod.synthFilters.inputs) if(in.oscillator==id) in={};
    std::size_t routeOut=0;
    for(const auto& route:mod.routes)
        if(route.id && route.destination.oscillator!=id)
            mod.routes[routeOut++]=route;
    while(routeOut<mod.routes.size()) mod.routes[routeOut++]={};
    // Keep the audio engine and UI snapshot atomic from the caller's point of
    // view: a deleted child must stop receiving modulation immediately.
    if(!publishUiModulation(mod)) return false;
    uiInstrumentState_.modulation=mod;
    bumpUiModelRevision();
    uiOscillatorRevision_.fetch_add(1,std::memory_order_release);
    return true;
}
// ---- mct-origami-content-browser -------------------------------------------
mct::origami::dsp::Wavetable OrigamiAudioProcessor::compileWavetable(const mct::origami::content::WavetableData& data) {
    // The engine's table format: per frame, band-limited levels holding
    // harmonics 1, 2, 4 ... 512 (the renderer picks the level that cannot
    // alias at the played pitch) and a full-band level that is the source
    // frame exactly. Non-realtime: one FFT per frame, one inverse per level.
    namespace ui=mct::origami::ui;
    constexpr std::size_t n=mct::origami::content::wavetableFrameSamples;
    static_assert(n==ui::kWavetableFrameSize,"one frame size");
    mct::origami::dsp::Wavetable table;
    table.name=data.name.toStdString();
    table.tableLength=n;
    std::array<std::complex<double>,n> spectrum{},level{};
    for(int f=0;f<data.frames();++f) {
        const float* source=data.samples.data()+static_cast<std::size_t>(f)*n;
        for(std::size_t i=0;i<n;++i) spectrum[i]={static_cast<double>(source[i]),0.0};
        ui::fft(spectrum,false);
        mct::origami::dsp::WavetableFrame frame;
        for(unsigned harmonics=1;harmonics<=static_cast<unsigned>(n/2);harmonics*=2) {
            mct::origami::dsp::WavetableBand band;
            band.maximumHarmonic=harmonics;
            if(harmonics==n/2) band.samples.assign(source,source+n); // full band: the source itself
            else {
                level.fill({});
                level[0]=spectrum[0];
                for(std::size_t k=1;k<=harmonics;++k) { level[k]=spectrum[k]; level[n-k]=spectrum[n-k]; }
                ui::fft(level,true);
                band.samples.resize(n);
                for(std::size_t i=0;i<n;++i) band.samples[i]=static_cast<float>(level[i].real());
            }
            frame.bands.push_back(std::move(band));
        }
        table.frames.push_back(std::move(frame));
    }
    return table;
}
bool OrigamiAudioProcessor::setUiOscillatorWavetable(mct::origami::OscillatorModuleId id,mct::origami::content::WavetableData data,const juce::String& contentId) {
    UiEdit historyEdit(*this,"Change OscillatorWavetable");
    if(id==0 || !data.valid()) return false;
    const bool factory=contentId==mct::origami::content::ContentLibrary::basicShapesId;
    // Prepared here (message thread): validation, allocation, generation
    // stamp. The audio thread only swaps pointers at a block boundary.
    auto table=factory ? mct::origami::dsp::Wavetable::builtIns() : compileWavetable(data);
    if(!installUiOscillatorWavetable(id,std::move(table))) return false;
    const juce::ScopedLock lock(stateLock_);
    if(factory) wavetableSources_.erase(id);
    else wavetableSources_[id]={std::make_shared<const mct::origami::content::WavetableData>(std::move(data)),contentId};
    return true;
}
OrigamiAudioProcessor::UiWavetableSource OrigamiAudioProcessor::getUiOscillatorWavetable(mct::origami::OscillatorModuleId id) const {
    const juce::ScopedLock lock(stateLock_);
    const auto it=wavetableSources_.find(id);
    return it!=wavetableSources_.end() ? it->second : UiWavetableSource{};
}
OrigamiAudioProcessor::UiPresetIdentity OrigamiAudioProcessor::getUiCurrentPreset() const {
    const juce::ScopedLock lock(stateLock_);
    return currentPreset_;
}
void OrigamiAudioProcessor::setUiCurrentPreset(const juce::String& id,const juce::String& name) {
    const juce::ScopedLock lock(stateLock_);
    currentPreset_={id,name};
}
bool OrigamiAudioProcessor::loadUiPresetState(const juce::MemoryBlock& state,const juce::String& id,const juce::String& name) {
    UiEdit historyEdit(*this,"Load Preset");
    if(state.getSize()==0 || state.getSize()>static_cast<std::size_t>(std::numeric_limits<int>::max())) return false;
    if(!restoreState(state.getData(),static_cast<int>(state.getSize()))) return false;
    setUiCurrentPreset(id,name);
    return true;
}
bool OrigamiAudioProcessor::loadUiInitPreset() {
    UiEdit historyEdit(*this,"Init Preset");
    return loadUiPresetState(initState_,mct::origami::content::ContentLibrary::initPresetId,"INIT");
}
std::vector<std::uint8_t> OrigamiAudioProcessor::encodeContentTrailer(bool includeWavetables) const {
    const juce::ScopedLock lock(stateLock_);
    std::map<mct::origami::OscillatorModuleId,UiWavetableSource> live;
    if(includeWavetables) for(const auto& [id,source]:wavetableSources_) {
        bool exists=false;for(const auto& m:uiInstrumentState_.oscillators) exists|=m.id!=0 && m.id==id;
        if(exists && source.data) live.emplace(id,source);
    }
    return encodeHistoryContent(currentPreset_,live);
}
std::vector<std::uint8_t> OrigamiAudioProcessor::encodeHistoryContent(const UiPresetIdentity& preset,const std::map<mct::origami::OscillatorModuleId,UiWavetableSource>& sources) {
    std::vector<std::uint8_t> out;
    const auto word=[&out](std::uint32_t v){for(int shift=24;shift>=0;shift-=8)out.push_back(static_cast<std::uint8_t>(v>>shift));};
    const auto text=[&](const juce::String& t){const auto utf8=t.toUTF8();const auto n=std::min<std::size_t>(std::strlen(utf8.getAddress()),4096);word(static_cast<std::uint32_t>(n));out.insert(out.end(),utf8.getAddress(),utf8.getAddress()+n);};
    word(1u);text(preset.id);text(preset.name);word(static_cast<std::uint32_t>(sources.size()));
    for(const auto& [id,source]:sources) {
        word(id);text(source.contentId);text(source.data->name);word(static_cast<std::uint32_t>(source.data->frames()));
        for(float v:source.data->samples){std::uint32_t bits;std::memcpy(&bits,&v,sizeof bits);word(bits);}
    }
    return out;
}

namespace {
bool onHistoryThread() {return juce::MessageManager::existsAndIsCurrentThread();}
}
void OrigamiAudioProcessor::reconcileHistoryHostReset() const {
    if(onHistoryThread() && history_ && historyHostReset_.exchange(false,std::memory_order_acq_rel)) history_->clear();
}
void OrigamiAudioProcessor::beginUiTransaction(const char* name) {
    if(onHistoryThread()) beginUiTransaction(juce::String(name));
}
void OrigamiAudioProcessor::beginUiTransaction(const juce::String& name) {
    if(!onHistoryThread() || !history_) return;
    reconcileHistoryHostReset();history_->begin(name.toStdString());
}
void OrigamiAudioProcessor::endUiTransaction() {
    if(onHistoryThread() && history_) {
        history_->end();
        if(!history_->active() && restorePending_.load(std::memory_order_acquire)) {const juce::ScopedLock lock(stateLock_);restoreMailbox_.publish(uiInstrumentState_);}
    }
}
bool OrigamiAudioProcessor::canUndoUi() const {reconcileHistoryHostReset();return onHistoryThread() && history_ && history_->canUndo();}
bool OrigamiAudioProcessor::canRedoUi() const {reconcileHistoryHostReset();return onHistoryThread() && history_ && history_->canRedo();}
bool OrigamiAudioProcessor::undoUi() {return canUndoUi() && history_->undo();}
bool OrigamiAudioProcessor::redoUi() {return canRedoUi() && history_->redo();}
void OrigamiAudioProcessor::clearUiHistory(){if(onHistoryThread() && history_){historyHostReset_=false;history_->clear();}}
void OrigamiAudioProcessor::markUiSaved(){if(onHistoryThread() && history_)history_->markSaved();}
bool OrigamiAudioProcessor::uiAtSavedState() const {return onHistoryThread() && history_ && history_->atSaved();}
std::size_t OrigamiAudioProcessor::uiHistorySize() const {return onHistoryThread() && history_ ? history_->size() : 0;}
std::size_t OrigamiAudioProcessor::uiHistoryBytes() const {return onHistoryThread() && history_ ? history_->bytes() : 0;}
void OrigamiAudioProcessor::setUiHistoryContext(int page,unsigned bus){if(history_ && onHistoryThread())history_->context={page,bus};}
std::pair<int,unsigned> OrigamiAudioProcessor::uiHistoryContext() const {return onHistoryThread() && history_ ? std::pair<int,unsigned>{history_->context.page,history_->context.bus} : std::pair<int,unsigned>{0,1};}
bool OrigamiAudioProcessor::HistorySnapshot::same(const HistorySnapshot& other) const {
    if(state!=other.state || sources.size()!=other.sources.size())return false;
    for(const auto& [id,source]:sources){const auto it=other.sources.find(id);if(it==other.sources.end() || source.contentId!=it->second.contentId)return false;
        if(source.data!=it->second.data && (source.data->name!=it->second.data->name || source.data->samples!=it->second.data->samples))return false;}
    return true;
}
std::size_t OrigamiAudioProcessor::HistorySnapshot::cost() const {
    std::size_t bytes=sizeof(*this)+state.getSize();for(const auto& [id,source]:sources)bytes+=80+sizeof(id)+sizeof(source)+source.data->samples.size()*sizeof(float)+4u*std::size_t(source.contentId.length()+source.data->name.length()+2);return bytes;
}
OrigamiAudioProcessor::HistorySnapshot OrigamiAudioProcessor::captureHistory() {
    HistorySnapshot snapshot;writeStateInformation(snapshot.state,false);
    const juce::ScopedLock lock(stateLock_);snapshot.preset=currentPreset_;snapshot.automationRevision=macroAutomationRevision_;
    for(const auto& [id,source]:wavetableSources_) {bool live=false;for(const auto& m:uiInstrumentState_.oscillators)live|=m.id==id && id!=0;if(live && source.data)snapshot.sources.emplace(id,source);}
    return snapshot;
}
bool OrigamiAudioProcessor::restoreHistory(const HistorySnapshot& snapshot) {
    // Reconstitute the ordinary CNT1 trailer only at replay. Stored PCM is shared,
    // never recopied at each intermediate gesture value. Use the canonical decoder.
    const auto* bytes=static_cast<const std::uint8_t*>(snapshot.state.getData());const auto size=snapshot.state.getSize();if(size<16)return false;
    std::uint32_t oldLength=0;for(std::size_t i=size-16;i<size-12;++i)oldLength=(oldLength<<8)|bytes[i];
    if(oldLength>size-16)return false;
    juce::MemoryBlock state(bytes,size-16-oldLength);const auto content=encodeHistoryContent(snapshot.preset,snapshot.sources);state.append(content.data(),content.size());
    const auto word=[&state](std::uint32_t v){std::uint8_t b[4];for(int i=0;i<4;++i)b[i]=std::uint8_t(v>>(24-8*i));state.append(b,4);};
    word(static_cast<std::uint32_t>(content.size()));word(contentMagic);state.append(bytes+size-8,8);
    // Host automation is not a user edit. Preserve bases automated since this
    // snapshot; a later explicit UI macro edit still has ordinary undo semantics.
    std::array<float,mct::origami::maxMacros> automated{};
    std::array<bool,mct::origami::maxMacros> preserve{};
    {const juce::ScopedLock lock(stateLock_);for(std::size_t i=0;i<preserve.size();++i){preserve[i]=macroAutomationRevision_[i]!=snapshot.automationRevision[i];automated[i]=uiInstrumentState_.modulation.macros[i];}}
    if(!restoreState(state.getData(),static_cast<int>(state.getSize())))return false;
    if(std::any_of(preserve.begin(),preserve.end(),[](bool b){return b;})) {
        auto mod=getUiInstrumentState().modulation;
        for(std::size_t i=0;i<preserve.size();++i)if(preserve[i])mod.macros[i]=automated[i];
        return setUiModulationState(mod);
    }
    return true;
}

bool OrigamiAudioProcessor::installUiOscillatorWavetable(
    mct::origami::OscillatorModuleId id,mct::origami::dsp::Wavetable table) {
    if(id==0) return false;
    // Serialized with the other UI-side module edits (never with processBlock).
    const juce::ScopedLock lock(stateLock_);
    // Publish a complete table generation without ever blocking processBlock:
    // validated (one full scan) and stamped here, adopted by the audio thread
    // at the next host-block boundary.
    if(restorePending_.load(std::memory_order_acquire)) {if(!engine_.publishWavetableForPendingOscillator(id,std::move(table)))return false;}
    else if(!engine_.publishWavetableForOscillator(id,std::move(table))) return false;
    // The oscillator viewport must re-read the committed table; rejected
    // tables above return before advancing the oscillator revision.
    uiOscillatorRevision_.fetch_add(1,std::memory_order_release);
    return true;
}

bool OrigamiAudioProcessor::setUiOscillatorState(mct::origami::OscillatorModuleId id,const mct::origami::OscillatorModuleState& state) noexcept {
    UiEdit historyEdit(*this,"Change OscillatorState");
    const juce::ScopedLock lock(stateLock_);
    // Output sends must target existing buses with no duplicates.
    if(!mct::origami::validOscBusRoutes(state,uiInstrumentState_.buses)) return false;

    // A child can itself be a modulation destination. Prune routes against the
    // requested child set BEFORE asking the engine to remove that child;
    // otherwise whole-state validation correctly rejects the temporarily
    // dangling destination and the UI appears unable to delete the row.
    auto childExists=[&](const mct::origami::ModRoute& route) noexcept {
        if(route.destination.oscillator!=id) return true;
        if(route.destination.parameter==mct::origami::ModDestination::ProcessAmount) {
            for(std::size_t i=0;i<state.processCount;++i)
                if(state.processes[i].id==route.destination.itemId) return true;
            return false;
        }
        if(route.destination.parameter==mct::origami::ModDestination::RouteAmount) {
            for(std::size_t i=0;i<state.routeCount;++i)
                if(state.routes[i].id==route.destination.itemId) return true;
            return false;
        }
        return true;
    };

    const auto previousMod=uiInstrumentState_.modulation;
    auto prunedMod=previousMod;
    std::size_t routeOut=0;
    std::size_t previousRouteCount=0;
    for(const auto& route:previousMod.routes) {
        if(!route.id) continue;
        ++previousRouteCount;
        if(childExists(route))
            prunedMod.routes[routeOut++]=route;
    }
    const bool modulationChanged=routeOut!=previousRouteCount;
    while(routeOut<prunedMod.routes.size()) prunedMod.routes[routeOut++]={};
    if(restorePending_.load(std::memory_order_acquire)) {
        auto candidate=uiInstrumentState_;candidate.modulation=prunedMod;bool found=false;
        for(auto& module:candidate.oscillators)if(module.id==id) {
            auto canonical=state;canonical.id=id;canonical.enabled=module.enabled;
            if(id==1)mct::origami::applyLegacyOscillatorParameters(canonical,candidate.parameters);
            else {if(canonical.wtPosition==module.wtPosition && canonical.waveform!=module.waveform)canonical.wtPosition=canonical.waveform/3.f;canonical.waveform=canonical.wtPosition*3.f;}
            module=canonical;found=true;
        }
        if(!found || !mct::origami::validInstrumentState(candidate))return false;
        uiInstrumentState_=candidate;bumpUiModelRevision();uiOscillatorRevision_.fetch_add(1,std::memory_order_release);return true;
    }
    if(modulationChanged && !publishUiModulation(prunedMod)) return false;
    if(!engine_.setOscillatorModuleState(id,state)) {
        if(modulationChanged) publishUiModulation(previousMod);
        return false;
    }

    const auto canonical=engine_.oscillatorModuleState(id);
    for(auto& module:uiInstrumentState_.oscillators) {
        if(module.id!=id) continue;
        module=canonical;
        uiInstrumentState_.modulation=prunedMod;
        bumpUiModelRevision();
        uiOscillatorRevision_.fetch_add(1,std::memory_order_release);
        return true;
    }

    // Keep engine/UI snapshots coherent even if an unexpected stale module ID
    // reaches this boundary.
    if(modulationChanged) publishUiModulation(previousMod);
    return false;
}
mct::origami::OscillatorModuleState OrigamiAudioProcessor::getUiOscillatorState(mct::origami::OscillatorModuleId id) const noexcept {
    const juce::ScopedLock lock(stateLock_);
    for(const auto& module:uiInstrumentState_.oscillators)
        if(module.id==id) return module;
    return {};
}
bool OrigamiAudioProcessor::setUiOscillatorEnabled(mct::origami::OscillatorModuleId id,bool enabled) noexcept {
    UiEdit historyEdit(*this,"Change OscillatorEnabled");
    const juce::ScopedLock lock(stateLock_);
    if(!restorePending_.load(std::memory_order_acquire) && !engine_.setOscillatorModuleEnabled(id,enabled)) return false;
    for(auto& module:uiInstrumentState_.oscillators)
        if(module.id==id) {
            module.enabled=enabled;
            bumpUiModelRevision();
            uiOscillatorRevision_.fetch_add(1,std::memory_order_release);
            return true;
        }
    return false;
}
bool OrigamiAudioProcessor::getUiOscillatorEnabled(mct::origami::OscillatorModuleId id) const noexcept {
    const juce::ScopedLock lock(stateLock_);
    for(const auto& module:uiInstrumentState_.oscillators)
        if(module.id==id) return module.enabled;
    return false;
}

void OrigamiAudioProcessor::setUiPitchWheel(float normalized) noexcept {
    normalized=juce::jlimit(-1.0f,1.0f,normalized);
    const int value=normalized>=0 ? 8192+juce::roundToInt(normalized*8191.0f) : 8192+juce::roundToInt(normalized*8192.0f);
    pendingUiPitch_.store(juce::jlimit(0,16383,value),std::memory_order_release);
}
void OrigamiAudioProcessor::setUiModWheel(float normalized) noexcept {
    pendingUiMod_.store(juce::jlimit(0,127,juce::roundToInt(juce::jlimit(0.0f,1.0f,normalized)*127.0f)),std::memory_order_release);
}
bool OrigamiAudioProcessor::setUiPitchBendRange(float semitones) noexcept {
    UiEdit historyEdit(*this,"Change PitchBendRange");
    // Symmetric wheel: signed endpoints +N / -N.
    return setUiPitchBendRanges(semitones,-semitones);
}
bool OrigamiAudioProcessor::setUiPitchBendRanges(float upSemitones,float downSemitones) noexcept {
    UiEdit historyEdit(*this,"Change PitchBendRanges");
    const juce::ScopedLock lock(stateLock_);
    if(!engine_.setPitchBendRanges(upSemitones,downSemitones)) return false;
    uiInstrumentState_.performance.pitchBendRangeSemitones=upSemitones;
    bumpUiModelRevision();
    uiInstrumentState_.performance.pitchBendDownSemitones=downSemitones;
    bumpUiModelRevision();
    uiPerformanceState_.pitchBendRangeSemitones=upSemitones;
    uiPerformanceState_.pitchBendDownSemitones=downSemitones;
    return true;
}
float OrigamiAudioProcessor::getUiPitchBendRange() const noexcept {
    const juce::ScopedLock lock(stateLock_);
    return uiInstrumentState_.performance.pitchBendRangeSemitones;
}
float OrigamiAudioProcessor::getUiPitchBendDownRange() const noexcept {
    const juce::ScopedLock lock(stateLock_);
    return uiInstrumentState_.performance.pitchBendDownSemitones;
}
bool OrigamiAudioProcessor::setUiPerformanceState(const mct::origami::PerformanceState& state) noexcept {
    UiEdit historyEdit(*this,"Change PerformanceState");
    const juce::ScopedLock lock(stateLock_);
    uiPerformanceState_=state;
    uiInstrumentState_.performance=state;
    bumpUiModelRevision();
    performanceMailbox_.publish(uiPerformanceState_);
    return true;
}
mct::origami::PerformanceState OrigamiAudioProcessor::getUiPerformanceState() const noexcept {
    const juce::ScopedLock lock(stateLock_);
    return uiPerformanceState_;
}
bool OrigamiAudioProcessor::setUiArpeggiatorState(const mct::origami::ArpeggiatorState& requested) noexcept {
    UiEdit historyEdit(*this,"Change ArpeggiatorState");
    auto state=requested;
    state.rateIndex=juce::jlimit(0,6,state.rateIndex);state.octaveSpan=juce::jlimit(1,4,state.octaveSpan);
    state.gate=juce::jlimit(0.05f,1.0f,state.gate);state.swing=juce::jlimit(0.0f,0.75f,state.swing);
    state.probability=juce::jlimit(0.01f,1.0f,state.probability);
    state.velocityScale=juce::jlimit(0.25f,1.5f,state.velocityScale);
    state.transposeSemitones=juce::jlimit(-24,24,state.transposeSemitones);
    state.internalTempo=juce::jlimit(20.0,400.0,state.internalTempo);
    const juce::ScopedLock lock(stateLock_);
    uiArpState_=state;
    arpMailbox_.publish(uiArpState_);
    return true;
}
mct::origami::ArpeggiatorState OrigamiAudioProcessor::getUiArpeggiatorState() const noexcept {
    const juce::ScopedLock lock(stateLock_);
    return uiArpState_;
}
mct::origami::ArpeggiatorRuntimeSnapshot OrigamiAudioProcessor::getUiArpeggiatorRuntimeSnapshot() const noexcept {
    mct::origami::ArpeggiatorRuntimeSnapshot snapshot;
    snapshot.activeNote=arpUiActiveNote_.load(std::memory_order_acquire);
    snapshot.heldLow=arpUiHeldLow_.load(std::memory_order_acquire);
    snapshot.heldHigh=arpUiHeldHigh_.load(std::memory_order_acquire);
    return snapshot;
}
mct::origami::EnvelopeTraceSnapshot OrigamiAudioProcessor::getUiEnvelopeTraceSnapshot() const noexcept {
    mct::origami::EnvelopeTraceSnapshot s;
    s.active=envUiActive_.load(std::memory_order_acquire);
    if(!s.active) return s;
    s.order=envUiOrder_.load(std::memory_order_relaxed);
    for(std::size_t i=0;i<3;++i){
        s.envelopes[i].stage=static_cast<mct::origami::dsp::Envelope::Stage>(envUiStage_[i].load(std::memory_order_relaxed));
        s.envelopes[i].progress=envUiProgress_[i].load(std::memory_order_relaxed);
        s.envelopes[i].value=envUiValue_[i].load(std::memory_order_relaxed);
    }
    return s;
}

mct::origami::PerformanceInputSnapshot OrigamiAudioProcessor::getUiPerformanceInputSnapshot() const noexcept {
    mct::origami::PerformanceInputSnapshot snapshot;
    snapshot.heldLow=performanceUiHeldLow_.load(std::memory_order_acquire);
    snapshot.heldHigh=performanceUiHeldHigh_.load(std::memory_order_acquire);
    for(std::size_t i=0;i<snapshot.velocity.size();++i)
        snapshot.velocity[i]=performanceUiVelocity_[i].load(std::memory_order_relaxed);
    return snapshot;
}

mct::origami::RenderBudgetSnapshot OrigamiAudioProcessor::getUiRenderBudgetSnapshot() const noexcept {
    mct::origami::RenderBudgetSnapshot snapshot{};
    snapshot.load.activeVoices=qosVoices_.load(std::memory_order_relaxed);
    snapshot.load.activeModules=qosModules_.load(std::memory_order_relaxed);
    snapshot.load.totalUnison=qosUnison_.load(std::memory_order_relaxed);
    snapshot.load.oscillatorEvaluationsPerSample=qosOscEvals_.load(std::memory_order_relaxed);
    snapshot.callbackDeadlineFraction=qosInstant_.load(std::memory_order_relaxed);
    snapshot.smoothedDeadlineFraction=qosSmoothed_.load(std::memory_order_relaxed);
    snapshot.peakDeadlineFraction=qosPeak_.load(std::memory_order_relaxed);
    snapshot.headroomFraction=juce::jlimit(0.0f,1.0f,1.0f-snapshot.smoothedDeadlineFraction);
    snapshot.deadlineMisses=qosDeadlineMisses_.load(std::memory_order_acquire);
    snapshot.voiceAdmissionCeiling=qosVoiceCeiling_.load(std::memory_order_relaxed);

    const auto rawLevel=qosLevel_.load(std::memory_order_relaxed);
    snapshot.level=rawLevel>=static_cast<std::uint32_t>(mct::origami::RenderQoSLevel::Critical)
        ? mct::origami::RenderQoSLevel::Critical
        : static_cast<mct::origami::RenderQoSLevel>(rawLevel);
    const auto flags=qosFlags_.load(std::memory_order_relaxed);
    snapshot.suppressVisualTelemetry=(flags&(1u<<0))!=0;
    snapshot.reduceControlRate=(flags&(1u<<1))!=0;
    snapshot.reduceOptionalEffectQuality=(flags&(1u<<2))!=0;
    snapshot.restrictNewHighCostVoices=(flags&(1u<<3))!=0;
    snapshot.bypassNewestOptionalEffect=(flags&(1u<<4))!=0;
    snapshot.voiceAdmissionActive=snapshot.restrictNewHighCostVoices
        && snapshot.voiceAdmissionCeiling<mct::origami::GlobalRenderBudget::maximumSynthVoices;
    return snapshot;
}

void OrigamiAudioProcessor::clearUiArpeggiatorLatch() noexcept {
    // Coalescing command: multiple clears before the next callback equal one.
    pendingClearArpLatch_.store(true,std::memory_order_release);
}

juce::AudioProcessorEditor* OrigamiAudioProcessor::createEditor() { return new OrigamiAudioProcessorEditor(*this); }
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new OrigamiAudioProcessor(); }

bool OrigamiAudioProcessor::publishUiModulation(const mct::origami::ModulationState& modulation) noexcept {
    if(!restorePending_.load(std::memory_order_acquire))return engine_.setModulationState(modulation);
    auto candidate=uiInstrumentState_;candidate.modulation=modulation;
    return mct::origami::validInstrumentState(candidate) && engine_.prepareSynthFilterStorage(modulation.synthFilters);
}
