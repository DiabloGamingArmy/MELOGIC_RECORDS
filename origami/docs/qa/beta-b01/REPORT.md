# B01 — adversarial DSP and release validation

Baseline: `85d7991f9026ef187b90c185e95f72beb7ca8896`, branch `mct-origami-nodes-visual-feedback-p03`. Baseline clean Release build (Standalone, AU, VST3) and all **9/9 existing CTest targets passed**, 61.65 seconds; no baseline test failures. Apple clang 17, arm64, macOS 26.6.2; local JUCE source checkout. This pass changes MIDI-boundary defects and test infrastructure only. No UI/features, gain limits or voice/unison reductions were added.

## Architecture and realtime boundary

`OrigamiAudioProcessor::processBlock` consumes prepared engine/module/modulation snapshots, splits rendering at MIDI offsets, renders oscillator voices and bus sends, executes prepared per-bus and GLOBAL FX plans, and applies `FinalOutputStage` once. Host state uses the existing pending-state mailbox; centralized document history snapshots and graph compilation remain on the control owner. Engine/FX publication retires owned objects off the callback. OSC phase/unison math, filters, modulation/Control graphs, bus compilation, serialization and final gain were inspected and exercised through their production paths.

The new executable checks every rendered sample for finite values, fixture amplitude limits and subnormal output under the production FTZ policy. Callback guards cover C++ allocation/deallocation and, on this Mac, libmalloc malloc/realloc/free with a probe self-test. This caught JUCE MIDI scratch reallocations that C++ new/delete guards alone missed. Instrumentation is confined to the test executable and excluded from sanitizer builds. No realtime logging, filesystem activity, blocking waits or new callback ownership destruction was introduced. Observing zero allocations in these runs is not a proof about all possible host interactions.

## Reproduced defects and fixes

| Severity | Reproduction | Correction / regression |
|---|---|---|
| P1 — callback heap activity | 100,000 short MIDI events exceeded the prepared scratch capacity; 3 MB SysEx caused owned `MidiMessage` storage allocation. libmalloc guard reported 6 allocations / 6 frees. | Stream host MIDI in place, merge the bounded UI queue, reject unsupported long data before constructing a message, and drain generated ARP events per input event / bounded 2,048-sample scheduler span. Short events retain ordering and exact offsets; final oversized-input note and unchanged host event count are asserted with ARP enabled and disabled. |
| P1 — stuck/retriggered ARP voices | Latch enabled, tempo 400, note, CC123: released voices could be resurrected by the next ARP step. | CC123/CC120 also reset physical/latched ARP ownership, then dispatch the stop to the engine. Both stop variants must settle to exact silence and admit subsequent input. |

No Origami crash, NaN/Inf, memory corruption or numerically divergent recurrence was observed. Sanitizer coverage limitations below prevent treating this as exhaustive.

## Coverage actually executed

