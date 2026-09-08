// Runs in a Worker. Float preserves over-range samples; PCM saturates them.
export function encodeWav(channels, sampleRate, depth = 24, normalize = false, dither = false, progress = () => {}) {
  if (![16, 24, 32].includes(depth)) throw new Error('Unsupported WAV bit depth.')
  if (!channels.length || channels.length > 2 || !channels[0].length || channels.some(c => c.length !== channels[0].length)) throw new Error('Invalid PCM channels.')
  if (!Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('Unsupported sample rate.')
  const frames = channels[0].length, bytes = depth / 8, dataSize = frames * channels.length * bytes
  const headerSize = depth === 32 ? 56 : 44
  const padding = dataSize % 2
  if (dataSize + headerSize + padding > 0xffffffff) throw new Error('Export exceeds the WAV 4 GB limit. Choose a shorter range.')
  const result = new ArrayBuffer(headerSize + dataSize + padding), view = new DataView(result)
  const str = (offset, text) => [...text].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)))
  str(0, 'RIFF'); view.setUint32(4, result.byteLength - 8, true); str(8, 'WAVE'); str(12, 'fmt ')
  view.setUint32(16, 16, true); view.setUint16(20, depth === 32 ? 3 : 1, true)
  view.setUint16(22, channels.length, true); view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels.length * bytes, true); view.setUint16(32, channels.length * bytes, true); view.setUint16(34, depth, true)
  if (depth === 32) { str(36, 'fact'); view.setUint32(40, 4, true); view.setUint32(44, frames, true) }
  str(headerSize - 8, 'data'); view.setUint32(headerSize - 4, dataSize, true)
  let peak = 0
  for (const channel of channels) for (const value of channel) {
    if (!Number.isFinite(value)) throw new Error('The mix contains invalid audio samples. Check instruments and inserts.')
    peak = Math.max(peak, Math.abs(value))
  }
  const scale = normalize && peak > 0 ? 10 ** (-1 / 20) / peak : 1
  let offset = headerSize, seed = 0x534f5552
  const random = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296 }
  for (let frame = 0; frame < frames; frame++) {
    if (frame % 65536 === 0) progress(frame / frames)
    for (const channel of channels) {
      let value = channel[frame] * scale
      if (depth === 32) view.setFloat32(offset, value, true)
      else {
        const max = 2 ** (depth - 1)
        if (dither) value += (random() - random()) / max
        const pcm = Math.max(-max, Math.min(max - 1, Math.round(value * max)))
        if (depth === 16) view.setInt16(offset, pcm, true)
        else { view.setUint8(offset, pcm & 255); view.setUint8(offset + 1, (pcm >> 8) & 255); view.setUint8(offset + 2, (pcm >> 16) & 255) }
      }
      offset += bytes
    }
  }
  return { buffer: result, peak, clipped: peak > 1 && !normalize }
}
