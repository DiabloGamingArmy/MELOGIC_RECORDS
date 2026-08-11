/*
  Soura Desktop Native Audio Backend
  ==================================
  Thin control-plane bridge to the persistent Rust/CPAL engine.

  IMPORTANT:
  Tauri invoke() is NOT used inside the realtime callback.
  It only configures or interrogates the native engine.
*/

let invokeFn = null

async function getInvoke() {
  if (invokeFn) {
    return invokeFn
  }

  const mod =
    await import(
      '@tauri-apps/api/core'
    )

  invokeFn =
    mod.invoke

  return invokeFn
}

export function isSouraNativeRuntime() {
  return Boolean(
    globalThis.__TAURI_INTERNALS__
    || globalThis.__TAURI__
    || navigator.userAgent.includes('Tauri')
  )
}

export class NativeSouraAudioBackend {
  constructor() {
    this.kind =
      'native'

    this.status =
      null
  }

  async init() {
    const invoke =
      await getInvoke()

    this.status =
      await invoke(
        'native_audio_initialize'
      )

    console.info(
      '[soura-native-audio] initialized',
      this.status
    )

    return this.status
  }

  async getStatus() {
    const invoke =
      await getInvoke()

    this.status =
      await invoke(
        'native_audio_get_status'
      )

    return this.status
  }

  async listOutputDevices() {
    const invoke =
      await getInvoke()

    return invoke(
      'native_audio_list_output_devices'
    )
  }

  async startTestTone({
    frequencyHz = 440,
    gain = 0.06,
  } = {}) {
    const invoke =
      await getInvoke()

    this.status =
      await invoke(
        'native_audio_start_test_tone',
        {
          frequencyHz,
          gain,
        }
      )

    return this.status
  }

  async stopTestTone() {
    const invoke =
      await getInvoke()

    this.status =
      await invoke(
        'native_audio_stop_test_tone'
      )

    return this.status
  }

  async runDspSelfTest({
    semitones = -5,
  } = {}) {
    const invoke =
      await getInvoke()

    const result =
      await invoke(
        'native_audio_dsp_self_test',
        {
          semitones,
        }
      )

    console.info(
      '[soura-native-dsp] self-test',
      result
    )

    return result
  }
}

export default NativeSouraAudioBackend
