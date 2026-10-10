# Synth Filter editor and Panic corrective pass

Baseline: c0cec9eda430bc969db3cadab663e8c7aa5cfd7d. Branch: mct-origami-nodes-visual-feedback-p03. Local-only work; no push.

## 1. Filter architecture audit

The pre-edit ownership and reproduction are recorded in [AUDIT.md](AUDIT.md). Synth had no persisted type: eight authored slots, independent stereo double SVF integrators per voice, and a second static LOW-PASS presentation. Nodes owned nine type labels in FxEffects.cpp, eight float SVF modes plus its separate delay-based Comb processor. The processor owns authored state and prepared topology; Voices own Synth integrators; FxRenderer owns independent graph processors; FilterPanel owns message-thread controls/response paint. Mutable state remains separate.

FilterTypes.h now owns persistent IDs, names, Synth availability, Gain/resonance capability and frequency labels. Both menus derive directly from that table; Nodes' choice range/count/labels derive from its size. The bounded Synth control descriptors supply defaults, ranges and units. Type ID dispatches the coefficient design; FilterResponse.h provides the common complex TPT transfer calculation using each domain's actual coefficients. No routing architecture was rewritten.

## 2. Filter types

| ID | Canonical display name | Nodes | Synth | Kernel/controls |
|---:|---|---|---|---|
| 0 | LOW PASS | Yes | Yes | SVF low-pass; Cutoff/Res |
| 1 | HIGH PASS | Yes | Yes | SVF high-pass; Cutoff/Res |
| 2 | BAND PASS | Yes | Yes | Unity-center SVF band-pass; Frequency/Res |
| 3 | NOTCH | Yes | Yes | SVF notch; Frequency/Res |
| 4 | PEAK | Yes | Yes | SVF bell; Frequency/Res/Gain |
| 5 | ALL PASS | Yes | Yes | SVF phase filter; Frequency/Res |
| 6 | LOW SHELF | Yes | Yes | SVF shelf; Frequency/Res/Gain |
| 7 | HIGH SHELF | Yes | Yes | SVF shelf; Frequency/Res/Gain |
| 8 | COMB | Yes | Disabled, visible in shared menu | Existing feedback delay, damping and soft-limited feedback |

All eight Synth modes use Drive, Mix and Keytrack. Frequency is 20–20,000 Hz, normalized resonance 0–1 (Q .5–4), Drive 0–24 dB, Mix/Keytrack 0–1. Peak/shelves show Gain −24–24 dB, default 0. Other modes hide Gain. Defaults remain 8,000 Hz/.1 resonance/0 Drive/1 Mix/0 Keytrack. All-pass resonance/frequency affect phase; partial Mix therefore affects magnitude. Nodes retains its established Q .5–12 and existing parameter IDs/defaults rather than changing old sounds.

Comb remains unavailable in Synth because Nodes prepares two heap-backed power-of-two delay buffers (requested length fs/15 per channel), fractional delay, damping and nonlinear feedback. Multiplying this by eight slots and sixteen voices requires a separately budgeted prepared delay pool and an appropriate response model. No substitute SVF is exposed as Comb. The shared catalog records this reason. Each supported Synth mode costs the same fixed 160-byte stereo runtime; Nodes SVF integrators remain 8 bytes per channel, with coefficients and smoothing owned by FilterFx.

## 3. DSP audit

The existing low-pass recurrence is unchanged:

```
g = table-interpolated tan(pi*fc/fs)
Q = .5 + 3.5*resonance; k = 1/Q; a1 = 1/(1 + g*(g+k))
v1 = a1*(ic1 + g*(x-ic2)); v2 = ic2 + g*v1
ic1 = 2*v1-ic1; ic2 = 2*v2-ic2
```

The 4,097-entry table is prepared outside the callback. Frequency clamps to 20..min(20k,.45*fs), and preparation supports 8k..384k. Keytracking multiplies frequency by 2^((note−60)*keytrack/12) before clamping. Values smooth per voice, including new Gain. Drive applies tanh before filtering with existing square-root makeup; Mix combines dry and wet audio. Nonlinear Drive is not part of the plotted linear transfer.

Other Synth modes use the same independent double integrators with weighted input/band/low outputs. Peak changes k by gain amplitude; shelves scale g and output weights using the established SVF designs. Coefficients are cached per voice/filter; changing ID or type resets its states. Finite-state guards and denormal flushing apply to every mode. No low-pass coefficient/DSP defect was demonstrated. The existing Nodes float kernel is unchanged.

## 4. Response root cause

