// mct-origami-deep-audit-p07-enforced-qos
// mct-origami-deep-audit-p03-fix2-canonical-state-repair
// mct-origami-deep-audit-p03-canonical-state
// mct-origami-deep-audit-p02-lockfree-ui-midi
// mct-origami-audio-reengineer-p17-global-qos-budget
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
#include <functional>
#include "core/Engine.h"
#include "core/ArpeggiatorState.h"
#include "core/fx/FxGraph.h"
#include "core/fx/FxRenderer.h"
#include "core/fx/FxEnvironment.h"
#include "core/fx/FxWorkspace.h"
#include "core/nodes/ControlGraph.h"
#include "ui/VisualizationSettings.h"

// mct-origami-audio-reengineer-p04-ui-telemetry-decimation

// mct-origami-audio-reengineer-p03-midi-preallocation

// mct-origami-nested-modulation-manual-qa: one DAW-automatable parameter per
// stable macro slot. The ID is immutable ("macro.<id>", MACRO 1..4 keep ids
// 1..4); the parameter holds the macro's BASE value (knob / automation /
// preset). Incoming modulation changes only the engine's EFFECTIVE value and
// is never written here. The display name follows the macro's custom name.
class OrigamiMacroParameter final : public juce::AudioParameterFloat {
public:
    OrigamiMacroParameter(unsigned macroId,std::function<juce::String(unsigned)> nameOf)
        : juce::AudioParameterFloat(juce::ParameterID{"macro."+juce::String(macroId),1},"Macro "+juce::String(macroId),
                                    juce::NormalisableRange<float>(0.0f,1.0f),0.0f),
          macroId_(macroId),nameOf_(std::move(nameOf)) {}
    juce::String getName(int maximumStringLength) const override {
        const auto name=nameOf_ ? nameOf_(macroId_) : juce::String("Macro "+juce::String(macroId_));
        return maximumStringLength>0 ? name.substring(0,maximumStringLength) : name;
    }
    unsigned macroId() const noexcept { return macroId_; }
private:
    unsigned macroId_;
    std::function<juce::String(unsigned)> nameOf_;
};

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
    bool installUiOscillatorWavetable(mct::origami::OscillatorModuleId,mct::origami::dsp::Wavetable);
    mct::origami::OscillatorModuleState getUiOscillatorState(mct::origami::OscillatorModuleId) const noexcept;
    bool setUiOscillatorEnabled(mct::origami::OscillatorModuleId,bool) noexcept;
    bool getUiOscillatorEnabled(mct::origami::OscillatorModuleId) const noexcept;
    bool setUiMacro(unsigned,float) noexcept;
    // mct-origami-nested-modulation-manual-qa: DAW macro parameters.
    // A UI drag is one host gesture (begin / values / end), so the DAW can
    // record it; the index is the stable macro id - 1.
    void beginUiMacroGesture(unsigned index) noexcept;
    void endUiMacroGesture(unsigned index) noexcept;
    OrigamiMacroParameter* macroParameter(unsigned index) const noexcept { return index<macroParameters_.size() ? macroParameters_[index] : nullptr; }
    // Message thread: bring the model's macro BASE values up to date with
    // the parameters (host automation moved them). Returns true when changed.
    bool syncUiMacrosFromHost() noexcept;
    // Macro names (stable id - 1). Empty restores "MACRO n". Printable ASCII,
    // up to 23 characters; the DAW parameter name follows.
    bool setUiMacroName(unsigned index,const juce::String& name) noexcept;
    juce::String getUiMacroName(unsigned index) const noexcept;
    juce::String macroDisplayName(unsigned macroId) const;
    bool setUiLfo(const mct::origami::LfoSettings&) noexcept;
    bool setUiModulationState(const mct::origami::ModulationState&) noexcept;
    unsigned addUiRoute() noexcept;
    bool setUiRoute(const mct::origami::ModRoute&) noexcept;
    bool removeUiRoute(unsigned) noexcept;
    mct::origami::InstrumentState getUiInstrumentState() const noexcept;
    std::uint64_t getUiOscillatorRevision() const noexcept { return uiOscillatorRevision_.load(std::memory_order_acquire); }
    // N07: bumped on EVERY change of the UI instrument state (modulation,
    // oscillators, buses, parameters, performance, restore). Views compare it
    // instead of snapshotting the instrument on every timer tick.
    std::uint64_t getUiModelRevision() const noexcept { return uiModelRevision_.load(std::memory_order_acquire); }
    mct::origami::OrigamiEngine::NodesDiagnostics getUiNodesDiagnostics() const noexcept { return engine_.nodesDiagnostics(); }

    // Deep Audit P02: UI notes enter the audio domain through a fixed SPSC
    // queue. MidiKeyboardState is no longer an audio-thread bridge.
    bool enqueueUiKeyboardNote(int note,bool noteOn,float velocity=0.85f) noexcept;
    void setUiPitchWheel(float normalized) noexcept;
    void setUiModWheel(float normalized) noexcept;
    bool setUiPitchBendRange(float semitones) noexcept;
    bool setUiPitchBendRanges(float upSemitones,float downSemitones) noexcept;
    float getUiPitchBendRange() const noexcept;
    float getUiPitchBendDownRange() const noexcept;
    bool setUiPerformanceState(const mct::origami::PerformanceState&) noexcept;
    mct::origami::PerformanceState getUiPerformanceState() const noexcept;
    bool setUiArpeggiatorState(const mct::origami::ArpeggiatorState&) noexcept;
    mct::origami::ArpeggiatorState getUiArpeggiatorState() const noexcept;
    mct::origami::ArpeggiatorRuntimeSnapshot getUiArpeggiatorRuntimeSnapshot() const noexcept;
    mct::origami::EnvelopeTraceSnapshot getUiEnvelopeTraceSnapshot() const noexcept;
    mct::origami::PerformanceInputSnapshot getUiPerformanceInputSnapshot() const noexcept;
    mct::origami::RenderBudgetSnapshot getUiRenderBudgetSnapshot() const noexcept;
    double getUiHostBpm() noexcept;
    void clearUiArpeggiatorLatch() noexcept;
    std::uint32_t getUiVisualizationMask() const noexcept;
    void setUiVisualizationMask(std::uint32_t) noexcept;
    mct::origami::RuntimeVisualizationSnapshot getUiRuntimeVisualizationSnapshot() noexcept;
    // mct-origami-fx-page-foundation-p01
    // Canonical editable FX graph. MESSAGE THREAD ONLY: processBlock never
    // reads it. A future FX renderer will receive compiled, immutable plans.
    // MAIN bus graph (kept for existing callers); every bus has its own graph.
    mct::origami::fx::FxGraphDocument& getUiFxDocument() noexcept { return fxWorkspace_.document(mct::origami::mainBusId); }
    // mct-origami-unified-routing-core-fx-p04: per-bus graphs + Global FX.
    mct::origami::fx::FxWorkspace& getUiFxWorkspace() noexcept { return fxWorkspace_; }
    // Canonical bus editing (the future Mixer uses the same calls). MAIN is
    // permanent; removing a bus prunes oscillator sends (falling back to MAIN
    // at unity) and FX modulation routes, and drops the bus's graph.
    mct::origami::BusId addUiBus() noexcept;
    bool removeUiBus(mct::origami::BusId) noexcept;
    // mct-origami-fx-graph-dsp-bus-routing-p02
    // Peak output since the previous call (UI meter telemetry, lock-free).
    std::pair<float,float> consumeUiFxPeaks() noexcept { return fxEnvironment_.consumePeaks(); }
    std::uint64_t getFxCompileCount() const noexcept { return fxEnvironment_.compileCount(); }
    mct::origami::fx::FxViewState& getUiFxViewState() noexcept { return fxViewState_; }
    // mct-origami-nodes-n03-control: NODES CONTROL-layer view metadata
    // (positions / placed nodes only; relationships live in ModulationState).
    // Message thread only.
    mct::origami::nodes::ControlLayout& getUiControlLayout() noexcept { return controlLayout_; }

    // P0 audio-continuity diagnostics. These counters are observational only:
    // they never participate in rendering decisions and remain allocation-free.
    struct AudioContinuityDiagnostics {
        std::uint64_t callbacks=0;
        std::uint64_t beginHostBlockFailures=0;
        std::uint64_t processSpanFailures=0;
        std::uint64_t requestedSpanSamples=0;
        std::uint64_t renderedSpanSamples=0;
        std::uint64_t zeroOutputCallbacks=0;
        std::uint64_t uiMidiEventsDrained=0;
        double preparedSampleRate=0.0;
        int preparedBlockSize=0;
        int minCallbackSamples=0;
        int maxCallbackSamples=0;
        int lastCallbackSamples=0;
        int lastOutputChannels=0;
        float outputPeak=0.0f;
        float maxAdjacentDelta=0.0f;
        std::uint64_t nonFiniteOutputSamples=0;
        double callbackBudgetMs=0.0;
        double lastCallbackMs=0.0;
        double worstCallbackMs=0.0;
        std::uint64_t callbacksOverBudget=0;
        mct::origami::dsp::SpectralCompilerStats spectralProfile{};
    };
    AudioContinuityDiagnostics getAudioContinuityDiagnostics() const noexcept;
    void resetAudioContinuityDiagnostics() noexcept;
