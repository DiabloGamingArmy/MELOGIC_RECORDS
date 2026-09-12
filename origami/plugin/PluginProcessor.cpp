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
#include "core/preset/StateCodec.h"
OrigamiAudioProcessor::OrigamiAudioProcessor()
    : AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)) {
    // Preserve the established four-module initial layout in the model, once.
    for(int i=0;i<3;++i) engine_.addOscillatorModule();
    // Pre-audio-thread: establish the canonical host/UI model exactly once.
    uiInstrumentState_=engine_.instrumentState();
    uiPerformanceState_=uiInstrumentState_.performance;
    uiArpState_=arpState_;
}
void OrigamiAudioProcessor::prepareToPlay(double sampleRate, int samplesPerBlock) {
    sampleRate_=sampleRate>1.0?sampleRate:44100.0;
    envUiSamplesUntilPublish_=0;
    highResolutionTicksPerSecond_=static_cast<double>(juce::Time::getHighResolutionTicksPerSecond());
    if(!(highResolutionTicksPerSecond_>0.0)) highResolutionTicksPerSecond_=1.0;
    renderBudget_.reset();
    prepared_ = engine_.prepare(sampleRate_, static_cast<std::size_t>(juce::jmax(1, samplesPerBlock)), 2u);
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
    std::array<float*, 2> channels { buffer.getWritePointer(0, start), buffer.getWritePointer(1, start) };
    if (!prepared_ || !engine_.processSpan(channels.data(), 2u, static_cast<std::size_t>(count)))
        buffer.clear(start, count);
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
            const double swing=juce::jlimit(0.0,0.75,static_cast<double>(arpState_.swing));
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
    const auto callbackStartTicks=juce::Time::getHighResolutionTicks();
    juce::ScopedNoDenormals noDenormals;
    jassert(buffer.getNumChannels() >= 2);
    const int total = buffer.getNumSamples();

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
    if(!prepared_ || !engine_.beginHostBlock(2u)) {
        buffer.clear();
        serviceVisualTelemetry(total);
        finalizeRenderBudget(callbackStartTicks,total);
        return;
    }

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

    serviceVisualTelemetry(total);
    finalizeRenderBudget(callbackStartTicks,total);
}
void OrigamiAudioProcessor::getStateInformation(juce::MemoryBlock& dest) {
    // Deep Audit P03: autosave serializes the canonical non-RT model. It never
    // suspends the processor and never interrogates mutable renderer internals.
    mct::origami::InstrumentState snapshot;
    {
        const juce::ScopedLock lock(stateLock_);
        snapshot=uiInstrumentState_;
    }
    const auto bytes=mct::origami::encodeInstrumentState(snapshot);
    dest.replaceAll(bytes.data(),bytes.size());
}
void OrigamiAudioProcessor::setStateInformation(const void* data, int size) {
    if(size<=0) return;

    // Decode + validate completely before publication. The renderer receives one
    // complete fixed-size generation at the next callback boundary.
    mct::origami::InstrumentState state;
    if(!mct::origami::decodeInstrumentState(
            data,static_cast<std::size_t>(size),state)) return;

    const juce::ScopedLock lock(stateLock_);
    uiInstrumentState_=state;
    uiPerformanceState_=state.performance;
    restoreMailbox_.publish(uiInstrumentState_);
    // Keep the independent performance mailbox generation coherent with the
    // complete restore. Any subsequent UI performance edit overwrites this.
    performanceMailbox_.publish(uiPerformanceState_);
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
        route.id=mod.nextRouteId++;route.amount=.35f;
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
    uiInstrumentState_.modulation=mod;
    return true;
}
bool OrigamiAudioProcessor::setUiOscillatorState(mct::origami::OscillatorModuleId id,const mct::origami::OscillatorModuleState& state) noexcept {
    const juce::ScopedLock lock(stateLock_);
    if(!engine_.setOscillatorModuleState(id,state)) return false;
    const auto canonical=engine_.oscillatorModuleState(id);
    for(auto& module:uiInstrumentState_.oscillators)
        if(module.id==id) { module=canonical; return true; }
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
        if(module.id==id) { module.enabled=enabled; return true; }
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
    const juce::ScopedLock lock(stateLock_);
    if(!engine_.setPitchBendRange(semitones)) return false;
    uiInstrumentState_.performance.pitchBendRangeSemitones=semitones;
    uiPerformanceState_.pitchBendRangeSemitones=semitones;
    return true;
}
float OrigamiAudioProcessor::getUiPitchBendRange() const noexcept {
    const juce::ScopedLock lock(stateLock_);
    return uiInstrumentState_.performance.pitchBendRangeSemitones;
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
    return snapshot;
}

void OrigamiAudioProcessor::clearUiArpeggiatorLatch() noexcept {
    // Coalescing command: multiple clears before the next callback equal one.
    pendingClearArpLatch_.store(true,std::memory_order_release);
}

juce::AudioProcessorEditor* OrigamiAudioProcessor::createEditor() { return new OrigamiAudioProcessorEditor(*this); }
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new OrigamiAudioProcessor(); }