The reported low-pass shape was not reproduced as a DSP, transfer-function or logarithmic-axis foldback defect. Offline measurement supports the original mathematical response. Near Nyquist, bilinear prewarping produces the visibly curved high-frequency geometry; a 20 kHz cutoff at 48 kHz also leaves little above-cutoff frequency within a 20 kHz display. That is expected behavior, not a transition moving backward.

Concrete presentation defects were unlabeled frequency references, insufficient +12 dB headroom at maximum resonance, redundant engineering/topology text, and a separate saturated graph-floor line. These were corrected without smoothing or faking response geometry. Nodes' separate SVF preview also ignored Mix and fixed its design rate at 48 kHz; it now uses phase-aware Mix and the observed sample rate, and invalidates its cached preview when that rate changes. Existing Comb/EQ preview approximations were not redesigned.

The Synth axis is logarithmic 20..min(20k,.499*fs), with an inverse mapping. The actual coefficient cutoff remains clamped at .45*fs. Y uses magnitude dB, +18..−60 dB for ordinary modes and +36..−60 for gain-bearing modes; displayed values clip at the panel bounds. Bypass tends to the unity response through the existing Mix smoothing. Resonance peaks and partial-Mix cancellation are represented by the complex transfer.

## 5. Numeric DSP-versus-analytic evidence

Independent steady-state sine projection measures the actual recurrence, using integer periods at the recorded probe frequency. Settling is at least .1 s, 16 probe cycles and 80 effective-cutoff periods. The baseline audit measured 896 low-pass probes before source edits; worst error was 0.000865176928249 dB. The final matrix measures 6,656 Synth probes: eight modes, four sample rates, seven cutoffs, four resonances; gain-bearing modes additionally cover −24/0/+24 dB, and each mode covers Mix 0/.35/1. Four probe locations cover below cutoff, cutoff, above cutoff and high frequency.

Tolerance is 0.02 dB for analytical magnitude >1e−5; near zero it is absolute magnitude 2e−7. Worst meaningful dB error is **0.00577907216882 dB** (LP, 96 kHz, 1 kHz cutoff, resonance 1, 45 kHz probe; measured −99.65685199 vs analytic −99.66263106 dB). Worst above −60 dB is **0.0001078535251 dB**. Worst absolute magnitude error across the matrix is **1.41515030094e−6**. Deep nulls use absolute tolerance because dB ratios become ill-conditioned.

Representative measurements (48 kHz; 1 kHz cutoff; resonance .1; Mix 1; Peak/shelves Gain +6 dB):

| Type | Sample rate | Cutoff | Actual probe | Measured dB | Analytic dB | Error dB |
|---|---:|---:|---:|---:|---:|---:|
| LOW PASS | 48000 | 1000 | 1000.000 | -1.411621311 | -1.411621356 | 4.51843e-08 |
| HIGH PASS | 48000 | 1000 | 1000.000 | -1.411621638 | -1.411621509 | 1.29013e-07 |
| BAND PASS | 48000 | 1000 | 1000.000 | 0.000000050 | 0.000000000 | 5.03976e-08 |
| NOTCH | 48000 | 1000 | 1000.000 | -156.338812400 | -156.504374100 | 0.165562 |
| PEAK | 48000 | 1000 | 1000.000 | 5.999999921 | 5.999999998 | 7.71198e-08 |
| ALL PASS | 48000 | 1000 | 1000.000 | -0.000000203 | 0.000000000 | 2.03225e-07 |
| LOW SHELF | 48000 | 1000 | 1000.000 | 3.000000022 | 3.000000070 | 4.88034e-08 |
| HIGH SHELF | 48000 | 1000 | 1000.000 | 2.999999890 | 2.999999927 | 3.75572e-08 |

The notch row is a ~−156 dB null: its 0.166 dB ratio difference is an absolute magnitude difference of approximately 2.9e−10, well below the near-zero tolerance. 288 additional Nodes float-kernel probes verify the same provider against Nodes' own coefficients: non-null error below .002 dB in the isolated audit (worst .00138122 dB), with a float null floor up to 7.96249e−5 magnitude (−81.98 dB) at 20 Hz/192 kHz. Nodes tests allow absolute 1e−4 at nulls. This is precision evidence, not a changed kernel.

Full data: [baseline](baseline-low-pass-response.csv), [all modes](multimode-response.csv).

## 6. Cutoff monotonicity evidence

All four sample rates pass the authored sweep 20/50/100/200/500/1000/2000/5000/10000/15000/20000 Hz. Effective transition is atan(g)*fs/pi. At 44.1 kHz, the last authored value clamps to 19,845 Hz; at the other rates it reaches 20 kHz. Effective transitions and logarithmic x positions strictly increase at every step. Normalized x positions are 0/.132647/.232990/.333333/.465980/.566323/.666667/.799313/.899657/.958354/1 (last .998874 at 44.1 kHz).

