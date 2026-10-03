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
// mct-origami-audio-reengineer-p04-ui-telemetry-decimation
// mct-origami-audio-reengineer-p03-midi-preallocation
#include "PluginEditor.h"
#include <array>
#include <algorithm>
#include <cmath>
#include <limits>
#include <optional>
#include "core/preset/StateCodec.h"
OrigamiAudioProcessor::OrigamiAudioProcessor()
    : AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)) {
    // Preserve the established four-module initial layout in the model, once.
    for(int i=0;i<3;++i) engine_.addOscillatorModule();
    // Pre-audio-thread: establish the canonical host/UI model exactly once.
    uiInstrumentState_=engine_.instrumentState();
    uiPerformanceState_=uiInstrumentState_.performance;
    uiArpState_=arpState_;
    // Every committed FX graph change recompiles (topology) or republishes
    // parameters. The audio thread only ever sees prepared plans.
    fxWorkspace_.onChanged=[this]{syncFxRenderer();};
    syncFxRenderer();
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
    }
    engine_.setMasterAfterFx(fxWorkspace_.globals().order==mct::origami::fx::FxOrder::PreMaster);
    pruneFxModulationRoutes();
}
mct::origami::BusId OrigamiAudioProcessor::addUiBus() noexcept {
    mct::origami::BusId id=0;
    {
        const juce::ScopedLock lock(stateLock_);
        auto buses=uiInstrumentState_.buses;
        id=mct::origami::addBus(buses);
        if(id==0 || !engine_.setBusState(buses)) return 0;
        uiInstrumentState_.buses=buses;
        uiOscillatorRevision_.fetch_add(1,std::memory_order_release);
    }
    fxWorkspace_.document(id); // creates "<BUS> IN -> <BUS> OUT" and resyncs
    syncFxRenderer();
    return id;
}
bool OrigamiAudioProcessor::removeUiBus(mct::origami::BusId id) noexcept {
    if(id==mct::origami::mainBusId) return false;
    {
        const juce::ScopedLock lock(stateLock_);
        auto next=uiInstrumentState_;
        if(!mct::origami::removeBus(next,id)) return false;
        // Retarget oscillator sends first (the bus still exists), then drop it.
        for(const auto& module:next.oscillators)
            if(module.id && !engine_.setOscillatorModuleState(module.id,module)) return false;
        if(!engine_.setBusState(next.buses)) return false;
        for(auto& module:uiInstrumentState_.oscillators)
            if(module.id) module=engine_.oscillatorModuleState(module.id);
        uiInstrumentState_.buses=next.buses;
        uiOscillatorRevision_.fetch_add(1,std::memory_order_release);
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
    if(engine_.setModulationState(mod)) uiInstrumentState_.modulation=mod;
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

    // Wavetable editor commits cross into DSP only at a callback boundary.
    // Moving the consumed generation here transfers vector ownership without
    // a JUCE callback lock and never mutates a table while voices render it.
    PendingOscillatorWavetable pendingWavetable;
    if(wavetableMailbox_.consume(pendingWavetable) && pendingWavetable.id!=0)
        engine_.installWavetableForOscillator(
            pendingWavetable.id,std::move(pendingWavetable.table));
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
    mct::origami::InstrumentState pendingRestore;
    if(restoreMailbox_.consume(pendingRestore)) {
        engine_.restoreInstrumentState(pendingRestore);
        // A full instrument generation replaces note/runtime ownership.
        resetArpeggiatorRuntime(false);
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
    if(auto* playHead=getPlayHead()) {
        if(const auto position=playHead->getPosition()) {
            if(const auto bpm=position->getBpm(); bpm && std::isfinite(*bpm))
                hostBpm=static_cast<float>(juce::jlimit(20.0,400.0,*bpm));
        }
    }
    cachedHostBpm_.store(hostBpm,std::memory_order_release);

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

void OrigamiAudioProcessor::getStateInformation(juce::MemoryBlock& dest) {
    // Deep Audit P03: autosave serializes the canonical non-RT model. It never
    // suspends the processor and never interrogates mutable renderer internals.
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
    appendWord(visualMagic);
    appendWord(visualizationMask_.load(std::memory_order_acquire));
    dest.replaceAll(bytes.data(),bytes.size());
}
void OrigamiAudioProcessor::setStateInformation(const void* data, int size) {
    if(size<=0) return;

    int instrumentSize=size;
    if(size>=8) {
        const auto* bytes=static_cast<const std::uint8_t*>(data);
        const auto readWord=[bytes](int offset) {
            std::uint32_t value=0;
            for(int i=0;i<4;++i) value=(value<<8)|bytes[offset+i];
            return value;
        };
        if(readWord(size-8)==0x56495331u) {
            visualizationMask_.store(
                readWord(size-4)&mct::origami::ui::validVisualizationMask,
                std::memory_order_release);
            instrumentSize-=8;
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
            if(length<0 || length>instrumentSize-8) return;
            const int start=instrumentSize-8-length;
            if(tag==fxWorkspaceMagic) {
                workspaceBytes.assign(bytes+start,bytes+start+length);
            } else {
                mct::origami::fx::FxGraph graph;
                if(!mct::origami::fx::decodeFxGraph(bytes+start,static_cast<std::size_t>(length),graph)) return;
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
            if(length<0 || length>instrumentSize-8) return;
            const int start=instrumentSize-8-length;
            mct::origami::nodes::ControlLayout decoded;
            if(!decoded.decode(bytes+start,static_cast<std::size_t>(length))) return;
            controlLayout=std::move(decoded);
            instrumentSize=start;
        }
    }

    // Decode + validate completely before publication. The renderer receives one
    // complete fixed-size generation at the next callback boundary.
    mct::origami::InstrumentState state;
    if(!mct::origami::decodeInstrumentState(
            data,static_cast<std::size_t>(instrumentSize),state)) return;
    if(!workspaceBytes.empty()) {
        mct::origami::fx::FxWorkspace probe; // validate before touching anything
        if(!probe.decode(workspaceBytes.data(),workspaceBytes.size())) return;
    }

    {
    const juce::ScopedLock lock(stateLock_);
    uiInstrumentState_=state;
    uiOscillatorRevision_.fetch_add(1,std::memory_order_release);
    uiPerformanceState_=state.performance;
    restoreMailbox_.publish(uiInstrumentState_);
    // Keep the independent performance mailbox generation coherent with the
    // complete restore. Any subsequent UI performance edit overwrites this.
    performanceMailbox_.publish(uiPerformanceState_);
    }
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
    syncFxRenderer();
}

std::uint32_t OrigamiAudioProcessor::getUiVisualizationMask() const noexcept {
    return visualizationMask_.load(std::memory_order_acquire);
}
void OrigamiAudioProcessor::setUiVisualizationMask(std::uint32_t mask) noexcept {
    visualizationMask_.store(mask&mct::origami::ui::validVisualizationMask,
                             std::memory_order_release);
}
mct::origami::RuntimeVisualizationSnapshot
OrigamiAudioProcessor::getUiRuntimeVisualizationSnapshot() noexcept {
    visualizationMailbox_.consume(uiVisualizationSnapshot_);
    return uiVisualizationSnapshot_;
}
bool OrigamiAudioProcessor::setUiMacro(unsigned index,float value) noexcept {
    const juce::ScopedLock lock(stateLock_);
    if(index>=4) return false;
    auto mod=uiInstrumentState_.modulation;mod.macros[index]=value;
    if(!engine_.setModulationState(mod)) return false;
    uiInstrumentState_.modulation=mod;
    return true;
}
bool OrigamiAudioProcessor::setUiLfo(const mct::origami::LfoSettings& settings) noexcept {
    const juce::ScopedLock lock(stateLock_);
    auto mod=uiInstrumentState_.modulation;mod.lfo1=settings;
    if(!engine_.setModulationState(mod)) return false;
    uiInstrumentState_.modulation=mod;
    return true;
}
bool OrigamiAudioProcessor::setUiModulationState(const mct::origami::ModulationState& state) noexcept {
    const juce::ScopedLock lock(stateLock_);
    if(!engine_.setModulationState(state)) return false;
    uiInstrumentState_.modulation=state;
    return true;
}
unsigned OrigamiAudioProcessor::addUiRoute() noexcept {
    const juce::ScopedLock lock(stateLock_);
    auto mod=uiInstrumentState_.modulation;
    if(mod.nextRouteId==std::numeric_limits<unsigned>::max()) return 0;
    for(auto& route:mod.routes) if(!route.id) {
        // ON / UNIPOLAR / no source / no destination / 0%: inert until both
        // ends are chosen (mct-origami-nodes-n01).
        route=mct::origami::ModRoute{};
        route.id=mod.nextRouteId++;
        if(!engine_.setModulationState(mod)) return 0;
        uiInstrumentState_.modulation=mod;
        return route.id;
    }
    return 0;
}
bool OrigamiAudioProcessor::setUiRoute(const mct::origami::ModRoute& edited) noexcept {
    const juce::ScopedLock lock(stateLock_);
    if(!edited.id) return false;
    auto mod=uiInstrumentState_.modulation;
    for(auto& route:mod.routes) if(route.id==edited.id) {
        route=edited;
        if(!engine_.setModulationState(mod)) return false;
        uiInstrumentState_.modulation=mod;
        return true;
    }
    return false;
}
bool OrigamiAudioProcessor::removeUiRoute(unsigned id) noexcept {
    const juce::ScopedLock lock(stateLock_);
    auto mod=uiInstrumentState_.modulation;std::size_t out=0;bool found=false;
    for(const auto& route:mod.routes) if(route.id) {
        if(route.id==id) found=true;else mod.routes[out++]=route;
    }
    if(!found) return false;
    while(out<mod.routes.size()) mod.routes[out++]={};
    if(!engine_.setModulationState(mod)) return false;
    uiInstrumentState_.modulation=mod;
    return true;
}
mct::origami::InstrumentState OrigamiAudioProcessor::getUiInstrumentState() const noexcept {
    const juce::ScopedLock lock(stateLock_);
    return uiInstrumentState_;
}
// mct-origami-functional-osc-controls-v15
bool OrigamiAudioProcessor::setUiParameter(mct::origami::ParameterId id,float value) noexcept {
    const juce::ScopedLock lock(stateLock_);
    if(!engine_.setParameter(id,value)) return false;
    uiInstrumentState_.parameters=engine_.parameterState();
    mct::origami::applyLegacyOscillatorParameters(
        uiInstrumentState_.oscillators[0],uiInstrumentState_.parameters);
    uiOscillatorRevision_.fetch_add(1,std::memory_order_release);
    return true;
}
float OrigamiAudioProcessor::getUiParameter(mct::origami::ParameterId id) const noexcept {
    const juce::ScopedLock lock(stateLock_);
    return uiInstrumentState_.parameters[static_cast<std::size_t>(id)];
}
mct::origami::OscillatorModuleId OrigamiAudioProcessor::addUiOscillator() noexcept {
    const juce::ScopedLock lock(stateLock_);
    const auto id=engine_.addOscillatorModule();
    if(id==0) return 0;
    for(auto& module:uiInstrumentState_.oscillators) {
        if(module.id!=0) continue;
        module=engine_.oscillatorModuleState(id);
        break;
    }
    uiInstrumentState_.nextId=std::max(uiInstrumentState_.nextId,id+1u);
    uiOscillatorRevision_.fetch_add(1,std::memory_order_release);
    return id;
}
bool OrigamiAudioProcessor::removeUiOscillator(mct::origami::OscillatorModuleId id) noexcept {
    const juce::ScopedLock lock(stateLock_);
    if(!engine_.removeOscillatorModule(id)) return false;

    std::array<mct::origami::OscillatorModuleState,
               mct::origami::OscillatorModuleBank::capacity> compact{};
    std::size_t out=0;
    for(const auto& previous:uiInstrumentState_.oscillators) {
        if(previous.id==0 || previous.id==id) continue;
        const auto current=engine_.oscillatorModuleState(previous.id);
        if(current.id!=0) compact[out++]=current;
    }
    uiInstrumentState_.oscillators=compact;

    auto mod=uiInstrumentState_.modulation;
    std::size_t routeOut=0;
    for(const auto& route:mod.routes)
        if(route.id && route.destination.oscillator!=id)
            mod.routes[routeOut++]=route;
    while(routeOut<mod.routes.size()) mod.routes[routeOut++]={};
    // Keep the audio engine and UI snapshot atomic from the caller's point of
    // view: a deleted child must stop receiving modulation immediately.
    if(!engine_.setModulationState(mod)) return false;
    uiInstrumentState_.modulation=mod;
    uiOscillatorRevision_.fetch_add(1,std::memory_order_release);
    return true;
}
bool OrigamiAudioProcessor::installUiOscillatorWavetable(
    mct::origami::OscillatorModuleId id,mct::origami::dsp::Wavetable table) {
    if(id==0 || !table.valid()) return false;
    // Publish a complete table generation without ever blocking processBlock.
    // The audio thread consumes it at the next host-block boundary.
    PendingOscillatorWavetable pending;
    pending.id=id;
    pending.table=std::move(table);
    wavetableMailbox_.publish(pending);
    // The oscillator viewport must re-read the committed table; rejected
    // tables above return before advancing the oscillator revision.
    uiOscillatorRevision_.fetch_add(1,std::memory_order_release);
    return true;
}

bool OrigamiAudioProcessor::setUiOscillatorState(mct::origami::OscillatorModuleId id,const mct::origami::OscillatorModuleState& state) noexcept {
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
    if(modulationChanged && !engine_.setModulationState(prunedMod)) return false;
    if(!engine_.setOscillatorModuleState(id,state)) {
        if(modulationChanged) engine_.setModulationState(previousMod);
        return false;
    }

    const auto canonical=engine_.oscillatorModuleState(id);
    for(auto& module:uiInstrumentState_.oscillators) {
        if(module.id!=id) continue;
        module=canonical;
        uiInstrumentState_.modulation=prunedMod;
        uiOscillatorRevision_.fetch_add(1,std::memory_order_release);
        return true;
    }

    // Keep engine/UI snapshots coherent even if an unexpected stale module ID
    // reaches this boundary.
    if(modulationChanged) engine_.setModulationState(previousMod);
    return false;
}
mct::origami::OscillatorModuleState OrigamiAudioProcessor::getUiOscillatorState(mct::origami::OscillatorModuleId id) const noexcept {
    const juce::ScopedLock lock(stateLock_);
    for(const auto& module:uiInstrumentState_.oscillators)
        if(module.id==id) return module;
    return {};
}
bool OrigamiAudioProcessor::setUiOscillatorEnabled(mct::origami::OscillatorModuleId id,bool enabled) noexcept {
    const juce::ScopedLock lock(stateLock_);
    if(!engine_.setOscillatorModuleEnabled(id,enabled)) return false;
    for(auto& module:uiInstrumentState_.oscillators)
        if(module.id==id) {
            module.enabled=enabled;
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
    return setUiPitchBendRanges(semitones,semitones);
}
bool OrigamiAudioProcessor::setUiPitchBendRanges(float upSemitones,float downSemitones) noexcept {
    const juce::ScopedLock lock(stateLock_);
    if(!engine_.setPitchBendRanges(upSemitones,downSemitones)) return false;
    uiInstrumentState_.performance.pitchBendRangeSemitones=upSemitones;
    uiInstrumentState_.performance.pitchBendDownSemitones=downSemitones;
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
    const juce::ScopedLock lock(stateLock_);
    uiPerformanceState_=state;
    uiInstrumentState_.performance=state;
    performanceMailbox_.publish(uiPerformanceState_);
    return true;
}
mct::origami::PerformanceState OrigamiAudioProcessor::getUiPerformanceState() const noexcept {
    const juce::ScopedLock lock(stateLock_);
    return uiPerformanceState_;
}
bool OrigamiAudioProcessor::setUiArpeggiatorState(const mct::origami::ArpeggiatorState& requested) noexcept {
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
