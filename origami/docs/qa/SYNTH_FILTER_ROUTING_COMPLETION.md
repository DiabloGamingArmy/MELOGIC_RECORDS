# Synth filter routing completion — F01–F06

Repository: DiabloGamingArmy/MELOGIC_RECORDS. Branch: `mct-origami-nodes-visual-feedback-p03`.
Baseline: `951362057b5f88a7e864dc8e7ccbf56cf2d74294`. No push.

## 1. Architecture audit (performed before implementation)

The old Synth filter was `ModulationState::filterEnabled`, with global Cutoff and Resonance parameters. `Voice::moduleFilters_[16]` and `moduleFiltersRight_[16]` held separate low-pass histories for each oscillator in each voice. It was an implicit stage before envelope/level and bus sends, with shared coefficient values, no filter identity, no oscillator-to-filter topology, and no summed-input filter instance. The panel's response was a static illustrative path; Drive, Keytrack, Mix and topology labels were decorative.

Oscillator generation and process chains already used a fixed `OscillatorRenderPlan`, stable oscillator/process identities, bounded voice runtimes, and canonical oscillator bus sends. Bus IDs resolved to fixed slots. These were extended rather than replaced.

Nodes audio filters and FX filters already use the same per-bus `FxGraph` / `FxRenderer` / `FxEnvironment` post-mix architecture. Nodes exposes programmable audio routing plus the distinct canonical control/event graph. There is currently no additional Nodes per-voice audio domain. `FilterFx` owns its stereo SVF and Comb runtime independently from Voice: low-pass, high-pass, band-pass, notch, bell, all-pass, shelves and Comb. Existing Comb effect-to-Filter migration remains intact. FX global controls apply around the existing mixed/bus graph. The repository therefore had two audio filter execution architectures, with Nodes and FX sharing one; three labels did not imply three separate DSP engines.

The canonical control system is `ModulationState::routes` and its existing compiler, source pool, operators and `ModAddress`. Nodes and Matrix are views of those routes, while `ControlLayout` stores positions and explicitly placed cards. Preset schema 35 already serialized scalable sources; older schema selection and historical filter flags had to remain intact.

## 2. Final signal model

New explicit Synth filters execute inside each Voice, after oscillator processing, level/envelope and pan, before terminal bus sends and the existing mixed-audio FX graph:

```
OSC1 -> FILTER1 -> MAIN
OSC1 -> FILTER1 -> BUS2
OSC1 + OSC2 -> FILTER1 -> MAIN
OSC1 -> FILTER1 -> FILTER2 -> MAIN
OSC2 -> MAIN                 (independent direct output)
```

Inputs sum once per voice and stereo channel. A filter identity executes once per voice, regardless of its number of incoming oscillator/filter edges. Existing final voice normalization by enabled oscillator count is preserved; there is no additional filter normalization. Terminal output retains existing multi-bus send semantics.

Legacy authored filtering remains the old per-oscillator implicit LP before envelope/level. If an old patch subsequently adds explicit filters, its old LP remains upstream of the new topology. It is visibly labelled LEGACY / PER OSCILLATOR. Init and fresh state have neither implicit filtering enabled nor explicit filter objects.

Nodes filter creation/drop creates an independent post-mix object. It cannot change Synth routing. The sidebar and copy tooltip identify that domain explicitly.

## 3. DSP implementation

Each voice owns eight small independent stereo runtimes. Synth reuses the existing TPT `dsp::LowPassFilter` and prepared 4097-entry coefficient table; no replacement SVF or Comb algorithm was introduced. Synth supports the actual low-pass algorithm, not decorative filter types.

Cutoff, resonance, drive, mix and keytrack use a 5 ms one-pole glide. Tiny differences snap to target to avoid subnormal smoothing tails. Coefficients and drive gain are cached until effective values change. Cutoff uses the existing table rather than per-sample tangent evaluation. Keytrack is exponential around MIDI note 60: cutoff × 2^((note−60)×keytrack/12), clamped to 20–20000 Hz before the coefficient table's sample-rate-safe clamp. L/R have independent recursive histories, shared scalar parameter values and preserved oscillator pan.

