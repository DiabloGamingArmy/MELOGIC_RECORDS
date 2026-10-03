// mct-origami-fx-graph-dsp-bus-routing-p02
#pragma once
#include "core/fx/FxGraph.h"
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
    float wet=1.0f;          // bypass crossfade position (1 = processing)
    bool processing=true;    // false once fully bypassed: DSP is skipped
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
};

struct PreparedFxPlan {
    std::array<FxPlanStep,FxGraph::maxNodes> steps{};
    std::size_t stepCount=0;
    bool hasOutput=false;
    std::uint8_t outputBuffer=0;
    // BUS 1 -> MASTER OUT with nothing in between: the renderer may skip work.
    bool identity=false;
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
    bool sync(const FxGraph&);
    std::uint64_t compileCount() const noexcept { return compileCount_; }

    // ---- UI telemetry: bounded, lock-free, consumed with reset.
    std::pair<float,float> consumePeaks() noexcept;

    // ---- realtime
    void process(float* left,float* right,int samples) noexcept;

private:
    static std::vector<std::uint32_t> topologyKey(const FxGraph&);
    void publish(std::unique_ptr<PreparedFxPlan>);
    void drainRetired() noexcept;
    void adoptPending() noexcept;
    void renderChunk(float* left,float* right,int n) noexcept;
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
    float inputGainNow_=1.0f,dryWetNow_=1.0f,widthNow_=1.0f,outputGainNow_=1.0f;
    float smoothing_=0.999f,bypassStep_=0.01f;

    std::vector<float> pool_;             // (maxNodes + 2) stereo chunk buffers
    std::atomic<float> peakLeft_{0.0f},peakRight_{0.0f};
};
}
