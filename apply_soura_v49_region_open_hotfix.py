#!/usr/bin/env python3
from pathlib import Path
import shutil

TARGET = Path("src/studioProject.js")

if not TARGET.exists():
    raise SystemExit("src/studioProject.js not found. Run this from the MELOGIC_RECORDS repository root.")

text = TARGET.read_text(encoding="utf-8")
original = text

backup = TARGET.with_suffix(".js.v49-open-hotfix.bak")
if not backup.exists():
    shutil.copy2(TARGET, backup)
    print("backup:", backup)

start = text.find("function renderPitchTraceView(region, track) {")
end = text.find("\nfunction ", start + 10)

if start < 0 or end < 0:
    raise SystemExit("Could not locate renderPitchTraceView(region, track); no write performed.")

fn = text[start:end]

if "const gridWidth =" not in fn:
    anchor = "  const visibleDuration = Math.max(minAudioRegionSeconds, getAudioRegionVisibleDurationSeconds(region))"

    if anchor not in fn:
        raise SystemExit("Could not safely find visibleDuration inside renderPitchTraceView(); no write performed.")

    insertion_lines = [
        anchor,
        "  const regionStartBeat = Number(region.startBeat) || 0",
        "  const regionEndBeat = Math.max(",
        "    regionStartBeat + 0.25,",
        "    Number(region.endBeat) || regionStartBeat + 1",
        "  )",
        "  const regionLengthBeats = Math.max(",
        "    0.25,",
        "    regionEndBeat - regionStartBeat",
        "  )",
        "  const gridWidth = Math.max(",
        "    1,",
        "    regionLengthBeats * audioRegionEditorBeatWidth",
        "  )",
    ]
    fn = fn.replace(anchor, "\n".join(insertion_lines), 1)
    print("patched: defined canonical Pitch Trace gridWidth")
else:
    print("already present: gridWidth definition")

if "data-region-editor-grid-width=" not in fn:
    fn = fn.replace(
        "data-pitch-trace-view",
        'data-pitch-trace-view data-region-editor-grid-width="${gridWidth}"',
        1
    )
    print("patched: exposed Region Editor grid width")

text = text[:start] + fn + text[end:]

if text == original:
    print("No changes were required.")
else:
    TARGET.write_text(text, encoding="utf-8")
    print("wrote:", TARGET)

print("\nNow run:")
print("  npm run build")
print("  npx tauri dev")
