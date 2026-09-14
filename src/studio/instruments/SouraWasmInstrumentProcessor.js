// The ABI allocates output buffers for at most 128 frames at creation. Keep
// render work bounded and leave allocation to initialization/message handling.
const MAX_BLOCK_FRAMES = 128
const MIDI_CAPACITY = 4096
const MIDI_BUDGET = 1024

class SouraWasmInstrumentProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super()
    this.exports = null
    this.memory = null
    this.left = null
    this.right = null
    this.memoryBuffer = null
    this.disposed = false
    this.failure = null
    this.callbacks = 0
    this.midiOverruns = 0
    this.processFailures = 0
    this.eventCount = 0
    this.sequence = 0
    // Fixed min-heap, stable for equal timestamps. No retained message objects.
    this.times = new Float64Array(MIDI_CAPACITY)
    this.sequences = new Float64Array(MIDI_CAPACITY)
    this.notes = new Uint8Array(MIDI_CAPACITY)
    this.velocities = new Float32Array(MIDI_CAPACITY)
    this.kinds = new Uint8Array(MIDI_CAPACITY)
    this.port.onmessage = (event) => this.handleMessage(event.data || {})
    this.ready = this.initialize(options.processorOptions || {}).catch((error) => {
      this.failure = 'initialization-failed'
      this.port.postMessage({ type: 'error', code: this.failure, message: String(error?.message || error) })
    })
  }

  async initialize(options) {
    const bytes = options.wasmBytes
    if (!bytes) throw new Error('Soura WASM processor bytes were not provided.')
    const { instance } = await WebAssembly.instantiate(bytes, {})
    if (this.disposed) return
    const exp = instance.exports || {}
    const required = ['memory', 'soura_create', 'soura_destroy', 'soura_note_on', 'soura_note_off', 'soura_set_parameter', 'soura_process', 'soura_get_output_left_ptr', 'soura_get_output_right_ptr']
    const missing = required.filter((name) => !exp[name])
    if (missing.length) throw new Error(`Soura WASM ABI mismatch: missing ${missing.join(', ')}`)
    exp.soura_create(sampleRate, MAX_BLOCK_FRAMES)
    this.exports = exp
    this.memory = exp.memory
    for (const parameter of options.parameters || []) {
      exp.soura_set_parameter(Number(parameter.index) || 0, Number(parameter.value) || 0)
    }
    const leftPtr = Number(exp.soura_get_output_left_ptr())
    const rightPtr = Number(exp.soura_get_output_right_ptr())
    this.memoryBuffer = exp.memory.buffer
    // Invalid/uninitialized pointers fail during setup, before audio processing.
    this.left = new Float32Array(this.memoryBuffer, leftPtr, MAX_BLOCK_FRAMES)
    this.right = new Float32Array(this.memoryBuffer, rightPtr, MAX_BLOCK_FRAMES)
    this.port.postMessage({ type: 'ready' })
  }

  handleMessage(message) {
    if (message.type === 'diagnostics') {
      this.port.postMessage({ type: 'diagnostics', callbacks: this.callbacks, midiOverruns: this.midiOverruns, processFailures: this.processFailures, queuedEvents: this.eventCount, failure: this.failure })
      return
    }
    if (message.type === 'dispose') {
      // Disable process synchronously. initialize also checks disposed after its
      // await, so a late instantiation cannot revive a disconnected instrument.
      if (this.disposed) return
      this.disposed = true
      this.eventCount = 0
      const exp = this.exports
      this.exports = null
      exp?.soura_destroy()
      return
    }
    if (this.disposed || this.failure) return
    if (message.type === 'noteOn' || message.type === 'noteOff') {
      if (this.eventCount === MIDI_CAPACITY) {
        this.midiOverruns += 1
        // Never drop a note-off and leave a voice sounding indefinitely.
        this.failure = 'midi-overflow'
        this.port.postMessage({ type: 'error', code: this.failure, message: 'Soura WASM MIDI queue overflowed; instrument stopped. Reload the instrument.' })
        return
      }
      const time = Number.isFinite(Number(message.time)) ? Number(message.time) : currentTime
      const sequence = this.sequence++
      const note = Math.max(0, Math.min(127, Number(message.note) || 0))
      const velocity = Math.max(0, Math.min(1, Number(message.velocity) || 0))
      const kind = message.type === 'noteOn' ? 1 : 0
      let index = this.eventCount++
      while (index > 0) {
        const parent = (index - 1) >> 1
        if (this.times[parent] < time || (this.times[parent] === time && this.sequences[parent] < sequence)) break
        this.copyEvent(parent, index)
        index = parent
      }
      this.times[index] = time
      this.sequences[index] = sequence
      this.notes[index] = note
      this.velocities[index] = velocity
      this.kinds[index] = kind
      return
    }
    if (message.type === 'param') {
      if (this.exports) this.exports.soura_set_parameter(Number(message.index) || 0, Number(message.value) || 0)
      else this.ready.then(() => {
        if (!this.disposed && !this.failure) this.exports?.soura_set_parameter(Number(message.index) || 0, Number(message.value) || 0)
      })
    }
  }

  copyEvent(from, to) {
    this.times[to] = this.times[from]
    this.sequences[to] = this.sequences[from]
    this.notes[to] = this.notes[from]
    this.velocities[to] = this.velocities[from]
    this.kinds[to] = this.kinds[from]
  }

  earlier(a, b) {
    return this.times[a] < this.times[b] || (this.times[a] === this.times[b] && this.sequences[a] < this.sequences[b])
  }

  popEvent() {
    this.eventCount -= 1
    if (!this.eventCount) return
    this.copyEvent(this.eventCount, 0)
    let index = 0
    while (index * 2 + 1 < this.eventCount) {
      let child = index * 2 + 1
      if (child + 1 < this.eventCount && this.earlier(child + 1, child)) child += 1
      if (!this.earlier(child, index)) break
      // The unused last slot is scratch storage; it cannot alias a live child.
      this.copyEvent(index, this.eventCount)
      this.copyEvent(child, index)
      this.copyEvent(this.eventCount, child)
      index = child
    }
  }

  flushEvents(blockEnd) {
    for (let count = 0; count < MIDI_BUDGET && this.eventCount; count += 1) {
      if (this.times[0] > blockEnd) break
      if (this.kinds[0]) this.exports.soura_note_on(this.notes[0], this.velocities[0])
      else this.exports.soura_note_off(this.notes[0])
      this.popEvent()
    }
  }

  silence(output) {
    for (let c = 0; c < (output?.length || 0); c += 1) output[c].fill(0)
  }

  process(inputs, outputs) {
    const output = outputs[0]
    this.callbacks += 1
    if (this.disposed || this.failure || !this.left) {
      this.silence(output)
      return !this.disposed
    }
    if (!output?.length) return true
    const frames = output[0].length
    if (frames > MAX_BLOCK_FRAMES || this.memory.buffer !== this.memoryBuffer) {
      this.failure = frames > MAX_BLOCK_FRAMES ? 'unsupported-block-size' : 'memory-grew-during-render'
      this.processFailures += 1
      this.silence(output)
      return true
    }
    try {
      this.flushEvents(currentTime + (frames / sampleRate))
      this.exports.soura_process(frames)
      if (this.memory.buffer !== this.memoryBuffer) {
        this.failure = 'memory-grew-during-render'
        this.processFailures += 1
        this.silence(output)
        return true
      }
      // Indexed copies support short blocks without allocating subarray views.
      for (let i = 0; i < frames; i += 1) {
        output[0][i] = this.left[i]
        if (output[1]) output[1][i] = this.right[i]
      }
    } catch {
      this.failure = 'processor-failed'
      this.processFailures += 1
      this.silence(output)
    }
    return true
  }
}

registerProcessor('soura-wasm-instrument-v1', SouraWasmInstrumentProcessor)
