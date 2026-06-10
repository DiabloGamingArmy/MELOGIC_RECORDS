import { getStudioLibraryAssetUrl } from '../../data/studioLibraryService.js'
import { selectLibrarySample } from './librarySampleSelection.js'

export { selectLibrarySample } from './librarySampleSelection.js'

const decodedBufferCaches = new WeakMap()

function clamp(value, min, max) {
  const number = Number.isFinite(Number(value)) ? Number(value) : min
  return Math.min(max, Math.max(min, number))
}

function bufferCacheFor(audioContext) {
  if (!decodedBufferCaches.has(audioContext)) decodedBufferCaches.set(audioContext, new Map())
  return decodedBufferCaches.get(audioContext)
}

async function decodeLibrarySample(audioContext, samplePath) {
  const cache = bufferCacheFor(audioContext)
  if (!cache.has(samplePath)) {
    cache.set(samplePath, (async () => {
      const url = await getStudioLibraryAssetUrl(samplePath)
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Sample download failed with status ${response.status}.`)
      return audioContext.decodeAudioData((await response.arrayBuffer()).slice(0))
    })().catch((error) => {
      cache.delete(samplePath)
      throw error
    }))
  }
  return cache.get(samplePath)
}

function normalizeSamples(manifest = {}) {
  return (Array.isArray(manifest?.samples) ? manifest.samples : [])
    .map((sample) => ({
      fileName: String(sample?.fileName || ''),
      note: String(sample?.note || ''),
      rootMidi: Number(sample?.rootMidi),
      path: String(sample?.path || '')
    }))
    .filter((sample) => Number.isFinite(sample.rootMidi) && sample.path)
    .sort((a, b) => a.rootMidi - b.rootMidi || a.path.localeCompare(b.path))
}

export class LibrarySamplerInstrument {
  constructor({ id, type, trackId, audioContext, destination, params = {}, manifest = null, resolveManifest } = {}) {
    if (!audioContext) throw new Error('AudioContext is required for LibrarySamplerInstrument.')
    this.id = id
    this.type = type
    this.trackId = trackId
    this.audioContext = audioContext
    this.resolveManifest = resolveManifest
    this.outputNode = audioContext.createGain()
    this.outputNode.connect(destination || audioContext.destination)
    this.voices = new Map()
    this.heldNotes = new Set()
    this.pendingNotes = new Map()
    this.params = this.normalizeParams(params)
    this.manifest = null
    this.manifestSignature = ''
    this.samples = []
    this.samplePlaybackMode = 'pitch-modified'
    this.status = 'idle'
    this.error = ''
    this.loadPromise = null
    this.outputNode.gain.value = this.params.volume
    if (manifest) this.setManifest(manifest)
  }

  normalizeParams(params = {}) {
    return {
      libraryInstrumentId: String(params.libraryInstrumentId || ''),
      libraryInstrumentName: String(params.libraryInstrumentName || ''),
      libraryInstrumentVersion: Math.max(1, Math.round(Number(params.libraryInstrumentVersion) || 1)),
      volume: clamp(params.volume ?? 0.8, 0, 1),
      attack: clamp(params.attack ?? 0.006, 0.001, 2),
      release: clamp(params.release ?? 0.16, 0.01, 6)
    }
  }

  setManifest(manifest = null) {
    if (!manifest || manifest.id !== this.params.libraryInstrumentId) return
    const samples = normalizeSamples(manifest)
    const samplePlaybackMode = manifest.samplePlaybackMode === 'exact-position' ? 'exact-position' : 'pitch-modified'
    const signature = `${manifest.id}:v${manifest.version || 1}:${samplePlaybackMode}:${samples.map((sample) => `${sample.rootMidi}:${sample.path}`).join('|')}`
    if (signature === this.manifestSignature) return
    this.manifest = manifest
    this.manifestSignature = signature
    this.samples = samples
    this.samplePlaybackMode = samplePlaybackMode
    this.loadPromise = null
    this.status = this.samples.length ? 'ready' : 'error'
    this.error = this.samples.length ? '' : 'This library instrument has no mapped samples.'
  }

  async ensureRunning() {
    if (this.audioContext.state === 'suspended') await this.audioContext.resume()
  }

  async ensureManifest() {
    if (this.samples.length) return this.manifest
    if (!this.params.libraryInstrumentId) throw new Error('No Library instrument is assigned.')
    const manifest = await this.resolveManifest?.(this.params.libraryInstrumentId)
    if (!manifest) throw new Error('The assigned Library instrument could not be found.')
    this.setManifest(manifest)
    if (!this.samples.length) throw new Error(this.error)
    return manifest
  }

  async preload() {
    if (this.loadPromise) return this.loadPromise
    this.status = 'loading'
    this.error = ''
    this.loadPromise = (async () => {
      await this.ensureManifest()
      let nextIndex = 0
      const worker = async () => {
        while (nextIndex < this.samples.length) {
          const sample = this.samples[nextIndex]
          nextIndex += 1
          await decodeLibrarySample(this.audioContext, sample.path)
        }
      }
      await Promise.all(Array.from({ length: Math.min(4, this.samples.length) }, () => worker()))
      this.status = 'loaded'
      return this
    })().catch((error) => {
      this.status = 'error'
      this.error = error?.message || 'Library samples could not be loaded.'
      this.loadPromise = null
      throw error
    })
    return this.loadPromise
  }

  nearestSample(note) {
    return selectLibrarySample(this.samples, note, this.samplePlaybackMode)
  }

  async noteOn(note, velocity = 0.8) {
    const midi = Number(note)
    if (!Number.isFinite(midi)) return
    this.noteOff(midi, { immediate: true })
    this.heldNotes.add(midi)
    const requestToken = Symbol(`sample-note-${midi}`)
    this.pendingNotes.set(midi, requestToken)
    await this.ensureManifest()
    const sample = this.nearestSample(midi)
    if (!sample) {
      this.pendingNotes.delete(midi)
      return
    }
    const buffer = await decodeLibrarySample(this.audioContext, sample.path)
    if (!this.heldNotes.has(midi) || this.pendingNotes.get(midi) !== requestToken) return
    this.pendingNotes.delete(midi)

    const now = this.audioContext.currentTime
    const source = this.audioContext.createBufferSource()
    const envelope = this.audioContext.createGain()
    source.buffer = buffer
    const playbackRate = this.samplePlaybackMode === 'exact-position'
      ? 1
      : 2 ** ((midi - sample.rootMidi) / 12)
    source.playbackRate.setValueAtTime(playbackRate, now)
    envelope.gain.setValueAtTime(0.0001, now)
    envelope.gain.exponentialRampToValueAtTime(Math.max(0.0001, clamp(velocity, 0, 1)), now + this.params.attack)
    source.connect(envelope)
    envelope.connect(this.outputNode)
    const voice = { source, envelope, sample, released: false }
    this.voices.set(midi, voice)
    source.onended = () => this.cleanupVoice(midi, voice)
    source.start(now)
    this.status = 'loaded'
  }

  noteOff(note, { immediate = false } = {}) {
    const midi = Number(note)
    this.heldNotes.delete(midi)
    this.pendingNotes.delete(midi)
    const voice = this.voices.get(midi)
    if (!voice || voice.released) return
    voice.released = true
    const now = this.audioContext.currentTime
    const release = immediate ? 0.015 : this.params.release
    voice.envelope.gain.cancelScheduledValues(now)
    voice.envelope.gain.setValueAtTime(Math.max(0.0001, voice.envelope.gain.value), now)
    voice.envelope.gain.exponentialRampToValueAtTime(0.0001, now + release)
    try {
      voice.source.stop(now + release + 0.02)
    } catch {
      this.cleanupVoice(midi, voice)
    }
  }

  cleanupVoice(midi, voice) {
    if (this.voices.get(midi) === voice) this.voices.delete(midi)
    try {
      voice.source.disconnect()
      voice.envelope.disconnect()
    } catch {
      // The browser may already have released an ended source.
    }
  }

  setParam(name, value) {
    const previousId = this.params.libraryInstrumentId
    this.params = this.normalizeParams({ ...this.params, [name]: value })
    if (name === 'volume') this.outputNode.gain.setTargetAtTime(this.params.volume, this.audioContext.currentTime, 0.015)
    if (name === 'libraryInstrumentId' && previousId !== this.params.libraryInstrumentId) {
      this.stopAll()
      this.manifest = null
      this.manifestSignature = ''
      this.samples = []
      this.samplePlaybackMode = 'pitch-modified'
      this.loadPromise = null
      this.status = 'idle'
      this.error = ''
    }
  }

  getStatus() {
    return {
      status: this.status,
      error: this.error,
      sampleCount: this.samples.length,
      samplePlaybackMode: this.samplePlaybackMode
    }
  }

  stopAll() {
    Array.from(this.voices.keys()).forEach((note) => this.noteOff(note, { immediate: true }))
    this.heldNotes.clear()
    this.pendingNotes.clear()
  }

  dispose() {
    this.stopAll()
    try {
      this.outputNode.disconnect()
    } catch {
      // Already disconnected.
    }
  }
}
