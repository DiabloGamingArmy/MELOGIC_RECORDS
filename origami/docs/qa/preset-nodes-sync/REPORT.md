# Nodes preset / view synchronization correction

Date: 2026-10-08. Baseline: bc0e6bcac259d141cffbe1f2f403d81cbf4be675.
Branch: mct-origami-nodes-visual-feedback-p03.

## Proven causal chain

The processor's FxWorkspace owns the authoritative message-thread bus graph documents. FxEnvironment compiles that state for audio rendering; FxPage is a projection, not another graph owner. Restore validates state, publishes the instrument model, recreates workspace documents, reconciles canonical buses, restores CONTROL layout, then synchronizes the renderer. Previously, it advanced the ordinary UI model revision before the workspace restore and suppressed workspace edit notifications without emitting a completed-restore notification.

FxPage retained a raw document pointer, document-local edit revision, node components, selection, inspector and CONTROL history. Restored documents start with the same local revision; allocation can reuse the old document address. Its pointer and revision comparisons therefore both passed while graph contents had changed. syncFromModel called refresh(false), which skipped the AUDIO component rebuild, then could refresh the sidebar/CONTROL view separately. Hidden modelChanged deferred structural work; visibility checked only modelDirty. Browse close only resized. Clicking a different old node invoked selectNode -> refresh(true), bypassing the faulty comparison and repairing the projection.

The new no-interaction Browse regression failed on the original code with `FAIL: displayed positions match without graph interaction` (regression-before.txt), before the production fix. It now passes.

## Correction and ownership

FxWorkspace has a runtime-only atomic monotonic document-lifetime generation. Successful reset, decode, legacy adoption and bus document removal advance it; failed decode does not. It is independent of local graph edit revisions, memory addresses and serialized patch data. An existing revision could not represent this lifetime: the document revision restarts and the instrument model revision is published before the graph restore completes.

FxPage checks the lifetime before dereferencing its cached document pointer. A changed lifetime rebinds the existing active bus if valid, otherwise MAIN. It clears AUDIO components, graph/CONTROL selection, clipboard, patch-local graph/CONTROL history and gestures, pending confirmation/palette, view caches, meters, visual modulation snapshots and inspector binding/scroll. The graph, wires, bus/sidebar/routing commands and CONTROL projection then rebuild from canonical state. Conservative selection clearing applies even when IDs are reused. History is local to a document lifetime; clearing it prevents A transactions from altering B, including after document removal.

Nodes visibility always invokes authoritative synchronization. Restore completion posts a JUCE ChangeBroadcaster notification only after graph, CONTROL layout and renderer synchronization finish; editor listeners read the latest state and are removed on editor destruction. Browse load also synchronizes directly. Browse close synchronizes editor surfaces and Nodes before resized exposes the destination. Unchanged modulation skips redundant CONTROL invalidation. Identical boundaries keep existing node components and skip CONTROL derivation.

Deferred node deletion and modulation deletion capture the lifetime and reject stale work. Nodes native menus check lifetime plus anchor/component survival, including persistent canvas/panel anchors. Completion notifications contain no old snapshot and can coalesce to the latest patch. Existing editor AsyncUpdater work reads current state, so delayed presentation work cannot republish a prior patch.

Telemetry remains copied from the current processor host by bus/node ID, with no renderer-instance pointer retained in the UI. Replaced node components and inspector telemetry are cleared; the inspector is empty and x=0. New modulation projection and telemetry subscription use the rebound canonical bus. Existing renderer publication owns audio-side processor retirement. No DSP algorithm, FFT/latency/PDC, parameter semantics, Init or oscillator change was made. No UI work was added to processBlock/render and no timer correctness workaround was added.

Preset Browse has no patch preview/cancel-and-restore semantics: row selection only browses; LOAD/activation synchronously commits, marks used, and closes. CLOSE/Escape do not restore an earlier patch. Preset stepping uses the same load path. Wavetable preview semantics are separate.

## Validation

- Focused regression: 427 checks (focused.txt). Actual temporary-library Browse LOAD/close A -> B -> A, complex -> INIT, same IDs/topology with different positions/parameters/power/modulation/insertion workflow, additional bus and removed-active-bus MAIN fallback, SYNTH/MATRIX/GLOBAL -> Nodes, selection and horizontal scroll reset, graph/CONTROL undo clearing, preset stepping and selection-only Browse close.
- Rapid A -> B -> C -> D while Browse stays open; final D identity, MAIN and added bus state verified before graph interaction.
- Deferred delete of B node and route followed by C with reused IDs; native message-loop dispatch cannot delete C. Host setStateInformation completion updates components without any graph/browser action. Native callback dispatch coverage is macOS; other platforms use ChangeBroadcaster dispatch for the completion check.
- Ten repeated page/Browse boundaries preserve instrument bytes, workspace bytes, generation, preset identity, component identity and CONTROL rebuild count. There is no separate preset dirty flag in UiPresetIdentity; byte/state/history/identity checks verify that synchronization does not edit the preset.
- Two processors restored from identical state (one with editor synchronization) produce bit-identical stereo samples over 32 x 128 frames. This checks editor synchronization transparency, not an independent baseline-versus-new executable render comparison.
- git diff --check passed.
- Full rebuilt suite: 9/9 passed in 72.60 s (ctest.txt); 1,636,688 plugin/UI checks; 3,954,183 Spectral checks with zero RT allocations/deletes/C mallocs/C frees; 74 Spectral quality checks.
- rebuild-dev.sh passed all regression gates, deployed Standalone/AU/VST3, and reported literal `AU VALIDATION SUCCEEDED.` (rebuild-dev.txt).
- Existing horizontal-inspector audit remains in the full suite: compact bounded sections, horizontal wheel/hit mapping, nine commands in the existing header, 250px inspector, graph at y=0 and reclaimed toolbar space.

## Deployed Standalone actions actually performed

On /Applications/MCT Origami.app after deployment, using existing presets and Browse search/keyboard selection/LOAD:

1. Loaded Sparkle Stabber from SYNTH, then opened Nodes. Screenshot showed its Spectral Tune, Compressor and Drive chain with fresh positions and an empty Module Parameters inspector.
2. Nodes on Sparkle -> Browse -> Weird Ass Sounds 2 -> automatic close directly to Nodes. Screenshot immediately showed the different Drive/Compressor/Filter/Chorus graph and its connections. No node/bus/Fit/zoom/inspector interaction occurred after loading.
3. Browse -> Sparkle -> automatic close. Its original Spectral graph appeared again without graph interaction.
4. An INIT search initially selected Yoy 4 because INIT also matches categories. Header verification detected this, then keyboard selection of the first INIT result loaded the actual factory INIT. Its graph contained only MAIN IN, MAIN OUT and their connection, with an empty inspector. This was a real complex-to-empty transition from Yoy 4.
5. Consecutive Browse loads Sparkle Stabber -> Weird Ass Sounds 2 -> YOY Sound 3 -> INIT, without graph interaction between them. Each loaded header was verified, and the final screenshot showed only INIT terminals/connection. Browse LOAD closes on every commit; the focused test separately covers multiple loads while Browse remains open.
6. From INIT, opened Browse, selected Sparkle without LOAD, then CLOSE. Header and empty Nodes graph remained INIT, confirming actual selection/cancel semantics.

MIXER is disabled / not implemented, so a real MIXER transition cannot be exercised. MATRIX and GLOBAL transitions are covered in regression tests. No deployed audio audition, native-menu interruption during a preset restore, or manual bus-removal test is claimed. No user presets were created, overwritten or deleted for deployed QA. The Standalone was left on INIT/Nodes.
