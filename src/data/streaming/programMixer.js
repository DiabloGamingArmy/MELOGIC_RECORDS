export const DEFAULT_PROGRAM_SCENES = [
  { sceneId: 'audio-only', name: 'Audio Only', transition: 'fade' },
  { sceneId: 'camera-fullscreen', name: 'Camera Fullscreen', transition: 'cut' },
  { sceneId: 'camera-artwork', name: 'Camera + Artwork', transition: 'fade' },
  { sceneId: 'sequence-visual', name: 'Sequence Visual', transition: 'fade' },
  { sceneId: 'starting-soon', name: 'Starting Soon', transition: 'fade' },
  { sceneId: 'brb', name: 'Be Right Back', transition: 'fade' }
]

export const DEFAULT_PROGRAM_SOURCES = [
  { sourceId: 'browser-mic', type: 'browser-microphone', label: 'Browser Microphone', enabled: true, muted: false, visible: false, programEnabled: true, monitorEnabled: false, gain: 1 },
  { sourceId: 'sequence-audio', type: 'sequence-audio', label: 'Sequence Audio', enabled: true, muted: false, visible: false, programEnabled: true, monitorEnabled: true, gain: 1 },
  { sourceId: 'browser-camera', type: 'browser-camera', label: 'Browser Camera', enabled: false, muted: false, visible: true, zIndex: 1, opacity: 1, objectFit: 'cover' },
  { sourceId: 'sequence-video', type: 'sequence-video', label: 'Sequence Video', enabled: false, muted: false, visible: true, zIndex: 2, opacity: 1, objectFit: 'cover' },
  { sourceId: 'now-playing-card', type: 'now-playing-card', label: 'Now Playing Card', enabled: true, visible: true, zIndex: 3, opacity: 1 }
]

export class ProgramMixer {
  constructor({ width = 1280, height = 720, fps = 30 } = {}) {
    this.width = width
    this.height = height
    this.fps = fps
    this.audioEnabled = true
    this.videoEnabled = false
    this.canvas = null
    this.context = null
    this.captureStream = null
    this.animationId = 0
    this.audioContext = null
    this.programDestination = null
    this.monitorDestination = null
    this.sources = new Map(DEFAULT_PROGRAM_SOURCES.map((source) => [source.sourceId, { ...source }]))
    this.activeSceneId = DEFAULT_PROGRAM_SCENES[0].sceneId
  }

  attachCanvas(canvas) {
    this.canvas = canvas
    this.context = canvas?.getContext?.('2d') || null
    if (this.canvas) {
      this.canvas.width = this.width
      this.canvas.height = this.height
    }
    return this
  }

  startRenderLoop() {
    this.stopRenderLoop()
    if (!this.canvas || !this.context || !this.videoEnabled) {
      this.drawPlaceholder()
      return
    }
    const draw = () => {
      this.drawProgramFrame()
      this.animationId = window.requestAnimationFrame(draw)
    }
    draw()
  }

  stopRenderLoop() {
    if (this.animationId) window.cancelAnimationFrame(this.animationId)
    this.animationId = 0
  }

  drawPlaceholder() {
    if (!this.context) return
    this.context.clearRect(0, 0, this.width, this.height)
    this.context.fillStyle = '#05080f'
    this.context.fillRect(0, 0, this.width, this.height)
    this.context.fillStyle = '#9fb0d0'
    this.context.font = '700 30px system-ui, sans-serif'
    this.context.textAlign = 'center'
    this.context.fillText(this.videoEnabled ? 'Program Preview' : 'Video output disabled', this.width / 2, this.height / 2)
  }

  drawProgramFrame() {
    if (!this.context) return
    this.context.fillStyle = '#05080f'
    this.context.fillRect(0, 0, this.width, this.height)
    const activeSources = Array.from(this.sources.values())
      .filter((source) => source.enabled !== false && source.visible !== false)
      .sort((a, b) => Number(a.zIndex || 0) - Number(b.zIndex || 0))
    activeSources.forEach((source, index) => {
      const x = source.transform?.x ?? 48 + index * 36
      const y = source.transform?.y ?? 48 + index * 30
      const width = source.transform?.width ?? (source.type === 'now-playing-card' ? 430 : this.width - 96)
      const height = source.transform?.height ?? (source.type === 'now-playing-card' ? 160 : this.height - 96)
      this.context.globalAlpha = Number(source.opacity ?? 1)
      this.context.fillStyle = source.type === 'now-playing-card' ? 'rgba(14,20,32,.88)' : 'rgba(22,31,48,.82)'
      this.context.fillRect(x, y, width, height)
      this.context.strokeStyle = source.locked ? 'rgba(159,176,208,.24)' : 'rgba(103,242,170,.55)'
      this.context.lineWidth = 2
      this.context.strokeRect(x, y, width, height)
      this.context.fillStyle = '#eef4ff'
      this.context.font = '700 24px system-ui, sans-serif'
      this.context.textAlign = 'left'
      this.context.fillText(source.label || source.type, x + 22, y + 42)
      this.context.globalAlpha = 1
    })
  }

  getProgramMediaStream() {
    const stream = new MediaStream()
    const audio = this.getAudioTrack()
    const video = this.getVideoTrack()
    if (audio) stream.addTrack(audio)
    if (video) stream.addTrack(video)
    return stream
  }

  getAudioTrack() {
    if (!this.audioEnabled) return null
    if (!this.programDestination && (window.AudioContext || window.webkitAudioContext)) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext
      this.audioContext = this.audioContext || new AudioContextCtor()
      this.programDestination = this.audioContext.createMediaStreamDestination()
    }
    return this.programDestination?.stream?.getAudioTracks?.()[0] || null
  }

  getVideoTrack() {
    if (!this.videoEnabled || !this.canvas?.captureStream) return null
    if (!this.captureStream) this.captureStream = this.canvas.captureStream(this.fps)
    return this.captureStream.getVideoTracks()[0] || null
  }

  enableAudio() { this.audioEnabled = true }
  disableAudio() { this.audioEnabled = false }
  enableVideo() {
    this.videoEnabled = true
    this.startRenderLoop()
  }
  disableVideo() {
    this.videoEnabled = false
    this.captureStream?.getVideoTracks?.().forEach((track) => track.stop())
    this.captureStream = null
    this.stopRenderLoop()
    this.drawPlaceholder()
  }
  setScene(sceneId) { this.activeSceneId = sceneId || this.activeSceneId }
  setSourceTransform(sourceId, transform = {}) {
    const source = this.sources.get(sourceId)
    if (source) this.sources.set(sourceId, { ...source, transform: { ...(source.transform || {}), ...transform } })
  }
  setSourceGain(sourceId, gain = 1) {
    const source = this.sources.get(sourceId)
    if (source) this.sources.set(sourceId, { ...source, gain: Number(gain) })
  }
  destroy() {
    this.disableVideo()
    this.audioContext?.close?.().catch(() => {})
    this.audioContext = null
    this.programDestination = null
    this.monitorDestination = null
  }
}