88 independent probes straddle the effective Q=.85 transition at .98/1.02 frequency ratios. The regression also checks 11,264 axis samples for strict ordering, inverse agreement and finite response coordinates, including endpoints. Probe resolution was tightened for the straddle test after rounding initially placed a requested 1.02 kHz probe exactly at 1 kHz; the expectation was not relaxed. [Sweep data](cutoff-sweep.csv).

## 7. UI changes

The selected-filter header has FILTER TYPE, a real shared-catalog selector, OUT and ON/BYPASS. IN: UNCONNECTED, its topology sentence, LINEAR RESPONSE / DRIVE IS NONLINEAR, and the saturated floor stroke are removed. The left source rail retains its existing component, dimensions, scrolling and theme language.

The graph is primary, with neutral boundary, subtle 100/1k/10k references and a zero-dB reference. One sampled path supplies both white stroke and closed dark theme-accent fill. The graph handle edits canonical Frequency/Resonance through the same state command as the knobs; no graph-local parameter state exists. Its vertical position represents normalized resonance, not magnitude. Runtime telemetry updates the effective curve and handle; authored controls remain the stored values. Frequency labels adapt by type and Peak/shelves show Gain only when applicable. Frequency formatting is reusable by Synth and FX: 100 Hz, 7.58 kHz, 10.0 kHz, 20.0 kHz.

## 8. Panic root cause and shared fix

Before patching, six native focused-overlay destruction fixtures ended with Emergency DSP reset holding focus, matching JUCE's shared drag-image teardown. [Pre-edit output](panic-before.txt). DragImageComponent takes direct focus; its destructor calls dragOperationEnded before Component's base destructor. Destroying the focused overlay then focuses the parent's first focusable child: Panic. Panic previously classified that direct focus as legitimate keyboard focus, hence a gray overlay outside the pointer. Clicking elsewhere caused focusLost and cleared it.

PluginEditor now forwards the shared drag start/end hooks to OrigamiHeader. Panic suppresses transient drag focus immediately; a guarded SafePointer callback reconciles focus after overlay destruction. It releases accidental Panic focus and restores deliberate pre-drag accessibility focus. The paint condition uses the physical pointer rather than stale JUCE hover state. Generation checks prevent stale cleanup affecting a later drag. Tests cover entering/leaving, ENV/LFO/Macro/Filter/cancel/valid-drop lifecycle handoffs, deliberate keyboard focus, focus loss and exactly-once command activation. Panic DSP was untouched.

## 9. Files changed

- `origami/core/SynthFilter.h`
- `origami/core/Voice.cpp`
- `origami/core/dsp/Filter.h`
- `origami/core/fx/FxEffects.cpp`
- `origami/core/fx/FxFilter.h`
- `origami/core/fx/FxGraph.cpp`
- `origami/core/modulation/Modulation.cpp`
- `origami/core/preset/StateCodec.cpp`
- `origami/plugin/PluginEditor.cpp`
- `origami/plugin/PluginEditor.h`
- `origami/plugin/ui/FxPage.cpp`
- `origami/plugin/ui/FxPage.h`
- `origami/plugin/ui/OrigamiHeader.cpp`
- `origami/plugin/ui/OrigamiHeader.h`
- `origami/plugin/ui/SignalPanels.cpp`
- `origami/plugin/ui/SignalPanels.h`
- `origami/tests/EngineTests.cpp`
- `origami/tests/FxGraphTests.cpp`
- `origami/tests/PerfBench.cpp`
- `origami/tests/PluginTests.cpp`
- `origami/tests/StateTests.cpp`
- `origami/core/ParameterFormatting.h`
- `origami/core/dsp/FilterResponse.h`
- `origami/core/dsp/FilterTypes.h`
- `origami/tests/FilterResponseTests.h`
- `origami/docs/qa/filter-editor/ (audit, report, numeric/performance/memory evidence and actual renders)`

## 10. State and migration

Schema 38 is required because 36/37 had no Synth type/Gain field or bounded extension for it. Only patches needing non-LP types or nonzero stored Gain emit 38; ordinary LP patches still emit 36/37 as appropriate. The decoder retains versions 1–37. Legacy Synth type defaults to LP with Gain 0; existing Nodes parameter IDs/type indices are unchanged. New records add a bounded type word and Gain float, preserving FilterId, routing, serial chains and modulation destinations. Unknown IDs, Comb in Synth, invalid Gain and truncated records reject before transactional state publication. Existing v36 historical fixture audio and exact v37 roundtrips pass; all 18 pre-edit performance audio hashes remain identical.

