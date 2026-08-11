#!/usr/bin/env python3
from pathlib import Path
import re
import shutil

TARGET = Path("src/studioProject.js")

if not TARGET.exists():
    raise SystemExit(
        "src/studioProject.js not found. Run this from the MELOGIC_RECORDS repository root."
    )

text = TARGET.read_text(encoding="utf-8")
original = text

backup = TARGET.with_suffix(".js.timeline-v45.bak")
if not backup.exists():
    shutil.copy2(TARGET, backup)
    print("backup:", backup)

def replace_function(source, start_signature, next_signature, replacement, label):
    start = source.find(start_signature)
    end = source.find(next_signature, start + len(start_signature))
    if start < 0 or end < 0:
        raise SystemExit(
            f"Could not safely locate {label}; no partial write was performed."
        )
    print("patched:", label)
    return source[:start] + replacement.rstrip() + "\n" + source[end:]


# ---------------------------------------------------------------------------
# 1) Waveform detail.
# ---------------------------------------------------------------------------
text = re.sub(
    r"const WAVEFORM_PEAKS_PER_PIXEL = [0-9.]+",
    "const WAVEFORM_PEAKS_PER_PIXEL = 2.75",
    text,
    count=1
)
text = re.sub(
    r"const WAVEFORM_MAX_RENDERED_PEAKS = \d+",
    "const WAVEFORM_MAX_RENDERED_PEAKS = 32768",
    text,
    count=1
)
text = re.sub(
    r"const WAVEFORM_PERSISTED_MAX_PEAKS = \d+",
    "const WAVEFORM_PERSISTED_MAX_PEAKS = 16384",
    text,
    count=1
)

text = text.replace("maxPeaks: 1100", "maxPeaks: 24000")
text = text.replace("maxPeaks: 12000", "maxPeaks: 24000")
text = text.replace("maxPeaks: 16000", "maxPeaks: 24000")

print("patched: waveform density / cache limits")


# ---------------------------------------------------------------------------
# 2) Audio Region Editor always uses the Pitch Trace/MIDI-style surface.
# ---------------------------------------------------------------------------
panel_start = text.find("function renderAudioRegionEditorPanel(region, motionClass = '') {")
panel_end = text.find("\nfunction renderRegionEditorTimeline(", panel_start)

if panel_start < 0 or panel_end < 0:
    raise SystemExit("Could not locate renderAudioRegionEditorPanel().")

panel = text[panel_start:panel_end]

if "const pitchTraceActive = true" not in panel:
    panel = panel.replace(
        "  const pitchTrace = edit.pitchTrace\n",
        "  const pitchTrace = edit.pitchTrace\n  const pitchTraceActive = true\n",
        1
    )

panel = panel.replace(
    "${pitchTrace.enabled ? 'has-pitch-trace-tools' : ''}",
    "${pitchTraceActive ? 'has-pitch-trace-tools has-pitch-trace-mode' : ''}"
)
panel = panel.replace(
    "${pitchTrace.enabled ? 'has-pitch-trace-tools has-pitch-trace-mode' : ''}",
    "${pitchTraceActive ? 'has-pitch-trace-tools has-pitch-trace-mode' : ''}"
)
panel = panel.replace(
    "pitchTraceEnabled: pitchTrace.enabled",
    "pitchTraceEnabled: pitchTraceActive"
)
panel = panel.replace(
    "${pitchTrace.enabled ? renderPitchTraceToolPane",
    "${pitchTraceActive ? renderPitchTraceToolPane"
)

text = text[:panel_start] + panel + text[panel_end:]
print("patched: Pitch Trace editor is primary audio Region Editor")


