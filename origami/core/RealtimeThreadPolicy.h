// mct-origami-audio-reengineer-p19-aux-rt-thread-decision-gate
#pragma once

namespace mct::origami {

struct RealtimeThreadPolicy final {
    // Origami is host-callback-driven. This remains false until profiling
    // demonstrates that single-thread rendering cannot meet the release budget
    // after lower-risk optimization work has been exhausted.
    static constexpr bool auxiliaryRenderThreadsEnabled = false;

    // A future auxiliary-render design must never make the host callback wait
    // without a bounded deadline/fallback path.
    static constexpr bool audioCallbackMayBlockForWorker = false;

    // Worker-per-voice / worker-per-oscillator / worker-per-effect is explicitly
    // outside the supported architecture.
    static constexpr bool perDspObjectWorkersAllowed = false;
};

static_assert(!RealtimeThreadPolicy::auxiliaryRenderThreadsEnabled,
              "Patch 19 release policy requires single-thread host rendering");
static_assert(!RealtimeThreadPolicy::audioCallbackMayBlockForWorker,
              "Origami realtime callback must never block waiting for a worker");
static_assert(!RealtimeThreadPolicy::perDspObjectWorkersAllowed,
              "Origami must not create worker threads per DSP object");

} // namespace mct::origami
