# Soura region geometry audit

Repository main: `40a2325093bbd86cda3335e8e18d294068504d49`, verified against fetched `origin/main`. Existing uncommitted viewport, CSS, test and DSP metadata changes were preserved. No deployment.

## 1. Reproduced root cause

Before changing the geometry implementation, a local browser fixture ran the actual Soura editor with an eight-beat audio region and four-beat MIDI region. Zoom raised the ruler scale, but neither region resized. Browser console evidence:

```text
ReferenceError: trackTopAtIndex is not defined
    at studioProject.js:12862:19
    at NodeList.forEach
    at updateTimelineRegionGeometryDom (studioProject.js:12854:48)
    at studioProject.js:13033:7
```

The function call occurred after calculating left/width but before assigning either DOM style. The zoom frame had already updated the scale, scroll and ruler/grid. The exception prevented region assignment and the remainder of the frame, including diagnostic publication. This was the direct cause, not an incorrect multiplication or zoom sensitivity.

## 2. Container and waveform

Both stayed at their previous screen widths because the containing region never resized. The SVG and bars already use percentage sizing and the SVG has `preserveAspectRatio="none"`. They now follow the container continuously. Waveform detail refresh is debounced by 90 ms; existing SVG/bar projection handles live scaling. Cached peak analysis is retained, and the visible waveform detail renderer is no longer invoked on every zoom frame. Newly visible regions still need an initial render.

## 3. Geometry paths audited

| Path | Finding / resulting behavior |
| --- | --- |
| `renderMidiRegion` | Independent left/width and lane formulas replaced by shared projection/lane helpers. |
| `renderAudioRegion` | Removed render-time timing mutation and recording pixel-position override; uses the same helpers. |
| `updateTimelineRegionGeometryDom` | Undefined lane function aborted every populated zoom frame. Now uses shared lane geometry and the supplied viewport snapshot, including note previews. |
| `renderTimelineRegionElements` | Delegates persisted and live recording regions to the shared renderers. |
| `getTimelineRegionIndex` / visibility selection | Reads the same pure musical range as rendering. |
| `refreshVisibleTimelineRegionsDom` | Removed wholesale viewport teardown; viewport scrolling now reconciles entering/leaving regions and updates retained nodes. |
| `reconcileVisibleTimelineRegionsDom` | Retains visible nodes and renders only newly entering regions. |
| `refreshMidiRegionDom` / editor rebuild | Edit/recording refresh can rebuild nodes, but all generated rectangles use the shared renderer. |
| Audio import/drop / recording completion | Commit timing through `syncAudioRegionTimeline` before insertion. Import preview remains a separate temporary drop affordance with its existing 32 px minimum. |
| Drag / trim / stretch / split / overlap edits | Mutate timing intentionally at edit boundaries; subsequent rendering uses the pure musical range. |
| Load / clone / save / undo restore | Existing normalization remains at state boundaries. Rendering no longer silently repairs source data. |
| Playback / Follow Playhead | Camera movement does not alter region endpoints. Transport scheduling was not changed. |
| `renderAudioWaveform`, peak-limit selection, visible waveform refresh | Arrangement clipping/visibility uses the shared musical projection/range. Detail is deferred during zoom. |
| CSS and parent transforms | Region is absolute, border-box, min-width 0, overflow hidden. No competing region width/scale override found. Ruler/global/extension mirror native grid scrolling; the region parent has no additional horizontal camera transform. |
| Handles, pseudo-elements, children | Handle scale only mirrors the right handle. Region pseudo-elements fill the rectangle; no width animation. Waveform bars use percentages. Region Editor coordinates remain a separate editor viewport. |

## 4–6. Audio timing authority

The reproduced fixture's audio fields did **not** diverge: start 4, end 12, duration 8, four seconds at 120 BPM. Divergence was therefore not needed to trigger this failure.

The former full-render call to `syncAudioRegionTimeline` nevertheless could rewrite `durationBeats`/`endBeat` from trim/stretch seconds while the fast path read beat fields. It was a second authority and has been removed from rendering and pure range lookup. `syncAudioRegionTimeline` remains responsible for reconciling media timing into musical timing during actual load/edit/import operations.

Layout authority is `startBeat` and `endBeat`; duration is `endBeat - startBeat`. Legacy fallback uses `timelineStartBeats` and `durationBeats` only when canonical endpoints are missing. Source/file/trim/stretch seconds remain media properties, not independent screen-width inputs. A divergent-field unit test verifies they cannot override committed musical endpoints in a render/zoom lookup.

