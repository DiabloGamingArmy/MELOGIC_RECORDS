// mct-origami-unified-routing-core-fx-p04
// mct-origami-fx-modulation-graph-ux-p03
// mct-origami-fx-graph-dsp-bus-routing-p02
#pragma once
#include "core/fx/FxGraph.h"
#include "core/dsp/StreamingSpectrum.h"
#include "core/modulation/Modulation.h"
#include <array>
#include <atomic>
#include <map>
#include <memory>
#include <utility>
#include <vector>

// Canonical FxGraph -> FxGraphCompiler -> PreparedFxPlan -> FxRenderer.
//
// Compilation (message thread) resolves execution order, port->buffer routing,
// split/merge fan-out/in and effect instances. The renderer (audio thread)
// receives only the immutable plan; it never sees FxGraph, never searches by
// ID, never allocates, locks or builds strings.
namespace mct::origami::fx {

// One live effect. The processor's DSP state survives recompiles that keep
// the node (same ID and type), so editing the graph never resets a tail.
struct FxNodeInstance {
    FxNodeId node=invalidFxNodeId;
    const FxEffectDescriptor* descriptor=nullptr;
    std::unique_ptr<FxProcessor> processor;
    // Message thread -> audio thread: canonical normalized values in
    // descriptor order, and the PWR state.
    std::array<std::atomic<float>,maxFxParameters> targets{};
    std::atomic<bool> enabled{true};
    // Audio-thread-owned.
    std::array<float,maxFxParameters> latched{};
    // Offsets from the canonical modulation system (normalized span fraction).
    std::array<float,maxFxParameters> modulation{};
    float wet=1.0f;          // bypass crossfade / tail-gate position (1 = processing)
    bool processing=true;    // zero-latency DSP may sleep; streaming DSP stays warm
    dsp::StereoLatencyDelay bypassDry,tailGate;
    int silentSamples=0;     // TAIL PRESERVE: consecutive near-silent tail samples
};

enum class FxStepKind : std::uint8_t { Source, Effect, Split, Merge, Output };

struct FxPlanStep {
    FxStepKind kind=FxStepKind::Source;
    std::uint8_t inputCount=0;
    std::array<std::uint8_t,FxGraph::maxBranches> inputs{}; // buffer indices
    std::uint8_t output=0;                                  // buffer index
    float inputGain=1.0f;                                   // merge: 1/N
    FxBusId bus=0;
    FxNodeInstance* instance=nullptr;
    mutable std::array<dsp::StereoLatencyDelay,FxGraph::maxBranches> inputDelays;
};

struct PreparedFxPlan {
    std::array<FxPlanStep,FxGraph::maxNodes> steps{};
    std::size_t stepCount=0;
    bool hasOutput=false;
    std::uint8_t outputBuffer=0;
    // BUS 1 -> MASTER OUT with nothing in between: the renderer may skip work.
    bool identity=false;
    int latencySamples=0;
    mutable dsp::StereoLatencyDelay dryDelay,outputPadding;
    // Ownership only; never touched by the audio thread.
    std::vector<std::shared_ptr<FxNodeInstance>> instances;
};

class FxGraphCompiler {
public:
    void prepare(double sampleRate); // drops cached instances (new sample rate)
    // nullptr when the graph is invalid; callers keep the previous plan.
    std::unique_ptr<PreparedFxPlan> compile(const FxGraph&);
    // Publishes canonical parameter/PWR values to live instances.
    void pushParameters(const FxGraph&) noexcept;
    double sampleRate() const noexcept { return sampleRate_; }
private:
    double sampleRate_=48000.0;
    std::map<FxNodeId,std::shared_ptr<FxNodeInstance>> cache_;
};

class FxRenderer {
public:
    static constexpr int chunk=256;
    FxRenderer();
    ~FxRenderer();
    FxRenderer(const FxRenderer&)=delete;
    FxRenderer& operator=(const FxRenderer&)=delete;

    // ---- non-realtime (message thread / prepareToPlay; never concurrent with process)
    void prepare(double sampleRate);
    // Compile if topology changed, push parameters + globals, publish.
    // Returns false (keeping the previous plan) if the graph is invalid.
    // applyGraphGlobals=false: bus renderers stay graph-only (neutral globals);
    // GLOBAL FX is applied once on the summed master by FxEnvironment.
    bool sync(const FxGraph&,bool applyGraphGlobals=true);
    int latencySamples() const noexcept { return renderedLatency_.load(std::memory_order_acquire); }
    int graphLatencySamples() const noexcept { return latency_.load(std::memory_order_acquire); }
    // Environment publishes complete bus transactions. Writer detaches plans;
    // audio adoption uses the renderer's existing off-thread retirement queue.
    std::unique_ptr<PreparedFxPlan> detachPendingPlan() noexcept { return std::unique_ptr<PreparedFxPlan>(pending_.exchange(nullptr)); }
    bool canAdoptPlan() const noexcept;
    void adoptPlan(PreparedFxPlan*) noexcept;
    void setAlignedLatency(int samples);
    void setBypassMode(FxBypassMode) noexcept;
    // Which bus this renderer serves (modulation slots are bus-qualified).
    // Rebinding to a different bus drops cached effect instances so no DSP
    // state leaks between bus graphs; message thread only.
    void bind(FxBusId);
    FxBusId boundBus() const noexcept { return bus_.load(std::memory_order_relaxed); }
    bool identity() const noexcept { return identity_.load(std::memory_order_relaxed); }
    std::uint64_t compileCount() const noexcept { return compileCount_; }

