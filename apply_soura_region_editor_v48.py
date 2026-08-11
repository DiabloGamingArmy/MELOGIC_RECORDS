#!/usr/bin/env python3
from pathlib import Path
import re
import shutil

TARGET = Path("src/studioProject.js")

if not TARGET.exists():
    raise SystemExit(
        "src/studioProject.js not found. Run from the MELOGIC_RECORDS repository root."
    )

text = TARGET.read_text(encoding="utf-8")
original = text

backup = TARGET.with_suffix(".js.region-geometry-v48.bak")
if not backup.exists():
    shutil.copy2(TARGET, backup)
    print("backup:", backup)

text = text.replace(
    "positionToRegionEditorX(getTransportClockProjectBeat(), region)",
    "positionToRegionEditorX(xToBeat(timelineState.playheadX), region)"
)

text = text.replace(
    "const playheadBeat = getTransportClockProjectBeat()",
    "const playheadBeat = xToBeat(timelineState.playheadX)"
)

print("patched: Region Editor playhead follows main DAW visual beat")

text = text.replace(
    "const gridWidth = Math.max(420, regionLengthBeats * beatWidth())",
    "const gridWidth = Math.max(420, regionLengthBeats * midiRollBeatWidth)"
)

text = text.replace(
    "const gridWidth = Math.max(420, regionLength * beatWidth())",
    "const gridWidth = Math.max(420, regionLength * midiRollBeatWidth)"
)

if "--pitch-trace-canvas-width:${gridWidth}px;" in text:
    text = text.replace(
        "--pitch-trace-canvas-width:${gridWidth}px;",
        "--pitch-trace-canvas-width:${gridWidth}px;--midi-roll-grid-width:${gridWidth}px;",
        1
    )

text = text.replace(
    "--midi-roll-grid-width:${gridWidth}px;--midi-roll-grid-width:${gridWidth}px;",
    "--midi-roll-grid-width:${gridWidth}px;"
)

print("patched: Pitch Trace canvas and ruler share gridWidth")

ticks_start = text.find("function renderRegionEditorTimelineTicks(")
ticks_end = text.find("\nfunction renderMidiRollGridLines(", ticks_start)

if ticks_start < 0 or ticks_end < 0:
    raise SystemExit(
        "Could not locate renderRegionEditorTimelineTicks(); no write performed."
    )

ticks_fn = '''function renderRegionEditorTimelineTicks(region = getMidiRollRegion()) {
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

  const firstWholeBeat = Math.ceil(regionStart - 1e-7)
  const lastWholeBeat = Math.floor(regionEnd + 1e-7)
  const output = []

  for (
    let absoluteBeat = firstWholeBeat;
    absoluteBeat <= lastWholeBeat;
    absoluteBeat += 1
  ) {
    const left =
      (absoluteBeat - regionStart)
      * midiRollBeatWidth

    const modulo =
      ((absoluteBeat % beatsPerBar) + beatsPerBar)
      % beatsPerBar

    const isBar = Math.abs(modulo) < 1e-7

    const barLabel =
      isBar
        ? String(Math.round(absoluteBeat / beatsPerBar))
        : ''

    output.push(
      `<span
        class="studio-region-editor-tick ${isBar ? 'studio-region-editor-tick--bar' : 'studio-region-editor-tick--beat'}"
        style="left:${left}px"
      >${barLabel ? `<b>${esc(barLabel)}</b>` : ''}</span>`
    )
  }

  return output.join('')
}'''

text = text[:ticks_start] + ticks_fn + text[ticks_end:]
print("patched: ruler tick geometry")

grid_start = text.find("function renderPitchTraceGridLines(")

if grid_start >= 0:
    grid_end = text.find("\nfunction ", grid_start + 10)

    if grid_end > grid_start:
        grid_fn = '''function renderPitchTraceGridLines(regionOrLength = getMidiRollRegion()) {
  const region =
    regionOrLength && typeof regionOrLength === 'object'
      ? regionOrLength
      : getMidiRollRegion()

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

  const firstWholeBeat = Math.ceil(regionStart - 1e-7)
  const lastWholeBeat = Math.floor(regionEnd + 1e-7)
  const output = []

  for (
    let absoluteBeat = firstWholeBeat;
    absoluteBeat <= lastWholeBeat;
    absoluteBeat += 1
  ) {
    const left =
      (absoluteBeat - regionStart)
      * midiRollBeatWidth

    const modulo =
      ((absoluteBeat % beatsPerBar) + beatsPerBar)
      % beatsPerBar

    const isBar = Math.abs(modulo) < 1e-7

    output.push(
      `<i
        class="${isBar ? 'is-bar' : 'is-beat'}"
        style="left:${left}px"
      ></i>`
    )
  }

  return output.join('')
}'''

        text = text[:grid_start] + grid_fn + text[grid_end:]
        print("patched: Pitch Trace grid uses ruler geometry")
else:
    print("note: renderPitchTraceGridLines() not found; canvas-width fix still applies")

move_pattern = '''region.startBeat = nextStart
    region.endBeat = nextStart + originalLength
    const nextTrack = tracks[getTrackIndexFromClientY(event.clientY)]'''

move_replacement = '''region.startBeat = nextStart
    region.endBeat = nextStart + originalLength
    region.timelineStartBeats = nextStart
    region.timelineStartSeconds = getTimelineSecondsAtBeat(nextStart)
    const nextTrack = tracks[getTrackIndexFromClientY(event.clientY)]'''

if move_pattern in text:
    text = text.replace(move_pattern, move_replacement, 1)
    print("patched: live audio move metadata")

finish_old = '''const finishedRegion = midiRegions.find((region)=>region.id === midiRegionDrag.id)
  if (didMove && finishedRegion) applyRegionPlacementWithOverlapResolution([finishedRegion])
  midiRegionDrag = null'''

finish_new = '''const finishedRegion = midiRegions.find((region)=>region.id === midiRegionDrag.id)
  if (didMove && finishedRegion) {
    applyRegionPlacementWithOverlapResolution([finishedRegion])
    if (finishedRegion.type === 'audio') syncAudioRegionTimeline(finishedRegion)
  }
  midiRegionDrag = null'''

if finish_old in text:
    text = text.replace(finish_old, finish_new, 1)
    print("patched: post-drag audio timeline synchronization")

text = text.replace(
    "HORIZONTAL SCALE FOLLOWS DAW · OPTION-SCROLL CHANGES PITCH HEIGHT",
    "INDEPENDENT HORIZONTAL SCALE · OPTION-SCROLL CHANGES PITCH HEIGHT"
)

text = text.replace(
    "Horizontal scale follows DAW · Option-scroll changes pitch height",
    "Independent horizontal scale · Option-scroll changes pitch height"
)

if text == original:
    print("No studioProject.js changes were necessary.")
else:
    TARGET.write_text(text, encoding="utf-8")
    print("wrote:", TARGET)

print()
print("Next:")
print("  npm run build")
print("  npx tauri dev")
