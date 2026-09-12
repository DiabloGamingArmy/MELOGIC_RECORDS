// mct-origami-audio-reengineer-p16-arp-ui-coalescing
// mct-origami-audio-reengineer-p14-callback-lock-mailboxes
// mct-origami-audio-reengineer-p13-audioplayhead-boundary
// mct-origami-audio-reengineer-p10-persistent-preallocated-midi
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
#pragma once
#include <JuceHeader.h>
#include "core/Engine.h"
#include "core/ArpeggiatorState.h"

// mct-origami-audio-reengineer-p04-ui-telemetry-decimation

// mct-origami-audio-reengineer-p03-midi-preallocation

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
    bool setUiModulationState(const mct::origami::ModulationState&) noexcept;
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
    bool setUiPerformanceState(const mct::origami::PerformanceState&) noexcept;
    mct::origami::PerformanceState getUiPerformanceState() const noexcept;
    bool setUiArpeggiatorState(const mct::origami::ArpeggiatorState&) noexcept;
    mct::origami::ArpeggiatorState getUiArpeggiatorState() const noexcept;
    mct::origami::ArpeggiatorRuntimeSnapshot getUiArpeggiatorRuntimeSnapshot() const noexcept;
    mct::origami::EnvelopeTraceSnapshot getUiEnvelopeTraceSnapshot() const noexcept;
    double getUiHostBpm() noexcept;
    void clearUiArpeggiatorLatch() noexcept;
private:
    mutable juce::CriticalSection stateLock_; // non-realtime model writers/snapshots only
    void renderRange(juce::AudioBuffer<float>&, int start, int count) noexcept;
    void dispatchMidi(const juce::MidiMessage&) noexcept;
    double currentArpBpm() const noexcept;
    double arpStepBeats() const noexcept;
    void resetArpeggiatorRuntime(bool silenceVoice) noexcept;
    void captureArpNote(const juce::MidiMessage&, juce::MidiBuffer&, int samplePosition) noexcept;
    void advanceArpeggiator(juce::MidiBuffer&, int startSample, int endSample, double bpm) noexcept;
    int chooseArpNote() noexcept;
    void publishArpUiSnapshot() noexcept;
    void publishEnvelopeUiSnapshot() noexcept;
    juce::MidiKeyboardState uiKeyboardState_;
    // Persistent realtime MIDI workspaces; storage is committed in prepareToPlay().
    juce::MidiBuffer inputMidiScratch_;
    juce::MidiBuffer scheduledMidiScratch_;
    static constexpr std::size_t midiScratchBytes_ = 256u * 1024u;
    std::atomic<int> pendingUiPitch_{-1},pendingUiMod_{-1};
    mct::origami::OrigamiEngine engine_;
    // Patch 14/19: non-blocking UI -> audio state transfer.
    mct::origami::PerformanceState uiPerformanceState_{};
    mct::origami::LatestStateMailbox<mct::origami::PerformanceState> performanceMailbox_;
    mct::origami::ArpeggiatorState uiArpState_{};
    mct::origami::LatestStateMailbox<mct::origami::ArpeggiatorState> arpMailbox_;
    std::atomic<bool> pendingClearArpLatch_{false};
    // Audio-thread-owned runtime state.
    mct::origami::ArpeggiatorState arpState_{};
    double sampleRate_=44100.0;
    std::atomic<float> cachedHostBpm_{120.0f};
    static_assert(std::atomic<float>::is_always_lock_free, "Origami requires lock-free float telemetry atomics");
    double arpStepRemaining_=0.0,arpGateRemaining_=-1.0;
    int arpActiveNote_=-1,arpActiveChannel_=1,arpSequenceIndex_=0,arpBounceDirection_=1;
    bool arpStepParity_=false,arpWasEnabled_=false;
    std::array<bool,128> arpHeld_{},arpPhysicalHeld_{};
    std::array<float,128> arpVelocity_{};
    std::array<int,128> arpChannel_{},arpOrder_{};
    int arpOrderCount_=0;
    std::uint32_t arpRandomState_=0x6d2b79f5u;
    std::uint32_t arpChanceRandomState_=0x9e3779b9u;
    std::atomic<int> arpUiActiveNote_{-1};
    std::atomic<std::uint64_t> arpUiHeldLow_{0},arpUiHeldHigh_{0};
    std::atomic<bool> arpUiDirty_{true};
    std::atomic<bool> envUiActive_{false};
    std::atomic<std::uint64_t> envUiOrder_{0};
    std::array<std::atomic<std::uint32_t>,3> envUiStage_{};
    std::array<std::atomic<float>,3> envUiProgress_{};
    std::array<std::atomic<float>,3> envUiValue_{};
    // UI telemetry is intentionally control-rate, not render-span-rate.
    // Countdown is audio-thread-owned; publication remains lock-free atomics.
    std::int64_t envUiSamplesUntilPublish_=0;
    static constexpr double envelopeUiPublishHz_=60.0;
    bool prepared_ = false;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(OrigamiAudioProcessor)
};
