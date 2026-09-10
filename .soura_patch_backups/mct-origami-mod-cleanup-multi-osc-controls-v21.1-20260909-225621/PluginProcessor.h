#pragma once
#include <JuceHeader.h>
#include "core/Engine.h"

class OrigamiAudioProcessor final : public juce::AudioProcessor {
public:
    OrigamiAudioProcessor();
    ~OrigamiAudioProcessor() override = default;
    void prepareToPlay(double sampleRate, int samplesPerBlock) override;
    void releaseResources() override {}
    bool isBusesLayoutSupported(const BusesLayout&) const override;
    void processBlock(juce::AudioBuffer<float>&, juce::MidiBuffer&) override;
    juce::AudioProcessorEditor* createEditor() override;
    bool hasEditor() const override { return true; }
    const juce::String getName() const override { return JucePlugin_Name; }
    bool acceptsMidi() const override { return true; }
    bool producesMidi() const override { return false; }
    bool isMidiEffect() const override { return false; }
    double getTailLengthSeconds() const override { return 20.0; }
    int getNumPrograms() override { return 1; }
    int getCurrentProgram() override { return 0; }
    void setCurrentProgram(int) override {}
    const juce::String getProgramName(int) override { return "Init"; }
    void changeProgramName(int, const juce::String&) override {}
    void getStateInformation(juce::MemoryBlock&) override;
    void setStateInformation(const void*, int) override;

    // mct-origami-functional-osc-controls-v15
    bool setUiParameter(mct::origami::ParameterId,float) noexcept;
    float getUiParameter(mct::origami::ParameterId) const noexcept;
    // mct-origami-multi-osc-audio-v21
    mct::origami::OscillatorModuleId addUiOscillator() noexcept;
    bool removeUiOscillator(mct::origami::OscillatorModuleId) noexcept;
private:
    void renderRange(juce::AudioBuffer<float>&, int start, int count) noexcept;
    void dispatchMidi(const juce::MidiMessage&) noexcept;
    mct::origami::OrigamiEngine engine_;
    bool prepared_ = false;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(OrigamiAudioProcessor)
};
