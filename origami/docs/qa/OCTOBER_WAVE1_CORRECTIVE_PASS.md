# October Wave 1 manual-QA corrective pass

Validated 2026-10-07 on `mct-origami-nodes-visual-feedback-p03`, starting at `faeef8f031a3726003b72e93ef090c056729f7c7`. This is the existing P03/Wave 1 corrective pass. No subsequent phase was started.

## 1. Root causes

1. **PANIC location:** `OrigamiHeader` explicitly placed an always-painted panic button in the right utility strip. The existing callback already reached `requestPanic()`. The fix moves that same button over the whole left identity area, with branding visible normally, a dimmed overlay on hover/keyboard focus, and the original callback unchanged.
2. **Random viewport stepping:** `OscillatorCard` independently reconstructed the waveform from the current model plus route telemetry. Its cache rounded spectral amounts to 1/32 and wavetable position to a discrete key. It rendered a prepared endpoint, then animated between previous cache results. Audio already interpolated adjacent random frames using parity-stable hints; the viewport did not represent that interpolation. The fix retains the continuous amount/position, renders adjacent deterministic prepared-style frames and interpolates them at that amount, including interpolation between processed wavetable frames. The previous-result animation is removed. UI refresh/telemetry remains decimated; each drawn frame uses its current observed amount.
3. **White right edge:** stroke/fill separation already existed. The final sample used phase 1.0, which wrapped to the first sample; a saw therefore jumped at the last X coordinate. The polyline now samples a half-open cycle. The separate fill closes; the white stroke remains open.
4. **Source ceiling:** sources were represented by fixed legacy enums, 3 ENV/4 LFO fields, singleton generators, fixed runtime/compiled/telemetry arrays, 14 UI source rows, catalogs suppressing existing families, and legacy-only serialization. The + action activated those fixed sources rather than allocating another identity.
5. **Default filter:** `ModulationState::filterEnabled` defaulted true. Fresh plugin state and the captured Init state inherited it. The checked-in Init JSON contains parameter values and does not instantiate the binary patch topology. The default is now false; decoding old implicit-filter formats explicitly restores true, while formats with authored topology flags keep their flags.

## 2. Architectural changes

A shared pool reserves **32 additional sources**, beyond the original 3 ENV, 4 LFO and 5 generator sources. All seven families are repeatable: ENV, LFO, Random, Chaos, Drift, Sequencer and Function. The pool can therefore support 35 envelopes or 36 LFOs when all new slots use that family. Velocity/Note remain performance singletons.

Instance identity is monotonic and independent of storage slot or family label. Encoded source IDs use `0x1000 + id`; existing source enum values are preserved. Slots can be reused without attaching old cables to a new source. Deletion clears operator inputs and cascades source/rate-target routes.

Global sources use compact active/routed lists and small preallocated generator state. Each voice reserves lightweight envelope/LFO state per slot; no additional oscillator or filter bank is duplicated. The compiler supports extra LFO rate dependencies and stereo sources with bounded programs/masks. Canonical IDs propagate through Nodes, Matrix, destination catalogs, knob assignment, observed telemetry and persistence.

The modulation rail has prebuilt lightweight rows. Existing family editors are reused through a message-thread projection/writeback of the selected instance. Legacy settings are restored on writeback; telemetry reads canonical state and verifies the observed identity before reading a reused slot. At capacity the add menu disables repeatable families and explains the 32-slot capacity.

PANIC is a JUCE Button over the complete identity artwork, retains tooltip/accessibility and keyboard activation, and paints only during hover/press/keyboard focus. Leaving after a mouse click restores branding.

## 3. Files changed