Drive uses the existing FX convention `tanh(gain*x)/sqrt(gain)` at native sample rate; Mix blends dry/wet. Power glides Mix to zero, bypasses and resets recursive state once the fade is effectively complete. Reset, retrigger/steal and Panic clear filter state; mono legato retains continuity and updates note keytracking. Detaching a prepared stage clears its runtime. Existing LP finite-input protection, finite-state recovery, denormal cleanup and quiet-tail detection remain in use. Extreme impulse cases cover 8–384 kHz, 20/1000/20000 Hz cutoff and resonance endpoints.

The response derives analytically from the actual coefficient transfer function, including coherent dry/wet mixing. Effective smoothed/keytracked values and stable IDs are copied through existing decimated telemetry. The curve shows one observed voice, otherwise authored base values; bypass fading uses the effective mix. It is labelled LINEAR RESPONSE / DRIVE IS NONLINEAR. No audio-thread FFT or fabricated animation is used.

## 4. Routing implementation

`SynthFilterCollection` is canonical instrument/modulation state: eight filters, sixteen oscillator inputs, monotonic stable IDs and terminal bus sends. IDs are never reused during a patch's identity history. Authoring commands validate before publication. Cycles, unknown/duplicate IDs, duplicate inputs, invalid buses and invalid parameter ranges are rejected.

Writer-side `prepareSynthFilters` resolves IDs to fixed runtime indices, determines reachable stages, topologically orders at most eight stages, resolves terminal/direct oscillator bus sends, and prepares modulation target slots. The existing modulation mailbox publishes this state and its plan together, including the coherent bus slot map. The existing oscillator plan adopts resolved vectors without filter ID searches or traversal. Modulation cache keys include resolved target slots, so moving storage slots cannot retarget stable identities.

Dropping on an oscillator prepends a filter while retaining the previous filter or bus destination. Dropping on a filter inserts AFTER its existing stage. Shared-stage insertion must agree with its existing downstream destination; conflicts/cycles are refused rather than moving other sources. AFTER insertion requires an unused inserted stage.

Deletion reconnects upstream filters and oscillator inputs to the deleted stage's downstream filter or terminal sends. A canonical direct-send override preserves changed terminal sends without a separate oscillator mailbox transaction. The oscillator routing editor reads and edits that override after the splice. Filter modulation routes and nested dependents are removed. Processor-owned Nodes parameter placement metadata is pruned both on edit and restore. Catalog/Matrix and telemetry refresh by stable identity; detached runtime stages reset.

## 5. Drag/drop UX

A Synth filter row uses `MCT_SYNTH_FILTER:<id>`; an oscillator title uses `MCT_SYNTH_OSC:<id>`. Filter-to-card and oscillator-to-filter invoke the same canonical insertion command. Filter-to-filter means AFTER and the panel overlay says so. Oscillator cards show a highlighted insertion target; incompatible sharing/cycles show a refusal message. OUT displays the filter ID, and the routing workspace shows the full chain and terminal buses. Filter IN lists contributing oscillator/filter identities; OUT shows the downstream stage/bus. Filter power, add/remove, five working knobs and output menu are real model controls. Eight occupied slots disable Add with a capacity tooltip.

Dragging a Synth filter onto Nodes copies its applicable values to an independent post-mix node; it does not share mutable state or topology.

## 6. Modulation

Canonical destination enums 401–405 are SynthCutoff, SynthResonance, SynthDrive, SynthMix and SynthKeytrack. Their address is `{destination, 0, FilterId}`. One destination catalog is reused by Matrix, Nodes and knob assignment; knobs carry the same stable item ID. Synth destinations are per-voice execution targets. Existing global sources broadcast through canonical frames, and voice sources apply independently through the existing voice compiler. ENV4, LFO5 and Random2 regression fixtures use the scalable source pool. Existing velocity, keytrack, envelopes, LFO modes, macros, operators and polyphonic sources remain the same modulation machinery. Deleting a filter removes targeted routes and their nested dependencies, catalog entries and placed Nodes parameter cards.

## 7. State / migration

Schema 36 appends bounded explicit filter objects, values, power, serial edges, oscillator inputs and splice-preserved direct sends. Identity history selects v36 even after deletion. Older unmodified states retain the existing schema-selection path. Versions 1–35 decode with an empty explicit filter pool and preserve historical implicit `filterEnabled` behavior; existing scalable-source and FX Comb migrations remain unchanged.

