// Kept separate from the Three.js mount so distance behavior is testable in
// both browser and executable runtimes without a renderer.
export const editorFarPlaneForProject = (project = {}) => {
  const animationDistance = (project.animation?.tracks || []).reduce((largest, track) => {
    if (!String(track?.propertyPath || '').startsWith('transform.position.')) return largest
    return Math.max(largest, ...(track.keyframes || []).map((keyframe) => Math.abs(Number(keyframe?.value) || 0)))
  }, 0)
  const extent = (Array.isArray(project.objects) ? project.objects : []).reduce((largest, object) => {
    const position = object?.position || {}
    const dimensions = object?.dimensions || object?.lastKnownBounds || {}
    const scale = object?.scale || {}
    const radius = Math.max(Number(dimensions.width || 1) * Number(scale.x ?? 1), Number(dimensions.depth || 1) * Number(scale.z ?? 1), Number(dimensions.height || 1) * Number(scale.y ?? 1), 1)
    return Math.max(largest, Math.hypot(Number(position.x || 0), Number(position.y || 0), Number(position.z || 0)) + radius)
  }, animationDistance)
  return Math.max(5000, extent * 4 + 2000)
}
