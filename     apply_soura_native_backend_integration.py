#!/usr/bin/env python3
"""
Integrate the native Soura execution backend into the existing Soura
project-loader path without replacing the giant studioProject.js file.

Run from the MELOGIC_RECORDS repository root:

    python3 apply_soura_native_backend_integration.py
"""

from pathlib import Path
import shutil

ROOT = Path.cwd()
TARGET = ROOT / "src/studioProject.js"

def die(message):
    raise SystemExit(
        f"\nERROR: {message}\n"
    )

def backup(path):
    backup_path =
        path.with_suffix(
            path.suffix
            + ".native-audio-phase1.bak"
        )

    if not backup_path.exists():
        shutil.copy2(
            path,
            backup_path
        )

        print(
            f"backup: {backup_path}"
        )

def main():
    if not TARGET.exists():
        die(
            "src/studioProject.js not found. "
            "Run this script from the MELOGIC_RECORDS repo root."
        )

    text =
        TARGET.read_text(
            encoding="utf-8"
        )

    original =
        text

    import_anchor = """import { StudioAudioEngine } from './studio/audio/StudioAudioEngine.js'"""

    new_import = """import { StudioAudioEngine } from './studio/audio/StudioAudioEngine.js'
import {
  getSouraExecutionMode,
  initializeSouraExecutionBackend
} from './studio/audio/SouraExecutionBackend.js'"""

    if (
        "initializeSouraExecutionBackend"
        not in text
    ):
        if import_anchor not in text:
            die(
                "Could not find StudioAudioEngine import. "
                "Your local studioProject.js differs from the expected structure."
            )

        text =
            text.replace(
                import_anchor,
                new_import,
                1
            )

        print(
            "patched: Soura native backend import"
        )
    else:
        print(
            "already patched: backend import"
        )

    # If the staged loader patch from our previous pass exists, replace only
    # the DSP warmup section. This makes desktop boot initialize CPAL/CoreAudio
    # while web boot continues through WebAudio/WASM.
    old_block = """    loader.activate(
      'audio',
      'Loading Signalsmith WASM DSP'
    )

    const dspWarmup =
      preloadSouraWasmDsp()

    const dspResult =
      await waitForWarmup(
        dspWarmup,
        2200
      )

    if (
      dspResult.status === 'complete'
    ) {
      loader.complete(
        'audio',
        'WASM DSP ready'
      )
    } else if (
      dspResult.status === 'failed'
    ) {
      console.warn(
        '[soura-dsp] preload failed',
        dspResult.error
      )

      loader.warn(
        'audio',
        'DSP will retry when needed'
      )
    } else {
      loader.warn(
        'audio',
        'Continuing warmup in background'
      )
    }"""

    new_block = """    const executionMode =
      getSouraExecutionMode()

    loader.activate(
      'audio',
      executionMode === 'native'
        ? 'Starting native CoreAudio engine'
        : 'Loading Signalsmith WASM DSP'
    )

    const dspWarmup =
      executionMode === 'native'
        ? initializeSouraExecutionBackend()
        : preloadSouraWasmDsp()

    const dspResult =
      await waitForWarmup(
        dspWarmup,
        executionMode === 'native'
          ? 3500
          : 2200
      )

    if (
      dspResult.status === 'complete'
    ) {
      loader.complete(
        'audio',
        executionMode === 'native'
          ? 'Native CoreAudio engine ready'
          : 'WASM DSP ready'
      )
    } else if (
      dspResult.status === 'failed'
    ) {
      console.warn(
        '[soura-audio] backend warmup failed',
        dspResult.error
      )

      loader.warn(
        'audio',
        executionMode === 'native'
          ? 'Native engine unavailable; editor will continue'
          : 'DSP will retry when needed'
      )
    } else {
      loader.warn(
        'audio',
        executionMode === 'native'
          ? 'Native engine is continuing startup'
          : 'Continuing warmup in background'
      )
    }"""

    if old_block in text:
        text =
            text.replace(
                old_block,
                new_block,
                1
            )

        print(
            "patched: desktop-native Soura loading stage"
        )

    elif (
        "Starting native CoreAudio engine"
        in text
    ):
        print(
            "already patched: native loading stage"
        )
    else:
        print(
            "note: staged loader warmup block was not found. "
            "The native backend files will still compile, but studioProject.js "
            "was not automatically wired into the loader."
        )

    if text == original:
        print(
            "No new studioProject.js changes required."
        )

        return

    backup(TARGET)

    TARGET.write_text(
        text,
        encoding="utf-8"
    )

    print(
        f"wrote: {TARGET}"
    )

if __name__ == "__main__":
    main()
