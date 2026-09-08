import { planExport } from '../../../src/studio/export/exportPlan.js'
import { encodeExport } from '../../../src/studio/export/ProjectExportService.js'
export function createExportFixture(ctx, track) {
  track.instrument = { type: 'melogic-wavetable', enabled: true, params: { volume: .3, release: .05, attack: .005 } }
  track.volume = 72; track.pan = 0; track.audioEffects = []; track.midiEffects = []
  const buffer = ctx.createBuffer(2, ctx.sampleRate * 2, ctx.sampleRate)
  for (let i = 0; i < buffer.length; i++) { buffer.getChannelData(0)[i] = .25; buffer.getChannelData(1)[i] = -.125 }
  return { buffer, regions: [
    { id: 'export-audio', name: 'Stereo fixture', type: 'audio', trackId: track.id, startBeat: 0, endBeat: 4, durationBeats: 4, fileDurationSeconds: 2, trimStartSeconds: 0, trimEndSeconds: 2, audioClip: { runtimeId: 'export-audio' } },
    { id: 'export-midi', name: 'Repeated pitch fixture', type: 'midi', trackId: track.id, startBeat: 0, endBeat: 4, notes: [0, 1, 2, 3].map((startBeat, i) => ({ id: `n${i}`, note: 60, startBeat, durationBeats: .5, velocity: .8 })) }
  ] }
export function mountExportFixture({ snapshot, render }) {
  const button = document.createElement('button'); button.textContent = 'Run bounce checks'; button.style.cssText = 'position:fixed;right:0;bottom:0;z-index:10000'
  const output = document.createElement('output'); output.dataset.exportChecks = ''; output.style.cssText = 'position:fixed;left:0;bottom:0;z-index:10000;background:#111;color:#fff;max-width:80vw;font:12px monospace'
  document.body.append(button, output)
  button.onclick = async () => {
    output.textContent = 'Running…'
    const results = [], signal = new AbortController().signal
    const options = { sampleRate: 48000, depth: 24, normalize: false, tail: 0 }
    async function bounce(change = () => {}, extra = {}) {
      const state = snapshot(); change(state)
      const plan = planExport({ ...state, ...options, ...extra })
      return render(state, plan, options, signal, () => {})
    }
    const assert = (condition, name) => { if (!condition) throw new Error(name); results.push(name) }
    const audioOnly = state => { state.regions = state.regions.filter(region => region.type === 'audio') }
    try {
      const before = JSON.stringify(snapshot().regions)
      const audio = await bounce(audioOnly)
      assert(Math.abs(audio.getChannelData(0)[24000] - .18) < 1e-5 && Math.abs(audio.getChannelData(1)[24000] + .09) < 1e-5, 'stereo audio / track gain')
      const master = await bounce(state => { audioOnly(state); state.masterLevel = .5 })
      assert(Math.abs(master.getChannelData(0)[24000] - .09) < 1e-5, 'master gain')
      const pan = await bounce(state => { audioOnly(state); state.tracks[0].pan = -100 })
      assert(Math.abs(pan.getChannelData(1)[24000]) < 1e-5, 'track pan')
      const effect = await bounce(state => { audioOnly(state); state.tracks[0].audioEffects = [{ type: 'eq', params: { outputGain: -6 } }] })
      assert(Math.abs(effect.getChannelData(0)[24000] - .18 * 10 ** (-6 / 20)) < 1e-4, 'insert processing')
      const midi = await bounce(state => { state.regions = state.regions.filter(region => region.type === 'midi') })
      for (const start of [0, .5, 1, 1.5]) assert(midi.getChannelData(0).subarray((start + .05) * 48000, (start + .15) * 48000).some(value => Math.abs(value) > .001), `MIDI pitch at ${start}s`)
      const cycle = await bounce(audioOnly, { range: 'cycle', cycle: { start: 1, end: 3 }, tail: 1 })
      assert(cycle.length === 96000, 'cycle length / tail')
      const encoded = await encodeExport(audio, options, signal, () => {})
      const decoded = await new OfflineAudioContext(2, 1, 48000).decodeAudioData(encoded.buffer.slice(0))
      assert(decoded.numberOfChannels === 2 && decoded.length === audio.length, 'worker WAV decodes')
      assert(JSON.stringify(snapshot().regions) === before, 'project unchanged')
      output.textContent = `PASS: ${results.join('; ')}`
    } catch (error) { output.textContent = `FAIL: ${error.stack}`; console.error(error) }
  }
}
