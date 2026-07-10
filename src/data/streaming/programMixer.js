export const DEFAULT_PROGRAM_SCENES = []

export const DEFAULT_PROGRAM_SOURCES = []

export const PROGRAM_SCENE_TEMPLATES = [
  { templateId: 'blank', name: 'Blank', sourceTypes: [] },
  { templateId: 'audio-only', name: 'Audio Only', sourceTypes: ['browser-microphone', 'now-playing-card'] },
  { templateId: 'camera-fullscreen', name: 'Camera Fullscreen', sourceTypes: ['browser-camera', 'browser-microphone'] },
  { templateId: 'camera-artwork', name: 'Camera + Artwork', sourceTypes: ['browser-camera', 'now-playing-card', 'browser-microphone'] },
  { templateId: 'sequence-visual', name: 'Sequence Audio/Video', sourceTypes: ['sequence-video', 'sequence-audio', 'now-playing-card'] },
  { templateId: 'starting-soon', name: 'Starting Soon', sourceTypes: ['text-lower-third'] },
  { templateId: 'brb', name: 'Be Right Back', sourceTypes: ['text-lower-third'] }
]

export const PROGRAM_SOURCE_TYPES = [
  { type: 'browser-microphone', label: 'Browser Microphone', media: 'audio' },
  { type: 'browser-camera', label: 'Browser Camera', media: 'video' },
  { type: 'sequence-audio', label: 'Sequence Audio', media: 'audio' },
  { type: 'sequence-video', label: 'Sequence Video', media: 'video' },
  { type: 'now-playing-card', label: 'Now Playing Card', media: 'visual' },
  { type: 'image', label: 'Image', media: 'visual' },
  { type: 'text-lower-third', label: 'Text / Lower Third', media: 'visual' },
  { type: 'screen-share', label: 'Screen Share', media: 'video', future: true },
  { type: 'guest-audio', label: 'Invited Guest Audio', media: 'audio' },
  { type: 'guest-video', label: 'Invited Guest Video', media: 'video' }
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
    this.sources = new Map()
    this.activeSceneId = ''
    this.activeScene = null
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
      this.drawProgramFrame(this.activeScene)
      this.animationId = window.requestAnimationFrame(draw)
    }
    draw()
  }

  stopRenderLoop() {
    if (this.animationId) window.cancelAnimationFrame(this.animationId)
    this.animationId = 0
  }

  drawPlaceholder(message = '') {
    if (!this.context) return
    this.context.clearRect(0, 0, this.width, this.height)
    this.context.fillStyle = '#05080f'
    this.context.fillRect(0, 0, this.width, this.height)
    this.context.fillStyle = '#9fb0d0'
    this.context.font = '700 30px system-ui, sans-serif'
    this.context.textAlign = 'center'
    this.context.fillText(message || (this.videoEnabled ? 'No program scene selected' : 'Video output disabled'), this.width / 2, this.height / 2)
  }

  drawProgramFrame(scene = null) {
    if (!this.context) return
    this.context.fillStyle = '#05080f'
    this.context.fillRect(0, 0, this.width, this.height)
    const allowedSourceIds = Array.isArray(scene?.sources) ? new Set(scene.sources) : null
    const activeSources = Array.from(this.sources.values())
      .filter((source) => source.enabled !== false && source.visible !== false && (!allowedSourceIds || allowedSourceIds.has(source.sourceId)))
      .sort((a, b) => Number(a.zIndex || 0) - Number(b.zIndex || 0))
    if (!activeSources.length) {
      this.drawPlaceholder(scene ? 'Scene has no visible sources' : 'No program scene selected')
      return
    }
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
  setScene(sceneId, scene = null) {
    this.activeSceneId = sceneId || this.activeSceneId
    this.activeScene = scene
  }
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
