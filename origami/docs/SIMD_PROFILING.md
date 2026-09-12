# Origami SIMD / vectorization profiling

Patch 18 intentionally does **not** add an explicit SIMD library or rewrite the DSP layout.

The architecture audits require profiling first. The hot path contains stateful oscillator objects, branch-heavy process/routing logic, per-lane phase state, modulation, recursive filters, and transcendental functions. Some loops may auto-vectorize; others may require a structure-of-arrays redesign before explicit SIMD can help.

Run:

```bash
./scripts/run-simd-profile.sh
```

The script creates three independent Release/LTO builds:

1. `baseline` — normal compiler auto-vectorization.
2. `no_autovec` — same source with Clang/GCC auto-vectorization disabled.
3. `vector_reports` — compiler diagnostics showing optimized, missed, and analyzed vectorization opportunities.

The benchmark covers increasing synth density plus the standalone 2048-point spectral transform.

Interpretation:

- A large baseline-vs-no-autovec improvement means the compiler is already extracting useful SIMD; inspect the report before writing intrinsics.
- A small difference means explicit SIMD is not automatically justified. Look for dominant missed loops and their blockers.
- `Voice::nextModules()` is a likely structural hotspot because unison lanes are independent in concept but stored as stateful oscillator objects and called through branch-heavy processing.
- `WavetableOscillator::next()` has per-oscillator phase mutation and wavetable/process branching, which may inhibit vectorization across samples.
- Spectral FFT/IFFT loops can be computationally large, but spectral construction should not become a reason to accept realtime cache-miss construction. Profile it separately.
- Do not trade numerical correctness, deterministic routing, MIDI timing, or the realtime no-allocation/no-lock contract for SIMD.

Patch 18 is complete when we have repeatable measurements and compiler evidence. Any actual SIMD/SoA rewrite should be a follow-up justified by those results, not an assumption.