- `origami/core/Engine.cpp`
- `origami/core/Engine.h`
- `origami/core/Voice.cpp`
- `origami/core/Voice.h`
- `origami/core/dsp/Wavetable.cpp`
- `origami/core/dsp/Wavetable.h`
- `origami/core/modulation/Modulation.cpp`
- `origami/core/modulation/Modulation.h`
- `origami/core/nodes/ControlGraph.cpp`
- `origami/core/preset/StateCodec.cpp`
- `origami/plugin/PluginEditor.cpp`
- `origami/plugin/ui/FxPage.cpp`
- `origami/plugin/ui/LfoControlStrip.cpp`
- `origami/plugin/ui/LfoControlStrip.h`
- `origami/plugin/ui/ModulationBindings.h`
- `origami/plugin/ui/ModulationDestinations.cpp`
- `origami/plugin/ui/ModulationMatrix.cpp`
- `origami/plugin/ui/ModulationPanel.cpp`
- `origami/plugin/ui/ModulationPanel.h`
- `origami/plugin/ui/ModulationSourceRow.h`
- `origami/plugin/ui/ModulationUiTelemetry.h`
- `origami/plugin/ui/OrigamiHeader.cpp`
- `origami/plugin/ui/OrigamiHeader.h`
- `origami/plugin/ui/OscillatorRack.cpp`
- `origami/plugin/ui/OscillatorRack.h`
- `origami/tests/EngineTests.cpp`
- `origami/tests/FxGraphTests.cpp`
- `origami/tests/ModulationTests.cpp`
- `origami/tests/OptimizedPathGolden.h`
- `origami/tests/PerfBench.cpp`
- `origami/tests/PluginTests.cpp`
- `origami/tests/StateTests.cpp`
- `origami/docs/qa/OCTOBER_WAVE1_CORRECTIVE_PASS.md` (this report)

## 4. State/schema migration

Schema **35** appends the monotonic next-instance ID and all 32 bounded instance records, including family, display number and generator settings. States select v35 after an instance has been created, including after all instances are deleted, preserving identity history. Patches that never use the pool continue using the existing conditional v27–v34 encoder.

The decoder accepts v1–v35 and rejects unsupported versions, truncation, invalid/duplicate instance identities/settings and dangling references. Older states produce an empty pool and retain legacy source identity. Existing filter flags are honored; old formats predating those flags retain their implicit filter. Older plugin binaries cannot open v35 patches.

## 5. Tests added/updated

- Core random-preview sweeps cover all 31 internal 1/32 boundaries for both families, and compare every sample against fractional endpoint interpolation throughout all 32 intervals. Half-open phase/saw endpoint checks cover the right edge.
- Actual painted-card tests inspect continuous amounts/waveform samples at multiple boundaries for both families. Path inspection asserts one move, 383 lines, zero closures, and no terminal saw wrap jump.
- Plugin tests cover whole identity PANIC bounds, focus/activation, existing silence/state/FX preservation, fresh/Init topology, manual filter addition and patch persistence.
- Source tests exercise a full mixed pool with 16 voices, independent Random streams, canonical telemetry IDs, live deletion/recreation/mailbox adoption, nested LFO rate routing and emergency reset under allocation/free guards.
- UI tests add six extra instances each of ENV/LFO/Random, select their family editors, verify an extra LFO rate edit preserves legacy LFO1, connect new sources in Nodes, persist those connections, and check capacity feedback.
- State tests cover full v35 settings/cables/rate destinations, deletion cleanup, monotonic recreation, capacity, truncation and authored filters in legacy/current patches.
- Existing fixtures that need an audible filter now explicitly author one. Original optimized-render golden hashes are preserved.
- Performance benchmark adds 0/8/32 source-pool cases. Memory gates now bound the measured lightweight expansion at Voice 128 KiB and Engine 2360 KiB; other RT/capacity guards remain.

## 6. Full test results

`ctest --test-dir origami/build-multihost --output-on-failure`: **7/7 passed**, 36.31 seconds on the final rerun.

| Suite | Result |
|---|---|
| State/serialization | PASS, 2,677 checks |
| Core/foundation, spectral/random morph, RT policy and allocation guards | PASS, 365,053 checks |
| Wavetable bank foundation | PASS, V22.0 foundation |
| Modulation | PASS, 3,938 checks |
| FX graph/DSP/bus | PASS, 648 checks |
| Plugin/UI | PASS, 1,606,640 checks |
| Content | PASS, 98 checks |

