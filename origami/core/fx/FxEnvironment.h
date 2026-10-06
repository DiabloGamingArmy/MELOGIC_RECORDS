// mct-origami-unified-routing-core-fx-p04
#pragma once
#include "core/fx/FxRenderer.h"
#include "core/BusModel.h"
#include <array>
#include <atomic>
#include <memory>
#include <utility>
#include <vector>

// Realtime FX execution for every audio bus:
//
//   oscillator bus sends (engine render slots: 0 = MAIN, 1..7 = user buses)
//        -> input gain (GLOBAL FX)
//        -> one prepared FxRenderer per bus (its own compiled graph)
//        -> bus outputs summed into the master
//        -> GLOBAL FX: dry/wet (vs the unprocessed sum), width, output gain,
//           post-FX master gain when FX ORDER = PRE MASTER
//
// Every bus is processed whether or not its graph is on screen. Allocation-
// and lock-free; all memory is prepared up front.
namespace mct::origami::fx {

class FxEnvironment {
public:
    static constexpr int chunk=FxRenderer::chunk;
    FxEnvironment();

    // ---- non-realtime (never concurrent with process)
    void prepare(double sampleRate);
    // Slot order must match the engine's BusSlotMap (BusState order).
    struct BusGraph { FxBusId bus; const FxGraph* graph; };
    void sync(const std::vector<BusGraph>& slots,const FxGlobalSettings& globals);
    std::uint64_t compileCount() const noexcept;
    std::pair<float,float> consumePeaks() noexcept;
    // mct-origami-manual-qa-ui-wavetable-fixes: the peak (L, R) of the signal
    // entering `bus`'s graph (what its IN node emits) since the last call.
    std::pair<float,float> consumeInputPeaks(FxBusId bus) noexcept;
    const FxRenderer& renderer(std::size_t slot) const noexcept { return *renderers_[slot]; }

    // ---- realtime. aux: 2*(maxRenderBuses-1) planar pointers (may be null).
    void process(float* mainLeft,float* mainRight,float* const* aux,std::size_t busCount,int samples,
                 const FxModulationOutput* modulation=nullptr,bool preMaster=false,float masterGain=1.0f) noexcept;

private:
    void processChunk(float* mainLeft,float* mainRight,float* const* aux,std::size_t buses,int offset,int n) noexcept;
    std::array<std::unique_ptr<FxRenderer>,maxRenderBuses> renderers_;
    std::atomic<std::size_t> activeBuses_{1};
    std::atomic<float> inputGain_{1.0f},dryWet_{1.0f},width_{1.0f},outputGain_{1.0f};
    float inputNow_=1.0f,dryWetNow_=1.0f,widthNow_=1.0f,outputNow_=1.0f,postNow_=1.0f;
    bool postActive_=false;
    float postTarget_=1.0f;
    const FxModulationOutput* modulation_=nullptr;
    float smoothing_=0.999f;
    std::vector<float> dry_; // 2*chunk
    std::atomic<float> peakLeft_{0.0f},peakRight_{0.0f};
    // Per render slot: max |x| of the bus input since the UI last read it.
    // Audio thread: relaxed loads / stores of floats only.
    std::array<std::atomic<float>,maxRenderBuses*2> inputPeak_{};
    void noteInputPeak(std::size_t slot,float left,float right) noexcept {
        if(left>inputPeak_[2*slot].load(std::memory_order_relaxed)) inputPeak_[2*slot].store(left,std::memory_order_relaxed);
        if(right>inputPeak_[2*slot+1].load(std::memory_order_relaxed)) inputPeak_[2*slot+1].store(right,std::memory_order_relaxed);
    }
};

}