# ---------------------------------------------------------------------------
# 3) Canonical absolute-project Region Editor ruler.
# ---------------------------------------------------------------------------
render_timeline = '''function renderRegionEditorTimeline(region, gridWidth) {
  if (!region) return ''

  const regionStart = Number(region.startBeat) || 0
  const regionEnd = Math.max(
    regionStart + 0.25,
    Number(region.endBeat) || regionStart + 1
  )
  const regionLength = regionEnd - regionStart
  const width = Math.max(
    420,
    Number(gridWidth) || regionLength * midiRollBeatWidth
  )

  const projectBeat = xToBeat(timelineState.playheadX)
  const playheadLeft = positionToRegionEditorX(projectBeat, region)
  const ticks = renderRegionEditorTimelineTicks(region)

  return `<div class="studio-region-editor-header-container">
    <div
      class="studio-region-editor-timeline"
      data-region-editor-timeline="${esc(region.id)}"
      style="--midi-roll-grid-width:${width}px"
    >
      <div class="studio-region-editor-timeline-spacer"></div>
      <div
        class="studio-region-editor-timeline-viewport"
        data-region-editor-timeline-viewport
      >
        <div
          class="studio-region-editor-timeline-inner"
          data-region-editor-timeline-inner
          style="width:${width}px"
        >
          ${ticks}
          <i
            class="studio-region-editor-playhead"
            style="left:${playheadLeft}px"
          ></i>
        </div>
      </div>
    </div>
  </div>`
}'''

text = replace_function(
    text,
    "function renderRegionEditorTimeline(region, gridWidth) {",
    "function positionToRegionEditorX(",
    render_timeline,
    "renderRegionEditorTimeline"
)

ticks_function = '''function renderRegionEditorTimelineTicks(region = getMidiRollRegion()) {
  if (!region) return ''

  const regionStart = Number(region.startBeat) || 0
  const regionEnd = Math.max(
    regionStart + 0.25,
    Number(region.endBeat) || regionStart + 1
  )

  const beatsPerBar = Math.max(
    1,
    Number(timelineState.beatsPerBar) || 4
  )

  const division = getMidiRollGridDivision()
  const first = Math.floor(regionStart / division) * division
  const output = []

  for (
    let absoluteBeat = first;
    absoluteBeat <= regionEnd + 1e-6;
    absoluteBeat += division
  ) {
    if (absoluteBeat < regionStart - 1e-6) continue

    const localBeat = absoluteBeat - regionStart
    const left = localBeat * midiRollBeatWidth

    const wholeBeat = Math.abs(
      absoluteBeat - Math.round(absoluteBeat)
    ) < 1e-6

    if (!wholeBeat) continue

    const roundedBeat = Math.round(absoluteBeat)
    const beatInBar =
      ((roundedBeat % beatsPerBar) + beatsPerBar) % beatsPerBar

    const isBar = beatInBar === 0
    const barNumber = Math.floor(roundedBeat / beatsPerBar) + 1
    const displayBeat = beatInBar + 1

    const label = isBar
      ? String(barNumber)
      : `${barNumber}.${displayBeat}`

    output.push(
      `<span
        class="studio-region-editor-tick ${isBar ? 'studio-region-editor-tick--bar' : 'studio-region-editor-tick--beat'}"
        style="left:${left}px"
      ><b>${esc(label)}</b></span>`
    )
  }

  return output.join('')
}'''

text = replace_function(
    text,
    "function renderRegionEditorTimelineTicks(",
    "function renderMidiRollGridLines(",
    ticks_function,
    "renderRegionEditorTimelineTicks"
)


# ---------------------------------------------------------------------------
# 4) One horizontal scale for Region Editor ruler, grid, notes, playhead.
# ---------------------------------------------------------------------------
text = text.replace(
    "const gridWidth = Math.max(420, regionLengthBeats * beatWidth())",
    "const gridWidth = Math.max(420, regionLengthBeats * midiRollBeatWidth)"
)
text = text.replace(
    "const gridWidth = Math.max(420, regionLength * beatWidth())",
    "const gridWidth = Math.max(420, regionLength * midiRollBeatWidth)"
)

pitch_view_marker = 'data-pitch-trace-duration="${visibleDuration}"'
if pitch_view_marker in text and "data-pitch-trace-pixels-per-beat" not in text:
    text = text.replace(
        pitch_view_marker,
        pitch_view_marker + '\n    data-pitch-trace-pixels-per-beat="${midiRollBeatWidth}"',
        1
    )

# Ensure the Pitch Trace canvas width comes from the same canonical grid width.
text = text.replace(
    "--pitch-trace-canvas-width:${gridWidth}px;",
    "--pitch-trace-canvas-width:${gridWidth}px;--midi-roll-grid-width:${gridWidth}px;"
)