## 11. Tests and exact counters

New coverage:

- FilterResponseTests.h: 6,656 independent Synth probes, 288 Nodes probes, 176 extreme impulse configurations, reset/silence/nonfinite recovery for all eight types; 44 sweep steps, 88 transition probes, 11,264 axis samples.
- multimodeSynthLifecycleAudit: independent polyphonic/keytracked output compared with three separate engines; modulation, voice stealing, Panic, held type changes, mono legato and callback allocation/free guards for every mode.
- synthFilterTypesV38: all eight type/Gain roundtrips, corrupt/unknown/unsupported type rejection, exact legacy state preservation.
- synthFilterEditorTypeAudit: actual editor controls, shared Nodes descriptor pointer/catalog, conditional Gain, each type's processor-wrapper restore, independent filter selection, knob/handle synchronization and five cutoff renders.
- panicDragFocusAudit: native focus lifecycle for six source/drop outcomes, physical-pointer visibility, retained deliberate keyboard accessibility focus and exactly-once activation.
- Existing fill/theme, source rail/capacity, routing, Panic-under-load, legacy audio and plugin continuity regressions remain enabled.

Final suite counters: engine **1,355,116**, plugin/UI **1,607,862**, state **2,782**, modulation **3,938**, FX graph/DSP/bus **648**, content **98**. Wavetable foundation reports PASS without a numeric counter. All seven CTest suites pass. Test fixtures represent native focus teardown and actual component rendering; no live mouse gestures or audible manual QA are claimed.

## 12. Real-time safety

All eight modes resolve from bounded validated IDs to fixed prepared Voice storage. Existing zero-filter specialization remains. Coefficient table preparation, state codec, menus, strings and response evaluation stay outside the audio callback. Rendering/type adoption/reset/Panic allocation and free guards pass for every exposed mode. No locks, filesystem calls, dynamic containers, UI lookups or FFT were added to audio processing. Runtime loops remain bounded by eight filter slots and existing voice/routing capacities.

## 13. Memory and performance

| Fixed object | Before | After |
|---|---:|---:|
| Stereo SynthFilterRuntime | 112 B | 160 B |
| Voice sizeof | 131.6 KiB | 132.0 KiB |
| Sixteen Voices | 2105.0 KiB | 2112.0 KiB |
| Engine sizeof | 2489.4 KiB | 2496.6 KiB |
| Processor sizeof | 2763.6 KiB | 2771.1 KiB |
| SynthFilterCollection | 5092 B | 5124 B |
| SynthFilterPlan | 1444 B | 1444 B |

Numbers are sizeof-derived; KiB values are rounded to one decimal. The increased memory is fixed storage for typed coefficient cache, Gain/current value and metadata. No per-voice Comb allocation was added.

48 kHz, 256-frame callback, same machine/harness; wall-clock timings include normal scheduling variance:

| Scenario | Voices | Before median/p99 µs | After median/p99 µs | After median/p99 deadline % |
|---|---:|---:|---:|---:|
| Synth filters zero | 1 | 22.3/27.0 | 18.8/24.2 | 0.35%/0.45% |
| Synth filters single | 1 | 23.9/30.2 | 22.5/26.4 | 0.42%/0.50% |
| Synth filters maximum eight serial | 1 | 65.0/82.9 | 63.2/72.9 | 1.19%/1.37% |
| Synth filters zero | 8 | 62.0/70.8 | 60.5/71.2 | 1.14%/1.34% |
| Synth filters single | 8 | 101.5/119.0 | 97.5/110.9 | 1.83%/2.08% |
| Synth filters maximum eight serial | 8 | 396.2/429.2 | 376.0/401.4 | 7.05%/7.53% |
| Synth filters zero | 16 | 108.9/123.5 | 108.5/125.9 | 2.03%/2.36% |
| Synth filters single | 16 | 192.7/215.0 | 189.7/208.4 | 3.56%/3.91% |
| Synth filters maximum eight serial | 16 | 774.1/831.2 | 736.8/775.6 | 13.81%/14.54% |
| Synth multimode band pass | 1 | new mode | 22.7/29.5 | 0.43%/0.55% |
| Synth multimode mixed eight serial | 1 | new mode | 49.7/55.9 | 0.93%/1.05% |
| Synth multimode band pass | 8 | new mode | 102.9/115.3 | 1.93%/2.16% |
| Synth multimode mixed eight serial | 8 | new mode | 318.0/341.7 | 5.96%/6.41% |
| Synth multimode band pass | 16 | new mode | 196.3/213.7 | 3.68%/4.01% |
| Synth multimode mixed eight serial | 16 | new mode | 625.1/646.0 | 11.72%/12.11% |

