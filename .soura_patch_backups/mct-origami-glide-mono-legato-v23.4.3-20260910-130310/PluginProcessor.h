// mct-origami-pitch-mod-real-v23.3
// mct-origami-playable-keyboard-audio-v23.1
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
    bool setUiOscillatorState(mct::origami::OscillatorModuleId,const mct::origami::OscillatorModuleState&) noexcept;
    mct::origami::OscillatorModuleState getUiOscillatorState(mct::origami::OscillatorModuleId) const noexcept;
    bool setUiOscillatorEnabled(mct::origami::OscillatorModuleId,bool) noexcept;
    bool getUiOscillatorEnabled(mct::origami::OscillatorModuleId) const noexcept;
    bool setUiMacro(unsigned,float) noexcept;
    bool setUiLfo(const mct::origami::LfoSettings&) noexcept;
    unsigned addUiRoute() noexcept;
    bool setUiRoute(const mct::origami::ModRoute&) noexcept;
    bool removeUiRoute(unsigned) noexcept;
    mct::origami::InstrumentState getUiInstrumentState() const noexcept;

    // V23.1: UI keyboard feeds the exact same MIDI path as host input.
    juce::MidiKeyboardState& uiKeyboardState() noexcept { return uiKeyboardState_; }
    void setUiPitchWheel(float normalized) noexcept;
    void setUiModWheel(float normalized) noexcept;
    bool setUiPitchBendRange(float semitones) noexcept;
    float getUiPitchBendRange() const noexcept;
private:
    mutable juce::CriticalSection stateLock_; // non-realtime model writers/snapshots only
    void renderRange(juce::AudioBuffer<float>&, int start, int count) noexcept;
    void dispatchMidi(const juce::MidiMessage&) noexcept;
    juce::MidiKeyboardState uiKeyboardState_;
    std::atomic<int> pendingUiPitch_{-1},pendingUiMod_{-1};
    mct::origami::OrigamiEngine engine_;
    bool prepared_ = false;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(OrigamiAudioProcessor)
};