After correcting the future-version fixture to v36, its target was rebuilt and the state suite and complete seven-suite CTest set passed again. `git diff --check` passed.

## 7. AUval/deployment

Ran the normal `./scripts/rebuild-dev.sh` from `origami`, without skipping validation. It built/deployed Standalone, AU and VST3 and passed its plugin/core/FX/content gates. Final output contained both required strings:

```text
AU VALIDATION SUCCEEDED.
===== MCT ORIGAMI DEV BUILD DEPLOYED + VALIDATED =====
```

Installed artifacts: `/Applications/MCT Origami.app`, `~/Library/Audio/Plug-Ins/Components/MCT Origami.component`, and `~/Library/Audio/Plug-Ins/VST3/MCT Origami.vst3`.

## 8. Real-time safety

Audio storage, compiler programs, telemetry and mailbox payloads remain fixed-capacity. Identity resolution and iteration are bounded by the 32-slot pool. Audio processing adds no heap allocation/free, locks, filesystem work or unbounded queues. Spectral preview reconstruction runs in UI code; audio still uses the existing asynchronous bounded spectral compiler.

The 16-voice/full-pool allocation guards include processing, reset and live source replacement. Unused globals do not advance. Per-voice active lists are rebuilt on state revision rather than scanning the pool every sample. Spare source values are cleared only when a pool route, observation or newest-voice reader needs them; legacy slots and nested FREE-LFO inert slots are always initialized. Stereo RIGHT values are read only under corresponding masks.

The existing NOTE ON → PROBABILITY → ENVELOPE TRIGGER ownership behavior remains on the existing implementation and is included in the passing event/ENV suite.

## 9. Memory/performance impact

Release builds on this local Apple host; byte counts are `sizeof`, not total process RSS. Baseline core was compiled from the original tracked HEAD in a temporary directory.

| Structure | Before | After | Increase |
|---|---:|---:|---:|
| Engine, including all 16 voices | 2,134,784 B | 2,387,776 B | 252,992 B / 247.06 KiB (11.85%) |
| Voice | 120,896 B | 129,408 B | 8,512 B / 8.31 KiB |
| Compiled modulation | 74,496 B | 106,144 B | 31,648 B |
| Modulation state | 5,692 B | 20,544 B | 14,852 B |
| Instrument state | 14,364 B | 29,216 B | 14,852 B |
| Modulation frame | 9,696 B | 9,952 B | 256 B |

One global runtime slot is 296 B. Per-voice expansion includes lightweight sources/observation; oscillator/filter storage is unchanged. The processor footprint reported by the benchmark is 2570.2 KiB.

Controlled alternating before/after measurements, explicit filter in both versions, 16 voices at 48 kHz/256 frames: simple patch median approximately **132 → 120 µs**; legacy 16-route patch approximately **334 → 337 µs** (~1% increase). These are local measurements, not timing guarantees.

| Mixed pool, 16 voices | Median µs | p99 µs | Median deadline use | p99 deadline use |
|---|---:|---:|---:|---:|
| 0 new sources | 114.6 | 136.5 | 2.15% | 2.56% |
| 8 new sources | 239.5 | 273.7 | 4.49% | 5.13% |
| 32 new sources | 359.2 | 419.9 | 6.74% | 7.87% |

Steady benchmark loops reported zero spectral misses/requests and zero full compiles. Cost increases with active voice envelopes/LFOs and routes; these numbers exercise active mixed families rather than just empty reserved slots.

## 10. Exact manual QA checklist

These are user acceptance checks to run on the deployed build; automated tests do not constitute a human visual/host audition.

