# Soura reliability continuation

Baseline: `f95f4cd0a24eb74257e13001bdb1a6ffefd619c5`, clean main matching freshly fetched origin/main on 2026-09-14. All 28 PDF pages read before edits. The PDF is a risk assessment, not proof of defects.

## P0: actual architecture

- `studio-project.html` → `src/studioProject.js` is the editor in **both** Vite web and Tauri desktop (`src-tauri/tauri.conf.json`, `src-tauri/src/lib.rs`).
- Project/editor state belongs to `studioProject.js` and `studio/model/studioProjectModel.js`; persistence goes through `saveStudioProjectEditorState`. Audio buffers live in runtime maps, separate from saved region metadata.
- Arrangement playback: `startPlayback` → `beginTransportClock` → scheduling/update functions → WebAudio sources → track channels/effects (`projectMixGraph.js`) → master → destination. `SouraWebAudioContext` owns the project context. Clock authority is AudioContext.currentTime plus project-seconds origin; beats use the tempo map. RAF still drives scheduling; native VST MIDI has no sample timestamp.
- `StudioAudioEngine` is created with the existing context and `useTransportWorklet: false`. Its standalone transport worklet is not the editor's clock. `SouraExecutionBackend.js` has no production importer: its native/web switch does not select the arrangement backend.
- Rust `audio/engine.rs` owns a separate CPAL **diagnostic tone** stream. `audio/dsp.rs` runs an isolated Signalsmith benchmark; neither processes arrangement clips.
- Production native instruments: instrument registry → `NativeVst3HostService.js` → Tauri `native_vst3_host.rs` → CPAL stream per instrument → `soura_vst3_host.mm` → VST3 processor. Audio bypasses the WebAudio track effect/master path; atomic gain/pan/mute provide native mix controls. No native shared project graph/router exists to replace.
- Native control commands hold the instances mutex; callbacks do not acquire it. C++ bus/event buffers are prepared before playback. Plugin creation/editor/disposal occur on control paths; plugin processing and MIDI event-list writes occur on the callback. Third-party processing cannot be certified from host source alone.
- Recording in the editor uses getUserMedia/MediaRecorder, including desktop. Native CPAL has no capture/file-writer ring. Offline export uses OfflineAudioContext and shared WebAudio mix helpers; native/worklet instruments without offline support are explicitly rejected.
- Sample conversion: decodeAudioData into context rate; WebAudio output backend/device conversion; WASM worker/Signalsmith rendering for region pitch/stretch; realtime region DSP through Signalsmith AudioWorklet. Native VST uses actual CPAL device rate at setup. There is no unified native project sample clock.
- `SOURA_APP_w2`, `meLogic/web`, `AudioRouter`, `BusMixer`, `MixerChannel`, `DSPChain`, `AudioRingBuffer`, `AtomicSharedPtrList`, `AudioClock`, `CodecFactory`, `FFmpegRunner`, and the PDF's readiness files are **absent** from this main tree. Their implementation cannot be audited here. Backup `.bak` files and patch scripts are not application entry points.

## Confirmed P1 findings

1. Native VST callback drains a concurrently replenished MIDI queue without a work bound. Rust queue capacity is 4096; C++ EventList accepts only 1024. Ignored addEvent failure silently drops accepted MIDI, including note-offs.
2. C++ processing failure returns before clearing input events, replaying stale MIDI on the next callback and retaining event-list occupancy.
3. Native stream error callbacks synchronously log. Stream/process failures and oversized buffers have no callback statistics.

## Verified without redesign

- The cached SDK's EventList allocates only in construction/setMaxSize, not addEvent/clear. HostProcessData prepares buffers before starting audio.
- No arrangement clips, routes, DSP graphs, or shared_ptr snapshots are passed through the native tone or VST callbacks. Adding a second graph/reclamation system here would not harden arrangement playback.
- Native callback data paths do not take the command mutex, launch subprocesses, perform filesystem/network I/O, or rebuild the graph. Arc references are captured at stream creation, not cloned/dropped each block.
- Tauri invocation and media analysis/DSP self-tests are outside the callback. Browser recording does not write disk from a Rust callback.

## Completed reliability work

- Native MIDI handoff uses a fixed SPSC queue with at most 1024 events consumed per callback, matching the preallocated C++ EventList. Accepted excess events stay queued; full-queue rejection is observable. Failed C++ processing clears old input events.
- Native diagnostic tone and VST callbacks expose atomic duration/error counters and bounded duration histograms. Percentile snapshots are calculated on control threads. Stream errors no longer log synchronously from the callback. The C++ process guard rejects synchronous editor resizing during processing.
- Plugin retirement waits for exclusive ownership after both audio/error callback references disappear. A control worker destroys retired owners; C++ teardown executes on the main thread. The collection interval does not establish safety: ownership does. If the reclamation worker fails, the fallback retains a still-live owner rather than freeing it unsafely.
- Native instrument creation/disposal is serialized per instance ID. Disposal remains terminal during pending creation; late notes and creation completions cannot resurrect disposed instruments.
- Custom WASM instruments use a preallocated MIDI heap, cached output views, bounded per-block consumption, validated ABI pointers, explicit initialization acknowledgment and terminal disposal. Overflow, traps, unexpected memory growth and oversized blocks fail silent with diagnostics. Control-side polling replaces per-block reporting.
- The Signalsmith wrapper caches live audio views, avoids per-block view construction and consumes automation without repeated array shifting. Its embedded WASM is unchanged. Before/after PCM comparisons were byte-identical for 300 blocks across four sample rates and three pitch shifts.
- Shared live/offline source scheduling now distinguishes source-buffer duration from audible output duration for fades. Seeking preserves fade progress, and delayed sources use the delayed envelope origin.
- Native device lifecycle reports INITIALIZING/RUNNING/DEVICE_LOST/FAILED/STOPPED states. Early stream failure cannot be overwritten by successful-start reporting. Failed VST output silences processing and rejects new MIDI. Capability flags explicitly report unsupported native device/configuration controls. Device enumeration retains actual channel/format/rate/buffer tuples.

