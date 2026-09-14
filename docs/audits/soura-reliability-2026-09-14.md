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

## Remaining (priority order)

1. Finish P1/P1A/P1B: qualify third-party VST processing, editor/processor concurrency and CPAL shutdown quiescence/lifetime on device loss. Inspect active Signalsmith/WASM instrument callbacks and graph mutation before declaring whole-runtime RT invariants. Add real hardware timing/stress and allocation/deallocation evidence; host-only tests cannot certify plugins or drivers. Native creation play-error/shutdown cleanup also needs lifecycle review.
2. P2/P2A/P2B: transport/rate/buffer matrix, native MIDI sample timestamps and clock integration, authoritative device recovery/configuration/capability reporting, project load during playback. Current native status is not a lifecycle state machine.
3. P3: recording alignment, punch, bounded capture/storage failure/device-loss behavior.
4. P4: unified latency accounting and compensation (native instruments currently bypass WebAudio mixing).
5. P5/P5A: executable persistence determinism and schema migrations against actual serializers.
6. P6: inventory actual media subprocess boundaries; the PDF's named FFmpeg classes are absent.
7. P7/P7A: remaining web architecture and large-session timeline performance.
8. P8: actual Firebase/API security; PDF's Next/auth-service paths absent.
9. P9: automated fast/release gates.
10. P10: dependencies/SBOM/installers/accessibility.
