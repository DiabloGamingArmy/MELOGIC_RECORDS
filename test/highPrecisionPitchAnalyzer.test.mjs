import test from 'node:test'
import assert from 'node:assert/strict'
import { analyzePitchHighPrecision } from '../src/studio/audio/highPrecisionPitchAnalyzer.js'

// soura-pitch-analysis-period-lock-v5

const sr = 44100

function pianoLikeTone(midi, seconds = .42, amplitude = .75) {
  const length = Math.round(sr * seconds)
  const out = new Float32Array(length)
  const f = 440 * 2 ** ((midi - 69) / 12)
  for (let i = 0; i < length; i++) {
    const t = i / sr
    const attack = Math.min(1, t / .012)
    const decay = Math.exp(-t * 2.6)
    // Deliberately harmonic-rich. The fundamental is NOT overwhelmingly
    // dominant, which reproduces the class of octave/subharmonic mistakes
    // seen on real piano samples.
    const value =
      Math.sin(2 * Math.PI * f * t) * .42 +
      Math.sin(2 * Math.PI * f * 2 * t + .21) * .34 +
      Math.sin(2 * Math.PI * f * 3 * t + .37) * .19 +
      Math.sin(2 * Math.PI * f * 4 * t + .51) * .10
    out[i] = value * amplitude * attack * decay
  }
  return out
}

function silence(seconds = .09) {
  return new Float32Array(Math.round(sr * seconds))
}

function concat(...chunks) {
  const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const out = new Float32Array(length)
  let offset = 0
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length }
  return out
}

function analyze(samples) {
  return analyzePitchHighPrecision({
    samples,
    sampleRate: sr,
    bpm: 120,
    analysisMode: 'instrument',
    sensitivity: .72,
    minNoteSeconds: .055,
    confidenceThreshold: .35,
    quality: 'deep'
  })
}

test('deep instrument analysis rejects subharmonic lock on a clean piano-like note', () => {
  const result = analyze(pianoLikeTone(67)) // G4
  assert.ok(result.notes.length >= 1, 'expected a detected note')
  const longest = [...result.notes].sort((a,b)=>b.durationSeconds-a.durationSeconds)[0]
  assert.equal(longest.midiNote, 67)
  assert.match(longest.analysisMethod, /v5/)
})

test('continuity resets across piano-note gaps instead of dragging the next pitch toward the previous note', () => {
  const samples = concat(
    pianoLikeTone(60, .34), silence(.10),
    pianoLikeTone(64, .34), silence(.10),
    pianoLikeTone(67, .34)
  )
  const result = analyze(samples)
  const substantial = result.notes.filter(note => note.durationSeconds >= .12)
  const detected = substantial.map(note => note.midiNote)
  for (const expected of [60,64,67]) {
    assert.ok(detected.includes(expected), `expected MIDI ${expected} in ${detected.join(',')}`)
  }
})

test('algorithm metadata reports the period-lock v5 detector', () => {
  const result = analyze(pianoLikeTone(72, .30))
  assert.match(result.algorithm, /period-peak-nsdf-continuity-v5/)
})
