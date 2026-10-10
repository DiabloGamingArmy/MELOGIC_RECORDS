# Spectral Tune completion report

Baseline: `214c479e11eef21e42727bfef409646a3d718aca`. Validation: October 8, 2026, Release build, Apple M5 Pro, 64 GiB RAM. One coherent local commit; no push. The exact final commit SHA is supplied in the completion message because a commit cannot contain its own hash.

## 1. Existing spectral infrastructure audit

[AUDIT.md](AUDIT.md) records the audit performed before implementation. Existing FFT operations serve periodic wavetable preparation, import, and editor transforms. There was no arbitrary-input streaming STFT/ISTFT, overlap-add resynthesizer, live spectral telemetry, or working effect/graph/host latency compensation.

## 2. Reuse decisions

Reused canonical effect descriptors, graph compilation, processor ownership, modulation addresses, graph codec, UI inspector/menu, and bounded telemetry publication. Existing wavetable FFT/compiler/cache code remains unchanged: its prepared periodic frames cannot resynthesize live audio. Added a small independent streaming backend. Initial portable timing justified a prepared Apple Accelerate FFT backend, retaining a portable radix-2 fallback. No third-party FFT dependency or auxiliary audio thread.

## 3. Streaming architecture

Stereo input rings → windowed prepared FFT → peak-region analysis and mapping → Hermitian reconstruction → inverse FFT → normalized overlap-add output. All windows, FFT setup, rings, phase histories, scratch, and compensation delays are prepared off the callback. Arbitrary host block sizes feed the same sample timeline. Stable node/bus-derived initial hop phases spread FFT bursts between instances.

## 4. FFT/window/hop/overlap

| Tested sample rate | FFT N | Hop H | Overlap | Bin spacing |
| --- | ---: | ---: | ---: | ---: |
| 44.1 kHz | 2048 | 512 | 75% | 21.533 Hz |
| 48 kHz | 2048 | 512 | 75% | 23.438 Hz |
| 96 kHz | 4096 | 1024 | 75% | 23.438 Hz |
| 192 kHz | 8192 | 2048 | 75% | 23.438 Hz |

Periodic Hann analysis and synthesis; squared-window overlap sum is 1.5, normalized by 2/3. Size policy: 2048 through 64 kHz, 4096 through 128 kHz, 8192 above. This maintains roughly 43 ms analysis duration and similar frequency resolution at the tested rates. It trades transient precision for useful spectral separation; instantaneous-frequency refinement improves steady-tone estimates without creating additional FFT resolution.

## 5. Exact latency

One effect delays output by N samples: 2048/44.1k = **46.440 ms**, 2048/48k = **42.667 ms**, 4096/96k = **42.667 ms**, 8192/192k = **42.667 ms**. Serial delays add; parallel arrivals use the longest path; all active buses align to their maximum graph latency. JUCE `setLatencySamples` reports that maximum to the host after graph synchronization. PWR and Mix retain latency; deleting the final spectral node restores zero latency. Eight serial instances at 48 kHz report 16384 samples / 341.333 ms.

## 6. Phase strategy

Peak instantaneous frequency uses phase advance relative to the expected hop advance. Each peak region keeps relative spectral phase and a propagated translation rotation. Moving peak bins inherit previous-region phase/motion. Fractional translation uses a centered FFT basis, including its alternating-sign basis conversion. Initial rotation accounts for actual frame start, including staggered first frames. L/R retain separate complex histories; linked detection uses stereo energy and remains valid for anti-correlated input. Returning to neutral fades mapped contribution and clears translation rotation, avoiding a permanent phase offset.

