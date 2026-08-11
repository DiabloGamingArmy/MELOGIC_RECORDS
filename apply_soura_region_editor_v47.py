#!/usr/bin/env python3
from pathlib import Path
import re
import shutil

TARGET = Path("src/studioProject.js")
if not TARGET.exists():
    raise SystemExit("src/studioProject.js not found. Run this from the MELOGIC_RECORDS repository root.")

text = TARGET.read_text(encoding="utf-8")
original = text

backup = TARGET.with_suffix(".js.region-layout-v47.bak")
if not backup.exists():
    shutil.copy2(TARGET, backup)
    print("backup:", backup)

patterns = [
    (
        r"(\$\{pitchTraceActive\s*\?\s*renderPitchTraceToolPane\(region,\s*missing\)\s*:\s*''\}\s*)\n(\$\{renderRegionEditorToolStrip\(\{\s*label:\s*'Audio region editor tools'\s*\}\)\})",
        r"\2\n      \1"
    ),
    (
        r"(\$\{pitchTrace\.enabled\s*\?\s*renderPitchTraceToolPane\(region,\s*missing\)\s*:\s*''\}\s*)\n(\$\{renderRegionEditorToolStrip\(\{\s*label:\s*'Audio region editor tools'\s*\}\)\})",
        r"\2\n      \1"
    )
]

reordered = False
for pattern, replacement in patterns:
    next_text, count = re.subn(pattern, replacement, text, count=1)
    if count:
        text = next_text
        reordered = True
        print("patched: Region Editor DOM column order")
        break

if not reordered:
    tool_pos = text.find("${renderRegionEditorToolStrip({ label: 'Audio region editor tools' })}")
    pitch_pos = text.find("renderPitchTraceToolPane(region, missing)")
    if tool_pos >= 0 and pitch_pos >= 0 and tool_pos < pitch_pos:
        print("already correct: Region Editor DOM column order")
    else:
        print("warning: could not safely reorder Region Editor tool columns")

text = text.replace(
    "positionToRegionEditorX(xToBeat(timelineState.playheadX), region)",
    "positionToRegionEditorX(getTransportClockProjectBeat(), region)"
)
text = text.replace(
    "const playheadBeat = xToBeat(timelineState.playheadX)",
    "const playheadBeat = getTransportClockProjectBeat()"
)
print("patched: Region Editor playhead uses canonical project beat")

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
    print("patched: live audio-region placement metadata")

finish_old = """const finishedRegion = midiRegions.find((region)=>region.id === midiRegionDrag.id)
  if (didMove && finishedRegion) applyRegionPlacementWithOverlapResolution([finishedRegion])
  midiRegionDrag = null"""

finish_new = """const finishedRegion = midiRegions.find((region)=>region.id === midiRegionDrag.id)
  if (didMove && finishedRegion) {
    applyRegionPlacementWithOverlapResolution([finishedRegion])
    if (finishedRegion.type === 'audio') syncAudioRegionTimeline(finishedRegion)
  }
  midiRegionDrag = null"""

if finish_old in text:
    text = text.replace(finish_old, finish_new, 1)
    print("patched: post-drag audio placement synchronization")

start = text.find("function renderRegionEditorTimelineTicks(")
end = text.find("\nfunction renderMidiRollGridLines(", start)
if start < 0 or end < 0:
    raise SystemExit("Could not locate renderRegionEditorTimelineTicks(); no file was written.")

ticks = '''function renderRegionEditorTimelineTicks(region = getMidiRollRegion()) {
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
    const localBeat = absoluteBeat - regionStart
    const left = localBeat * midiRollBeatWidth
    const modulo = ((absoluteBeat % beatsPerBar) + beatsPerBar) % beatsPerBar
    const isBar = Math.abs(modulo) < 1e-7
    const barLabel = isBar ? String(Math.round(absoluteBeat / beatsPerBar)) : ''

    output.push(
      `<span
        class="studio-region-editor-tick ${isBar ? 'studio-region-editor-tick--bar' : 'studio-region-editor-tick--beat'}"
        style="left:${left}px"
      >${barLabel ? `<b>${esc(barLabel)}</b>` : ''}</span>`
    )
  }

  return output.join('')
}'''

text = text[:start] + ticks + text[end:]
print("patched: bar-only absolute Region Editor ruler")

text = text.replace(
    "${pitchTrace.enabled ? 'has-pitch-trace-tools' : ''}",
    "${pitchTraceActive ? 'has-pitch-trace-tools has-pitch-trace-mode' : ''}"
)
text = text.replace(
    "pitchTraceEnabled: pitchTrace.enabled",
    "pitchTraceEnabled: pitchTraceActive"
)

if "const pitchTraceActive = true" not in text:
    marker = "  const pitchTrace = edit.pitchTrace\n"
    if marker in text:
        text = text.replace(marker, marker + "  const pitchTraceActive = true\n", 1)
        print("patched: Pitch Trace editor remains active")

if text == original:
    print("No source changes were necessary.")
else:
    TARGET.write_text(text, encoding="utf-8")
    print("wrote:", TARGET)

print()
print("Next:")
print("  npm run build")
print("  npx tauri dev")
