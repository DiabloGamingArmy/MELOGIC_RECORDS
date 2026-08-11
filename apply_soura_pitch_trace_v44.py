#!/usr/bin/env python3
from pathlib import Path
import shutil
import re

ROOT = Path.cwd()
TARGET = ROOT / "src/studioProject.js"

if not TARGET.exists():
    raise SystemExit(
        "src/studioProject.js was not found. Run this from the MELOGIC_RECORDS repository root."
    )

text = TARGET.read_text(encoding="utf-8")
original = text

backup = TARGET.with_suffix(".js.pitch-trace-v44.bak")
if not backup.exists():
    shutil.copy2(TARGET, backup)
    print("backup:", backup)

# -------------------------------------------------------------------------
# 1. HELLA-DETAILED WAVEFORM
#
# Pitch Trace used 1600 peaks in the previous pass. Raise it substantially.
# 12k points is detailed enough for large desktop editors without creating
# absurd million-node SVGs.
# -------------------------------------------------------------------------
replacements = [
    ("maxPeaks: 1600", "maxPeaks: 12000"),
    ("maxPeaks: 1400", "maxPeaks: 12000"),
]

for old, new in replacements:
    if old in text:
        text = text.replace(old, new)
        print(f"waveform detail: {old} -> {new}")

# Increase common persisted/import waveform caps when their exact constants
# exist. Clamp at 16384 to keep serialized project metadata sane.
constant_patterns = [
    r"(const\s+WAVEFORM_PERSISTED_MAX_PEAKS\s*=\s*)\d+",
    r"(const\s+WAVEFORM_PREVIEW_MAX_PEAKS\s*=\s*)\d+",
    r"(const\s+AUDIO_WAVEFORM_MAX_PEAKS\s*=\s*)\d+",
]

for pattern in constant_patterns:
    text, count = re.subn(pattern, r"\g<1>16384", text, count=1)
    if count:
        print("waveform cache cap increased:", pattern)

# -------------------------------------------------------------------------
# 2. PITCH TRACE MUST WIN OVER GENERIC WAVEFORM WHEN IT HAS DATA
#
# A rendered Pitch Trace surface should be selected whenever the normalized
# trace is enabled OR already contains analyzed notes. This prevents the
# regression where a valid analysis falls back to the generic Waveform editor.
# -------------------------------------------------------------------------
# Insert a durable boolean near common pitchTrace declarations.
anchor = "const pitchTrace = edit.pitchTrace"
if anchor in text and "pitchTraceHasEditorData" not in text:
    text = text.replace(
        anchor,
        anchor + "\n  const pitchTraceHasEditorData = Boolean(pitchTrace?.enabled || pitchTrace?.notes?.length)",
        1
    )
    print("added pitchTraceHasEditorData")

# Replace the most common exact render guards without touching unrelated
# enabled checks deeper in DSP/render logic.
render_guard_replacements = [
    ("pitchTrace.enabled ? renderPitchTraceView(region, track)", "pitchTraceHasEditorData ? renderPitchTraceView(region, track)"),
    ("pitchTrace.enabled\n        ? renderPitchTraceView(region, track)", "pitchTraceHasEditorData\n        ? renderPitchTraceView(region, track)"),
]

for old, new in render_guard_replacements:
    if old in text:
        text = text.replace(old, new, 1)
        print("hardened Pitch Trace editor selection")

# If the exact ternary was not present, report instead of guessing.
if "pitchTraceHasEditorData" in text and "renderPitchTraceView(region, track)" not in text:
    print("warning: renderPitchTraceView call not found; CSS/viewport recovery still applies.")

if text == original:
    print("No studioProject.js changes were necessary.")
else:
    TARGET.write_text(text, encoding="utf-8")
    print("wrote:", TARGET)

print("Next:")
print("  npm run build")
print("  npx tauri dev")