# Add an actual playhead element inside the pitch surface.
if 'data-pitch-trace-playhead' not in text:
    insertion_candidates = [
        '<div class="studio-pitch-trace-notes" data-pitch-trace-grid>',
        '<div class="studio-pitch-trace-notes">'
    ]

    for candidate in insertion_candidates:
        if candidate in text:
            text = text.replace(
                candidate,
                candidate + '''
          <span
            class="studio-pitch-trace-playhead"
            data-pitch-trace-playhead
            style="left:${positionToRegionEditorX(xToBeat(timelineState.playheadX), region)}px"
          ></span>''',
                1
            )
            print("patched: Pitch Trace playhead element")
            break


# ---------------------------------------------------------------------------
# 5) Canonical live playhead updater.
# ---------------------------------------------------------------------------
playhead_start = text.find("function updateMidiRollPlayheadDom() {")
playhead_end = text.find(
    "\nfunction syncRegionEditorTimelineScroll(",
    playhead_start
)

if playhead_start < 0 or playhead_end < 0:
    raise SystemExit("Could not locate updateMidiRollPlayheadDom().")

playhead_function = '''function updateMidiRollPlayheadDom() {
  const playheadBeat = xToBeat(timelineState.playheadX)

  const midiMarker = app.querySelector('[data-midi-roll-playhead]')
  const midiRegion = midiMarker ? getMidiRollRegion() : null

  if (midiMarker && midiRegion) {
    midiMarker.style.left =
      `${positionToRegionEditorX(playheadBeat, midiRegion)}px`
  }

  app
    .querySelectorAll('[data-pitch-trace-playhead]')
    .forEach((marker) => {
      const editor = marker.closest('[data-audio-region-editor]')
      const region = midiRegions.find(
        (item) => item.id === editor?.dataset?.audioRegionEditor
      )

      if (!region) return

      marker.style.left =
        `${positionToRegionEditorX(playheadBeat, region)}px`
    })

  app
    .querySelectorAll('[data-region-editor-timeline]')
    .forEach((timeline) => {
      const region = midiRegions.find(
        (item) => item.id === timeline.dataset.regionEditorTimeline
      )

      const marker = timeline.querySelector(
        '.studio-region-editor-playhead'
      )

      if (!region || !marker) return

      marker.style.left =
        `${positionToRegionEditorX(playheadBeat, region)}px`
    })
}'''

text = (
    text[:playhead_start]
    + playhead_function
    + text[playhead_end:]
)
print("patched: canonical Region Editor playhead updater")


# ---------------------------------------------------------------------------
# 6) Header ruler scroll follows either Pitch Trace or standard MIDI roll.
# ---------------------------------------------------------------------------
scroll_start = text.find(
    "function syncRegionEditorTimelineScroll(scrollLeft = null) {"
)
scroll_end = text.find("\nfunction ", scroll_start + 10)

if scroll_start < 0 or scroll_end < 0:
    raise SystemExit("Could not locate syncRegionEditorTimelineScroll().")

scroll_function = '''function syncRegionEditorTimelineScroll(scrollLeft = null) {
  const bodyScroll =
    app.querySelector('.studio-pitch-trace-scroll')
    || app.querySelector('.studio-midi-roll-scroll')

  const left = Number.isFinite(Number(scrollLeft))
    ? Number(scrollLeft)
    : (bodyScroll?.scrollLeft || 0)

  app
    .querySelectorAll('[data-region-editor-timeline-viewport]')
    .forEach((viewport) => {
      if (
        Math.abs(
          (viewport.scrollLeft || 0) - left
        ) > 0.5
      ) {
        viewport.scrollLeft = left
      }
    })
}'''

text = text[:scroll_start] + scroll_function + text[scroll_end:]
print("patched: Region Editor ruler horizontal scroll sync")


