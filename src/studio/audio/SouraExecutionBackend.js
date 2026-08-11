import StudioAudioEngine from './StudioAudioEngine.js'

import {
  isSouraNativeRuntime,
  NativeSouraAudioBackend
} from './native/NativeSouraAudioBackend.js'

let backend = null

export async function initializeSouraExecutionBackend() {
  if (backend) {
    return backend
  }

  if (isSouraNativeRuntime()) {
    const native =
      new NativeSouraAudioBackend()

    await native.init()

    backend =
      native

    return backend
  }

  const web =
    new StudioAudioEngine()

  await web.init()

  backend =
    web

  return backend
}

export function getSouraExecutionBackend() {
  return backend
}

export function getSouraExecutionMode() {
  return isSouraNativeRuntime()
    ? 'native'
    : 'web'
}
