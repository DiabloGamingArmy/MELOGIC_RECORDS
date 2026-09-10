#include "PluginProcessor.h"
#include "PluginEditor.h"
#include <array>
namespace {
constexpr std::uint32_t stateMagic = 0x4D43544Fu;
constexpr std::uint32_t stateVersion = 1u;
}
OrigamiAudioProcessor::OrigamiAudioProcessor()
    : AudioProcessor(BusesProperties().withOutput("Output", juce::AudioChannelSet::stereo(), true)) {}
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
    int cursor = 0;
    const int total = buffer.getNumSamples();
    for (const auto metadata : midi) {
        const int eventSample = juce::jlimit(cursor, total, metadata.samplePosition);
        renderRange(buffer, cursor, eventSample - cursor);
        dispatchMidi(metadata.getMessage());
        cursor = eventSample;
    }
    renderRange(buffer, cursor, total - cursor);
}
void OrigamiAudioProcessor::getStateInformation(juce::MemoryBlock& dest) {
    const auto values = engine_.parameterState();
    juce::MemoryOutputStream stream(dest, false);
    stream.writeIntBigEndian(static_cast<int>(stateMagic));
    stream.writeIntBigEndian(static_cast<int>(stateVersion));
    stream.writeIntBigEndian(static_cast<int>(mct::origami::parameterCount));
    for (float value : values) stream.writeFloatBigEndian(value);
}
void OrigamiAudioProcessor::setStateInformation(const void* data, int size) {
    if (data == nullptr || size <= 0) return;
    juce::MemoryInputStream stream(data, static_cast<std::size_t>(size), false);
    if (static_cast<std::uint32_t>(stream.readIntBigEndian()) != stateMagic) return;
    if (static_cast<std::uint32_t>(stream.readIntBigEndian()) != stateVersion) return;
    const int storedCount = stream.readIntBigEndian();
    constexpr int legacyFoundationCount = 10;
    constexpr int legacyTuningCount = 13;
    if (storedCount != legacyFoundationCount &&
        storedCount != legacyTuningCount &&
        storedCount != static_cast<int>(mct::origami::parameterCount)) return;

    auto values = mct::origami::defaultParameters();
    for (int i = 0; i < storedCount; ++i) {
        if (stream.getNumBytesRemaining() < static_cast<juce::int64>(sizeof(float))) return;
        values[static_cast<std::size_t>(i)] = stream.readFloatBigEndian();
    }
    engine_.applyPatchState(values);
}
// mct-origami-functional-osc-controls-v15
bool OrigamiAudioProcessor::setUiParameter(mct::origami::ParameterId id,float value) noexcept {
    return engine_.setParameter(id,value);
}
float OrigamiAudioProcessor::getUiParameter(mct::origami::ParameterId id) const noexcept {
    const auto state=engine_.parameterState();
    return state[static_cast<std::size_t>(id)];
}
juce::AudioProcessorEditor* OrigamiAudioProcessor::createEditor() { return new OrigamiAudioProcessorEditor(*this); }
juce::AudioProcessor* JUCE_CALLTYPE createPluginFilter() { return new OrigamiAudioProcessor(); }