Decoding requires fixed bounded counts, valid booleans and full canonical instrument validation. Truncation, dangling/duplicate IDs, cycles, invalid destination/bus and unsupported versions reject atomically. Plugin wrapper state also preserves Nodes placed-parameter layout and canonical filter routes. Older plugin binaries cannot read v36 states.

## 8. Files changed

- Core: `core/SynthFilter.h` (new), `Engine.h/.cpp`, `Voice.h/.cpp`, `OscillatorRenderPlan.h`, `InstrumentState.cpp`, `dsp/Filter.h`, `modulation/Modulation.h/.cpp`, `nodes/ControlGraph.h/.cpp`, `preset/StateCodec.cpp`.
- Plugin: `PluginEditor.cpp`, `PluginProcessor.cpp`.
- UI: `SignalPanels.h/.cpp`, `OscillatorRack.h/.cpp`, `FxPage.h/.cpp`, `ModulationDestinations.cpp`, `ModulationMatrix.cpp`, `ModulationUiTelemetry.h`.
- Tests: `EngineTests.cpp`, `StateTests.cpp`, `PluginTests.cpp`, `FxGraphTests.cpp`, `PerfBench.cpp`.
- Evidence: this report and the benchmark records beside it.

Paths above are relative to `origami/`.

## 9. Tests added / updated

Core: shared driven stereo filter compared sample-for-sample against one summed-input reference; audible difference; scalable per-voice ENV/LFO and Random modulation; eight-stage/sixteen-voice processing/adoption/Panic allocation guards; mono legato lifecycle; stable-ID modulation after runtime slot reorder; independently keytracked chord equal to three solo renders; extreme sample-rate/cutoff/resonance finite bounded impulse output.

State: destination-preserving insertion; BEFORE/AFTER chains; shared-output conflicts; exact filter/modulation roundtrips; deletion splices, direct-send overrides and bus cleanup; pool capacity and nonreused IDs; encoded dangling/duplicate/cyclic corruption and final-tail truncation rejection; unsupported v37 rejection. Existing legacy codecs and goldens remain exercised.

Plugin/UI: real panel/card authoring APIs for both drag directions and AFTER insertion; canonical five-destination catalog and knob IDs; scalable-source assignment; Nodes parameter placement/connection/save-load/deletion cleanup; binary wrapper persistence; bus/oscillator deletion; fresh/Init empty pool; actual panel offscreen painting. The legacy sidebar expectation now uses its truthful label. Engine fixed-footprint gate is updated to accommodate measured bounded storage; Voice remains below its existing 128 KiB gate.

Existing Random, source-pool, NOTE ON → PROBABILITY → ENVELOPE TRIGGER, bus/FX, Panic, waveform and visualization regression suites remain in the full validation run. Manual mouse/host interaction is a separate checklist below, not claimed as automated proof.

## 10. Full validation results

`./scripts/rebuild-dev.sh` completed successfully: Standalone, AU and VST3 built, regression gates ran, deployed copies installed, and installed AU `aumu Orig Mctg` reported **AU VALIDATION SUCCEEDED** and **MCT ORIGAMI DEV BUILD DEPLOYED + VALIDATED**.

| Suite | Result |
|---|---:|
| Core foundation | 553,597 checks |
| Plugin/UI | 1,607,334 checks |
| State | 2,744 checks |
| Modulation | 3,938 checks |
| FX graph/DSP/bus | 648 checks |
| Content library | 98 checks |
| Wavetable bank | V22.0 foundation PASS (no numeric check counter emitted) |

`ctest --test-dir origami/build-multihost --output-on-failure -V`: **7/7 passed**, 43.05 seconds, with the same numeric counters above.

`git diff --check` passed. Actual 700×280 offscreen filter-panel rendering was inspected: [panel](synth-filter-panel.png). Build emits existing aggregate-initializer/compiler warnings; there were no build errors.

## 11. Real-time safety