## 7. Delayed rebuild

The described 120 ms post-zoom region rebuild was already absent in the uncommitted viewport changes present at task start. It was not needed to reproduce the exception. A remaining scroll/viewport teardown path was replaced with reconciliation. Browser testing waited beyond the settle delay and then explicitly rebuilt: rectangles matched exactly, with no timing mutation. Ordinary zoom retained the original region nodes throughout 250 changes.

## 8. Shared abstraction and diagnostics

`src/studio/timeline/regionGeometry.js` exports:

- `getRegionTimelineRange(region)` — pure musical endpoints and derived duration.
- `getTimelineRegionGeometry(region, geometry)` — projects both endpoints through `timelineXForBeat` using one origin, scale and revision; width is right minus left.
- `getTimelineRegionLaneGeometry({ laneTop, trackHeight })` — identical vertical bounds for live and full rendering.

`window.__souraTimelineGeometry.snapshot()` includes each region's id/type, musical endpoints/duration, scale, origin, scroll, revision, expected and inline dimensions, bounding rectangle, reconstructed content-space X, and waveform widths. DOM width and content-space position participate in invariant errors. Diagnostics are enabled in development or with `souraGeometry`.

## 9. Browser measurements

Audio range stayed **4–12 beats** in every row. Origin was 0. Content left and screen left are deliberately separate.

| State | px/beat | Expected content left | Actual inline left | Expected width | Bounding width | SVG / bars width |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Before fix, before zoom | 25 | 100 | 100 | 200 | 200 | 198 / 198 |
| Before fix, after zoom | 30.535069 | 122.140276 | **100** | 244.280552 | **200** | **198 / 198** |
| After fix, zoom in | 30.535069 | 122.140276 | 122.14 | 244.280552 | 244.273438 | 242.273438 / 242.273438 |
| After fix, zoom out | 25 | 100 | 100 | 200 | 200 | 198 / 198 |

Before the fix, screen left changed from 490 to 443.5 solely because scroll changed from 0 to 46.5; the region's content left incorrectly remained 100. After the fix, screen left was 465.632813: grid left 390 + measured content left 122.132813 − scroll 46.5. Errors below 0.008 px reflect browser subpixel layout. The 2 px waveform difference is the region's two 1 px borders.

MIDI range **16–20 beats** changed from left 400 / width 100 to inline left 488.561 / bounding width 122.132813; expected left 488.561103 / width 122.140276. It returned to exactly 400 / 100 on zoom-out. Audio and MIDI width ratios matched the scale ratio within browser rounding.

The 250-update browser fixture reported `failures: []`, with zero state mutations or retained-region node replacements. Before and after explicit rebuild:

```json
[
  { "left": "100px", "width": "200px", "top": "1px", "height": "94px" },
  { "left": "400px", "width": "100px", "top": "1px", "height": "94px" }
]
```

Playback-active zoom was also measured. With Follow Playhead enabled and generated local audio playing, zoom-out returned the audio/MIDI widths to 200/100 with no diagnostic errors. Pausing did not correct or change their geometry.

## 10–12. Tests and build

Added seven tests in `test/regionGeometry.test.mjs`: exact 200→400 width doubling for both types, 250 scale/origin/scroll updates for each type, endpoint round trips, divergent audio fields, legacy/subpixel fallback, and execution of the **actual live DOM updater** with audio/MIDI/recording elements. The latter catches the original missing-function exception rather than merely testing a duplicated equation.

47 focused tests passed across region geometry, arrangement viewport, timeline virtualization, Region Editor coordinates, transport/metronome invariants, Web Audio context ownership, portability, track editing, StudioAudioEngine and asset drops. Production `npm run build` passed, including DSP build/verification. Existing Vite configuration and large-chunk warnings remain.

The development-only fixture at `/studio-project.html?regionGeometryFixture` mounts the actual editor with no project id, preventing cloud saves. It provides zoom, measurement, rebuild and 250-update controls. A generated local AudioBuffer supports transport/waveform checks. The fixture branch is excluded from production builds.

## 13. Remaining manual acceptance

Test an imported clip in the user's normal project and target browser/native shell: align both edges to known ruler beats, pinch in/out during playback with Follow both off and on, and confirm the same endpoints after pause/resume. Also check live microphone recording and long/stretched clips with viewport entry/exit. The isolated browser fixture verifies the reported geometry failure and repair; it does not replace device-specific audio/import acceptance.