private:
    mutable juce::CriticalSection stateLock_; // non-realtime model writers/snapshots only
    // DAW macro parameters (owned by juce::AudioProcessor) by macro id - 1.
    std::array<OrigamiMacroParameter*,mct::origami::maxMacros> macroParameters_{};
    // Names for the host (read from any host thread under this lock).
    juce::SpinLock macroNameLock_;
    std::array<std::array<char,mct::origami::ModulationState::macroNameCapacity>,mct::origami::maxMacros> hostMacroNames_{};
    void setMacroParametersFromModel(const mct::origami::ModulationState&) noexcept;
    void publishMacroNamesToHost(const mct::origami::ModulationState&) noexcept;
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
    void serviceVisualTelemetry(int hostBlockSamples) noexcept;
    void finalizeRenderBudget(std::int64_t startTicks,int hostBlockSamples) noexcept;
    void drainUiKeyboardMidi(juce::MidiBuffer&) noexcept;

    struct UiMidiEvent {
        std::uint8_t note=0;
        std::uint8_t velocity=0;
        bool noteOn=false;
    };
    static constexpr std::uint32_t uiMidiCapacity_=1024;
    std::array<UiMidiEvent,uiMidiCapacity_> uiMidiQueue_{};
    std::atomic<std::uint32_t> uiMidiWrite_{0},uiMidiRead_{0};
    std::atomic<std::uint64_t> uiMidiDropped_{0};
    std::atomic<bool> uiMidiOverflowRecovery_{false};

    std::atomic<std::uint64_t> continuityCallbacks_{0};
    std::atomic<std::uint64_t> continuityBeginFailures_{0};
    std::atomic<std::uint64_t> continuitySpanFailures_{0};
    std::atomic<std::uint64_t> continuityRequestedSamples_{0};
    std::atomic<std::uint64_t> continuityRenderedSamples_{0};
    std::atomic<std::uint64_t> continuityZeroCallbacks_{0};
    std::atomic<std::uint64_t> continuityUiMidiEvents_{0};
    std::atomic<double> runtimePreparedSampleRate_{0.0};
    std::atomic<int> runtimePreparedBlockSize_{0};
    std::atomic<int> runtimeMinCallbackSamples_{0},runtimeMaxCallbackSamples_{0};
    std::atomic<int> runtimeLastCallbackSamples_{0},runtimeLastOutputChannels_{0};
    std::atomic<float> runtimeOutputPeak_{0.0f},runtimeMaxAdjacentDelta_{0.0f};
    std::atomic<std::uint64_t> runtimeNonFiniteOutputSamples_{0};
    std::atomic<double> runtimeCallbackBudgetMs_{0.0},runtimeLastCallbackMs_{0.0},runtimeWorstCallbackMs_{0.0};
    std::atomic<std::uint64_t> runtimeCallbacksOverBudget_{0};

    // Persistent realtime MIDI workspaces; storage is committed in prepareToPlay().
    juce::MidiBuffer inputMidiScratch_;
    juce::MidiBuffer scheduledMidiScratch_;
    static constexpr std::size_t midiScratchBytes_ = 256u * 1024u;
    std::atomic<int> pendingUiPitch_{-1},pendingUiMod_{-1};
    mct::origami::OrigamiEngine engine_;

    // Wavetable editor publication is non-blocking with respect to processBlock:
    // OrigamiEngine::publishWavetableForOscillator (validated and allocated on
    // the UI thread, swapped in by the audio thread at the next host-block
    // boundary, the replaced table freed back on the UI thread).

    // Deep Audit P03: host/UI model state is canonical outside the renderer.
    // getStateInformation() serializes this snapshot without interrogating or
    // suspending live DSP. Full restores cross to audio only at a block boundary.
    mct::origami::InstrumentState uiInstrumentState_{};
    std::atomic<std::uint64_t> uiOscillatorRevision_{1};
    std::atomic<std::uint64_t> uiModelRevision_{1};
    void bumpUiModelRevision() noexcept { uiModelRevision_.fetch_add(1,std::memory_order_release); }
    mct::origami::LatestStateMailbox<mct::origami::InstrumentState> restoreMailbox_;

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
    std::atomic<std::uint64_t> performanceUiHeldLow_{0},performanceUiHeldHigh_{0};
    std::array<std::atomic<std::uint8_t>,128> performanceUiVelocity_{};
    std::atomic<bool> envUiActive_{false};
    std::atomic<std::uint64_t> envUiOrder_{0};
    std::array<std::atomic<std::uint32_t>,3> envUiStage_{};
    std::array<std::atomic<float>,3> envUiProgress_{};
    std::array<std::atomic<float>,3> envUiValue_{};
    // Patch 17/19: audio-thread-owned global callback budget.
    mct::origami::GlobalRenderBudget renderBudget_;
    double highResolutionTicksPerSecond_=1.0;
    std::atomic<float> qosInstant_{0.0f},qosSmoothed_{0.0f},qosPeak_{0.0f};
    std::atomic<std::uint32_t> qosLevel_{0},qosFlags_{0};
    std::atomic<std::uint32_t> qosVoices_{0},qosModules_{0},qosUnison_{0},qosOscEvals_{0},qosVoiceCeiling_{16};
    std::atomic<std::uint64_t> qosDeadlineMisses_{0};
    std::atomic<std::uint32_t> visualizationMask_{mct::origami::ui::defaultVisualizationMask};
    mct::origami::LatestStateMailbox<mct::origami::RuntimeVisualizationSnapshot> visualizationMailbox_;
    mct::origami::RuntimeVisualizationSnapshot uiVisualizationSnapshot_{};
    mct::origami::fx::FxWorkspace fxWorkspace_;
    // One prepared renderer per bus + Global FX; process() runs after the engine.
    mct::origami::fx::FxEnvironment fxEnvironment_;
    // User-bus render buffers (L,R per user slot), allocated in prepareToPlay.
    std::vector<float> auxStorage_;
    std::array<float*,2*(mct::origami::maxRenderBuses-1)> auxPointers_{};
    int auxCapacity_=0;
    bool auxThisBlock_=false;
    juce::CriticalSection fxCompileLock_; // non-realtime compile/prepare only
    void syncFxRenderer();
    void pruneFxModulationRoutes();
    mct::origami::fx::FxViewState fxViewState_{};
    mct::origami::nodes::ControlLayout controlLayout_{};
    static constexpr std::uint32_t controlLayoutMagic=0x4E434C31u; // 'NCL1' (N03: CONTROL view metadata)
    static constexpr std::uint32_t fxStateMagic=0x46584732u; // 'FXG2' (P02/P03: MAIN graph only)
    static constexpr std::uint32_t fxWorkspaceMagic=0x46585731u; // 'FXW1' (P04: all bus graphs + Global FX)

    // UI telemetry is intentionally control-rate, not render-span-rate.
    // Countdown is audio-thread-owned; publication remains lock-free atomics.
    std::int64_t envUiSamplesUntilPublish_=0;
    static constexpr double envelopeUiPublishHz_=60.0;
    bool prepared_ = false;
    JUCE_DECLARE_NON_COPYABLE_WITH_LEAK_DETECTOR(OrigamiAudioProcessor)
};