# ---------------------------------------------------------------------------
# 7) Canonical Pitch Trace X zoom. This changes midiRollBeatWidth itself;
#    there is no CSS-only fake scale anymore.
# ---------------------------------------------------------------------------
listener = '''
if (!globalThis.__souraPitchTraceCanonicalZoomV45) {
  globalThis.__souraPitchTraceCanonicalZoomV45 = true

  document.addEventListener(
    'soura:pitch-trace-horizontal-zoom',
    (event) => {
      const view = event.target?.closest?.('.studio-pitch-trace-view')
      const editor = view?.closest?.('[data-audio-region-editor]')
      const region = midiRegions.find(
        (item) => item.id === editor?.dataset?.audioRegionEditor
      )
      const scroll = view?.querySelector?.('[data-pitch-trace-scroll]')

      if (!view || !region || !scroll) return

      const direction = event.detail?.direction || 'fit'
      const rect = scroll.getBoundingClientRect()

      const keyWidth =
        view.querySelector('.studio-pitch-trace-keyboard')
          ?.getBoundingClientRect?.().width
        || 72

      const pointerX = Number.isFinite(Number(event.detail?.clientX))
        ? clamp(
            Number(event.detail.clientX) - rect.left - keyWidth,
            0,
            Math.max(1, rect.width - keyWidth)
          )
        : Math.max(1, rect.width - keyWidth) / 2

      const oldWidth = Math.max(1, midiRollBeatWidth)

      const beatAtPointer =
        ((scroll.scrollLeft || 0) + pointerX) / oldWidth

      if (direction === 'fit') {
        const regionLength = Math.max(
          0.25,
          (Number(region.endBeat) || 0)
          - (Number(region.startBeat) || 0)
        )

        const viewportWidth = Math.max(
          200,
          scroll.clientWidth - keyWidth
        )

        midiRollBeatWidth = Math.round(
          clamp(
            viewportWidth / regionLength,
            12,
            720
          )
        )
      } else {
        midiRollBeatWidth = Math.round(
          clamp(
            midiRollBeatWidth
            * (direction === 'in' ? 1.18 : 1 / 1.18),
            12,
            720
          )
        )
      }

      const newScrollLeft = direction === 'fit'
        ? 0
        : Math.max(
            0,
            beatAtPointer * midiRollBeatWidth - pointerX
          )

      renderEditor()

      requestAnimationFrame(() => {
        const nextEditor = app.querySelector(
          `[data-audio-region-editor="${CSS.escape(region.id)}"]`
        )

        const nextScroll = nextEditor?.querySelector(
          '[data-pitch-trace-scroll]'
        )

        if (nextScroll) {
          nextScroll.scrollLeft = Math.min(
            newScrollLeft,
            Math.max(
              0,
              nextScroll.scrollWidth - nextScroll.clientWidth
            )
          )

          syncRegionEditorTimelineScroll(nextScroll.scrollLeft)
        }

        updateMidiRollPlayheadDom()
      })
    }
  )

  document.addEventListener(
    'soura:pitch-trace-horizontal-scroll',
    (event) => {
      syncRegionEditorTimelineScroll(
        Number(event.detail?.scrollLeft) || 0
      )
    }
  )
}

'''

listener_anchor = "function syncRegionEditorTimelineScroll(scrollLeft = null) {"
if "__souraPitchTraceCanonicalZoomV45" not in text:
    idx = text.find(listener_anchor)
    text = text[:idx] + listener + text[idx:]
    print("patched: canonical Pitch Trace horizontal zoom")


# ---------------------------------------------------------------------------
# 8) Main DAW zoom: one extra post-layout anchor correction.
#
# The current code calculates the correct anchor beat, but refreshes geometry
# before applying the final scrollLeft. WebKit can display one frame with the
# ruler/grid at different scroll states. Correct once more after layout.
# ---------------------------------------------------------------------------
zoom_tail = (
    "grid.scrollLeft = clamp(newTimelineX - mouseX, 0, "
    "Math.max(0, timelineContentWidth() - grid.clientWidth)); "
    "syncTimelineScroll(grid); scheduleEditorSave(); return"
)

if zoom_tail in text:
    corrected = (
        "grid.scrollLeft = clamp(newTimelineX - mouseX, 0, "
        "Math.max(0, timelineContentWidth() - grid.clientWidth)); "
        "syncTimelineScroll(grid); "
        "requestAnimationFrame(() => { "
        "const correctedX = beatsFromBarZeroToX(anchorBeat); "
        "grid.scrollLeft = clamp(correctedX - mouseX, 0, "
        "Math.max(0, timelineContentWidth() - grid.clientWidth)); "
        "syncTimelineScroll(grid); "
        "updateMidiRollPlayheadDom(); "
        "}); "
        "scheduleEditorSave(); return"
    )
    text = text.replace(zoom_tail, corrected, 1)
    print("patched: main DAW pointer-anchor correction")
else:
    print("note: local main-DAW zoom branch differs; skipped unsafe textual replacement")


TARGET.write_text(text, encoding="utf-8")
print("wrote:", TARGET)
print()
print("Next:")
print("  npm run build")
print("  npx tauri dev")