- Rates **44,100 / 48,000 / 88,200 / 96,000 / 192,000 Hz**; block sizes **1, 2, 3, 8, 16, 17, 32, 63, 64, 127, 128, 256, 257, 512, 1,024, 2,048**. Matrices span core rendering, all production effects, modulation and Master; not every possible parameter combination is a Cartesian cross-product.
- Strict 440 Hz sine regression at all five rates with irregular blocks: residual power below `1e-7`, DC below `1e-4`, audible RMS and bounded peak. Four Basic Shapes frames; Natural/Fixed/Random/Free phase, phase/RAND endpoints, common/per-lane phase, hard pans, notes 0/60/127; all **43 OSC CHAIN types including Off** through actual voices.
- Unison **1/2/3/4/8/12/16**, detune **0/50/100**, changes during sounding notes, geometric tuning symmetry, 16-channel bends, dense admission/stealing and eventual release silence. Maximum core workload **16 MIDI voices × 16 OSC × 16 Unison = 4,096 lanes**; asserted actual admitted voice/module/unison counts. Scaling measurements also cover 1/8/16 voices × 1/4/16 OSC, all at 16 Unison. This core test bypasses the processor's time-dependent admission QoS, preserving the requested workload.
- All **9 synth filter types**, all five rates, rapid cutoff/resonance/gain sweeps; all **15 production FX** at all rates/block sizes, parameter minima/maxima/mixed/random settings and every enumerated choice. Includes single/multiband Compressor, EQ, Drive, Limiter, Filter/Comb, Chorus, Flanger, Phaser, Spatial, Delay, Reverb, Diffuse, Gain, Stereo Utility and Spectral Tune. Spectral Tune enumerates all 4,096 mask choices (4,126 settings/rate). No production Glitch effect exists to test.
- Loud deterministic FX input up to amplitude 8; silence settling; direct kernels checked before renderer/final-output guards. Delay/Reverb/Flanger/Phaser/Comb maximum-feedback impulse tails rendered for 90 seconds each; final second peak below `1e-5`.
- ENV1–3, LFO1–4, Random, Function, Chaos, Drift, Sequencer, Macro; bipolar/max-depth simultaneous routes, host-style base changes, republished routes and a 32-operator graph at all rates; invalid self-cycle rejected. Existing suite additionally covers graph topology mutations and editor/canonical synchronization.
- 256 dense MIDI blocks across all 16 channels, repeated/overlapping notes, 100,000-event buffers, 3 MB SysEx, pitch bend extremes, CC64 traffic, CC123/120 and Panic/recovery. **CC64 sustain is not implemented**; this establishes safe ignored input and release, not sustain functionality. Processing time necessarily grows with host input count; no deadline guarantee is claimed for arbitrary event floods.
- 512 FX insert/bypass/remove/compile cycles; 128 sounding bus create/reroute/FX/delete cycles, graph cycle rejection without mutation. Existing routing tests also cover graph topology and bus ownership. Bus gain/pan mixer controls are not implemented; oscillator sends and FX Gain/Spatial/Stereo paths are exercised instead.
- 200 complex A→mutate B→restore A host-state transitions while sounding: four OSC, Unison, random phase, routed bus FX, main FX, 32 Nodes, Matrix and Master; exact serialized equivalence. Truncated structurally plausible host chunks leave state unchanged. Existing state/plugin suites cover missing/older fields, custom wavetable PCM/identity, preset loading, host parameter reconciliation and preset/Nodes UI synchronization.
- **576 history edits + 576 Undo + 576 Redo**, across Master, performance, OSC creation/deletion, bus creation/deletion, Nodes/Matrix empty/full, FX insertion/removal, Unison and routing. Audio runs between edits/replays; each fixture edit must create exactly one entry and every replay must match canonical serialized state. Redo branching and 64-entry/128 MiB bounds asserted. Existing tests add preset and wavetable replay and editor binding checks.
- Five minutes / **14.4 million stereo frames** offline with complex routing/FX/Nodes, eight-note chords and detune changes; every output sample checked; exact silence after Panic. Resident memory sampled after one minute and at completion, diagnostic only (allocator/worker caches and OS residency can vary; no leak-proof claim).
- **20 processor construction/destruction cycles × five rates**, repeated release/reprepare, 257-sample actual callback after preparation for 17, then size 3; simultaneous independent instance state unchanged. Supported output configuration is stereo; no unsupported multichannel claim.
- Master true mute, very low, −12 dB, unity and +6 dB, rapid movement and 20 ms settling at all rates; L/R ratio and post-gain meters. Existing tests retain header/Global canonical identity and exclusion from internal modulation.

## Failure investigation without masking

Early fixture failures were investigated rather than relaxed: a block ending the last voice's release legitimately contained its final samples, so exact-zero is checked on the next block; Drive bias/DC smoothing is allowed its existing two-second settling period before the same strict silence assertion. A structural-history fixture initially requested an unchanged Unison value; it now alternates actual values and requires one history entry per edit.

Stacking all eight EQ bands at their maximum resonant settings produced approximately **53 million peak** under the deliberately loud/rapidly automated fixture. The original generic amplitude ceiling was inappropriate for the requested cascaded transfer. An independent double-state EQ recurrence and independently calculated coefficients now compare every EQ fixture waveform (0.5% relative / `1e-5` absolute error) and bound its amplitude by that reference. All such settings matched. Other effects retain the fixed ceiling. This is expected extreme transfer gain, not an unstable recurrence; **it remains a substantial headroom/product risk**. No clipping, hidden attenuation, disabled configurations or gain-law changes were used to conceal it. Normal output is not guaranteed below full scale, and this pass does not establish safe monitoring levels.

## Diagnostics and final results

Clean Release Standalone/AU/VST3 build succeeded; **10/10 CTest targets passed**, 134.52 s. The B01 target passed all 13 sections: **2,093,958 checks, 317,295,042 individual channel samples, 391,063 renders/callbacks, zero failures** (73.47 s). Release libmalloc probe was available; all guarded callback allocation/deallocation assertions passed.

Existing release counts: state 2,779; engine 2,594,683; modulation 3,938; FX 653; spectral 3,954,183 (its independent RT allocation guards also passed); spectral quality 74; plugin/UI 1,644,098; content 98; wavetable foundation passed its named gate. Full UBSan CTest run: **10/10 passed**, 251.77 s; B01 **1,690,041 checks / 317,295,042 samples / 391,063 renders**, with allocation-interception checks intentionally excluded because the sanitizer owns that instrumentation; `halt_on_error=1`, no reported undefined behavior. See the adjacent test summaries and full B01 outputs for per-section evidence.

Release five-minute render: peak 0.034508, RMS 0.00643595; resident bytes **50,479,104 after one minute → 45,039,616 at completion**, without observed growth between those observations. This is a residency observation, not a leak detector.

