export const DEFAULT_ANIMATION = { frameRate: 30, startFrame: 1, endFrame: 250, tracks: [] }

export const ANIMATABLE_PATHS = {
  x: 'transform.position.x', y: 'transform.position.y', z: 'transform.position.z',
  rotX: 'transform.rotation.x', rotY: 'transform.rotation.y', rotZ: 'transform.rotation.z',
  scaleX: 'transform.scale.x', scaleY: 'transform.scale.y', scaleZ: 'transform.scale.z'
}

const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback
const clampFrame = (value, fallback = 1) => Math.max(0, Math.round(number(value, fallback)))
const keyId = (targetObjectId, propertyPath) => `${targetObjectId}:${propertyPath}`

export function normalizeProjectAnimation(raw = {}) {
  const startFrame = clampFrame(raw.startFrame, DEFAULT_ANIMATION.startFrame)
  const endFrame = Math.max(startFrame, clampFrame(raw.endFrame, DEFAULT_ANIMATION.endFrame))
  const frameRate = [24, 25, 30, 50, 60].includes(Number(raw.frameRate)) ? Number(raw.frameRate) : DEFAULT_ANIMATION.frameRate
  const tracks = Array.isArray(raw.tracks) ? raw.tracks.map((track) => {
    const targetObjectId = String(track?.targetObjectId || '')
    const propertyPath = String(track?.propertyPath || '')
    if (!targetObjectId || !Object.values(ANIMATABLE_PATHS).includes(propertyPath)) return null
    const keyframes = Array.isArray(track.keyframes) ? track.keyframes
      .map((keyframe) => ({ ...keyframe, frame: clampFrame(keyframe.frame), value: number(keyframe.value), interpolation: keyframe.interpolation === 'step' ? 'step' : 'linear' }))
      .sort((a, b) => a.frame - b.frame)
      .filter((keyframe, index, list) => index === list.length - 1 || keyframe.frame !== list[index + 1].frame)
      : []
    return { ...track, id: String(track.id || keyId(targetObjectId, propertyPath)), targetObjectId, propertyPath, keyframes }
  }).filter(Boolean) : []
  return { ...raw, frameRate, startFrame, endFrame, tracks }
}

export function valueAtFrame(keyframes = [], frame) {
  if (!keyframes.length) return undefined
  const sorted = [...keyframes].sort((a, b) => a.frame - b.frame)
  if (frame <= sorted[0].frame) return sorted[0].value
  const last = sorted[sorted.length - 1]
  if (frame >= last.frame) return last.value
  const nextIndex = sorted.findIndex((keyframe) => keyframe.frame >= frame)
  const next = sorted[nextIndex]
  const previous = sorted[nextIndex - 1]
  if (next.frame === frame || previous.interpolation === 'step') return previous.interpolation === 'step' && next.frame !== frame ? previous.value : next.value
  const t = (frame - previous.frame) / (next.frame - previous.frame)
  return previous.value + (next.value - previous.value) * t
}

export function evaluateProjectAnimation(project = {}, frame = 1) {
  const animation = normalizeProjectAnimation(project.animation || {})
  const values = {}
  animation.tracks.forEach((track) => {
    const value = valueAtFrame(track.keyframes, frame)
    if (value === undefined) return
    const target = values[track.targetObjectId] || (values[track.targetObjectId] = {})
    const field = Object.entries(ANIMATABLE_PATHS).find(([, path]) => path === track.propertyPath)?.[0]
    if (field) target[field] = value
  })
  return values
}

export function upsertAnimationKeyframe(animationInput, targetObjectId, propertyPath, frame, value, interpolation = 'linear') {
  const animation = normalizeProjectAnimation(animationInput)
  const id = keyId(targetObjectId, propertyPath)
  const existing = animation.tracks.find((track) => track.id === id)
  const keyframe = { frame: clampFrame(frame), value: number(value), interpolation: interpolation === 'step' ? 'step' : 'linear' }
  if (existing) {
    const keyframes = [...existing.keyframes.filter((item) => item.frame !== keyframe.frame), keyframe].sort((a, b) => a.frame - b.frame)
    return { ...animation, tracks: animation.tracks.map((track) => track.id === id ? { ...track, keyframes } : track) }
  }
  return { ...animation, tracks: [...animation.tracks, { id, targetObjectId, propertyPath, keyframes: [keyframe] }] }
}

export function removeAnimationKeyframe(animationInput, trackId, frame) {
  const animation = normalizeProjectAnimation(animationInput)
  return { ...animation, tracks: animation.tracks.map((track) => track.id === trackId ? { ...track, keyframes: track.keyframes.filter((keyframe) => keyframe.frame !== frame) } : track).filter((track) => track.keyframes.length) }
}

/** Moves one key while retaining its value/interpolation and replacing a same-frame key deterministically. */
export function moveAnimationKeyframe(animationInput, trackId, fromFrame, toFrame) {
  const animation = normalizeProjectAnimation(animationInput)
  const sourceFrame = clampFrame(fromFrame)
  const destinationFrame = clampFrame(toFrame)
  const track = animation.tracks.find((candidate) => candidate.id === trackId)
  const keyframe = track?.keyframes.find((candidate) => candidate.frame === sourceFrame)
  if (!track || !keyframe || sourceFrame === destinationFrame) return animation
  const moved = { ...keyframe, frame: destinationFrame }
  return {
    ...animation,
    tracks: animation.tracks.map((candidate) => candidate.id === trackId
      ? { ...candidate, keyframes: [...candidate.keyframes.filter((item) => item.frame !== sourceFrame && item.frame !== destinationFrame), moved].sort((a, b) => a.frame - b.frame) }
      : candidate)
  }
}

export function retargetAnimationTracks(animationInput, fromObjectId, toObjectId) {
  const animation = normalizeProjectAnimation(animationInput)
  const copies = animation.tracks.filter((track) => track.targetObjectId === fromObjectId).map((track) => ({ ...track, id: keyId(toObjectId, track.propertyPath), targetObjectId: toObjectId, keyframes: track.keyframes.map((keyframe) => ({ ...keyframe })) }))
  return { ...animation, tracks: [...animation.tracks, ...copies] }
}
