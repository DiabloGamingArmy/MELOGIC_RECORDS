const AUDIO_CONTEXT_START_ERROR = 'Soura could not start browser audio. Check the browser audio permission/output device, then press Play again.'

function contextState(context) {
  return String(context?.state || 'uninitialized')
}

export function createSouraWebAudioContextOwner({ createContext, onStateChange = null } = {}) {
  if (typeof createContext !== 'function') throw new TypeError('createContext is required.')

  let context = null
  let creationCount = 0
  let resumeAttempts = 0
  let resumeFailures = 0
  let lastReason = 'uninitialized'
  let lastError = ''

  const snapshot = () => ({
    state: contextState(context),
    currentTime: Number(context?.currentTime) || 0,
    sampleRate: Number(context?.sampleRate) || 0,
    creationCount,
    resumeAttempts,
    resumeFailures,
    lastReason,
    lastError
  })

  const publish = () => {
    try { onStateChange?.(snapshot()) } catch {}
  }

  const getContext = () => {
    if (context?.state === 'closed') {
      const error = new Error('Soura browser audio was closed. Reload the project to restore audio output.')
      error.code = 'SOURA_AUDIO_CONTEXT_CLOSED'
      throw error
    }
    if (!context) {
      context = createContext()
      creationCount += 1
      lastReason = 'created'
      context?.addEventListener?.('statechange', publish)
      publish()
    }
    return context
  }

  const ensureRunning = async (reason = 'playback') => {
    const current = getContext()
    lastReason = String(reason || 'playback')
    lastError = ''
    if (current.state === 'suspended' || current.state === 'interrupted') {
      resumeAttempts += 1
      try {
        await current.resume()
      } catch (cause) {
        resumeFailures += 1
        lastError = cause?.message || AUDIO_CONTEXT_START_ERROR
        publish()
        const error = new Error(AUDIO_CONTEXT_START_ERROR, { cause })
        error.code = 'SOURA_AUDIO_CONTEXT_RESUME_FAILED'
        throw error
      }
    }
    if (current.state !== 'running') {
      resumeFailures += 1
      lastError = `AudioContext remained ${contextState(current)}.`
      publish()
      const error = new Error(AUDIO_CONTEXT_START_ERROR)
      error.code = 'SOURA_AUDIO_CONTEXT_NOT_RUNNING'
      throw error
    }
    publish()
    return current
  }

  const close = async () => {
    if (!context) return
    lastReason = 'cleanup'
    if (context.state !== 'closed') await context.close?.()
    publish()
  }

  return Object.freeze({ getContext, ensureRunning, snapshot, close })
}

export { AUDIO_CONTEXT_START_ERROR }
