export class SouraPerformanceDiagnostics {
  constructor({ enabled = false, sampleLimit = 600 } = {}) {
    this.enabled = Boolean(enabled)
    this.sampleLimit = Math.max(60, Number(sampleLimit) || 600)
    this.frameDeltas = []
    this.lastFrameAt = null
    this.counters = {
      transportStarts: 0,
      transportRestarts: 0,
      metronomeBeatsScheduled: 0,
      viewportChanges: 0,
      viewportChangesDuringPlayback: 0,
      schedulerPasses: 0
    }
    this.transportReasons = {}
  }

  recordFrame(frameTime) {
    if (!this.enabled) return
    if (Number.isFinite(this.lastFrameAt)) {
      this.frameDeltas.push(Math.max(0, frameTime - this.lastFrameAt))
      if (this.frameDeltas.length > this.sampleLimit) this.frameDeltas.shift()
    }
    this.lastFrameAt = frameTime
  }

  recordTransportStart(reason = 'unknown') {
    if (!this.enabled) return
    this.counters.transportStarts += 1
    if (reason !== 'play') this.counters.transportRestarts += 1
    this.transportReasons[reason] = (this.transportReasons[reason] || 0) + 1
  }

  recordMetronomeBeats(count = 1) { if (this.enabled) this.counters.metronomeBeatsScheduled += Math.max(0, Number(count) || 0) }
  recordViewportChange(playing = false) {
    if (!this.enabled) return
    this.counters.viewportChanges += 1
    if (playing) this.counters.viewportChangesDuringPlayback += 1
  }
  recordSchedulerPass() { if (this.enabled) this.counters.schedulerPasses += 1 }

  snapshot() {
    const sorted = [...this.frameDeltas].sort((a, b) => a - b)
    const average = sorted.length ? sorted.reduce((sum, value) => sum + value, 0) / sorted.length : 0
    const percentile = sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : 0
    return Object.freeze({
      enabled: this.enabled,
      frames: sorted.length,
      frameMs: { average, p95: percentile, max: sorted.at(-1) || 0, over50ms: sorted.filter((value) => value > 50).length },
      counters: { ...this.counters },
      transportReasons: { ...this.transportReasons }
    })
  }
}

export function createSouraPerformanceDiagnostics(options = {}) {
  return new SouraPerformanceDiagnostics(options)
}