Baseline LP scenarios retain all 18 audio hashes; no zero-filter median regression is indicated by this run. Max eight LP at 16 voices: p99 775.6 µs (14.54%); mixed eight at 16 voices: 646.0 µs (12.11%). UI responses are calculated on the message thread and have no audio-thread callback work. [Raw before](performance-before.txt), [raw after](performance-after.txt), [memory before](memory-before.txt), [memory after](memory-after.txt).

## 14. Offscreen visual QA

Actual corrected FilterPanel renders were inspected at [100 Hz](cutoff-100.png), [1 kHz](cutoff-1000.png), [5 kHz](cutoff-5000.png), [10 kHz](cutoff-10000.png) and [20 kHz](cutoff-20000.png). The transitions move monotonically right; high-cutoff curvature agrees with the measured bilinear transfer. Header controls, subtle grid, fill/stroke agreement, neutral floor, knob alignment and unchanged source rail were inspected. Eight mode renders also show correct conditional Gain and Frequency/Cutoff labels. [Compact layout](compact.png), [alternate theme](theme-blue.png), and [whole Synth canvas](whole-synth.png) are retained. No clipping was found in these fixtures.

## 15. Full validation

`git diff --check` passes. Full CTest: seven of seven suites pass. The repository's normal entry point is `./origami/scripts/rebuild-dev.sh`; it rebuilds Standalone/AU/VST3, executes plugin/core/FX/content gates, deploys the local products, and validates the installed AU. [Deployed validation output](rebuild-dev.txt), [final CTest log](ctest.txt), and [exact suite counters](test-details.txt) are retained alongside this report. The script completed successfully and the deployed AU reported **AU VALIDATION SUCCEEDED**. No source changes follow the final validation.

## 16. Known limitations

Comb is explicitly disabled in Synth for the delay-pool/response reasons above. Gain is a canonical authored/smoothed control; the existing five Synth modulation destination IDs remain unchanged, so no new Gain modulation address is added. Type switching resets integrators immediately and does not crossfade modes. The display represents the linear underlying filter, excluding Drive harmonics. Deep cancellation ratios require absolute tolerances. Existing Nodes Comb preview remains approximate and Nodes EQ preview remains outside this pass. Native focus fixtures reproduce the shared teardown; live drag/audio/manual host QA remains for the checklist. Timing results are local measurements, not a universal performance guarantee.

## 17. Manual QA checklist

These steps are provided for manual testing and are **not claimed performed**:

1. Add Filter.
2. Open Type dropdown.
3. Compare its list with Nodes → Effects → Filter/EQ → Filter → Type.
4. Confirm shared names/order; Comb is disabled in Synth with its reason.
5. Select each supported Synth type.
6. Confirm audible DSP changes appropriately.
7. Switch filters; confirm no stale type.
8. Save/reload; confirm type/Gain/routes.
9. LOW PASS cutoff 100 Hz.
10. LOW PASS cutoff 1 kHz.
11. LOW PASS cutoff 5 kHz.
12. LOW PASS cutoff 10 kHz.
13. LOW PASS cutoff 20 kHz.
14. Confirm transition moves rightward monotonically.
15. Sweep resonance.
16. Confirm coherent response peaks.
17. Modulate cutoff.
18. Confirm stroke/fill move together.
19. Confirm no saturated bottom line.
20. Change theme; confirm fill follows it.
21. Drag the response handle; confirm matching knob/state updates.
22. Drag ENV and release on empty area.
23. Confirm Panic hidden outside its physical region.
24. Drag LFO and release.
25. Confirm Panic hidden.
26. Drag Macro and release.
27. Confirm Panic hidden.
28. Drag Filter and release.
29. Confirm Panic hidden.
30. Perform valid source drag/drop; also cancel a drag.
31. Confirm Panic hidden unless physically hovered or deliberately keyboard-focused.
32. Hover identity.
33. Confirm active Panic hover treatment.
34. Move pointer away.
35. Confirm branding restores immediately.
36. Test Tab/accessibility focus and retained deliberate focus across a drag.
37. Click Panic.
38. Confirm existing emergency reset silences voices/tails and preserves the patch.

## 18. Exact commit SHA

The exact local commit SHA is supplied in the final delivery message. This report is part of that commit, so embedding its own SHA here would be self-referential. No push and no subsequent patch work.
