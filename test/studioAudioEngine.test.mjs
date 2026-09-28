import assert from 'node:assert/strict'
import test from 'node:test'
import { StudioAudioEngine } from '../src/studio/audio/StudioAudioEngine.js'

test('stopped transport state changes are retained without flooding the worklet', () => {
  const messages = []
  const sharedContext = { closeCalls: 0, close() { this.closeCalls += 1; return Promise.resolve() } }
  const engine = new StudioAudioEngine({ audioContext: sharedContext })
  engine.workletNode = {
    port: { postMessage: (message) => messages.push(message) },
    disconnect() {}
  }

  engine.setBpm(120)
  engine.setPositionBeats(4)
  engine.setPositionBeats(8)

  assert.deepEqual(messages, [])
  assert.equal(engine.getState().bpm, 120)
  assert.equal(engine.getState().positionBeats, 8)

  engine.startTransport()
  assert.deepEqual(messages, [
    { type: 'transport:start', bpm: 120, positionBeats: 8 }
  ])

  engine.destroy()
  assert.equal(sharedContext.closeCalls, 0)
})

test('running transport control messages are emitted only when values change', () => {
  const messages = []
  const sharedContext = { closeCalls: 0, close() { this.closeCalls += 1; return Promise.resolve() } }
  const engine = new StudioAudioEngine({ audioContext: sharedContext })
  engine.workletNode = {
    port: { postMessage: (message) => messages.push(message) },
    disconnect() {}
  }

  engine.startTransport()
  messages.length = 0
  engine.setBpm(140)
  engine.setBpm(120)
  engine.setBpm(120)
  engine.setPositionBeats(0)
  engine.setPositionBeats(4)
  engine.setPositionBeats(4)

  assert.deepEqual(messages, [
    { type: 'transport:set-bpm', bpm: 120 },
    { type: 'transport:set-position', positionBeats: 4 }
  ])

  engine.destroy()
  assert.equal(sharedContext.closeCalls, 0)
})

test('shared project audio context can skip the unused transport worklet', async () => {
  const sharedContext = {
    sampleRate: 44100,
    closeCalls: 0,
    close() { this.closeCalls += 1; return Promise.resolve() }
  }
  const engine = new StudioAudioEngine({ audioContext: sharedContext, useTransportWorklet: false })
  let workletLoadCalls = 0
  engine.loadWorklet = async () => { workletLoadCalls += 1 }

  const state = await engine.init()

  assert.equal(workletLoadCalls, 0)
  assert.equal(state.sampleRate, 44100)
  assert.equal(state.isReady, true)
  engine.destroy()
  assert.equal(sharedContext.closeCalls, 0)
})

test('concurrent init calls share one initialization pass', async () => {
  const sharedContext = {
    sampleRate: 48000,
    close() { return Promise.resolve() }
  }
  const engine = new StudioAudioEngine({ audioContext: sharedContext })
  let workletLoadCalls = 0
  let releaseLoad
  const loadGate = new Promise((resolve) => { releaseLoad = resolve })
  engine.loadWorklet = async () => {
    workletLoadCalls += 1
    await loadGate
  }

  const first = engine.init()
  const second = engine.init()
  releaseLoad()
  const [firstState, secondState] = await Promise.all([first, second])

  assert.equal(workletLoadCalls, 1)
  assert.equal(firstState.isReady, true)
  assert.equal(secondState.isReady, true)
})