1. **Branding hover:** open Origami, confirm normal logo/wordmark and no permanent right utility PANIC. Hover anywhere over the left identity: branding dims and centered STOP / PANIC appears. Leave: normal branding returns. Tab to the button and activate with keyboard.
2. **PANIC preservation:** hold notes with an FX tail and a nontrivial patch/cables; activate the identity control. Notes/tails stop, DSP RESET confirmation appears, and oscillators, parameters, source settings and routing remain. Play again successfully.
3. **RAND AMP slow:** on a rich waveform, add one RAND AMP stage and slowly sweep 0→1→0, particularly across 1/32, 8/32, 16/32 and 31/32. The viewport morphs continuously; listen for the established DSP morph.
4. **RAND AMP rapid:** drag amount quickly back/forth several times, stop at a fractional amount, and verify the viewport immediately represents the stopped amount without a delayed animation drifting toward it.
5. **RAND SPARSE slow:** replace the random stage with RAND SPARSE and repeat the complete slow sweep/boundary checks.
6. **RAND SPARSE rapid:** repeat rapid reversals and fractional stops; verify continuous displayed morph and responsive settling.
7. **Right edge:** view a saw and several processed shapes at different editor sizes. Inspect the far-right white stroke: no terminal vertical line toward baseline/first point; the filled area can close separately.
8. **ENV 4/5/6+:** use MOD + → ENV repeatedly. Select ENV4, ENV5, ENV6 and more; set distinct attacks/releases, route to oscillator controls and confirm independent envelopes on notes.
9. **Extra LFOs:** add LFO5 onward, edit independent rates/shapes, try FREE and note modes, route them and verify their values/tracers. Modulate a new LFO's rate and confirm legacy LFO1 is unchanged.
10. **Extra Random:** add several RANDOM sources, use distinct rates/smoothing, connect them and observe separate streams; also check repeatable Chaos/Drift/SEQ/Function entries remain available.
11. **Delete/recreate:** delete a newly added routed source, confirm its cables disappear, then add another source in the reclaimed capacity. Old cables must not reconnect to it; surviving sources retain settings.
12. **New source connections:** in Nodes connect ENV4/LFO5/Random2 to compatible operator inputs and destinations; check labels, selected-source telemetry and audible response. Also assign through Matrix/knob menu.
13. **Save/reload:** save that patch, close/reopen the plugin, reload and confirm exact new-source settings and Nodes/Matrix connections. Delete/recreate again and verify stable identity behavior. Fill 32 additional slots and confirm the add menu explains capacity.
14. **Fresh Init:** instantiate a fresh plugin and load Init. Confirm zero filter modules on Synth, while oscillators remain audible.
15. **Manual filter:** add a filter using the existing Synth control; adjust cutoff/resonance and confirm audible filtering and modulation.
16. **Filter patch reopen:** load an existing legacy filter patch and a newly saved filter patch. Confirm authored filters/cutoff/resonance/routes restore; loading Init afterward removes the filter topology again.

## 11. Known limitations

- Shared capacity is 32 additional instances, with existing 32 modulation routes/32 control operators unchanged. Identity history can contain 28,671 allocations per patch; IDs are not reused. Family display numbers may reuse a deleted highest label, but identity/cables do not.
- ENV TRIGGER keeps its original ENV1–3 targets. Additional envelopes respond to voice note/retrigger/release and can drive modulation; this pass does not expand event trigger-target semantics.
- The existing audio spectral architecture morphs the **first** Random stage in a chain. The viewport follows that same two-anchor policy. Multiple simultaneous Random stages retain that limitation; sweeps of a later Random stage are not covered by the continuity claim. Other process stages retain prepared-key quantization. The viewport shows the intended reconstructed cycle, not an instantaneous cache-miss/held-frame audio capture or the sum of all voices.
- Additional source settings are patch state/editor settings; no new host automation parameters were added.
- Native host visual/auditory manual acceptance remains to be performed using the checklist. Automated painting, audio, state and AU validation passed.

## 12. Commit

The corrective implementation, regression tests and this report are committed together on the current branch. The exact resulting SHA is supplied in the completion response (a commit cannot embed its own SHA). No push, merge or subsequent development phase is included.
