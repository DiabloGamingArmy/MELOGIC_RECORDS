self.onrtctransform = (event) => {
  const transformer = event.transformer
  const intervalMs = Math.max(1000, Number(transformer.options?.keyFrameIntervalMs || 2000))

  // Keep the encoded stream byte-for-byte intact while gaining access to the
  // browser encoder's standards-based key-frame request method.
  transformer.readable.pipeTo(transformer.writable).catch(() => {})

  const request = () => {
    if (typeof transformer.generateKeyFrame !== 'function') return
    transformer.generateKeyFrame().catch(() => {})
  }
  request()
  self.setInterval(request, intervalMs)
}
