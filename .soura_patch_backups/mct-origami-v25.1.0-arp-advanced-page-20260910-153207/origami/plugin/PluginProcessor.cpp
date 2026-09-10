// mct-origami-v25.0.0-arp-internal-clock
// mct-origami-modulation-completion-v24.0.1
// mct-origami-glide-mono-legato-v23.4.3
// mct-origami-pitch-mod-real-v23.3
// mct-origami-playable-keyboard-audio-v23.1
#include "PluginProcessor.h"
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
}
void OrigamiAudioProcessor::prepareToPlay(double sampleRate, int samplesPerBlock) {
    sampleRate_=sampleRate>1.0?sampleRate:44100.0;
    prepared_ = engine_.prepare(sampleRate_, static_cast<std::size_t>(juce::jmax(1, samplesPerBlock)), 2u);
    resetArpeggiatorRuntime(false);
}
bool OrigamiAudioProcessor::isBusesLayoutSupported(const BusesLayout& layouts) const {
    return layouts.getMainInputChannelSet().isDisabled()
        && layouts.getMainOutputChannelSet() == juce::AudioChannelSet::stereo();
}
void OrigamiAudioProcessor::renderRange(juce::AudioBuffer<float>& buffer, int start, int count) noexcept {
    if (count <= 0) return;
    std::array<float*, 2> channels { buffer.getWritePointer(0, start), buffer.getWritePointer(1, start) };
    if (!prepared_ || !engine_.process(channels.data(), 2u, static_cast<std::size_t>(count)))
        buffer.clear(start, count);
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

double OrigamiAudioProcessor::currentArpBpm() const noexcept {
    double bpm=juce::jlimit(20.0,400.0,arpState_.internalTempo);
    if(arpState_.syncToDaw) {
        if(auto* playHead=getPlayHead()) {
            if(const auto position=playHead->getPosition()) {
                if(const auto hostBpm=position->getBpm())
                    bpm=juce::jlimit(20.0,400.0,*hostBpm);
            }
        }
    }
    return bpm;
}
double OrigamiAudioProcessor::arpStepBeats() const noexcept {
    static constexpr double beats[] {1.0,0.5,0.25,0.125,1.0/3.0,1.0/6.0,0.75};
    return beats[juce::jlimit(0,6,arpState_.rateIndex)];
}
void OrigamiAudioProcessor::resetArpeggiatorRuntime(bool silenceVoice) noexcept {
    if(silenceVoice && arpActiveNote_>=0)
        engine_.noteOff(arpActiveNote_,static_cast<std::uint8_t>(juce::jlimit(1,16,arpActiveChannel_)-1),0u);
    arpStepRemaining_=0.0;arpGateRemaining_=-1.0;arpActiveNote_=-1;
    arpSequenceIndex_=0;arpBounceDirection_=1;arpStepParity_=false;arpOrderCount_=0;
    arpHeld_.fill(false);arpPhysicalHeld_.fill(false);arpVelocity_.fill(0.0f);arpChannel_.fill(1);
}
void OrigamiAudioProcessor::captureArpNote(const juce::MidiMessage& m,juce::MidiBuffer& out,int samplePosition) noexcept {
    const int note=juce::jlimit(0,127,m.getNoteNumber());
    if(m.isNoteOn()) {
        bool anyPhysical=false;
        for(bool down:arpPhysicalHeld_) if(down) {anyPhysical=true;break;}
        if(arpState_.latch && !anyPhysical) {
            arpHeld_.fill(false);arpOrderCount_=0;arpSequenceIndex_=0;arpBounceDirection_=1;
        }
        arpPhysicalHeld_[note]=true;
        if(!arpHeld_[note] && arpOrderCount_<128) arpOrder_[arpOrderCount_++]=note;
        arpHeld_[note]=true;arpVelocity_[note]=m.getFloatVelocity();arpChannel_[note]=juce::jlimit(1,16,m.getChannel());
        if(arpActiveNote_<0) arpStepRemaining_=0.0;
    } else if(m.isNoteOff()) {
        arpPhysicalHeld_[note]=false;
        if(!arpState_.latch) {
            arpHeld_[note]=false;
            for(int i=0;i<arpOrderCount_;++i) if(arpOrder_[i]==note) {
                for(int j=i+1;j<arpOrderCount_;++j) arpOrder_[j-1]=arpOrder_[j];
                --arpOrderCount_;break;
            }
            if(note==arpActiveNote_) {
                out.addEvent(juce::MidiMessage::noteOff(arpActiveChannel_,arpActiveNote_),samplePosition);
                arpActiveNote_=-1;arpGateRemaining_=-1.0;
            }
        }
    }
}
int OrigamiAudioProcessor::chooseArpNote() noexcept {
    std::array<int,512> sequence{};
    int count=0;
    const int octaves=juce::jlimit(1,4,arpState_.octaveSpan);
    auto append=[&](int base) {
        for(int oct=0;oct<octaves && count<(int)sequence.size();++oct) {
            const int note=base+12*oct;
            if(note<=127) sequence[count++]=note;
        }
    };
    if(arpState_.direction==OrigamiArpeggiatorState::Direction::Order) {
        for(int i=0;i<arpOrderCount_;++i) if(arpHeld_[arpOrder_[i]]) append(arpOrder_[i]);
    } else {
        for(int note=0;note<128;++note) if(arpHeld_[note]) append(note);
        std::sort(sequence.begin(),sequence.begin()+count);
    }
    if(count<=0) return -1;
    if(arpState_.direction==OrigamiArpeggiatorState::Direction::Random) {
        arpRandomState_=arpRandomState_*1664525u+1013904223u;
        return sequence[static_cast<int>(arpRandomState_%static_cast<std::uint32_t>(count))];
    }
    if(arpState_.direction==OrigamiArpeggiatorState::Direction::Down) {
        const int idx=((arpSequenceIndex_%count)+count)%count;++arpSequenceIndex_;return sequence[count-1-idx];
    }
    if(arpState_.direction==OrigamiArpeggiatorState::Direction::UpDown && count>1) {
        arpSequenceIndex_=juce::jlimit(0,count-1,arpSequenceIndex_);
        const int result=sequence[arpSequenceIndex_];arpSequenceIndex_+=arpBounceDirection_;
        if(arpSequenceIndex_>=count){arpSequenceIndex_=count-2;arpBounceDirection_=-1;}
        else if(arpSequenceIndex_<0){arpSequenceIndex_=1;arpBounceDirection_=1;}
        return result;
    }
    const int idx=((arpSequenceIndex_%count)+count)%count;++arpSequenceIndex_;return sequence[idx];
}
void OrigamiAudioProcessor::advanceArpeggiator(juce::MidiBuffer& out,int startSample,int endSample,double bpm) noexcept {
    if(endSample<=startSample) return;
    int cursor=startSample;
    while(cursor<endSample) {
        if(arpGateRemaining_>=0.0 && arpGateRemaining_<=0.000001 && arpActiveNote_>=0) {
            out.addEvent(juce::MidiMessage::noteOff(arpActiveChannel_,arpActiveNote_),cursor);
            arpActiveNote_=-1;arpGateRemaining_=-1.0;
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
                int source=chosen;
                while(source>=128 || (source>=0 && !arpHeld_[source])) source-=12;
                if(source<0 || !arpHeld_[source]) {
                    source=-1;for(int n=0;n<128;++n) if(arpHeld_[n] && n%12==chosen%12){source=n;break;}
                }
                const float velocity=source>=0?arpVelocity_[source]:0.85f;
                arpActiveChannel_=source>=0?arpChannel_[source]:1;arpActiveNote_=chosen;
                out.addEvent(juce::MidiMessage::noteOn(arpActiveChannel_,chosen,velocity),cursor);
                arpGateRemaining_=juce::jmax(1.0,stepSamples*juce::jlimit(0.05,1.0,static_cast<double>(arpState_.gate)));
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
    juce::ScopedNoDenormals noDenormals;
    jassert(buffer.getNumChannels() >= 2);
    const int total = buffer.getNumSamples();

    // V23.3: UI wheels enter the same engine MIDI dispatch contract as host events.
    if(const int pitch=pendingUiPitch_.exchange(-1,std::memory_order_acq_rel);pitch>=0)
        midi.addEvent(juce::MidiMessage::pitchWheel(1,pitch),0);
    if(const int mod=pendingUiMod_.exchange(-1,std::memory_order_acq_rel);mod>=0)
        midi.addEvent(juce::MidiMessage::controllerEvent(1,1,mod),0);

    // V23.1: merge on-screen keyboard events into the host MIDI buffer.
    uiKeyboardState_.processNextMidiBuffer(midi,0,total,true);

    juce::MidiBuffer scheduled;
    if(arpState_.enabled) {
        if(!arpWasEnabled_){resetArpeggiatorRuntime(true);arpWasEnabled_=true;}
        const double bpm=currentArpBpm();
        int schedulerCursor=0;
        for(const auto metadata:midi) {
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
        scheduled.swapWith(midi);
    }

    int cursor=0;
    for(const auto metadata:scheduled) {
        const int eventSample=juce::jlimit(cursor,total,metadata.samplePosition);
        renderRange(buffer,cursor,eventSample-cursor);
        dispatchMidi(metadata.getMessage());
        cursor=eventSample;
    }
    renderRange(buffer,cursor,total-cursor);
}
void OrigamiAudioProcessor::getStateInformation(juce::MemoryBlock& dest) {
    const juce::ScopedLock lock(stateLock_);
    const auto bytes=mct::origami::encodeInstrumentState(engine_.instrumentState());
    dest.replaceAll(bytes.data(),bytes.size());
}
void OrigamiAudioProcessor::setStateInformation(const void* data, int size) {
    if(size<=0) return;
    mct::origami::InstrumentState state;
    if(!mct::origami::decodeInstrumentState(data,static_cast<std::size_t>(size),state)) return;
    const juce::ScopedLock lock(stateLock_);
    // JUCE hosts/wrappers hold the callback lock around processing. No codec or
    // additional lock is introduced in processBlock; the commit resets voices.
    const juce::ScopedLock callbackLock(getCallbackLock());
    engine_.restoreInstrumentState(state);
}
bool OrigamiAudioProcessor::setUiMacro(unsigned index,float value) noexcept {
    const juce::ScopedLock lock(stateLock_);
    if(index>=4) return false;
    auto mod=engine_.instrumentState().modulation;mod.macros[index]=value;
    return engine_.setModulationState(mod);
}
bool OrigamiAudioProcessor::setUiLfo(const mct::origami::LfoSettings& settings) noexcept {
    const juce::ScopedLock lock(stateLock_);auto mod=engine_.instrumentState().modulation;mod.lfo1=settings;return engine_.setModulationState(mod);
}
bool OrigamiAudioProcessor::setUiModulationState(const mct::origami::ModulationState& state) noexcept {
    const juce::ScopedLock lock(stateLock_);return engine_.setModulationState(state);
}
unsigned OrigamiAudioProcessor::addUiRoute() noexcept {
    const juce::ScopedLock lock(stateLock_);
    auto mod=engine_.instrumentState().modulation;
    if(mod.nextRouteId==std::numeric_limits<unsigned>::max()) return 0;
    for(auto& route:mod.routes) if(!route.id) {
        route.id=mod.nextRouteId++;route.amount=.35f;
        return engine_.setModulationState(mod)?route.id:0;
    }
    return 0;
}
bool OrigamiAudioProcessor::setUiRoute(const mct::origami::ModRoute& edited) noexcept {
    const juce::ScopedLock lock(stateLock_);
    if(!edited.id) return false;
    auto mod=engine_.instrumentState().modulation;
    for(auto& route:mod.routes) if(route.id==edited.id) {
        route=edited;return engine_.setModulationState(mod);
    }
    return false;
}
bool OrigamiAudioProcessor::removeUiRoute(unsigned id) noexcept {
    const juce::ScopedLock lock(stateLock_);
    auto mod=engine_.instrumentState().modulation;std::size_t out=0;bool found=false;
    for(const auto& route:mod.routes) if(route.id) {
        if(route.id==id) found=true;else mod.routes[out++]=route;
    }
    if(!found) return false;
    while(out<mod.routes.size()) mod.routes[out++]={};
    return engine_.setModulationState(mod);
}
mct::origami::InstrumentState OrigamiAudioProcessor::getUiInstrumentState() const noexcept {
    const juce::ScopedLock lock(stateLock_);
    return engine_.instrumentState();
}
// mct-origami-functional-osc-controls-v15
bool OrigamiAudioProcessor::setUiParameter(mct::origami::ParameterId id,float value) noexcept {
    const juce::ScopedLock lock(stateLock_);
    return engine_.setParameter(id,value);
}
float OrigamiAudioProcessor::getUiParameter(mct::origami::ParameterId id) const noexcept {
    const juce::ScopedLock lock(stateLock_);
    const auto state=engine_.parameterState();
    return state[static_cast<std::size_t>(id)];
}
mct::origami::OscillatorModuleId OrigamiAudioProcessor::addUiOscillator() noexcept {
    const juce::ScopedLock lock(stateLock_);
    return engine_.addOscillatorModule();
}
bool OrigamiAudioProcessor::removeUiOscillator(mct::origami::OscillatorModuleId id) noexcept {
    const juce::ScopedLock lock(stateLock_);
    return engine_.removeOscillatorModule(id);
}
bool OrigamiAudioProcessor::setUiOscillatorState(mct::origami::OscillatorModuleId id,const mct::origami::OscillatorModuleState& state) noexcept {
    const juce::ScopedLock lock(stateLock_);
    return engine_.setOscillatorModuleState(id,state);
}
mct::origami::OscillatorModuleState OrigamiAudioProcessor::getUiOscillatorState(mct::origami::OscillatorModuleId id) const noexcept {
    const juce::ScopedLock lock(stateLock_);
    return engine_.oscillatorModuleState(id);
}
bool OrigamiAudioProcessor::setUiOscillatorEnabled(mct::origami::OscillatorModuleId id,bool enabled) noexcept {
    const juce::ScopedLock lock(stateLock_);
    return engine_.setOscillatorModuleEnabled(id,enabled);
}
bool OrigamiAudioProcessor::getUiOscillatorEnabled(mct::origami::OscillatorModuleId id) const noexcept {
    const juce::ScopedLock lock(stateLock_);
    return engine_.oscillatorModuleEnabled(id);
}

void OrigamiAudioProcessor::setUiPitchWheel(float normalized) noexcept {
    normalized=juce::jlimit(-1.0f,1.0f,normalized);
    const int value=normalized>=0 ? 8192+juce::roundToInt(normalized*8191.0f) : 8192+juce::roundToInt(normalized*8192.0f);
    pendingUiPitch_.store(juce::jlimit(0,16383,value),std::memory_order_release);
}
void OrigamiAudioProcessor::setUiModWheel(float normalized) noexcept {
    pendingUiMod_.store(juce::jlimit(0,127,juce::roundToInt(juce::jlimit(0.0f,1.0f,normalized)*127.0f)),std::memory_order_release);
}
bool OrigamiAudioProcessor::setUiPitchBendRange(float semitones) noexcept { const juce::ScopedLock lock(stateLock_);return engine_.setPitchBendRange(semitones); }
float OrigamiAudioProcessor::getUiPitchBendRange() const noexcept { const juce::ScopedLock lock(stateLock_);return engine_.pitchBendRange(); }
bool OrigamiAudioProcessor::setUiPerformanceState(const mct::origami::PerformanceState& state) noexcept {
    const juce::ScopedLock lock(stateLock_);const juce::ScopedLock callbackLock(getCallbackLock());return engine_.setPerformanceState(state);
}
mct::origami::PerformanceState OrigamiAudioProcessor::getUiPerformanceState() const noexcept {
    const juce::ScopedLock lock(stateLock_);return engine_.performanceState();
}
bool OrigamiAudioProcessor::setUiArpeggiatorState(const OrigamiArpeggiatorState& requested) noexcept {
    auto state=requested;
    state.rateIndex=juce::jlimit(0,6,state.rateIndex);state.octaveSpan=juce::jlimit(1,4,state.octaveSpan);
    state.gate=juce::jlimit(0.05f,1.0f,state.gate);state.swing=juce::jlimit(0.0f,0.75f,state.swing);
    state.internalTempo=juce::jlimit(20.0,400.0,state.internalTempo);
    const juce::ScopedLock lock(stateLock_);const juce::ScopedLock callbackLock(getCallbackLock());
    const bool timingChanged=state.rateIndex!=arpState_.rateIndex || state.swing!=arpState_.swing
        || state.syncToDaw!=arpState_.syncToDaw || state.internalTempo!=arpState_.internalTempo;
    arpState_=state;if(timingChanged) arpStepRemaining_=0.0;return true;
}
OrigamiArpeggiatorState OrigamiAudioProcessor::getUiArpeggiatorState() const noexcept {
    const juce::ScopedLock lock(stateLock_);return arpState_;
}

juce::AudioProcessorEditor* OrigamiAudioProcessor::createEditor() { return new OrigamiAudioProcessorEditor(*this); }
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new OrigamiAudioProcessor(); }