The architectural reference is [Laroche and Dolson's peak-region transformations](https://www.ee.columbia.edu/~dpwe/papers/LaroD99-pvoc.pdf). This implementation is a bounded approximation, not a claim of matching that paper's complete algorithm or perceptual quality.

## 7. Remapping algorithm

Detect local spectral peaks above a relative −80 dB evidence floor, partition source bins at peak midpoints, estimate each peak's frequency, select an allowed target, and translate each associated region. Two centered interpolation taps scatter coherent complex contributions into bounded destination bins. Distinct overlapping peak contributions receive a power budget; constructive collisions are attenuated to their summed per-peak power. No per-frame automatic gain control or hidden output limiter. It operates on multiple peaks simultaneously and resynthesizes the input spectrum, without a fundamental detector or replacement oscillator bank.

## 8. Pitch-target mathematics

`m = 69 + 12 log2(f/440)`; allowed integer MIDI notes are selected by absolute pitch class. Search is bounded to 25 candidate notes around floor(m), within useful analysis/Nyquist limits; equal distances choose the lower note. `f_target = 440 × 2^((m_target−69)/12)`. SNAP interpolates in log pitch. Invalid shifts are rejected rather than folded into the audible range.

## 9. Note mask

Twelve absolute bits, C at bit 0 through B at bit 11, bounded to 4095. Existing normalized parameter storage encodes the 4096 exact integer states through the Choice descriptor. All, Clear, Invert, and individual keys edit this same canonical mask. Empty mask disables quantization; independently authored Shift can still apply.

## 10. Root / Scale / Custom

Root C–B rotates preset interval masks. Presets: Chromatic, Major, Minor, Dorian, Phrygian, Lydian, Mixolydian, Pentatonic Major/Minor, Whole Tone; Custom is the eleventh selection. Editing keys switches to Custom when the mask differs from the active preset. Custom root changes its reference/annotation without transposing the absolute mask. Canonical edits and decode normalize mask/preset consistency. No separate UI-only scale state.

## 11. Snap

0–100%, default 75%. Zero gives delayed neutral reconstruction when Shift is zero; one reaches the nearest eligible target; intermediate settings attract continuously in semitones. A short mapping fade restores original phase on warm Snap-zero or mask-clear transitions.

## 12. Shift

Default zero; −24…+24 semitones or −24…+24 Hz, selected by Shift Mode. Shift precedes quantization. Semitone mode multiplies frequency; Hz mode adds frequency. The UI displays the appropriate unit. Shift Mode is authored state, not an audio-rate modulation destination.

## 13. Range

0…12 semitones, default 12: maximum permitted distance from shifted frequency to the nearest allowed target. Components farther away retain their shifted frequency instead of being attracted. This differs from the frequency processing bounds.

## 14. Smooth versus Response

Smooth: 0…500 ms, default 40 ms, controls mapped-offset motion toward a selected target. Response: exponential 5…500 ms, default approximately 20 ms, controls instantaneous-frequency estimate refinement. Independent changes produce distinct measured outputs. Continuous controls also receive 10 ms safety smoothing; Choice state is discrete.

## 15. Formant

Two bounded frequency-dependent envelope passes approximate a broad spectral envelope (~1/6 octave). Destination/source envelope ratio, bounded to 0.25…4, blends into remapped magnitudes by Formant 0…100%. This is meaningful envelope preservation, not vocal-tract modeling or perfect formant correction. The independent-control test confirms a real DSP change.

## 16. FX LOW / HIGH

Exponential 20 Hz…20 kHz boundaries limit the affected spectral interval. A smooth boundary taper reduces target displacement near edges; untouched exterior bins are restored from the original spectrum after scattering. This preserves out-of-region content rather than applying output high/low-pass filters. Authored crossed boundaries move the other bound; modulated bounds are ordered in DSP. High is limited to 0.49 × sample rate.

## 17. Stereo

0% blends peak evidence and frequency estimates using stereo energy; 100% detects/maps independently. Intermediate values blend evidence. Channels keep their own complex spectra and phase histories; no L+R cancellation detector. Anti-correlated input remains anti-correlated within 1e−5 in the linked test. Wide, differing-channel fixtures produce distinct linked/independent results.

## 18. Dry/wet compensation

Effect Mix dry is delayed N samples. Node PWR dry and tail gate are also delayed N. Merge inputs receive arrival-difference compensation. Graph global dry follows full graph latency; bus outputs and environment global dry share maximum bus latency. Neutral Mix 0/25/50/100%, parallel merge, multiple buses, and global Mix tests match aligned reference audio within 1e−6 (2e−6 for summed buses), avoiding delay-induced combing. Hard bypass uses a bounded 2 ms declick; Crossfade and Tail Preserve use 10 ms. Streaming processors remain warm while bypassed.

## 19. Modulation destinations

Canonical continuous destinations: Snap, Shift, Range, Smooth, Response, Formant, FX Low, FX High, Stereo, Mix. All ten were exercised through the renderer's modulation path and changed actual finite DSP output. ENV/LFO/Random routes survive processor save/load and are pruned when the node is deleted. Root, Scale, Notes, and Shift Mode are discrete authored state and exclude modulation offsets.

## 20. UI

Canonical `Audio Effects → Spectral → SPECTRAL TUNE` menu entry. Spectral category order is core data; no separate hidden palette. Card 300 × 260: compact header, Root/Scale and All/Clear/Invert, twelve chromatic keys, 276 × 96 prominent spectral viewport, four 46 px footer knobs (Snap, Shift, Smooth, Mix). Existing inspector hosts additional controls. Other audio card sizes/footers remain unchanged. Captures cover 0.75×, 1×, 1.5×, 2× and 1100/1440 px editors. Keys and knobs pass hit-bound/overlap checks. Deployed-app inspection confirmed the preserved exact Init saw and the searchable `AUDIO > EFFECTS > SPECTRAL` result. Native automation could set the search and operate AX buttons but did not activate the custom-painted result through keyboard/coordinate input; deployed insertion/audition was not claimed. The app was left on Init Synth. Offscreen processor/card checks cover insertion, controls, actual spectra, and rendering.

## 21. Truthful telemetry

Actual input FFT and mapped wet FFT feed 64 log-frequency magnitude buckets. Fixed −80…0 dB display scale, gray input and accent tuned output; output means pre-Mix mapped spectrum, as its caption indicates. Static pitch ticks and processing boundaries are annotations, not fabricated signal traces. Optional publication occurs in DSP; atomic bounded snapshots cross the renderer boundary. No UI FFT, full-spectrum transfer, dynamic frame allocation, or direct UI access to processor scratch. Panic/deletion invalidate snapshots.

## 22. Files changed

New DSP: `core/dsp/StreamingSpectrum.{h,cpp}`, `core/fx/SpectralTune.{h,cpp}`. Integration: `CMakeLists.txt`, `core/fx/FxGraph.{h,cpp}`, `FxEffects.cpp`, `FxRenderer.{h,cpp}`, `FxEnvironment.{h,cpp}`, `plugin/PluginProcessor.cpp`, `plugin/ui/FxPage.{h,cpp}`. Tests: new `tests/SpectralTuneTests.cpp`, test-only `SpectralHeapProbe.cpp`, updates to `PluginTests.cpp` and `FxGraphTests.cpp`. Evidence: this QA directory (audit, logs, CPU CSV, snapshots, WAV diagnostics). Paths are relative to `origami/`.

## 23. Serialization

Appended effect ID 16, category ID 8, visual ID 14; existing IDs retain values. Fourteen stable parameter IDs encode mask, presets, mode, and continuous state through existing graph parameters. No global schema bump. Decoder validates before normalizing new effect state. Historical library audio golden fixture deliberately remains frozen without the new effect; separate new-effect regressions cover Spectral Tune. Canonical exact `1.0f / 3.0f` Init saw and prior patch defaults remain unchanged.

## 24. RT safety

Prepared Accelerate plans are created/warmed/destroyed off-thread ([Apple prepared FFT documentation](https://developer.apple.com/documentation/accelerate/vdsp_create_fftsetup)). Process/reset/adoption tests report **zero C++ allocations, deletes, C mallocs, and C frees**. Test-only Darwin interposition verifies its own malloc/free interception before counting; it is not linked into the shipping plugin. Plan adoption/retirement uses bounded queues with writer-side destruction. Bus plan transactions adopt coherently at outer block boundaries. All loops are bounded by FFT size, graph limits, fixed telemetry size, or 25-note search. No worker wait, mutex, planning, or allocation in the new callback path. Forty graph-churn cycles passed the allocation guard.

## 25. Memory

| FFT N | Explicit processor bytes | Observed opaque FFT plan bytes | Sum (before allocator rounding) | Node bypass + gate delays |
| --- | ---: | ---: | ---: | ---: |
| 2048 | 362120 | 165552 | 527672 | 32768 |
| 4096 | 722568 | 337584 | 1060152 | 65536 |
| 8192 | 1443464 | 642480 | 2085944 | 131072 |

Explicit accounting: `84N + 184(N/2+1) + 1488` bytes on this Apple build. Includes stereo FFT/split scratch, prepared tables, window, input/OLA, dry delay, mapped spectrum, phase/frequency/peak/region/envelope/collision state, and 512 bytes of magnitude atomics within the fixed object. The Apple opaque plan is additional; off-thread allocator observations are in [native-fft-memory.log](native-fft-memory.log), SDK/allocator dependent. Graph dry/merge/bus-padding storage adds 8 bytes per stereo delay sample, only for positive required delays. Generic effects do not inherit these large spectral arrays.

## 26. CPU

[cpu.csv](cpu.csv): 128 complete-renderer configurations, telemetry enabled, tonal and independent broadband stereo fixtures, four rates × four block sizes × 1/2/4/8 serial instances. Each warms enough callbacks to populate all serial stages, then measures 1024 callbacks. Median alone is misleading: many small callbacks contain no FFT frame. p99 captures the periodic frame work. This is an offline wall-clock callback benchmark, not proof of a fully loaded DAW deadline.

Representative broadband results in microseconds (median / p99):

| Rate / block | 1 instance | 2 | 4 | 8 | 8-instance p99 deadline usage |
| --- | ---: | ---: | ---: | ---: | ---: |
| 48k / 64 | 1.375 / 119.750 | 2.166 / 122.459 | 80.500 / 130.041 | 88.375 / 206.084 | 15.46% |
| 48k / 128 | 2.709 / 124.125 | 88.666 / 129.334 | 117.334 / 199.542 | 187.166 / 229.792 | 8.62% |
| 96k / 64 | 1.708 / 175.291 | 2.625 / 189.584 | 4.500 / 179.459 | 8.792 / 314.834 | 47.23% |
| 192k / 64 | 1.458 / 306.083 | 2.209 / 307.792 | 3.584 / 308.000 | 6.708 / 318.375 | 95.51% |
| 192k / 128 | 2.792 / 309.500 | 4.042 / 310.208 | 6.875 / 312.375 | 262.542 / 322.042 | 48.31% |
| 192k / 512 | 10.792 / 317.166 | 280.625 / 325.125 | 296.958 / 337.166 | 582.750 / 1000.670 | 37.53% |

All configurations have p99 below their deadline. **192k/64 has inadequate practical headroom**: observed maximum 348.5 µs for two instances and 338.625 µs for eight exceeds its 333.333 µs deadline. Use larger buffers at that rate and budget engine/host work separately. At 192k/64, eight-instance mean is 76.113 µs; tonal p99 is 154.584 µs. Non-Apple portable CPU is unvalidated. [cpu-portable.csv](cpu-portable.csv) is an explicitly superseded diagnostic, not final production performance.

## 27. Neutral reconstruction

24 fixtures: sine, saw, impulse, white noise, three-tone chord, complex modulated bass at all four rates; irregular 127-sample blocks. RMS errors are approximately 1e−8; worst peak error below 1.8e−7 after exact delay alignment, comfortably inside required 1e−6 RMS / 1e−5 peak gates. Exact results are in [ctest.log](ctest.log). Partitioned 64 versus 511 sample streams produce identical samples. Warm Snap-zero/mask-clear transitions settle to maximum error 6.40091e−8; maximum sample jump 0.00769165 on the test sine.

## 28. Quantization

All twelve absolute pitch classes, Snap 0/0.5/1: 36 tuned-sine cases, observed target frequency within 0.51 Hz of expected logarithmic attraction; tuned amplitude greater than 0.12 for 0.2 input. Semitone −12/0/+7/+12/+3.5 and Hz +17 cases within 0.6 Hz. Octave-boundary target selection and all 120 root/preset masks pass. Tests verify measured rendered output, not solely pitch math.

## 29. FX range and sub

Input components: 55 Hz at 0.2, 280 Hz at 0.15, 5 kHz at 0.12; processing range 200–800 Hz, C-only full Snap. Measured amplitudes: sub **0.200020**, mapped 261.625 Hz **0.140672**, residual original 280 Hz **0.002778**, untouched high **0.119970**. Empty mask and narrow 0.1-semitone Range preserve original tone amplitude greater than 0.199. No output filter is used to obtain these results.

## 30. Save/load and cleanup

Graph codec restores exact custom/preset/control state. Actual processor save/load restores identical graph, three modulation routes, and 2048 host latency. Canonical node deletion removes routes and returns host latency to zero. Inactive buses receive prepared empty graphs so deleted processors retire off-thread. Existing serialization/golden regressions are retained.

## 31. Panic/reset

Populated processor reset produces exact silence, clears OLA/input/dry/phase/region/motion state and spectrum sequence. Renderer/environment Panic clears graph/bus alignment delays and telemetry. Reset and plan adoption pass allocation guards. Hard/Crossfade/Tail Preserve transitions remain finite, maximum sine sample jump **0.008733**, and settle to aligned dry within 1e−6 without stale-tail bursts.

## 32. Full regression

Final required verbose ctest and deployment results are recorded in [ctest.log](ctest.log) and [rebuild-dev.log](rebuild-dev.log). An initial full-suite failure exposed the historical seven-category menu expectation; it was updated to include the new canonical Spectral category. No existing audio golden was rewritten. Final command: `ctest --test-dir origami/build-multihost --output-on-failure -V`, **8/8 passed**, 124.78 seconds. Counts: state 2779; core 1916735; wavetable-bank foundation PASS; modulation 3938; FX graph/DSP/bus 653; spectral 3691997; plugin/UI 1635180; content 98. Focused final Spectral UI capture: 223 checks passed. The final added check verifies nonzero real spectral data in offscreen captures; deployment gates also passed (plugin 1635179 checks before that test-only assertion, core 1916735, FX 653, content 98).

## 33. AU validation

The required `./origami/scripts/rebuild-dev.sh` builds, runs deployment regression gates, installs Standalone/AU/VST3, validates the installed `aumu Orig Mctg`, and launches the app. The script exited 0 and the installed AU returned literal **`AU VALIDATION SUCCEEDED.`**. Standalone `/Applications/MCT Origami.app`, AU `~/Library/Audio/Plug-Ins/Components/MCT Origami.component`, and VST3 `~/Library/Audio/Plug-Ins/VST3/MCT Origami.vst3` were deployed successfully.

## 34. Manual sound-design QA checklist

Generated paired, latency-aligned float WAV diagnostics in [audio/](audio/) with no limiter. They are synthetic diagnostics, **not a substitute for listening to real sound-design material**. Listening has not been performed and these subjective items remain unchecked:

- [ ] Sustained saw: compare Snap 0/0.5/1, target audibility/locking, harmonic timbre, phase modulation and aliasing.
- [ ] Real supersaw/chord: compare linked/independent stereo, detune/width retention, chord ambiguity and collision gain.
- [ ] Real bass growl: move FX Low above the sub, check unchanged sub and movement of eligible formants/harmonics.
- [ ] Real color-bass source: sweep mask, Shift, Range, Smooth, Response and Formant; check useful intermediate Snap and audible locking.
- [ ] Real drums/transients: compare attacks, smear/pre-ringing, cymbal roughness, full/out-of-range behavior, PWR transitions.
- [ ] Real full mix: stress overlapping sources, headroom, low end, stereo collapse, extreme settings and high-rate small-buffer behavior.
- [ ] Across all sources: sweep parameters and modulate ENV/LFO/Random; listen for clicks, zippering, phase artifacts and excessive gain; compare aligned Mix 0/0.5/1 and parallel routing.

Objective synthetic fixture peak changes range **−2.600…+2.464 dB**, RMS changes **−1.795…−0.041 dB**; largest output peak 0.326670. [audio-metrics.csv](audio/audio-metrics.csv) contains each measurement. Peak reshaping can increase crest factor despite collision budgeting; it is not loudness normalization.

## 35. Known limitations

Approximately 43 ms single-instance latency; serial instances accumulate. Windowing can smear/pre-ring percussion. Spectral peaks can be ambiguous for dense material; this is not perfect auto-tune or harmonic-source separation. Broad envelope correction is approximate. Fractional two-tap translation changes energy/phase and can alter crest factor. Low frequencies remain limited by roughly 23 Hz bin resolution; out-of-range/invalid Nyquist destinations are rejected. Discrete mask/scale edits rely on target smoothing, not audio-rate pitch-class modulation. Bypassed streaming processors retain CPU cost to keep their phase/history warm. Large-rate small-buffer deadlines have the limits above. Topology changes prepare fresh compensation histories and change reported host latency; host PDC and startup settling still require host/session testing. Portable fallback timing and subjective listening on real material remain unverified.

## 36. Exact commit

One Spectral Tune commit on the current branch, no push, then stop. Exact 40-character SHA is returned in the completion message and available from `git rev-parse HEAD` after commit.