New filter DSP, topology adoption, sixteen-voice processing, mono lifecycle and emergency reset report **zero allocations and zero frees** under the existing guards. No new audio-thread locks, filesystem access, strings or unbounded containers. Synth filter identity lookup, adjacency discovery, reachability and ordering run on the writer thread. Audio executes fixed slots and a maximum of eight prepared stages per voice. State+plan adoption is through the existing lock-free mailbox. The modulation compiler's existing bounded host-block adoption work remains; it consumes prepared filter target indices. Existing unrelated OSC/source/operator compilation is not represented as newly moved off audio.

Zero-filter rendering has a compile-time specialization with no per-oscillator filter-routing branch or input scratch clear. Unconnected authored filters are excluded from the prepared execution plan. Per-block state copies and fixed storage still carry the pool footprint. Telemetry uses the existing bounded decimated snapshot path.

## 12. Memory / performance

Local Release benchmark, 48 kHz, 256 samples (5333.33 µs deadline), 1/8/16 voices; 16 is the engine maximum. Same baseline executable retained before edits, measured sequentially without concurrent tests/builds. Each scenario renders 1.5 seconds of audio; results are local samples, not a universal host guarantee.

| Zero-filter baseline | Before median / p99 µs | After median / p99 µs | Before deadline median / p99 | After deadline median / p99 |
|---|---:|---:|---:|---:|
| 1 voice | 19.8 / 24.5 | 17.0 / 24.6 | 0.37% / 0.46% | 0.32% / 0.46% |
| 8 voices | 60.6 / 71.0 | 61.2 / 73.0 | 1.14% / 1.33% | 1.15% / 1.37% |
| 16 voices | 108.4 / 130.0 | 110.5 / 126.2 | 2.03% / 2.44% | 2.07% / 2.37% |

All matching baseline/unison output hashes are identical. The 16-voice zero-filter median is +1.94%; p99 improves in this run. Timing variation should not be mistaken for a guaranteed speedup. The zero-filter specialization removes new per-sample routing/scratch work; unused filters have no execution stages.

| Explicit topology | Voices | Median µs | p99 µs | Deadline median / p99 |
|---|---:|---:|---:|---:|
| zero | 1 | 17.9 | 22.6 | 0.34% / 0.42% |
| single | 1 | 23.5 | 29.1 | 0.44% / 0.55% |
| shared four OSC | 1 | 33.3 | 39.6 | 0.62% / 0.74% |
| serial two | 1 | 26.6 | 31.6 | 0.50% / 0.59% |
| four separate | 1 | 38.8 | 46.7 | 0.73% / 0.88% |
| maximum eight serial | 1 | 61.7 | 74.3 | 1.16% / 1.39% |
| zero | 8 | 61.3 | 77.1 | 1.15% / 1.45% |
| single | 8 | 102.2 | 117.0 | 1.92% / 2.19% |
| shared four OSC | 8 | 161.6 | 182.6 | 3.03% / 3.42% |
| serial two | 8 | 136.7 | 160.0 | 2.56% / 3.00% |
| four separate | 8 | 201.3 | 225.5 | 3.77% / 4.23% |
| maximum eight serial | 8 | 384.6 | 422.8 | 7.21% / 7.93% |
| zero | 16 | 110.4 | 127.9 | 2.07% / 2.40% |
| single | 16 | 195.0 | 213.0 | 3.66% / 3.99% |
| shared four OSC | 16 | 303.6 | 348.1 | 5.69% / 6.53% |
| serial two | 16 | 259.0 | 288.0 | 4.86% / 5.40% |
| four separate | 16 | 381.8 | 415.5 | 7.16% / 7.79% |
| maximum eight serial | 16 | 765.6 | 826.5 | 14.36% / 15.50% |

Every steady-state scenario reports zero spectral misses, requests and full modulation compiles. Maximum topology authoring validation/preparation/publication (1000 calls): **6.833 µs median / 9.542 µs p99** on the writer thread.

| Fixed object | Before bytes | After bytes | Change |
|---|---:|---:|---:|
| Voice | 129408 | 130624 | +1216 B (1.1875 KiB) |
| Engine | 2387776 | 2446656 | +58880 B (57.5 KiB; 2.47%) |
| CompiledModulation | 106144 | 106176 | +32 B |
| ModulationState | 20544 | 22596 | +2052 B |
| InstrumentState | 29216 | 31268 | +2052 B |
| ModulationFrame | 9952 | 10120 | +168 B |

