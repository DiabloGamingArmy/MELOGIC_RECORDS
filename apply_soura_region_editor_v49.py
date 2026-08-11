#!/usr/bin/env python3
from pathlib import Path
import shutil

TARGET = Path("src/studioProject.js")
if not TARGET.exists():
    raise SystemExit("src/studioProject.js not found. Run from the MELOGIC_RECORDS repository root.")

text = TARGET.read_text(encoding="utf-8")
original = text

backup = TARGET.with_suffix(".js.region-scale-v49.bak")
if not backup.exists():
    shutil.copy2(TARGET, backup)
    print("backup:", backup)

if "let audioRegionEditorBeatWidth =" not in text:
    anchor = "let midiRollBeatWidth = 64"
    if anchor not in text:
        raise SystemExit("Could not find midiRollBeatWidth anchor; no write performed.")
    text = text.replace(anchor, anchor + "\nlet audioRegionEditorBeatWidth = 64", 1)
    print("added: audioRegionEditorBeatWidth")

start = text.find("function positionToRegionEditorX(")
second_start = text.find("function regionEditorXToPosition(", start)
second_end = text.find("\nfunction ", second_start + 10)
if start < 0 or second_start < 0 or second_end < 0:
    raise SystemExit("Could not locate Region Editor coordinate functions; no write performed.")

coordinate_pair = """function positionToRegionEditorX(
  beat = 0,
  region = getMidiRollRegion()
) {
  return (
    Number(beat || 0)
    - (Number(region?.startBeat) || 0)
  ) * audioRegionEditorBeatWidth
}

function regionEditorXToPosition(
  x = 0,
  region = getMidiRollRegion()
) {
  return (
    (Number(region?.startBeat) || 0)
    + (
      Number(x || 0)
      / Math.max(1, audioRegionEditorBeatWidth)
    )
  )
}"""

text = text[:start] + coordinate_pair + text[second_end:]
print("patched: Region Editor coordinate functions")

timeline_start = text.find("function renderRegionEditorTimeline(")
timeline_end = text.find("\nfunction positionToRegionEditorX(", timeline_start)
if timeline_start < 0 or timeline_end < 0:
    raise SystemExit("Could not locate renderRegionEditorTimeline(); no write performed.")

timeline_fn = """function renderRegionEditorTimeline(region, gridWidth) {
  if (!region) return ''

  const regionStart = Number(region.startBeat) || 0
  const regionEnd = Math.max(
    regionStart + 0.25,
    Number(region.endBeat) || regionStart + 1
  )
  const regionLength = regionEnd - regionStart
  const width = Math.max(
    1,
    Number(gridWidth) || regionLength * audioRegionEditorBeatWidth
  )

  const projectBeat = xToBeat(timelineState.playheadX)
  const playheadLeft = positionToRegionEditorX(projectBeat, region)
  const ticks = renderRegionEditorTimelineTicks(region)

  return `<div class="studio-region-editor-header-container">
    <div class="studio-region-editor-timeline" data-region-editor-timeline="${esc(region.id)}">
      <div class="studio-region-editor-timeline-spacer"></div>
      <div class="studio-region-editor-timeline-viewport" data-region-editor-timeline-viewport>
        <div
          class="studio-region-editor-timeline-inner"
          data-region-editor-timeline-inner
          style="width:${width}px;min-width:${width}px"
        >
          ${ticks}
          <i class="studio-region-editor-playhead" style="left:${playheadLeft}px"></i>
        </div>
      </div>
    </div>
  </div>`
}"""

text = text[:timeline_start] + timeline_fn + text[timeline_end:]
print("patched: Region Editor ruler width")

ticks_start = text.find("function renderRegionEditorTimelineTicks(")
ticks_end = text.find("\nfunction renderMidiRollGridLines(", ticks_start)
if ticks_start < 0 or ticks_end < 0:
    raise SystemExit("Could not locate renderRegionEditorTimelineTicks(); no write performed.")

ticks_fn = """function renderRegionEditorTimelineTicks(
  region = getMidiRollRegion()
) {
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
    const left = (
      absoluteBeat - regionStart
    ) * audioRegionEditorBeatWidth

    const modulo = (
      ((absoluteBeat % beatsPerBar) + beatsPerBar)
      % beatsPerBar
    )

    const isBar = Math.abs(modulo) < 1e-7
    const barLabel = isBar
      ? String(Math.round(absoluteBeat / beatsPerBar))
      : ''

    output.push(
      `<span
        class="studio-region-editor-tick ${isBar ? 'studio-region-editor-tick--bar' : 'studio-region-editor-tick--beat'}"
        data-region-editor-absolute-beat="${absoluteBeat}"
        style="left:${left}px"
      >${barLabel ? `<b>${esc(barLabel)}</b>` : ''}</span>`
    )
  }

  return output.join('')
}"""

text = text[:ticks_start] + ticks_fn + text[ticks_end:]
print("patched: Region Editor ruler ticks")

