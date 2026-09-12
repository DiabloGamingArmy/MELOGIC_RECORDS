# Auxiliary realtime threading decision

## Patch 19 conclusion

Origami remains **single-realtime-threaded**: the host's audio callback thread performs realtime DSP.

This is not a missing optimization. It is the deliberate result of the audio reliability audit.

The audit ranked auxiliary render threads as:

- effort: **very high**
- regression risk: **high**
- expected impact: potentially high
- priority: **only if profiling proves necessary**

It also specifically recommends one realtime DSP thread and warns that coordination overhead, cache movement, worker wakeup timing, synchronization, and deadline joins can cost more than the work they save.

## What Patch 19 does

Patch 19 does **not** create audio worker threads.

It establishes three permanent rules:

1. `processBlock()` must never block waiting for an auxiliary renderer.
2. Origami must not create one worker per voice, oscillator, effect, or graph node.
3. An auxiliary-render implementation cannot be enabled until profiling and platform scheduling work have been reviewed explicitly.

`ORIGAMI_ENABLE_AUX_RT_THREADS` exists as a **hard decision gate**, not as a working feature. Turning it on intentionally fails configuration.

## Evidence required before reconsideration

First run Patch 18:

```bash
./scripts/run-simd-profile.sh
```

Then:

```bash
python3 ./scripts/evaluate-aux-rt-threading.py
```

The evaluator can only make a case for **manual feasibility review**. It never turns auxiliary threading on.

Before implementation, all of the following must be true:

- real host/plugin callback telemetry still shows unacceptable p95/p99/max deadline use after lower-risk optimization;
- zero-allocation, zero-lock, zero-FFT-build render-path requirements are still passing;
- SIMD/SoA/algorithmic opportunities from Patch 18 have been evaluated;
- QoS and bounded topology policy are insufficient on the target workloads;
- the selected workload has coarse, independent jobs large enough to amortize wakeup/cache/synchronization overhead;
- a late worker cannot force an unbounded wait on the host callback.

## If auxiliary realtime rendering is ever justified

The design must remain host-callback-driven.

A future design should use a **small fixed worker count**, never thread-per-object. Work should be partitioned from an immutable render plan into predeclared jobs with preallocated output/scratch storage.

The host callback must have a deterministic deadline policy. If a worker is not ready by the permitted join point, the callback must use a safe fallback rather than block indefinitely.

Platform scheduling is part of correctness:

- Apple auxiliary realtime audio threads must integrate correctly with the host's Audio Workgroup where applicable.
- Windows auxiliary pro-audio work must use the appropriate system scheduling model; the plugin must not arbitrarily raise or hijack the DAW callback priority.
- Other platforms need equivalent explicit realtime scheduling analysis before shipping.

## Current decision

**NO auxiliary realtime renderer is implemented.**

The correct architecture today is:

```text
UI / model
    |
non-RT preparation / compilation
    |
lock-free publication
    |
HOST AUDIO CALLBACK  <-- the only realtime DSP thread
    |
audio output
```

This closes the 19-patch reengineering roadmap without introducing a high-risk synchronization architecture that the profiling has not yet justified.
