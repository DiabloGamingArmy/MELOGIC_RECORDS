import { getAudioEffectDefaultParams } from '../../daw/audioEffects/catalog.js'
const clamp = (value, min, max) => Math.min(max, Math.max(min, value))
function effectDbToGain(db = 0) {
  return 10 ** (clamp(Number(db) || 0, -80, 24) / 20)
}
function createImpulseBuffer(ctx, params = {}) {
  const duration = clamp(Number(params.decay) || 2.4, 0.2, 8)
  const size = clamp(Number(params.size) || 0.62, 0.1, 1)
  const width = clamp(Number(params.width) || 0.72, 0, 1)
  const length = Math.max(1, Math.round(ctx.sampleRate * duration))
  const impulse = ctx.createBuffer(2, length, ctx.sampleRate)
  let seed = 0x534f5552
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 }
  const shared = new Float32Array(length)
  for (let index = 0; index < length; index += 1) shared[index] = random() * 2 - 1
  for (let channelIndex = 0; channelIndex < impulse.numberOfChannels; channelIndex += 1) {
    const data = impulse.getChannelData(channelIndex)
    for (let index = 0; index < length; index += 1) {
      const t = index / Math.max(1, length - 1)
      const decay = (1 - t) ** (1.8 + (size * 3.2))
      const independent = random() * 2 - 1
      data[index] = ((shared[index] * (1 - width)) + (independent * width)) * decay
    }
  }
  return impulse
}
function connectSerial(nodes = []) {
  for (let index = 0; index < nodes.length - 1; index += 1) nodes[index]?.connect?.(nodes[index + 1])
}
function createEqEffectNodes(ctx, params = {}) {
  const nodes = []
  const addFilter = (type, frequency, q = 1, gain = 0) => {
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.value = clamp(Number(frequency) || 1000, 20, 20000)
    if ('Q' in filter) filter.Q.value = clamp(Number(q) || 1, 0.1, 18)
    if ('gain' in filter) filter.gain.value = clamp(Number(gain) || 0, -24, 24)
    nodes.push(filter)
  }
  if (params.hpEnabled) addFilter('highpass', params.hpFrequency, params.hpQ)
  if (params.lowShelfEnabled !== false) addFilter('lowshelf', params.lowShelfFrequency, 1, params.lowShelfGain)
  if (params.bell1Enabled !== false) addFilter('peaking', params.bell1Frequency, params.bell1Q, params.bell1Gain)
  if (params.bell2Enabled !== false) addFilter('peaking', params.bell2Frequency, params.bell2Q, params.bell2Gain)
  if (params.bell3Enabled !== false) addFilter('peaking', params.bell3Frequency, params.bell3Q, params.bell3Gain)
  if (params.highShelfEnabled !== false) addFilter('highshelf', params.highShelfFrequency, 1, params.highShelfGain)
  if (params.lpEnabled) addFilter('lowpass', params.lpFrequency, params.lpQ)
  const output = ctx.createGain()
  output.gain.value = effectDbToGain(params.outputGain)
  nodes.push(output)
  connectSerial(nodes)
  return { input: nodes[0], output, nodes }
}
function createReverbEffectNodes(ctx, params = {}) {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const preDelay = ctx.createDelay(0.5)
  const convolver = ctx.createConvolver()
  const damping = ctx.createBiquadFilter()
  const gain = ctx.createGain()
  const mix = clamp(Number(params.mix) || 0, 0, 1)
  dry.gain.value = 1 - mix
  wet.gain.value = mix
  preDelay.delayTime.value = clamp(Number(params.preDelay) || 0, 0, 0.25)
  convolver.buffer = createImpulseBuffer(ctx, params)
  damping.type = 'lowpass'
  damping.frequency.value = clamp(Number(params.damping) || 6800, 800, 18000)
  gain.gain.value = effectDbToGain(params.outputGain)
  input.connect(dry)
  dry.connect(output)
  connectSerial([input, preDelay, convolver, damping, wet, output, gain])
  return { input, output: gain, nodes: [input, dry, wet, preDelay, convolver, damping, output, gain] }
}
function createDelayEffectNodes(ctx, params = {}) {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const lowCut = ctx.createBiquadFilter()
  const highCut = ctx.createBiquadFilter()
  const delay = ctx.createDelay(2)
  const feedback = ctx.createGain()
  const gain = ctx.createGain()
  const mix = clamp(Number(params.mix) || 0, 0, 1)
  dry.gain.value = 1 - mix
  wet.gain.value = mix
  lowCut.type = 'highpass'
  lowCut.frequency.value = clamp(Number(params.lowCut) || 120, 20, 1000)
  highCut.type = 'lowpass'
  highCut.frequency.value = clamp(Number(params.highCut) || 7200, 1000, 18000)
  delay.delayTime.value = clamp(Number(params.time) || 0.28, 0.03, 1.5)
  feedback.gain.value = clamp(Number(params.feedback) || 0, 0, 0.85)
  gain.gain.value = effectDbToGain(params.outputGain)
  input.connect(dry)
  dry.connect(output)
  connectSerial([input, lowCut, highCut, delay, wet, output, gain])
  delay.connect(feedback)
  feedback.connect(delay)
  return { input, output: gain, nodes: [input, dry, wet, lowCut, highCut, delay, feedback, output, gain] }
}
function makeDistortionCurve(amount = 0.3) {
  const samples = 2048
  const curve = new Float32Array(samples)
  const drive = 1 + clamp(Number(amount) || 0, 0, 1) * 90
  for (let index = 0; index < samples; index += 1) {
    const x = (index * 2 / samples) - 1
    curve[index] = ((3 + drive) * x * 20 * Math.PI / 180) / (Math.PI + drive * Math.abs(x))
  }
  return curve
}
function createCompressorEffectNodes(ctx, params = {}) {
  const input = ctx.createGain()
  const compressor = ctx.createDynamicsCompressor()
  const makeup = ctx.createGain()
  const output = ctx.createGain()
  compressor.threshold.value = clamp(Number(params.threshold) || -24, -60, 0)
  compressor.ratio.value = clamp(Number(params.ratio) || 3, 1, 20)
  compressor.attack.value = clamp(Number(params.attack) || 0.012, 0.001, 0.12)
  compressor.release.value = clamp(Number(params.release) || 0.18, 0.02, 1.2)
  compressor.knee.value = clamp(Number(params.knee) || 18, 0, 40)
  makeup.gain.value = effectDbToGain(params.makeupGain)
  output.gain.value = effectDbToGain(params.outputGain)
  connectSerial([input, compressor, makeup, output])
  return { input, output, nodes: [input, compressor, makeup, output] }
}
function createLimiterEffectNodes(ctx, params = {}) {
  const input = ctx.createGain()
  const limiter = ctx.createDynamicsCompressor()
  const output = ctx.createGain()
  input.gain.value = effectDbToGain(params.inputGain)
  limiter.threshold.value = clamp(Number(params.ceiling) || -1, -12, 0)
  limiter.knee.value = 0
  limiter.ratio.value = 20
  limiter.attack.value = 0.003
  limiter.release.value = clamp(Number(params.release) || 0.08, 0.01, 0.8)
  output.gain.value = effectDbToGain(params.outputGain)
  connectSerial([input, limiter, output])
  return { input, output, nodes: [input, limiter, output] }
}
function createDistortionEffectNodes(ctx, params = {}) {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const shaper = ctx.createWaveShaper()
  const tone = ctx.createBiquadFilter()
  const gain = ctx.createGain()
  const mix = clamp(Number(params.mix) || 0, 0, 1)
  dry.gain.value = 1 - mix
  wet.gain.value = mix
  shaper.curve = makeDistortionCurve(params.drive)
  shaper.oversample = '4x'
  tone.type = 'lowpass'
  tone.frequency.value = clamp(Number(params.tone) || 6800, 800, 16000)
  gain.gain.value = effectDbToGain(params.outputGain)
  input.connect(dry)
  dry.connect(output)
  connectSerial([input, shaper, tone, wet, output, gain])
  return { input, output: gain, nodes: [input, dry, wet, shaper, tone, output, gain] }
}
function createModulatedDelayEffectNodes(ctx, params = {}, mode = 'chorus') {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const delay = ctx.createDelay(0.08)
  const feedback = ctx.createGain()
  const lfo = ctx.createOscillator()
  const depth = ctx.createGain()
  const gain = ctx.createGain()
  const mix = clamp(Number(params.mix) || 0, 0, 1)
  const baseDelay = mode === 'flanger'
    ? clamp(Number(params.delay) || 0.004, 0.001, 0.012)
    : clamp(Number(params.delay) || 0.018, 0.004, 0.04)
  dry.gain.value = 1 - mix
  wet.gain.value = mix
  delay.delayTime.value = baseDelay
  feedback.gain.value = clamp(Number(params.feedback) || 0, 0, mode === 'flanger' ? 0.85 : 0.65)
  lfo.frequency.value = clamp(Number(params.rate) || 0.6, 0.03, 6)
  depth.gain.value = (mode === 'flanger' ? 0.004 : 0.012) * clamp(Number(params.depth) || 0, 0, 1)
  gain.gain.value = effectDbToGain(params.outputGain)
  input.connect(dry)
  dry.connect(output)
  input.connect(delay)
  delay.connect(wet)
  wet.connect(output)
  delay.connect(feedback)
  feedback.connect(delay)
  lfo.connect(depth)
  depth.connect(delay.delayTime)
  output.connect(gain)
  try { lfo.start() } catch {}
  return { input, output: gain, nodes: [input, dry, wet, delay, feedback, lfo, depth, output, gain], cleanup: () => { try { lfo.stop() } catch {} } }
}
function createPhaserEffectNodes(ctx, params = {}) {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const feedback = ctx.createGain()
  const feedbackDelay = ctx.createDelay(0.02)
  const lfo = ctx.createOscillator()
  const depth = ctx.createGain()
  const gain = ctx.createGain()
  const stageCount = clamp(Math.round(Number(params.stages) || 4), 2, 8)
  const filters = Array.from({ length: stageCount }, (_, index) => {
    const filter = ctx.createBiquadFilter()
    filter.type = 'allpass'
    filter.frequency.value = 320 + index * 360
    filter.Q.value = 0.9
    return filter
  })
  const mix = clamp(Number(params.mix) || 0, 0, 1)
  dry.gain.value = 1 - mix
  wet.gain.value = mix
  feedback.gain.value = clamp(Number(params.feedback) || 0, 0, 0.7)
  feedbackDelay.delayTime.value = 0.001
  lfo.frequency.value = clamp(Number(params.rate) || 0.42, 0.03, 4)
  depth.gain.value = 900 * clamp(Number(params.depth) || 0, 0, 1)
  gain.gain.value = effectDbToGain(params.outputGain)
  input.connect(dry)
  dry.connect(output)
  connectSerial([input, ...filters, wet, output, gain])
  filters[filters.length - 1]?.connect(feedback)
  feedback.connect(feedbackDelay)
  feedbackDelay.connect(filters[0])
  lfo.connect(depth)
  filters.forEach((filter) => depth.connect(filter.frequency))
  try { lfo.start() } catch {}
  return { input, output: gain, nodes: [input, dry, wet, feedback, feedbackDelay, lfo, depth, ...filters, output, gain], cleanup: () => { try { lfo.stop() } catch {} } }
}
function createTremoloEffectNodes(ctx, params = {}) {
  const input = ctx.createGain()
  const output = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const tremolo = ctx.createGain()
  const lfo = ctx.createOscillator()
  const depth = ctx.createGain()
  const offset = ctx.createConstantSource()
  const gain = ctx.createGain()
  const mix = clamp(Number(params.mix) || 0, 0, 1)
  const amount = clamp(Number(params.depth) || 0, 0, 1)
  dry.gain.value = 1 - mix
  wet.gain.value = mix
  tremolo.gain.value = 0
  lfo.frequency.value = clamp(Number(params.rate) || 4.2, 0.1, 14)
  depth.gain.value = amount / 2
  offset.offset.value = 1 - amount / 2
  gain.gain.value = effectDbToGain(params.outputGain)
  input.connect(dry)
  dry.connect(output)
  input.connect(tremolo)
  tremolo.connect(wet)
  wet.connect(output)
  lfo.connect(depth)
  depth.connect(tremolo.gain)
  offset.connect(tremolo.gain)
  output.connect(gain)
  try { lfo.start(); offset.start() } catch {}
  return { input, output: gain, nodes: [input, dry, wet, tremolo, lfo, depth, offset, output, gain], cleanup: () => { try { lfo.stop(); offset.stop() } catch {} } }
}
function createFilterEffectNodes(ctx, params = {}) {
  const input = ctx.createGain()
  const filter = ctx.createBiquadFilter()
  const output = ctx.createGain()
  const allowed = new Set(['lowpass', 'highpass', 'bandpass', 'notch', 'lowshelf', 'highshelf', 'peaking'])
  filter.type = allowed.has(params.type) ? params.type : 'lowpass'
  filter.frequency.value = clamp(Number(params.cutoff) || 6800, 20, 20000)
  filter.Q.value = clamp(Number(params.resonance) || 0.72, 0.1, 18)
  filter.gain.value = clamp(Number(params.gain) || 0, -24, 24)
  output.gain.value = effectDbToGain(params.outputGain)
  connectSerial([input, filter, output])
  return { input, output, nodes: [input, filter, output] }
}
function createStereoImagerEffectNodes(ctx, params = {}) {
  const input = ctx.createGain()
  const dry = ctx.createGain()
  const wet = ctx.createGain()
  const splitter = ctx.createChannelSplitter(2)
  const merger = ctx.createChannelMerger(2)
  const output = ctx.createGain()
  const width = clamp(Number(params.width) || 1, 0, 2)
  const amount = clamp(Math.abs(width - 1), 0, 1)
  const same = (1 + width) / 2
  const cross = (1 - width) / 2
  const leftToLeft = ctx.createGain()
  const rightToLeft = ctx.createGain()
  const leftToRight = ctx.createGain()
  const rightToRight = ctx.createGain()
  dry.gain.value = 1 - amount
  wet.gain.value = amount
  leftToLeft.gain.value = same
  rightToRight.gain.value = same
  rightToLeft.gain.value = cross
  leftToRight.gain.value = cross
  output.gain.value = effectDbToGain(params.outputGain)
  input.connect(dry)
  dry.connect(output)
  input.connect(splitter)
  splitter.connect(leftToLeft, 0)
  splitter.connect(leftToRight, 0)
  splitter.connect(rightToLeft, 1)
  splitter.connect(rightToRight, 1)
  leftToLeft.connect(merger, 0, 0)
  rightToLeft.connect(merger, 0, 0)
  leftToRight.connect(merger, 0, 1)
  rightToRight.connect(merger, 0, 1)
  merger.connect(wet)
  wet.connect(output)
  return { input, output, nodes: [input, dry, wet, splitter, merger, leftToLeft, rightToLeft, leftToRight, rightToRight, output] }
}
export function createAudioEffectNodes(ctx, insert = {}) {
  const params = { ...getAudioEffectDefaultParams(insert.type), ...(insert.params || {}) }
  if (insert.type === 'eq') return createEqEffectNodes(ctx, params)
  if (insert.type === 'reverb') return createReverbEffectNodes(ctx, params)
  if (insert.type === 'delay') return createDelayEffectNodes(ctx, params)
  if (insert.type === 'compressor') return createCompressorEffectNodes(ctx, params)
  if (insert.type === 'limiter') return createLimiterEffectNodes(ctx, params)
  if (insert.type === 'distortion') return createDistortionEffectNodes(ctx, params)
  if (insert.type === 'chorus') return createModulatedDelayEffectNodes(ctx, params, 'chorus')
  if (insert.type === 'flanger') return createModulatedDelayEffectNodes(ctx, params, 'flanger')
  if (insert.type === 'phaser') return createPhaserEffectNodes(ctx, params)
  if (insert.type === 'tremolo') return createTremoloEffectNodes(ctx, params)
  if (insert.type === 'filter') return createFilterEffectNodes(ctx, params)
  if (insert.type === 'stereo-imager') return createStereoImagerEffectNodes(ctx, params)
  return null
}