helper = """function renderPitchTraceRegionGridLines(region) {
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
    const left = (
      absoluteBeat - regionStart
    ) * audioRegionEditorBeatWidth

    const modulo = (
      ((absoluteBeat % beatsPerBar) + beatsPerBar)
      % beatsPerBar
    )
    const isBar = Math.abs(modulo) < 1e-7

    output.push(
      `<i
        class="${isBar ? 'is-bar' : 'is-beat'}"
        data-region-editor-absolute-beat="${absoluteBeat}"
        style="left:${left}px"
      ></i>`
    )
  }

  return output.join('')
}

"""

if "function renderPitchTraceRegionGridLines(" not in text:
    insertion = text.find("function renderPitchTraceView(")
    if insertion < 0:
        raise SystemExit("Could not locate renderPitchTraceView(); no write performed.")
    text = text[:insertion] + helper + text[insertion:]
    print("added: Pitch Trace region-grid helper")

pitch_start = text.find("function renderPitchTraceView(")
pitch_end = text.find("\nfunction ", pitch_start + 10)
if pitch_start < 0 or pitch_end < 0:
    raise SystemExit("Could not locate renderPitchTraceView(); no write performed.")

pitch_fn = text[pitch_start:pitch_end]
pitch_fn = pitch_fn.replace("regionLengthBeats * midiRollBeatWidth", "regionLengthBeats * audioRegionEditorBeatWidth")
pitch_fn = pitch_fn.replace("regionLength * midiRollBeatWidth", "regionLength * audioRegionEditorBeatWidth")
pitch_fn = pitch_fn.replace("regionLengthBeats * beatWidth()", "regionLengthBeats * audioRegionEditorBeatWidth")
pitch_fn = pitch_fn.replace("regionLength * beatWidth()", "regionLength * audioRegionEditorBeatWidth")

exact_old = "const beatLines = Array.from({ length: beatCount + 1 }, (_, index)=>`<i style=\\\"left:${((index / beatCount) * 100).toFixed(3)}%\\\"></i>`).join('')"
if exact_old in pitch_fn:
    pitch_fn = pitch_fn.replace(exact_old, "const beatLines = renderPitchTraceRegionGridLines(region)", 1)

if "data-region-editor-grid-width=" not in pitch_fn:
    pitch_fn = pitch_fn.replace(
        "data-pitch-trace-view",
        "data-pitch-trace-view data-region-editor-grid-width=\\\"${gridWidth}\\\" data-region-editor-start-beat=\\\"${Number(region.startBeat) || 0}\\\" data-region-editor-end-beat=\\\"${Number(region.endBeat) || 0}\\\"",
        1
    )

pitch_fn = pitch_fn.replace(
    "--pitch-trace-canvas-width:${gridWidth}px;",
    "--pitch-trace-canvas-width:${gridWidth}px;--audio-region-editor-grid-width:${gridWidth}px;"
)

text = text[:pitch_start] + pitch_fn + text[pitch_end:]
print("patched: Pitch Trace uses Region Editor scale")

listener_start = text.find("if (!globalThis.__souraPitchTraceCanonicalZoomV45)")
if listener_start >= 0:
    listener_end = text.find("\nfunction syncRegionEditorTimelineScroll(", listener_start)
    if listener_end > listener_start:
        listener = text[listener_start:listener_end]
        listener = listener.replace("midiRollBeatWidth", "audioRegionEditorBeatWidth")
        text = text[:listener_start] + listener + text[listener_end:]
        print("patched: H zoom uses Region Editor scale")
else:
    print("warning: H zoom listener not found; local implementation differs")

text = text.replace(
    "const playheadBeat = getTransportClockProjectBeat()",
    "const playheadBeat = xToBeat(timelineState.playheadX)"
)

move_pattern = """region.startBeat = nextStart
    region.endBeat = nextStart + originalLength
    const nextTrack = tracks[getTrackIndexFromClientY(event.clientY)]"""

move_replacement = """region.startBeat = nextStart
    region.endBeat = nextStart + originalLength
    region.timelineStartBeats = nextStart
    region.timelineStartSeconds = getTimelineSecondsAtBeat(nextStart)
    const nextTrack = tracks[getTrackIndexFromClientY(event.clientY)]"""

if move_pattern in text:
    text = text.replace(move_pattern, move_replacement, 1)
    print("patched: audio move timeline metadata")

panel_start = text.find("function renderAudioRegionEditorPanel(")
panel_end = text.find("\nfunction renderRegionEditorTimeline(", panel_start)
if panel_start >= 0 and panel_end > panel_start:
    panel = text[panel_start:panel_end]
    if "renderRegionEditorToolStrip({ label: 'Audio region editor tools' })" not in panel:
        aside_marker = '<aside class="studio-midi-roll-tools studio-audio-region-tools"'
        if aside_marker in panel:
            panel = panel.replace(
                aside_marker,
                "${renderRegionEditorToolStrip({ label: 'Audio region editor tools' })}\\n      " + aside_marker,
                1
            )
            print("restored: Region Editor toolbar")
    text = text[:panel_start] + panel + text[panel_end:]

if text == original:
    print("No studioProject.js changes were necessary.")
else:
    TARGET.write_text(text, encoding="utf-8")
    print("wrote:", TARGET)

print()
print("Next:")
print("  npm run build")
print("  npx tauri dev")
