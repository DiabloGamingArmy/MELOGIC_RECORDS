#!/usr/bin/env python3
"""
Soura derived-render nonblocking hotfix.

Run from the MELOGIC_RECORDS repo root:

    python3 apply_soura_nonblocking_render_hotfix.py

Purpose
-------
Derived audio renders (pitch/stretch/trace/reverse) are runtime caches.
Playback must NOT wait for Firebase Storage upload.

This patch changes blocking:

    renderedStoragePath = await uploadSouraAudioBlob(...)

into fire-and-forget persistence while immediately installing the
rendered AudioBuffer/ObjectURL into Soura's runtime cache.

The source audio + edit parameters remain the authoritative project data.
"""

from pathlib import Path
import shutil
import re

ROOT = Path.cwd()
TARGET = ROOT / "src/studioProject.js"

def fail(msg):
    raise SystemExit(f"\nERROR: {msg}\n")

def backup(path):
    backup_path = path.with_suffix(path.suffix + ".nonblocking-render.bak")
    if not backup_path.exists():
        shutil.copy2(path, backup_path)
        print(f"backup: {backup_path}")

def patch_blocking_uploads(text):
    patterns = [
        (
            "pitch shift",
            re.compile(
                r"""    let renderedStoragePath = null
    try \{
      renderedStoragePath = await uploadSouraAudioBlob\(result\.renderedBlob, \{
        clipId: region\.id,
        suffix: `pitch-shift-\$\{Math\.round\(\(result\.totalSemitones \?\? pitchShift\.totalSemitones\) \* 100\)\}`
      \}\)
    \} catch \(uploadErr\) \{
      console\.warn\('\[studioProject\] rendered pitch shift upload failed; using session render only', uploadErr\)
    \}"""
            ),
            """    // Derived audio is a non-destructive runtime cache.
    // Playback must never wait for cloud persistence.
    let renderedStoragePath = null

    uploadSouraAudioBlob(result.renderedBlob, {
      clipId: region.id,
      suffix: `pitch-shift-${Math.round((result.totalSemitones ?? pitchShift.totalSemitones) * 100)}`
    })
      .then((path) => {
        if (!path) return

        console.info('[studioProject] derived pitch render persisted in background', {
          clipId: region.id,
          path
        })
      })
      .catch((uploadErr) => {
        console.warn(
          '[studioProject] background pitch render upload failed; session render remains valid',
          uploadErr
        )
      })"""
        ),
        (
            "pitch trace",
            re.compile(
                r"""    let renderedStoragePath = null
    try \{
      renderedStoragePath = await uploadSouraAudioBlob\(result\.renderedBlob, \{
        clipId: region\.id,
        suffix: `pitch-trace-\$\{result\.createdAt\}`
      \}\)
    \} catch \(uploadErr\) \{
      console\.warn\('\[studioProject\] rendered pitch trace upload failed; using session render only', uploadErr\)
    \}"""
            ),
            """    let renderedStoragePath = null

    uploadSouraAudioBlob(result.renderedBlob, {
      clipId: region.id,
      suffix: `pitch-trace-${result.createdAt}`
    })
      .then((path) => {
        if (!path) return
        console.info('[studioProject] derived pitch-trace render persisted in background', {
          clipId: region.id,
          path
        })
      })
      .catch((uploadErr) => {
        console.warn(
          '[studioProject] background pitch-trace upload failed; session render remains valid',
          uploadErr
        )
      })"""
        ),
        (
            "reverse",
            re.compile(
                r"""    let renderedStoragePath = null
    try \{
      renderedStoragePath = await uploadSouraAudioBlob\(result\.renderedBlob, \{
        clipId: region\.id,
        suffix: `reverse-\$\{result\.createdAt\}`
      \}\)
    \} catch \(uploadErr\) \{
      console\.warn\('\[studioProject\] rendered reverse upload failed; using session render only', uploadErr\)
    \}"""
            ),
            """    let renderedStoragePath = null

    uploadSouraAudioBlob(result.renderedBlob, {
      clipId: region.id,
      suffix: `reverse-${result.createdAt}`
    })
      .then((path) => {
        if (!path) return
        console.info('[studioProject] derived reverse render persisted in background', {
          clipId: region.id,
          path
        })
      })
      .catch((uploadErr) => {
        console.warn(
          '[studioProject] background reverse upload failed; session render remains valid',
          uploadErr
        )
      })"""
        )
    ]

    changed = 0

    for label, pattern, replacement in patterns:
        next_text, count = pattern.subn(replacement, text, count=1)

        if count == 1:
            text = next_text
            changed += 1
            print(f"patched: nonblocking {label} persistence")
        elif f"background {label.replace(' ', '-')}" in text or "Playback must never wait for cloud persistence" in text:
            print(f"already patched or equivalent: {label}")
        else:
            print(f"warning: exact {label} block not found; skipped")

    # Stretch/combined render uses a slightly different renderedSessionOnly
    # path. Convert its blocking upload generically if the exact block exists.
    stretch_pattern = re.compile(
        r"""    let renderedStoragePath = null
    let renderedSessionOnly = true
    try \{
      renderedStoragePath = await uploadSouraAudioBlob\(result\.renderedBlob, \{
        clipId: region\.id,
        suffix: `\$\{pitchActive \? 'pitch-time' : 'stretch'\}-\$\{Math\.round\(stretchMath\.lengthRatio \* 1000\)\}`
      \}\)
      renderedSessionOnly = !renderedStoragePath
    \} catch \(uploadErr\) \{
(?P<warn>.*?)    \}""",
        re.DOTALL
    )

    stretch_replacement = """    let renderedStoragePath = null
    let renderedSessionOnly = true

    uploadSouraAudioBlob(result.renderedBlob, {
      clipId: region.id,
      suffix: `${pitchActive ? 'pitch-time' : 'stretch'}-${Math.round(stretchMath.lengthRatio * 1000)}`
    })
      .then((path) => {
        if (!path) return

        console.info('[studioProject] derived stretch render persisted in background', {
          clipId: region.id,
          path
        })
      })
      .catch((uploadErr) => {
        console.warn(
          '[studioProject] background stretch render upload failed; session render remains valid',
          uploadErr
        )
      })"""

    next_text, count = stretch_pattern.subn(stretch_replacement, text, count=1)
    if count == 1:
        text = next_text
        changed += 1
        print("patched: nonblocking stretch/combined persistence")
    else:
        print("note: exact stretch/combined upload block not found; left unchanged")

    return text, changed

def main():
    if not TARGET.exists():
        fail(
            "src/studioProject.js not found. "
            "Run this from /Users/ginobarnes/Documents/Development/MELOGIC_RECORDS"
        )

    original = TARGET.read_text(encoding="utf-8")
    patched, changed = patch_blocking_uploads(original)

    if changed == 0:
        print("No new changes made.")
        return

    backup(TARGET)
    TARGET.write_text(patched, encoding="utf-8")

    print(f"wrote: {TARGET}")
    print()
    print("Next:")
    print("  npm run build")
    print("  npx tauri dev")

if __name__ == "__main__":
    main()
