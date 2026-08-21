class SouraWasmInstrumentProcessor extends AudioWorkletProcessor {
  constructor(options = {}) {
    super()
    this.exports = null
    this.memory = null
    this.leftPtr = 0
    this.rightPtr = 0
    this.eventQueue = []
    this.ready = this.initialize(options.processorOptions || {})
    this.port.onmessage = (event) => this.handleMessage(event.data || {})
  }

  async initialize(options) {
    const bytes = options.wasmBytes
    if (!bytes) throw new Error('Soura WASM processor bytes were not provided.')
    const { instance } = await WebAssembly.instantiate(bytes, {})
    const exp = instance.exports || {}
    const required = ['memory', 'soura_create', 'soura_destroy', 'soura_note_on', 'soura_note_off', 'soura_set_parameter', 'soura_process', 'soura_get_output_left_ptr', 'soura_get_output_right_ptr']
    const missing = required.filter((name) => !exp[name])
    if (missing.length) throw new Error(`Soura WASM ABI mismatch: missing ${missing.join(', ')}`)
    this.exports = exp
    this.memory = exp.memory
    exp.soura_create(sampleRate, 128)
    this.leftPtr = Number(exp.soura_get_output_left_ptr()) || 0
    this.rightPtr = Number(exp.soura_get_output_right_ptr()) || 0
    ;(options.parameters || []).forEach((parameter) => {
      exp.soura_set_parameter(Number(parameter.index) || 0, Number(parameter.value) || 0)
    })
    this.port.postMessage({ type: 'ready' })
  }

  handleMessage(message) {
    if (message.type === 'noteOn' || message.type === 'noteOff') {
      this.eventQueue.push(message)
      this.eventQueue.sort((a, b) => (Number(a.time) || 0) - (Number(b.time) || 0))
      return
    }
    if (message.type === 'param') {
      this.ready.then(() => this.exports?.soura_set_parameter(Number(message.index) || 0, Number(message.value) || 0)).catch(() => {})
      return
    }
    if (message.type === 'dispose') {
      this.ready.then(() => this.exports?.soura_destroy()).catch(() => {})
    }
  }

  flushEvents(blockStart, blockEnd) {
    if (!this.exports) return
    while (this.eventQueue.length) {
      const event = this.eventQueue[0]
      const at = Number(event.time)
      if (Number.isFinite(at) && at > blockEnd) break
      this.eventQueue.shift()
      if (event.type === 'noteOn') this.exports.soura_note_on(Number(event.note) || 0, Number(event.velocity) || 0)
      else this.exports.soura_note_off(Number(event.note) || 0)
    }
  }

  process(inputs, outputs) {
    const output = outputs[0]
    if (!output?.length || !this.exports || !this.memory) return true
    const frames = output[0]?.length || 128
    this.flushEvents(currentTime, currentTime + (frames / sampleRate))
    this.exports.soura_process(frames)
    const memoryBuffer = this.memory.buffer
    const left = new Float32Array(memoryBuffer, this.leftPtr, frames)
    const right = new Float32Array(memoryBuffer, this.rightPtr, frames)
    output[0]?.set(left)
    if (output[1]) output[1].set(right)
    return true
  }
}

registerProcessor('soura-wasm-instrument-v1', SouraWasmInstrumentProcessor)