export function createMasterMixBus(ctx, level = 1) {
  const input = ctx.createGain(), gain = ctx.createGain(), analyser = ctx.createAnalyser()
  gain.gain.value = level
  analyser.fftSize = 512
  analyser.smoothingTimeConstant = 0
  input.connect(gain); gain.connect(analyser); analyser.connect(ctx.destination)
  return { input, gain, analyser, connectedToDestination: true }
}
export function createTrackMixChannel(ctx, track, destination) {
  const input = ctx.createGain(), volumeGain = ctx.createGain(), panner = ctx.createStereoPanner(), analyser = ctx.createAnalyser()
  volumeGain.gain.value = clamp((Number(track?.volume) || 0) / 100, 0, 1)
  panner.pan.value = clamp((Number(track?.pan) || 0) / 100, -1, 1)
  analyser.fftSize = 512; analyser.smoothingTimeConstant = 0
  volumeGain.connect(panner); panner.connect(analyser); analyser.connect(destination)
  return { input, volumeGain, panner, analyser, effectNodes: [], effectCleanups: [] }
}
export function connectTrackMixEffects(ctx, channel, inserts = []) {
  let current = channel.input
  for (const insert of inserts.filter(insert => insert.enabled !== false)) {
    const effect = createAudioEffectNodes(ctx, insert)
    if (!effect) throw new Error(`Unsupported insert: ${insert.name || insert.type}`)
    current.connect(effect.input); current = effect.output
    channel.effectNodes.push(...effect.nodes)
    if (effect.cleanup) channel.effectCleanups.push(effect.cleanup)
  }
  current.connect(channel.volumeGain)
}
