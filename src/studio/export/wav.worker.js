import { encodeWav } from './wavEncoder.js'
self.onmessage = ({ data }) => {
  try {
    const result = encodeWav(data.channels, data.sampleRate, data.depth, data.normalize, data.dither, value => self.postMessage({ progress: value }))
    self.postMessage(result, [result.buffer])
  } catch (error) { self.postMessage({ error: error.message }) }
}