ASan+UBSan configured and built successfully, but the Apple clang 17 AddressSanitizer runtime spun before `main` for approximately eight minutes. Sampling shows shadow-memory initialization allocating through dyld's shared-cache iteration and recursively entering the ASan initialization spin lock; no Origami stack executed. The test process was interrupted. See `asan-startup-stack.txt`. This is consistent with the allocation-during-Darwin-shadow-mapping problem addressed by [LLVM PR 167797](https://github.com/llvm/llvm-project/pull/167797); the local evidence is the captured stack, not an asserted toolchain-version diagnosis. **No ASan pass or absence of memory defects is claimed.** No suppression/workaround runtime patch was applied. `ORIGAMI_SANITIZERS` defaults to `address,undefined` and permits an explicit `undefined` build so practical UBSan validation can run independently. TSan was not run; this is not a complete data-race audit. Release binaries have no sanitizer instrumentation.

## Performance observations

Apple M5 Pro; final measurements ran with no other B01 build/test process active. Baseline measurements overlapped the existing test suite, so these numbers support checking for a large regression, **not a controlled speedup claim**. All **20/20 comparable output hashes matched exactly**; no spectral misses occurred. The baseline selector `simple` matched no named scenario; simple-patch timings below are final-only, without an invented baseline comparison.

| Workload @48 kHz / 256 | Baseline median / p99 µs | Final median / p99 µs |
|---|---:|---:|
| 1 osc unison 16, 16 voices | 376.9 / 399.4 | 376.7 / 401.5 |
| typical @ block 256 | 447.8 / 461.3 | 442.8 / 468.9 |
| heavy everything, 16 voices | 2087.9 / 2161.0 | 2060.8 / 2143.8 |

The full adjacent performance logs also include simple 1/8/16-voice patches, moderate block/rate variations, 32-route heavy effects and automation. Isolated core scaling at 48 kHz / 2,048: 16 lanes median **0.243 ms**; 256 lanes (16 voices, one OSC) **2.858 ms**; 1,024 lanes **9.573 ms**; 2,048 lanes **18.437 ms**; 4,096 lanes **36.421 ms**, observed p99 **36.673 ms** against a **42.667 ms** deadline. Counts stayed fully admitted. Scaling broadly follows lane count; this maximum workload consumes about 85% of one callback budget before additional heavy FX. An earlier run while compiling reached 44.199 ms at maximum load. Neither 64 measured blocks nor a core-only timing result guarantees hard realtime behavior, higher-rate maximum-load capacity or DAW/device performance. No speculative optimization was introduced.

Clean compilation succeeded with existing repository/JUCE warnings; this pass does not claim a warning-free build or perform unrelated warning cleanup.

## Remaining uncertainty / beta decision

The two reproducible P1 defects are fixed and covered by regression tests. Extreme stacked EQ headroom, maximum-load deadline margin and incomplete ASan memory diagnostics need explicit consideration before beta sign-off. **Recommendation: block Beta 0.1 sign-off until functional ASan coverage and the extreme EQ headroom review are complete.** This is a validation/product-risk block, not a claim that the expected EQ transfer is a newly discovered unstable recurrence. This pass **does not declare Beta 0.1 ready**. Repeat ASan with a functioning Darwin runtime before claiming memory-safety validation; assess extreme EQ amplification and real-device/DAW deadline behavior before a general readiness claim. Automated processor state/lifecycle coverage does not replace interactive project round-trips or listening tests across supported DAWs/platforms. Offline finite-output checks do not establish absence of every audible aliasing/transient defect.

## Reproduction

```sh
cmake -S origami -B origami/build-multihost -DCMAKE_BUILD_TYPE=Release \
  -DORIGAMI_BUILD_TESTS=ON -DORIGAMI_BUILD_VST3=ON \
  -DJUCE_DIR=/path/to/JUCE
cmake --build origami/build-multihost --clean-first --parallel 6
ctest --test-dir origami/build-multihost --output-on-failure
origami/build-multihost/origami_dsp_torture
# Optional named section: matrix, oscillator, filters, effects, midi, arpStop,
# modulation, master, tails, states, routing, lifecycle, long.
cmake -S origami -B origami/build-b01-sanitizers -DCMAKE_BUILD_TYPE=RelWithDebInfo \
  -DORIGAMI_BUILD_PLUGIN=ON -DORIGAMI_BUILD_TESTS=ON \
  -DORIGAMI_SANITIZE=ON -DORIGAMI_SANITIZERS=undefined \
  -DJUCE_DIR=/path/to/JUCE
cmake --build origami/build-b01-sanitizers --parallel 6
UBSAN_OPTIONS=halt_on_error=1:print_stacktrace=1 \
  ctest --test-dir origami/build-b01-sanitizers --output-on-failure
origami/build-multihost/origami_perf_bench '1 osc,' 'typical' 'heavy everything' 'unison 16'
```
