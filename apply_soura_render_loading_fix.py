#!/usr/bin/env python3
# Soura render + project-loading patch installer.
#
# Run from the MELOGIC_RECORDS repository root:
#
#   python3 apply_soura_render_loading_fix.py
#
# Existing files receive .soura-fix.bak backups before writes.

from pathlib import Path
import re
import shutil

ROOT = Path.cwd()

STUDIO_PROJECT = ROOT / "src/studioProject.js"
WASM_CLIENT = ROOT / "src/studio/audio/dsp/wasm/souraWasmDspClient.js"

def die(message):
    print(f"\nERROR: {message}\n")
    raise SystemExit(1)

def backup(path):
    backup_path = path.with_suffix(path.suffix + ".soura-fix.bak")
    if not backup_path.exists():
        shutil.copy2(path, backup_path)
        print(f"backup: {backup_path}")
    return backup_path

def replace_once(text, old, new, label):
    count = text.count(old)

    if count == 0:
        if new in text:
            print(f"already patched: {label}")
            return text

        die(
            f"Could not find expected source for {label}. "
            "Your local file differs from the inspected repository version."
        )

    if count != 1:
        die(
            f"Expected one match for {label}, found {count}."
        )

    print(f"patched: {label}")
    return text.replace(old, new, 1)

def patch_wasm_client():
    if not WASM_CLIENT.exists():
        die(f"Missing {WASM_CLIENT}")

    text = WASM_CLIENT.read_text(encoding="utf-8")
    original = text

    old_route = '''function shouldUseLiveInputPath(payload = {}, inputFrames, outputFrames) {
  const operation = payload.operation
  const durationMatched = Math.abs(inputFrames - outputFrames) <= 1
  if (!durationMatched) return false
  if (operation === SOURA_AUDIO_DSP_OPERATIONS.pitchShift || operation === SOURA_AUDIO_DSP_OPERATIONS.pitchTrace || operation === SOURA_AUDIO_DSP_OPERATIONS.pitchAndStretch) return true
  const rate = inputFrames / Math.max(1, outputFrames)
  return operation === SOURA_AUDIO_DSP_OPERATIONS.timeStretch && Math.abs(rate - 1) < 0.000001 && Math.abs(getPitchSemitones(payload)) < 0.000001
}'''

    new_route = '''function shouldUseLiveInputPath(payload = {}, inputFrames, outputFrames) {
  const operation = payload.operation
  const durationMatched = Math.abs(inputFrames - outputFrames) <= 1
  if (!durationMatched) return false

  /*
    Offline pitch rendering must use Signalsmith's buffered-input path.

    Safari and Tauri on macOS are WebKit-based. A live AudioWorkletNode
    connected to an OfflineAudioContext can fail to advance rendering in
    WebKit, which previously left Soura's pitch preflight at 0/1 forever.

    Buffered input still uses the required Signalsmith WASM DSP engine.
  */
  if (
    operation === SOURA_AUDIO_DSP_OPERATIONS.pitchShift
    || operation === SOURA_AUDIO_DSP_OPERATIONS.pitchTrace
    || operation === SOURA_AUDIO_DSP_OPERATIONS.pitchAndStretch
  ) {
    return false
  }

  const rate =
    inputFrames / Math.max(1, outputFrames)

  return (
    operation === SOURA_AUDIO_DSP_OPERATIONS.timeStretch
    && Math.abs(rate - 1) < 0.000001
    && Math.abs(getPitchSemitones(payload)) < 0.000001
  )
}'''

    text = replace_once(
        text,
        old_route,
        new_route,
        "buffered Signalsmith pitch-render routing",
    )

    timeout_anchor = '''async function renderBufferedInputWithSignalsmith({ input, inputFrames, outputFrames, channels, sampleRate, quality, semitones }) {'''

    timeout_helper = '''function renderOfflineContextWithTimeout(
  ctx,
  {
    label = 'Soura DSP render',
    timeoutMs = 45000
  } = {}
) {
  let timer = 0

  const renderPromise =
    Promise.resolve().then(
      () => ctx.startRendering()
    )

  const timeoutPromise =
    new Promise((_, reject) => {
      timer = globalThis.setTimeout(
        () => {
          reject(
            new Error(
              `${label} timed out after ${Math.round(timeoutMs / 1000)} seconds. Original audio was preserved.`
            )
          )
        },
        timeoutMs
      )
    })

  return Promise.race([
    renderPromise,
    timeoutPromise
  ]).finally(() => {
    if (timer) {
      globalThis.clearTimeout(timer)
    }
  })
}

async function renderBufferedInputWithSignalsmith({ input, inputFrames, outputFrames, channels, sampleRate, quality, semitones }) {'''

    if "function renderOfflineContextWithTimeout(" not in text:
        text = replace_once(
            text,
            timeout_anchor,
            timeout_helper,
            "OfflineAudioContext watchdog",
        )
    else:
        print("already patched: OfflineAudioContext watchdog")

    old_render = "const renderedBuffer = await ctx.startRendering()"

    buffered_render = '''const renderedBuffer =
    await renderOfflineContextWithTimeout(
      ctx,
      {
        label: 'Soura buffered WASM DSP render'
      }
    )'''

    if old_render in text:
        text = text.replace(old_render, buffered_render, 1)
        print("patched: buffered DSP watchdog")
    elif "Soura buffered WASM DSP render" in text:
        print("already patched: buffered DSP watchdog")
    else:
        die("Could not locate buffered OfflineAudioContext render")

    live_render = '''const renderedBuffer =
    await renderOfflineContextWithTimeout(
      ctx,
      {
        label: 'Soura live-input WASM DSP render'
      }
    )'''

    if old_render in text:
        text = text.replace(old_render, live_render, 1)
        print("patched: live-input DSP watchdog")
    elif "Soura live-input WASM DSP render" in text:
        print("already patched: live-input DSP watchdog")
    else:
        die("Could not locate live-input OfflineAudioContext render")

    if text != original:
        backup(WASM_CLIENT)
        WASM_CLIENT.write_text(text, encoding="utf-8")
        print(f"wrote: {WASM_CLIENT}")
    else:
        print(f"unchanged: {WASM_CLIENT}")

