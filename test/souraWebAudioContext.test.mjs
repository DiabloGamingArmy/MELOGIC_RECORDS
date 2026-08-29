import assert from 'node:assert/strict'
import test from 'node:test'
import { createSouraWebAudioContextOwner } from '../src/studio/audio/SouraWebAudioContext.js'

function mockContext({ state = 'suspended', resumeState = 'running', resumeError = null } = {}) {
  return {
    state,
    currentTime: 12.5,
    sampleRate: 48000,
    resumeCalls: 0,
    closeCalls: 0,
    addEventListener() {},
    async resume() {
      this.resumeCalls += 1
      if (resumeError) throw resumeError
      this.state = resumeState
    },
    async close() {
      this.closeCalls += 1
      this.state = 'closed'
    }
  }
}

test('one authoritative context is reused and resumed before playback', async () => {
  const context = mockContext()
  let factoryCalls = 0
  const owner = createSouraWebAudioContextOwner({ createContext: () => { factoryCalls += 1; return context } })

  assert.equal(owner.getContext(), context)
  assert.equal(await owner.ensureRunning('play-control'), context)
  assert.equal(owner.getContext(), context)
  assert.equal(factoryCalls, 1)
  assert.equal(context.resumeCalls, 1)
  assert.deepEqual(owner.snapshot(), {
    state: 'running',
    currentTime: 12.5,
    sampleRate: 48000,
    creationCount: 1,
    resumeAttempts: 1,
    resumeFailures: 0,
    lastReason: 'play-control',
    lastError: ''
  })
})

test('a context that cannot run fails before visual transport starts', async () => {
  const context = mockContext({ resumeState: 'suspended' })
  const owner = createSouraWebAudioContextOwner({ createContext: () => context })

  await assert.rejects(owner.ensureRunning('play-control'), (error) => {
    assert.equal(error.code, 'SOURA_AUDIO_CONTEXT_NOT_RUNNING')
    assert.match(error.message, /could not start browser audio/i)
    return true
  })
  assert.equal(owner.snapshot().resumeFailures, 1)
})

test('a closed context is never silently replaced with a second context', async () => {
  const context = mockContext({ state: 'running' })
  let factoryCalls = 0
  const owner = createSouraWebAudioContextOwner({ createContext: () => { factoryCalls += 1; return context } })
  owner.getContext()
  await owner.close()

  assert.throws(() => owner.getContext(), (error) => error.code === 'SOURA_AUDIO_CONTEXT_CLOSED')
  assert.equal(factoryCalls, 1)
})
