import assert from 'node:assert/strict'
import test from 'node:test'
import { StudioAudioEngine } from '../src/studio/audio/StudioAudioEngine.js'

test('transport control messages are emitted only when values change', () => {
  const messages = []
  const sharedContext = { closeCalls: 0, close() { this.closeCalls += 1; return Promise.resolve() } }
  const engine = new StudioAudioEngine({ audioContext: sharedContext })
  engine.workletNode = {
    port: { postMessage: (message) => messages.push(message) },
    disconnect() {}
  }

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
