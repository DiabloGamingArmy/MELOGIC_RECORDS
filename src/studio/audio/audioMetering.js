export const DEFAULT_METER_CONFIG = Object.freeze({ floorDb: -60, clipAmplitude: 0.999, attack: 0.72, release: 0.1, peakRelease: 0.025, peakHoldMs: 650, silenceThreshold: 1e-5 })

export function measureTimeDomainSamples(samples = []) {
  let sum = 0
  let peak = 0
  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.abs(Number(samples[index]) || 0)
    sum += sample * sample
    if (sample > peak) peak = sample
  }
  return { peak, rms: Math.sqrt(sum / Math.max(1, samples.length)) }
}

export function amplitudeToDb(amplitude = 0, floorDb = -60) {
  const safe = Math.max(0, Number(amplitude) || 0)
  return safe > 0 ? Math.max(floorDb, 20 * Math.log10(safe)) : floorDb
}

export function dbToMeterLevel(db = -60, floorDb = -60) {
  return Math.max(0, Math.min(1, (Number(db) - floorDb) / Math.max(1, -floorDb)))
}

export function updateMeterBallistics(previous = {}, measurement = {}, now = 0, config = DEFAULT_METER_CONFIG) {
  const peakAmplitude = Number(measurement.peak) || 0
  const rmsAmplitude = Number(measurement.rms) || 0
  const amplitude = Math.max(rmsAmplitude, peakAmplitude * 0.72)
  const target = amplitude < config.silenceThreshold ? 0 : dbToMeterLevel(amplitudeToDb(amplitude, config.floorDb), config.floorDb)
  const priorLevel = Number(previous.level) || 0
  const level = priorLevel + (target - priorLevel) * (target > priorLevel ? config.attack : config.release)
  const measuredPeak = dbToMeterLevel(amplitudeToDb(peakAmplitude, config.floorDb), config.floorDb)
  const holdUntil = measuredPeak >= (Number(previous.peakLevel) || 0) ? now + config.peakHoldMs : Number(previous.peakHoldUntil) || 0
  const peakLevel = measuredPeak >= (Number(previous.peakLevel) || 0)
    ? measuredPeak
    : now < holdUntil ? Number(previous.peakLevel) || 0 : Math.max(level, (Number(previous.peakLevel) || 0) - config.peakRelease)
  return {
    level: level < 0.001 ? 0 : Math.max(0, Math.min(1, level)),
    peakLevel: Math.max(0, Math.min(1, peakLevel)),
    peakHoldUntil: holdUntil,
    clipped: previous.clipped === true || peakAmplitude >= config.clipAmplitude,
    peakAmplitude,
    rmsAmplitude,
    db: amplitudeToDb(amplitude, config.floorDb)
  }
}