def patch_studio_project():
    if not STUDIO_PROJECT.exists():
        die(f"Missing {STUDIO_PROJECT}")

    text = STUDIO_PROJECT.read_text(encoding="utf-8")
    original = text

    import_anchor = '''import {
  getSouraWasmDspStatusSnapshot,
  isLegacyJsDspFallbackEnabled,
  preloadSouraWasmDsp
} from './studio/audio/dsp/wasm/souraWasmDspClient.js'\n'''

    import_replacement = import_anchor + '''
import {
  createSouraProjectLoader,
  waitForWarmup
} from './studio/runtime/souraProjectLoadingScreen.js' '''

    if "createSouraProjectLoader" not in text:
        text = replace_once(
            text,
            import_anchor,
            import_replacement,
            "project loader import",
        )
    else:
        print("already patched: project loader import")

    modal_start = text.find(
        "function renderAudioPreflightRenderModal() {"
    )
    modal_end = text.find(
        "function renderStretchPlaybackPrompt() {"
    )

    if modal_start < 0 or modal_end < 0 or modal_end <= modal_start:
        die("Could not locate preflight render modal")

    current_modal = text[modal_start:modal_end]

    if "data-preflight-progress-label" not in current_modal:
        new_modal = '''function getAudioPreflightCurrentProgress() {
  const pitchProgress =
    Number(audioPitchRenderState.progress)

  if (
    audioPitchRenderState.active
    && Number.isFinite(pitchProgress)
  ) {
    return clamp(pitchProgress, 0, 1)
  }

  const stretchProgress =
    Number(audioStretchRenderState.progress)

  if (
    audioStretchRenderState.active
    && Number.isFinite(stretchProgress)
  ) {
    return clamp(stretchProgress, 0, 1)
  }

  return 0
}

function updateAudioPreflightProgressUI() {
  if (!audioPreflightRenderState.active) return

  const total =
    Math.max(
      1,
      Number(audioPreflightRenderState.total) || 1
    )

  const completed =
    clamp(
      Number(audioPreflightRenderState.completed) || 0,
      0,
      total
    )

  const current =
    getAudioPreflightCurrentProgress()

  const overall =
    clamp(
      (completed + current) / total,
      0,
      1
    )

  const percent =
    Math.round(overall * 100)

  const modal =
    app.querySelector(
      '.studio-audio-render-modal'
    )

  const progress =
    modal?.querySelector(
      '.studio-audio-render-progress'
    )

  const fill =
    progress?.querySelector('i')

  const label =
    modal?.querySelector(
      '[data-preflight-progress-label]'
    )

  progress?.setAttribute(
    'aria-label',
    `${percent}%`
  )

  progress?.setAttribute(
    'aria-valuenow',
    String(percent)
  )

  if (fill) {
    fill.style.width = `${percent}%`
  }

  if (label) {
    const currentNumber =
      Math.min(
        total,
        completed + 1
      )

    const detail =
      current > 0 && current < 1
        ? ` · DSP ${Math.round(current * 100)}%`
        : ''

    label.textContent =
      `${currentNumber}/${total} renders · `
      + `${audioPreflightRenderState.currentLabel || 'Queued'}`
      + detail
  }
}

function renderAudioPreflightRenderModal() {
  if (!audioPreflightRenderState.active) return ''

  const total =
    Math.max(
      1,
      Number(audioPreflightRenderState.total) || 1
    )

  const completed =
    clamp(
      Number(audioPreflightRenderState.completed) || 0,
      0,
      total
    )

  const current =
    getAudioPreflightCurrentProgress()

  const progress =
    clamp(
      (completed + current) / total,
      0,
      1
    )

  const percent =
    Math.round(progress * 100)

  const currentNumber =
    Math.min(
      total,
      completed + 1
    )

  return `
    <div
      class="studio-audio-render-modal"
      role="dialog"
      aria-modal="true"
      aria-labelledby="studio-preflight-render-title"
    >
      <section class="studio-audio-render-panel">
        <span>Preparing audio</span>

        <h3 id="studio-preflight-render-title">
          Preparing Audio
        </h3>

        <p>
          Soura is rendering offline audio edits
          before playback.
        </p>

        <div
          class="studio-audio-render-progress"
          role="progressbar"
          aria-label="${percent}%"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow="${percent}"
        >
          <i style="width:${percent}%"></i>
        </div>

        <small data-preflight-progress-label>
          ${currentNumber}/${total} renders ·
          ${esc(
            audioPreflightRenderState.currentLabel
            || 'Queued'
          )}
          ${
            current > 0 && current < 1
              ? ` · DSP ${Math.round(current * 100)}%`
              : ''
          }
        </small>

        ${
          audioPreflightRenderState.error
            ? `
              <p>${esc(audioPreflightRenderState.error)}</p>

              <div class="studio-modal-actions">
                <button
                  type="button"
                  class="button"
                  data-preflight-retry
                >
                  Retry Render
                </button>

                <button
                  type="button"
                  class="button button-muted"
                  data-preflight-play-original
                >
                  Play Original Where Possible
                </button>

                <button
                  type="button"
                  class="button button-muted"
                  data-preflight-cancel
                >
                  Cancel
                </button>
              </div>
            `
            : ''
        }
      </section>
    </div>
  `
}

'''
        text = text[:modal_start] + new_modal + text[modal_end:]
        print("patched: preflight progress UI")
    else:
        print("already patched: preflight progress UI")

    pitch_line = "audioPitchRenderState = { ...audioPitchRenderState, progress }"
    pitch_patched = '''audioPitchRenderState = { ...audioPitchRenderState, progress }
        updateAudioPreflightProgressUI()'''

    pitch_count = text.count(pitch_line)

    if pitch_count:
        text = text.replace(pitch_line, pitch_patched)
        print(f"patched: {pitch_count} pitch/reverse progress callbacks")
    elif "updateAudioPreflightProgressUI()" in text:
        print("already patched: pitch/reverse progress callbacks")
    else:
        die("Could not locate pitch progress callback")

    stretch_line = "audioStretchRenderState = { ...audioStretchRenderState, progress }"
    stretch_patched = '''audioStretchRenderState = { ...audioStretchRenderState, progress }
        updateAudioPreflightProgressUI()'''

    stretch_count = text.count(stretch_line)

    if stretch_count:
        text = text.replace(stretch_line, stretch_patched)
        print(f"patched: {stretch_count} stretch progress callbacks")
    else:
        print("note: no unpatched stretch callback found")

    init_pattern = re.compile(
        r"async function init\(\) \{.*?\ninit\(\)\s*$",
        re.DOTALL
    )

    if "const loader = createSouraProjectLoader(app)" not in text:
        match = init_pattern.search(text)

        if not match:
            die("Could not locate final Soura init() block")

        new_init = '''async function init() {
  const loader =
    createSouraProjectLoader(app)

  loader.start()

  try {
    loader.activate(
      'session',
      'Checking your Melogic account'
    )

    const user =
      await waitForInitialAuthState()

    if (!user) {
      loader.fail(
        'session',
        'Sign in is required to open this Soura project.'
      )

      return renderState(
        'Sign in required for Studio.',
        authRoute({
          redirect:
            window.location.pathname
        })
      )
    }

    loader.complete(
      'session',
      'Account restored'
    )

    loader.activate(
      'project',
      'Reading project from Firestore'
    )

    const id =
      projectIdFromPath()

    if (
      !id
      || reserved.has(id)
    ) {
      loader.fail(
        'project',
        'Studio project not found.'
      )

      return renderState(
        'Studio project not found.'
      )
    }

    const project =
      await getStudioProject(id)

    if (!project) {
      loader.fail(
        'project',
        'Studio project not found.'
      )

      return renderState(
        'Studio project not found.'
      )
    }

    if (
      !(
        user.uid === project.ownerId
        || (
          project.collaboratorIds
          || []
        ).includes(user.uid)
      )
    ) {
      loader.fail(
        'project',
        'You do not have access to this Soura project.'
      )

      return renderState(
        'You do not have access to this Studio project.'
      )
    }

    loader.complete(
      'project',
      project.title || 'Project loaded'
    )

    touchStudioProject(
      project.id
    ).catch(() => {})

    loader.activate(
      'workspace',
      'Restoring editor state'
    )

    projectState =
      project

    if (projectState.editorState) {
      applyLoadedEditorState(
        projectState.editorState
      )
    }

    ensureDefaultCycleRange()

    loader.complete(
      'workspace',
      'Workspace restored'
    )

    loader.activate(
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
    }

    loader.activate(
      'media',
      'Preparing audio assets'
    )

    const mediaWarmup =
      hydrateProjectAudioAssets()

    const mediaResult =
      await waitForWarmup(
        mediaWarmup,
        1800
      )

    if (
      mediaResult.status === 'complete'
    ) {
      loader.complete(
        'media',
        'Audio assets ready'
      )
    } else if (
      mediaResult.status === 'failed'
    ) {
      console.warn(
        '[studioProject] audio hydration failed',
        mediaResult.error
      )

      loader.warn(
        'media',
        'Media will continue loading as needed'
      )
    } else {
      loader.warn(
        'media',
        'Continuing media load in background'
      )
    }

    loader.finish()

    isEditorLoaded = true

    renderEditor()

    dspWarmup
      .then(() => renderEditor())
      .catch((err) => {
        console.error(
          '[soura-dsp] preload failed',
          err
        )

        renderEditor()
      })

    mediaWarmup.catch(
      (err) =>
        console.warn(
          '[studioProject] audio hydration failed',
          err
        )
    )

    warmSelectedTrackInstrument(
      'project-open'
    )
  } catch (error) {
    console.error(
      '[Soura] Project initialization failed:',
      error
    )

    loader.fail(
      'project',
      error?.message
      || 'Soura could not load this project.'
    )

    renderState(
      'Soura could not load this project.'
    )
  }
}

init()
'''

        text = text[:match.start()] + new_init + "\n"
        print("patched: staged Soura project boot")
    else:
        print("already patched: staged Soura project boot")

    if text != original:
        backup(STUDIO_PROJECT)
        STUDIO_PROJECT.write_text(text, encoding="utf-8")
        print(f"wrote: {STUDIO_PROJECT}")
    else:
        print(f"unchanged: {STUDIO_PROJECT}")

def main():
    for path in [ROOT / "src", STUDIO_PROJECT, WASM_CLIENT]:
        if not path.exists():
            die(
                "Run this script from the MELOGIC_RECORDS repository root. "
                f"Missing: {path}"
            )

    patch_wasm_client()
    patch_studio_project()

    print(
        "\nSoura render/loading fix installed.\n"
        "Next run:\n"
        "  npm run build\n"
        "  npx tauri dev\n"
    )

if __name__ == "__main__":
    main()
