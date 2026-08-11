import SignalsmithStretch from './dsp/wasm/vendor/SignalsmithStretch.mjs'

const activeProcessors = new WeakMap()

export function isSouraRealtimeDesktopRuntime() {
  return Boolean(
    globalThis.__TAURI_INTERNALS__
    || globalThis.__TAURI__
    || /Tauri/i.test(navigator.userAgent || '')
  )
}

function qualityToPreset(quality = 'realtime-high') {
  return quality === 'realtime-efficient'
    ? 'cheaper'
    : 'default'
}

function getTotalGlobalSemitones(edit = {}) {
  const pitchShift = edit.pitchShift || {}

  if (Number.isFinite(Number(pitchShift.totalSemitones))) {
    return Number(pitchShift.totalSemitones)
  }

  return (
    (Number(edit.transposeSemitones) || 0)
    + ((Number(edit.fineTuneCents) || 0) / 100)
  )
}

function getRealtimeRate(stretch = {}) {
  if (!stretch?.enabled) return 1

  const ratio =
    Number(stretch.lengthRatio)
    || Number(stretch.ratio)
    || (
      Number(stretch.sourceDurationSeconds) > 0
      && Number(stretch.targetDurationSeconds) > 0
        ? Number(stretch.targetDurationSeconds)
          / Number(stretch.sourceDurationSeconds)
        : 1
    )

  return Math.max(
    0.05,
    Math.min(
      20,
      1 / Math.max(0.05, ratio)
    )
  )
}

function buildAutomation(edit = {}, clipOffsetSeconds = 0) {
  const globalSemitones = getTotalGlobalSemitones(edit)
  const trace = edit.pitchTrace || {}
  const notes = Array.isArray(trace.notes) ? trace.notes : []

  if (!trace.enabled || !notes.length) {
    return [{
      outputTime: 0,
      semitones: globalSemitones
    }]
  }

  const events = [{
    outputTime: 0,
    semitones: globalSemitones
  }]

  for (const note of notes) {
    if (note.muted) continue

    const noteStart =
      Math.max(
        0,
        (Number(note.startSeconds) || 0)
        - clipOffsetSeconds
      )

    const noteDuration =
      Math.max(
        0.001,
        Number(note.durationSeconds) || 0.001
      )

    const original =
      Number(
        note.originalMidiNote
        ?? note.midiNote
      )

    const edited =
      Number(
        note.editedMidiNote
        ?? note.midiNote
      )

    const noteDelta =
      Number.isFinite(original)
      && Number.isFinite(edited)
        ? edited - original
        : 0

    const fineCents =
      Number(
        note.editedFineTuneCents
      ) || 0

    const semitones =
      globalSemitones
      + noteDelta
      + (fineCents / 100)

    events.push({
      outputTime: noteStart,
      semitones
    })

    events.push({
      outputTime:
        noteStart + noteDuration,
      semitones:
        globalSemitones
    })
  }

  events.sort(
    (a, b) =>
      a.outputTime - b.outputTime
  )

  return events.slice(0, 2048)
}

export function shouldUseRealtimeRegionProcessing(
  edit = {},
  stretch = {}
) {
  const globalPitch =
    Math.abs(
      getTotalGlobalSemitones(edit)
    ) > 0.0001

  const trace =
    edit.pitchTrace || {}

  const traceEdited =
    trace.enabled
    && Array.isArray(trace.notes)
    && trace.notes.some((note) =>
      note.muted
      || Number(
        note.editedMidiNote
        ?? note.midiNote
      ) !== Number(
        note.originalMidiNote
        ?? note.midiNote
      )
      || Math.abs(
        Number(
          note.editedFineTuneCents
        ) || 0
      ) > 0.001
    )

  return (
    globalPitch
    || traceEdited
    || Boolean(stretch?.enabled)
  )
}

export async function createSouraRealtimeRegionProcessor(
  context,
  {
    channels = 2,
    edit = {},
    stretch = {},
    clipOffsetSeconds = 0,
    quality = 'realtime-high'
  } = {}
) {
  if (!context) {
    throw new Error(
      'Soura realtime DSP requires an AudioContext.'
    )
  }

  const channelCount =
    Math.max(
      1,
      Math.min(
        8,
        Math.round(
          Number(channels) || 2
        )
      )
    )

  const node =
    await SignalsmithStretch(
      context,
      {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [
          channelCount
        ]
      }
    )

  await node.configure({
    preset:
      qualityToPreset(quality)
  })

  const rate =
    getRealtimeRate(stretch)

  const automation =
    buildAutomation(
      edit,
      clipOffsetSeconds
    )

  for (const event of automation) {
    const outputTime =
      Math.max(
        0,
        Number(event.outputTime) || 0
      )

    await node.schedule({
      active: true,
      outputTime,
      output: outputTime,
      input: outputTime * rate,
      rate,
      semitones:
        Number(
          event.semitones
        ) || 0
    })
  }

  const latencySeconds =
    Math.max(
      0,
      Number(
        await node.latency?.()
      ) || 0
    )

  activeProcessors.set(
    node,
    {
      context,
      latencySeconds,
      rate,
      quality,
      automationCount:
        automation.length
    }
  )

  return {
    node,
    latencySeconds,
    rate,
    automationCount:
      automation.length,
    quality
  }
}

export function destroySouraRealtimeRegionProcessor(
  node
) {
  if (!node) return

  try {
    node.disconnect()
  } catch {}

  try {
    node.dropBuffers?.()
  } catch {}

  activeProcessors.delete(node)
}
