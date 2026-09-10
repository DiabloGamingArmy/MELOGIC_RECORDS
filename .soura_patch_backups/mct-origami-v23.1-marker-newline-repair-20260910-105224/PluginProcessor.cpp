// mct-origami-playable-keyboard-audio-v23.1\n#include "PluginProcessor.h"
#include "PluginEditor.h"
#include <array>
#include <limits>
#include "core/preset/StateCodec.h"
OrigamiAudioProcessor::OrigamiAudioProcessor()
    : AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)) {
    // Preserve the established four-module initial layout in the model, once.
    for(int i=0;i<3;++i) engine_.addOscillatorModule();
}
void OrigamiAudioProcessor::prepareToPlay(double sampleRate, int samplesPerBlock) {
    prepared_ = engine_.prepare(sampleRate, static_cast<std::size_t>(juce::jmax(1, samplesPerBlock)), 2u);
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
    else if (message.isAllNotesOff() || message.isAllSoundOff()) engine_.allNotesOff();
}
void OrigamiAudioProcessor::processBlock(juce::AudioBuffer<float>& buffer, juce::MidiBuffer& midi) {
    juce::ScopedNoDenormals noDenormals;
    jassert(buffer.getNumChannels() >= 2);
    const int total = buffer.getNumSamples();

    // V23.1: merge on-screen keyboard events into the host MIDI buffer.
    // MidiKeyboardState is JUCE's intended UI-to-audio-thread bridge. The
    // resulting events flow through dispatchMidi() exactly like host MIDI.
    uiKeyboardState_.processNextMidiBuffer(midi,0,total,true);

    int cursor = 0;
    for (const auto metadata : midi) {
        const int eventSample = juce::jlimit(cursor, total, metadata.samplePosition);
        renderRange(buffer, cursor, eventSample - cursor);
        dispatchMidi(metadata.getMessage());
        cursor = eventSample;
    }
    renderRange(buffer, cursor, total - cursor);
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
    const juce::ScopedLock lock(stateLock_);
    auto mod=engine_.instrumentState().modulation;mod.lfo1=settings;
    return engine_.setModulationState(mod);
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

juce::AudioProcessorEditor* OrigamiAudioProcessor::createEditor() { return new OrigamiAudioProcessorEditor(*this); }
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new OrigamiAudioProcessor(); }