## Executive Summary 2: ordered implementation

All nine pages were read on 2026-09-14. This document now determines feature order. Its sample filenames, snippets, architecture diagram and competitor comparisons are guidance, not evidence of defects in this repository. Do not copy its proposed blanket floor-based snapping, change monitoring latency hints indiscriminately, or add a second desktop framework: those choices require actual product requirements and runtime evidence.

### Critical: core editing, file I/O, stability

1. **Started: region/MIDI editing.** Confirmed and fixed pointer movement/right resizing clamping notes to the old region end. Region end and duration now extend to the latest edited note, share the note gesture's single history transaction, and return to the original boundary when the pointer moves back. The left boundary and minimum note duration remain protected. Regression coverage includes multiple notes, four zoom levels, snapping on/off, history snapshots and click-without-drag. Remaining: actual browser gesture/undo/redo qualification, keyboard nudge parity, region splits, copy/paste and snapping review. Existing split operations already call `commitHistoryMutation`; missing split undo is not established. MIDI paste already extends the region. The existing nearest-grid snapping is not inherently wrong.
2. **Next: file I/O and persistence.** Inventory actual decoder/export capabilities and limits; test supported formats, large-file rejection/streaming behavior, metadata preservation, corruption handling, and tempo/loop round trips. RF64 and DAWproject interoperability remain unimplemented/unqualified here. Do not claim arbitrary >4 GB browser decoding or unlimited track capacity.
3. **Ongoing: stability and regression gates.** Earlier callback/lifetime/device work is listed above. `npm run test:soura` and `.github/workflows/soura-reliability.yml` now gate editor/audio/export regressions and the production web build. Existing tests and other CI workflows predate this change; the PDF's claim that none exist is false. Native hardware, actual third-party plugin load, device churn, recording, long-session memory, sanitizers and UI accessibility still need qualification. The new CI workflow has been validated locally through its test/build commands, not run on GitHub yet.

### Important: after critical qualification

4. Multi-track recording: actual capture/arming/monitoring limits, overdub alignment, punch and storage/device failure behavior.
5. MIDI sequencing: keyboard/pointer parity, quantization, velocity and piano-roll usability, preserving existing features.
6. Plugin support: qualify existing native VST3 and built-in/WASM instruments before extending formats; unify native audio routing and project clock/latency accounting.
7. Collaboration/cloud sync: inspect existing Firebase/LiveKit permissions and persistence before adding sharing, conflict resolution or backup. No security/privacy compliance claim follows from this code review.

### Advanced: after reliable core workflows

8. AI mastering/chords/EQ assistance with explicit data handling and measurable output quality.
9. Mobile/standalone expansion; existing desktop uses Tauri, not Electron.
10. Advanced DSP/content, then a supported developer SDK/API.

Professionalism and cleanliness apply throughout: use existing controls and history/persistence paths; keep changes focused; provide useful errors and progress; maintain keyboard labels, focus and contrast as touched workflows are qualified. Existing transport ARIA labels and menus are present, so accessibility work should target verified gaps. Do not add dead buttons, pretend capabilities, blanket consent dialogs or placeholder feature panels.

## Validation on 2026-09-14

- `npm run test:soura`: 61 tests passed, including six new MIDI gesture regressions. Tests execute production handlers in a VM with controlled DOM/audio dependencies; they are not end-to-end browser or screen-reader tests.
- `npm run build`: passed. Existing Vite large-chunk warning remains.
- `cargo test --manifest-path src-tauri/Cargo.toml --lib --locked --offline`: 15 passed, including Rust allocator tripwires, callback ownership, queue stress and start/device-loss races.
- `cargo build --manifest-path src-tauri/Cargo.toml --lib --locked --offline`: passed; three existing CPAL device-name deprecation warnings remain.
- `ctest --test-dir /tmp/soura-rt-bridge-tests --output-on-failure`: 1/1 passed against the actual C++ bridge and fake processor.
- `git diff --check`: passed.

To recreate the native bridge test build on this workstation:

```sh
cmake -S src-tauri/native-vst3-host -B /tmp/soura-rt-bridge-tests -DVST3_SDK_ROOT=/Users/ginobarnes/Library/Caches/Melogic/vst3sdk -DSOURA_BUILD_RT_TESTS=ON -DCMAKE_BUILD_TYPE=Release
cmake --build /tmp/soura-rt-bridge-tests --target soura_realtime_bridge_test -j4
ctest --test-dir /tmp/soura-rt-bridge-tests --output-on-failure
```

## Material limitations

This is staged implementation, not completion of the full feature roadmap or a production-readiness certification. Native device recovery/configuration remains partial: no automatic reconnection or reconfiguration is implemented, and default-device CPAL handling can suppress physical disconnect errors. Native instruments still bypass WebAudio master/effects and lack project sample timestamps. Third-party plugins, drivers and browser GC are outside the allocation tests' guarantees. WASM instrument blocks above the existing 128-frame ABI fail explicitly. Signalsmith message/offline paths still allocate and scan buffers. Full recording/latency compensation, schema migration, security review and real-device stress remain pending. No project format migration or deployment was performed.
