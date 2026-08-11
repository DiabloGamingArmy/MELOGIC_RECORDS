/*
  Optional developer diagnostic for Soura Desktop.

  In the Tauri Web Inspector console:

    const d = await import('/src/studio/audio/native/nativeAudioDiagnostic.js')
    await d.runNativeAudioDiagnostic()

  You should hear a short 440 Hz tone and receive native CPAL +
  Signalsmith benchmark data.
*/

import {
  NativeSouraAudioBackend,
  isSouraNativeRuntime
} from './NativeSouraAudioBackend.js'

const wait =
  (ms) =>
    new Promise(
      (resolve) =>
        setTimeout(resolve, ms)
    )

export async function runNativeAudioDiagnostic() {
  if (!isSouraNativeRuntime()) {
    throw new Error(
      'Native Soura audio diagnostics only run inside the Nexus/Tauri application.'
    )
  }

  const backend =
    new NativeSouraAudioBackend()

  const status =
    await backend.init()

  const devices =
    await backend.listOutputDevices()

  await backend.startTestTone({
    frequencyHz: 440,
    gain: 0.04,
  })

  await wait(700)

  await backend.stopTestTone()

  const dsp =
    await backend.runDspSelfTest({
      semitones: -5,
    })

  const result = {
    status,
    devices,
    dsp,
  }

  console.table(
    devices.map(
      (device) => ({
        name: device.name,
        default: device.isDefault,
        maxChannels: device.maxChannels,
        sampleRate:
          `${device.minSampleRate}-${device.maxSampleRate}`,
        bufferSize: device.bufferSize,
      })
    )
  )

  console.info(
    '[soura-native-audio] diagnostic complete',
    result
  )

  return result
}
