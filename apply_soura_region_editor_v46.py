#!/usr/bin/env python3
from pathlib import Path
import shutil

TARGET = Path("src/studioProject.js")

if not TARGET.exists():
    raise SystemExit(
        "src/studioProject.js not found. Run this from the MELOGIC_RECORDS repository root."
    )

text = TARGET.read_text(encoding="utf-8")
original = text

backup = TARGET.with_suffix(".js.timeline-v46.bak")
if not backup.exists():
    shutil.copy2(TARGET, backup)
    print("backup:", backup)


def replace_function(source, start_signature, next_signature, replacement, label):
    start = source.find(start_signature)
    end = source.find(next_signature, start + len(start_signature))

    if start < 0 or end < 0:
        raise SystemExit(
            f"Could not safely locate {label}; no write was performed."
        )

    print("patched:", label)
    return source[:start] + replacement.rstrip() + "\n" + source[end:]


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

    const modulo =
      ((absoluteBeat % beatsPerBar) + beatsPerBar) % beatsPerBar

    const isBar = Math.abs(modulo) < 1e-7

    const barLabel = isBar
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

text = replace_function(
    text,
    "function renderRegionEditorTimelineTicks(",
    "function renderMidiRollGridLines(",
    ticks_function,
    "Region Editor ruler labels"
)

old_finish = (
    "const finishedRegion = midiRegions.find((region)=>region.id === midiRegionDrag.id)\n"
    "  if (didMove && finishedRegion) applyRegionPlacementWithOverlapResolution([finishedRegion])\n"
    "  midiRegionDrag = null"
)

new_finish = (
    "const finishedRegion = midiRegions.find((region)=>region.id === midiRegionDrag.id)\n"
    "  if (didMove && finishedRegion) {\n"
    "    applyRegionPlacementWithOverlapResolution([finishedRegion])\n"
    "    if (finishedRegion.type === 'audio') syncAudioRegionTimeline(finishedRegion)\n"
    "  }\n"
    "  midiRegionDrag = null"
)

if old_finish in text:
    text = text.replace(old_finish, new_finish, 1)
    print("patched: audio move placement synchronization")
elif "if (finishedRegion.type === 'audio') syncAudioRegionTimeline(finishedRegion)" in text:
    print("already patched: audio move placement synchronization")
else:
    print(
        "warning: finishMidiRegionDrag differs locally; "
        "move completion sync was not text-patched."
    )

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
    print("patched: live audio move timeline fields")

text = text.replace(
    "HORIZONTAL SCALE FOLLOWS DAW · OPTION-SCROLL CHANGES PITCH HEIGHT",
    "INDEPENDENT HORIZONTAL SCALE · OPTION-SCROLL CHANGES PITCH HEIGHT"
)
text = text.replace(
    "Horizontal scale follows DAW · Option-scroll changes pitch height",
    "Independent horizontal scale · Option-scroll changes pitch height"
)

text = text.replace(
    "const barNumber = Math.floor(roundedBeat / beatsPerBar) + 1",
    "const barNumber = Math.floor(roundedBeat / beatsPerBar)"
)

if text == original:
    print("No source changes were required.")
else:
    TARGET.write_text(text, encoding="utf-8")
    print("wrote:", TARGET)

print()
print("Next:")
print("  npm run build")
print("  npx tauri dev")
