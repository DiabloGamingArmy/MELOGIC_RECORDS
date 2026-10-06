// mct-origami-audio-reengineer-p09-lightweight-voice-steal
// mct-origami-audio-reengineer-p06.3-local-source
// mct-origami-v32.1.1-extended-mod-sources-hotfix
// mct-origami-v28.0.0-interactive-envelope-editor
// mct-origami-modulation-completion-v24.0.1
// mct-origami-glide-mono-legato-v23.4.3
// mct-origami-pitch-mod-real-v23.3
// mct-origami-v34.2.1-performance-reinforcement
#pragma once
#include "ParameterRegistry.h"
#include "Voice.h"
#include "OscillatorModule.h"
#include "InstrumentState.h"
#include "RenderBudget.h"
#include <array>
#include <atomic>
#include <cstddef>
namespace mct::origami {
struct RuntimeVisualizationSnapshot {
    static constexpr std::size_t waveformBins=256;
    std::array<float,12> sourceValues{};
    std::array<float,12> sourcePhases{};
    // Observed voice's MIDI/control sources, copied at visualization cadence.
    std::array<float,4> performanceSources{}; // wheel, pressure, bend, gate
    // mct-origami-nodes-n01: raw modulation source slots exactly as the route
    // evaluator reads them (global slots, then the newest voice's slots; voice
    // slots are 0 while no voice sounds). Feeds the Matrix route monitors.
    ModulationSourceSlots routeSources{};
    // N05: monotonic per-operator EVENT counters (activity display only).
    std::array<std::uint32_t,ModulationState::maxControlOperators> operatorEvents{};
    std::uint32_t sequencerStep=0; // N06: current canonical sequencer step (display)
    float chaosY=0.5f;
    std::array<OscillatorModuleId,16> moduleIds{};
    std::array<float,16> oscillatorPhases{};
    std::array<std::array<float,waveformBins>,16> oscillatorWaveforms{};
    std::array<std::array<std::uint8_t,waveformBins>,16> oscillatorWaveformValid{};
    bool active=false;
};
class OrigamiEngine {
public:
    static constexpr std::size_t voiceCount = 16;
    OrigamiEngine() noexcept;
    // Non-realtime, exclusive access. prepare may allocate or throw bad_alloc.
    bool prepare(double sampleRate, std::size_t maximumBlockSize, unsigned outputChannels);
    bool installWavetable(dsp::Wavetable table); // validate/move with processing stopped
    // Install an editor-authored table for one oscillator module. Caller must
    // serialize this non-realtime mutation against processBlock.
    bool installWavetableForOscillator(OscillatorModuleId id,dsp::Wavetable table);
    // mct-origami-dsp-performance-stereo-chain: realtime-safe editor table
    // handoff while processing runs. Any non-audio thread may publish (it
    // validates, stamps and allocates). The audio thread adopts every published
    // table at the next host-block boundary by SWAPPING it into the module's
    // slot: nothing is allocated, copied or freed on the audio thread. The
    // replaced table travels back in the same holder and is freed by the next
    // non-audio call (publish / collect) or the destructor.
    bool publishWavetableForOscillator(OscillatorModuleId id,dsp::Wavetable table);
    void collectRetiredWavetables() noexcept;
    bool wavetableHandoffPending() const noexcept { return wavetableIncoming_.load(std::memory_order_acquire)!=nullptr; }
    ~OrigamiEngine();
    OrigamiEngine(const OrigamiEngine&)=delete;
    OrigamiEngine& operator=(const OrigamiEngine&)=delete;
    bool applyPatchState(const ParameterValues& values) noexcept; // exclusive, resets voices
    InstrumentState instrumentState() const noexcept; // serialize writers externally
    bool restoreInstrumentState(const InstrumentState&) noexcept; // exclusive, transactional
    // mct-origami-fx-graph-dsp-bus-routing-p02: canonical bus list (Mixer-owned later).
    bool setBusState(const BusState&) noexcept;
    // mct-origami-nodes-n05-events-logic: host tempo/transport, sampled once
    // per callback by the host adapter (render thread, before beginHostBlock).
    // The engine advances a sample-exact beat position from it; CLOCK and
    // TRANSPORT nodes read that position. No UI timing is ever involved.
    struct HostTransport { double bpm=120.0; double ppq=0.0; bool ppqValid=false; bool playing=false; };
    void setHostTransport(const HostTransport&) noexcept;
    double transportBeats() const noexcept { return beats_; }
    // mct-origami-fx-modulation-graph-ux-p03
    // FX destinations of the canonical modulation system, evaluated per span
    // (audio thread; read by the FX renderer on the same thread).
    const FxModulationOutput& fxModulationOutput() const noexcept { return fxModulation_; }
    // FX ORDER = PRE MASTER: voices skip master gain; the host applies
    // blockMasterGain() after the FX graph. Latched at host-block start.
    void setMasterAfterFx(bool enabled) noexcept { masterAfterFx_.store(enabled,std::memory_order_relaxed); }
    bool masterAfterFxActive() const noexcept { return hostMasterAfterFx_; }
    float blockMasterGain() const noexcept { return blockMaster_; }
    bool setModulationState(const ModulationState&) noexcept; // serialized non-realtime writer
    ParameterValues parameterState() const noexcept;
    // Atomic targets are the sole cross-thread API. Multi-parameter patch commits
    // require exclusive access; hosts dispatch MIDI/process/reset on the audio thread.
    bool setParameter(ParameterId id, float physicalValue) noexcept;
    bool setParameter(std::string_view id, float physicalValue) noexcept;
    void reset() noexcept;
    bool noteOn(int note, float velocity, std::uint8_t channel = 0, std::uint32_t noteId = 0) noexcept;
    bool noteOff(int note, std::uint8_t channel = 0, std::uint32_t noteId = 0) noexcept;
    void allNotesOff() noexcept;
    void pitchWheel(std::uint8_t channel,int value14) noexcept;
    void modWheel(std::uint8_t channel,int value7) noexcept;
    void aftertouch(std::uint8_t channel,int value7) noexcept;
    bool setPitchBendRange(float semitones) noexcept;
    bool setPitchBendRanges(float upSemitones,float downSemitones) noexcept;
    float pitchBendRange() const noexcept { return pitchBendRange_.load(std::memory_order_relaxed); }
    float pitchBendDownRange() const noexcept { return pitchBendDownRange_.load(std::memory_order_relaxed); }
    bool setPerformanceState(const PerformanceState&) noexcept;
    PerformanceState performanceState() const noexcept;
    // Replaces output, planar mono/stereo. Buffers must be distinct and valid for
    // sampleCount. Any block length is supported; zero frames is a harmless no-op.
    bool process(float* const* output, unsigned channels, std::size_t sampleCount) noexcept;
    bool beginHostBlock(unsigned channels) noexcept;
    bool processSpan(float* const* output, unsigned channels, std::size_t sampleCount) noexcept;
    // mct-origami-unified-routing-core-fx-p04: also renders user buses.
    // aux holds 2*(maxRenderBuses-1) planar pointers (L,R per user slot);
    // null pointers are skipped. MAIN is still written to output.
    bool processSpan(float* const* output, unsigned channels, std::size_t sampleCount,float* const* aux) noexcept;
    std::size_t renderBusCount() const noexcept { return hostBusSlots_.count; }
    void endHostBlock() noexcept;
    VoiceInfo voiceInfo(std::size_t index) const noexcept;
    std::size_t activeVoiceCount() const noexcept;
    RenderLoad renderLoad() const noexcept;
    void setVoiceAdmissionCeiling(std::size_t ceiling) noexcept;
    // Global timing bridge: ARP owns note scheduling, modulation owns the derived swing value.
    void setGlobalSwingBase(float swing) noexcept;
    float modulatedSwing() const noexcept { return currentSwing_; }
    std::size_t voiceAdmissionCeiling() const noexcept { return voiceAdmissionCeiling_; }
    // mct-origami-multi-osc-foundation-v20
    OscillatorModuleId addOscillatorModule() noexcept;
    bool removeOscillatorModule(OscillatorModuleId id) noexcept;
    std::size_t oscillatorModuleCount() const noexcept { return oscillatorModules_.count(); }
    const OscillatorModuleBank& oscillatorModules() const noexcept { return oscillatorModules_; }
    bool setOscillatorModuleState(OscillatorModuleId id,const OscillatorModuleState& state) noexcept;
    OscillatorModuleState oscillatorModuleState(OscillatorModuleId id) const noexcept;
    bool setOscillatorModuleEnabled(OscillatorModuleId id,bool enabled) noexcept;
    bool oscillatorModuleEnabled(OscillatorModuleId id) const noexcept;
    // Audio-thread policy: observation only; synthesis always remains audio-rate.
    void setVisualizationPolicy(bool suppress,bool reduceControlRate) noexcept {
        suppressVisualization_=suppress;reduceVisualizationRate_=reduceControlRate;
    }
    const RuntimeVisualizationSnapshot& runtimeVisualizationSnapshot() const noexcept { return runtimeVisualization_; }
    // N07 NODES diagnostics: bounded monotonic counters written by the audio
    // thread (relaxed atomics, no locks), readable from any thread. They never
    // influence DSP.
    struct NodesDiagnostics {
        std::uint32_t compiles=0,parameterUpdates=0,compileSkips=0;
        std::uint64_t stateRevision=0;
        std::uint32_t eventDelayOverflows=0;   // EVENT DELAY events dropped (queue full)
        std::uint32_t suppressedBlocks=0;      // blocks rendered with observation suppressed (QoS)
    };
    NodesDiagnostics nodesDiagnostics() const noexcept {
        NodesDiagnostics d;
        d.compiles=diagCompiles_.load(std::memory_order_relaxed);
        d.parameterUpdates=diagParameterUpdates_.load(std::memory_order_relaxed);
        d.compileSkips=diagCompileSkips_.load(std::memory_order_relaxed);
        d.stateRevision=diagStateRevision_.load(std::memory_order_relaxed);
        d.eventDelayOverflows=diagEventOverflows_.load(std::memory_order_relaxed);
        d.suppressedBlocks=diagSuppressedBlocks_.load(std::memory_order_relaxed);
        return d;
    }
private:
    void publishNodesDiagnostics() noexcept;
    std::atomic<std::uint32_t> diagCompiles_{0},diagParameterUpdates_{0},diagCompileSkips_{0},diagEventOverflows_{0},diagSuppressedBlocks_{0};
    std::atomic<std::uint64_t> diagStateRevision_{0};
    std::uint32_t eventOverflows_=0; // audio thread; published with the counters above
    struct Smoothed { float value=0, target=0; double step=0; std::size_t remaining=0; };
    dsp::EnvelopeSettings envelopeSettings() const noexcept;
    dsp::EnvelopeSettings modulationEnvelopeSettings(unsigned index) const noexcept;
    void publishModEnvelopeTargets(const ModulationState&) noexcept;
    void latchParameters() noexcept;
    float value(ParameterId id) const noexcept { return smooth_[static_cast<std::size_t>(id)].value; }
    ModulationState modulation_{}; // non-realtime model; never read in process
    LatestStateMailbox<ModulationState> modulationMailbox_;
    ModulationState audioModulation_{};
    CompiledModulation compiledModulation_;
    OscillatorRenderPlan oscillatorPlan_;
    std::array<OscillatorModuleId,16> compiledModuleIds_{};
    std::array<Lfo,4> globalLfos_{};
    RandomGenerator globalRandom_{};
    FunctionGenerator globalFunction_{};
    ChaosGenerator globalChaos_{};
    DriftGenerator globalDrift_{};
    SequencerGenerator globalSequencer_{};
    std::array<float,maxMacros> smoothedMacros_{}; // by macro id - 1
    float modulationSmoothing_=1;
    OscillatorModuleBank oscillatorModules_;
    std::uint64_t hostModuleGeneration_=0;
    std::array<std::atomic<float>, parameterCount> targets_;
    std::array<Smoothed, parameterCount> smooth_ {};
    std::array<OscillatorModuleState, OscillatorModuleBank::capacity> hostModules_ {};
    double hostNormalization_ = 1.0;
    float hostBendRange_ = 2.0f;
    float hostBendDownRange_ = 2.0f;
    float currentPortaTime_=0.0f;
    float currentEnvelopeScaling_=1.0f;
    float currentLfoScaling_=1.0f;
    float globalSwingBase_=0.0f,currentSwing_=0.0f;
    unsigned hostChannels_ = 0;
    bool hostBlockActive_ = false;
    std::array<Voice, voiceCount> voices_;
    // Patch 09/19: voice stealing must not clone and double-render a complete
    // wavetable/modulation/filter Voice at the exact moment polyphony is saturated.
    // Preserve click-free continuity with a tiny residual sample tail instead.
    std::array<Voice::Samples, voiceCount> lastVoiceSamples_{};
    std::array<Voice::Samples, voiceCount> stealResidual_{};
    std::array<Voice::AuxSamples, voiceCount> lastAux_{};
    std::array<Voice::AuxSamples, voiceCount> stealAuxResidual_{};
    static BusSlotMap slotMapFor(const BusState&) noexcept;
    LatestStateMailbox<BusSlotMap> busSlotMailbox_;
    BusSlotMap hostBusSlots_{};
    std::array<std::size_t, voiceCount> tailRemaining_{};
    dsp::Wavetable wavetable_;
    // id != 0 <=> `table` is a validated table owned by that module. A removed
    // module's slot is released by the audio thread (id = 0) with its storage
    // kept: the next adopted table swaps it out to be freed off-thread.
    struct OscillatorWavetableSlot {
        OscillatorModuleId id=0;
        dsp::Wavetable table;
    };
    struct WavetableHandoff {
        OscillatorModuleId id=0;
        dsp::Wavetable table;
        WavetableHandoff* next=nullptr;
    };
    // Two lock-free stacks: the producer pushes / takes all, the audio thread
    // takes all / pushes. Push-only + take-all has no ABA hazard.
    std::atomic<WavetableHandoff*> wavetableIncoming_{nullptr},wavetableRetired_{nullptr};
    bool adoptWavetableHandoffs(WavetableHandoff* list) noexcept;
    OscillatorWavetableSlot* wavetableSlotFor(OscillatorModuleId id) noexcept;
    std::array<OscillatorWavetableSlot,OscillatorModuleBank::capacity> oscillatorWavetables_{};
    // mct-origami-nested-modulation-manual-qa: manual-edit dezipper. A
    // published module state that changes only continuous values (a UI knob
    // drag: same ids, types, sources, counts) glides from the rendered value
    // to the new one over `dezipSeconds`, per sample. Structural changes
    // jump. dezipModules_ is the module state the render reads (equal to
    // hostModules_ when nothing glides). Modulation is applied on top of it,
    // so LFO / ENV / macro / NODES modulation is never delayed.
public:
    static constexpr double dezipSeconds=0.010;
    static constexpr std::size_t dezipFieldCount=10+maxOscProcesses+maxOscRoutes;
    bool dezipping() const noexcept { return dezipActive_!=0; }
private:
    std::array<OscillatorModuleState,OscillatorModuleBank::capacity> dezipModules_{};
    // mct-origami-nested-modulation-manual-qa: the newest voice's per-voice
    // sources (previous sample) for GLOBAL nested targets, and the effective
    // (modulated) macro values for the UI.
    std::array<float,CompiledModulation::voiceSourceCount> newestVoiceSources_{};
    bool newestVoiceValid_=false;
    std::array<float,maxMacros> effectiveMacros_{};
public:
    // Effective macro value (base + incoming modulation), audio-thread value
    // published for the UI via the visualization snapshot.
    const std::array<float,maxMacros>& effectiveMacros() const noexcept { return effectiveMacros_; }
private:
    struct DezipRamp { std::uint32_t remaining=0; std::array<float,dezipFieldCount> step{}; };
    std::array<DezipRamp,OscillatorModuleBank::capacity> dezipRamps_{};
    std::uint32_t dezipActive_=0;
    void startDezip() noexcept;
    void advanceDezip(std::array<OscillatorModuleState,OscillatorModuleBank::capacity>& modules) noexcept;
    std::array<const dsp::Wavetable*,OscillatorModuleBank::capacity> hostWavetables_{};
    void rebuildHostWavetables() noexcept;
    double sampleRate_ = 48000;
    unsigned outputChannels_ = 2;
    std::size_t stealFadeSamples_ = 144;
    std::uint64_t order_ = 0;
    struct HeldNote { NoteAddress address{}; float velocity=0; std::uint64_t order=0; bool held=false; };
    bool sameAddress(const NoteAddress&,const NoteAddress&) const noexcept;
    const HeldNote* selectedMonoHeld() const noexcept;
    std::size_t selectVoiceStealCandidate() const noexcept;
    void clearHeldNotes() noexcept;
    std::array<float,16> pitchBendNormalized_{};
    std::array<float,16> modWheel_{},aftertouch_{};
    std::array<std::atomic<float>,17> modEnvelopeTargets_{};
    std::atomic<float> pitchBendRange_{2.0f};
    std::atomic<float> pitchBendDownRange_{-2.0f}; // signed endpoint (full wheel down)
    PerformanceState performance_{};
    BusState buses_{}; // non-realtime model; the renderer only reads BUS 1 sends
    std::array<float,CompiledModulation::globalSourceCount> lastGlobalSources_{};
    std::array<float,operatorOutputSlotCount> lastGlobalOperators_{};
    double beats_=0.0,transportBpm_=120.0;
    bool transportPlaying_=false,pendingTransportStart_=false,pendingTransportStop_=false;
    FxModulationOutput fxModulation_{};
    std::atomic<bool> masterAfterFx_{false};
    bool hostMasterAfterFx_=false;
    float blockMaster_=1.0f;
    std::array<HeldNote,128> heldNotes_{};
    std::size_t heldCount_=0;
    // Deep Audit P07: this limits only future polyphonic admissions. Existing
    // voices are never terminated when the ceiling drops.
    std::size_t voiceAdmissionCeiling_=voiceCount;
    bool prepared_ = false;
    RuntimeVisualizationSnapshot runtimeVisualization_{};
    std::array<OscillatorModuleState,16> runtimeVisualizationModules_{};
    // UI observation is intentionally control-rate. Audio DSP remains sample-rate.
    // At 96 kHz this caps visualization bookkeeping near 1 kHz instead of 96 kHz.
    std::size_t runtimeVisualizationCountdown_=0;
    bool suppressVisualization_=false,reduceVisualizationRate_=false;
};
static_assert(std::atomic<float>::is_always_lock_free, "Origami requires lock-free float parameter targets");
}