Processor: 2570.2 → 2638.6 KiB. Filter runtime: **112 B × 8 = 896 B per voice**, 14336 B across sixteen voices; remaining Voice growth includes bounded telemetry/alignment. Prepared routing plan: **920 B**. Authored collection: **2020 B**. Compiler storage stays fixed and differs by the 32-byte prepared-slot cache key.

Raw evidence: [before callbacks](synth-filter-perf-before.txt), [after callbacks](synth-filter-perf-after.txt), [before memory](synth-filter-memory-before.txt), [after memory](synth-filter-memory-after.txt), [writer preparation](synth-filter-prepare.txt).


## 13. Known limitations

Eight explicit filters and sixteen voices are the practical supported maximum. Filters support serial edges, summed inputs and existing terminal multi-bus sends; arbitrary OSC-to-parallel-filter branching is deferred. Joining an already shared filter with a different prior destination is rejected; AFTER insertion uses an unused filter. These preserve unambiguous downstream ownership.

Synth currently supports the existing low-pass only; Nodes/FX retain their own multimode/Comb filter. Native-rate nonlinear drive can alias and has no oversampling. No filter-specific pan or independent L/R parameter modulation was added. No new DAW automation parameters were added; canonical internal modulation covers the five controls. The curve represents the linear transfer for one observed voice, not a chord spectrum or nonlinear drive response.

Legacy implicit filtering is preserved, not silently converted to shared explicit instances. Old binaries cannot load new v36 patches. Full live mouse/keyboard/DAW manual QA remains to be performed with the checklist below; offscreen rendering and wrapper AU validation are completed separately. The preceding corrective pass's documented Random/event limitations are not expanded into new work here.

## 14. Manual QA checklist

Use the deployed Standalone or AU/VST3 in a host; capture the saved patch and screenshots if a step differs.

1. Load Init: no filter rows/knobs, Add available, oscillators audible.
2. Add a filter: LOW-PASS / PER VOICE, working five knobs, unconnected IN.
3. Drag that filter's row onto OSC1's card; confirm highlighted insertion feedback.
4. Confirm OSC1 OUT names the stable filter ID and its route workspace shows the chain.
5. First set OSC1 to BUS3, then insert an unused filter: verify terminal OUT remains BUS3.
6. Change the terminal filter OUT to another bus; listen through that bus's output/FX.
7. Remove it: OSC1 must resume the selected bus, including editing its send afterward.
8. Add another filter; verify its ID is new rather than silently reusing the deleted ID.
9. Add a second filter and select each; controls must edit their own stable identities.
10. Drop second on OSC1 for BEFORE insertion; then test a fresh stage dropped on a filter for explicit AFTER insertion. Preserve terminal bus throughout; attempt a cycle and confirm refusal.
11. Route two oscillators with matching downstream destinations into one filter. Confirm IN lists both and driven summed audio behaves as one stage. Try mismatched destinations and confirm refusal.
12. Assign ENV/LFO/Random to cutoff and resonance/drive using knobs, Matrix and Nodes; confirm identical canonical destinations and moving effective response.
13. Play a chord with keytrack, release/steal notes, test mono legato/retrigger and Panic; listen for stable independent filtering and clean reset.
14. Save a patch with a shared input, serial chain, non-MAIN terminal bus and modulation routes.
15. Close/reopen the plugin or application, then load that patch.
16. Confirm exact IDs, input chain, downstream bus, parameter values, Matrix routes and Nodes placements.
17. Delete a filter with active routes in both Matrix and Nodes; confirm serial splice.
18. Confirm no stale parameter cards/cables, picker destinations, telemetry or audible old stage. Add a new filter and ensure old modulation does not retarget it.
19. Load a historical filter-enabled patch: LEGACY LP remains audible with its old global cutoff/resonance behavior. Creating a Nodes filter must not change Synth routing.
20. Load Init again: zero explicit/legacy filters, clean routing and audible direct oscillators.

## 15. Commit

One coherent completion commit on the current branch; its exact SHA is reported in the delivery message. No push and no subsequent phase.