    // ---- UI telemetry: bounded, lock-free, consumed with reset.
    // Node telemetry contract (P03):
    // - opt-in: nothing is published (no work at all) until enabled;
    // - one snapshot per node per block, of the signal LEAVING the node
    //   (after bypass / crossfade), from the Effect step that renders it;
    // - disabling stops future publication only: the last snapshot stays
    //   readable (same sequence) until its node leaves the plan or the
    //   renderer is re-prepared, which release the slot;
    // - samples are read coherently (seqlock); peaks are consume / reset;
    // - an id that is not a live node of the plan never has telemetry.
    std::pair<float,float> consumePeaks() noexcept;

    static constexpr std::size_t telemetrySamples=64;
    struct NodeTelemetrySnapshot {
        FxNodeId node=invalidFxNodeId;
        std::array<float,telemetrySamples> left{},right{};
        float peakLeft=0.0f,peakRight=0.0f;
        std::uint64_t sequence=0; // publications of this node since its slot was claimed
        bool valid=false;
        FxSpectrumSnapshot spectrum{};
        bool hasSpectrum=false;
    };
    NodeTelemetrySnapshot consumeNodeTelemetry(FxNodeId) noexcept;
    void setTelemetryEnabled(bool enabled) noexcept { telemetryEnabled_.store(enabled); }

    // ---- realtime
    // modulation: FX destinations of the canonical modulation system (may be null).
    // preMaster: FX ORDER = PRE MASTER; masterGain is then applied after the graph.
    void process(float* left,float* right,int samples,const FxModulationOutput* modulation=nullptr,
                 bool preMaster=false,float masterGain=1.0f,float* alignedDryLeft=nullptr,float* alignedDryRight=nullptr) noexcept;
    void emergencyResetRuntime() noexcept;

private:
    static std::vector<std::uint32_t> topologyKey(const FxGraph&);
    void publish(std::unique_ptr<PreparedFxPlan>);
    void drainRetired() noexcept;
    void adoptPending() noexcept;
    void renderChunk(float* left,float* right,int n,float* alignedDryLeft,float* alignedDryRight) noexcept;
    void applyModulation(const FxModulationOutput*) noexcept;
    void processEffect(const FxPlanStep&,float* outL,float* outR,int n) noexcept;
    float* buffer(std::size_t index,int channel) noexcept {
        return pool_.data()+(index*2+static_cast<std::size_t>(channel))*chunk;
    }

    FxGraphCompiler compiler_;
    FxGraph lastGraph_;
    std::vector<std::uint32_t> lastKey_;
    std::uint64_t compileCount_=0;

    std::atomic<PreparedFxPlan*> pending_{nullptr};
    PreparedFxPlan* active_=nullptr; // audio-thread-owned between prepare() calls
    static constexpr std::size_t retireCapacity=32;
    std::array<PreparedFxPlan*,retireCapacity> retired_{};
    std::atomic<std::size_t> retireWrite_{0},retireRead_{0};

    // Globals: message thread writes targets, audio thread smooths.
    std::atomic<float> inputGain_{1.0f},dryWet_{1.0f},width_{1.0f},outputGain_{1.0f};
    std::atomic<int> bypassMode_{static_cast<int>(FxBypassMode::Crossfade)};
    std::atomic<FxBusId> bus_{fxMainBusId};
    std::atomic<bool> identity_{true};
    std::atomic<int> latency_{0},renderedLatency_{0};
    int alignedLatency_=0;
    float inputGainNow_=1.0f,dryWetNow_=1.0f,widthNow_=1.0f,outputGainNow_=1.0f;
    float postGainNow_=1.0f,postGainTarget_=1.0f;
    bool postGainActive_=false;
    double sampleRate_=48000.0;
    // Modulation slot -> (instance, parameter index), resolved only on change.
    std::uint64_t modulationGeneration_=~std::uint64_t{0};
    const PreparedFxPlan* modulationPlan_=nullptr;
    std::array<FxNodeInstance*,maxFxModulationSlots> modulationTarget_{};
    std::array<std::uint8_t,maxFxModulationSlots> modulationIndex_{};
    float smoothing_=0.999f,bypassStep_=0.01f;

    std::vector<float> pool_;             // (maxNodes + 3) stereo chunk buffers
    std::atomic<float> peakLeft_{0.0f},peakRight_{0.0f};
    // One writer (the audio thread; prepare() with audio stopped). `guard` is
    // a seqlock: odd while the slot is written, so a reader never accepts a
    // half-written snapshot. `node` and `published` are written under it.
    struct NodeTelemetrySlot {
        std::atomic<std::uint64_t> guard{0};
        std::atomic<FxNodeId> node{invalidFxNodeId};
        std::atomic<std::uint64_t> published{0};
        std::array<std::atomic<float>,telemetrySamples> left{},right{};
        std::atomic<float> peakLeft{0.0f},peakRight{0.0f};
        std::array<std::atomic<float>,FxSpectrumSnapshot::bins> spectrumInput{},spectrumOutput{};
        std::atomic<float> spectrumLow{20},spectrumHigh{20000},spectrumRate{48000};
        std::atomic<unsigned> spectrumMask{4095};
        std::atomic<std::uint64_t> spectrumSequence{0};
    };
    std::array<NodeTelemetrySlot,FxGraph::maxNodes> nodeTelemetry_{};
    std::atomic<bool> telemetryEnabled_{false};
    void publishNodeTelemetry(FxNodeInstance&,const float*,const float*,int) noexcept;
    // Frees the slots of nodes that are not Effect steps of the active plan
    // (graph churn never exhausts the fixed slot array). Audio thread, on
    // plan adoption only; bounded by maxNodes x steps.
    void releaseStaleTelemetry() noexcept;
    static void releaseTelemetrySlot(NodeTelemetrySlot&) noexcept;
};
}
