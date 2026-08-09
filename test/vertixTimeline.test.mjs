import assert from 'node:assert/strict'
import test from 'node:test'
import { moveAnimationKeyframe, normalizeProjectAnimation, SUPPORTED_FRAME_RATES } from '../src/stage/animation/animationModel.js'
import { buildTimelineTrackHierarchy, loopedTimelineFrame, normalizeTimelineLoopRange, snapTimelineFrame, timelineFrameAtOffset, timelineFrameFromPointer, timelineGridStep, timelinePixelsPerFrame, timelineRulerStep, timelineTimeLabel } from '../src/stage/animation/timelineModel.js'
import { editorFarPlaneForProject } from '../src/stage/viewportVisibilityModel.js'

const animation = normalizeProjectAnimation({
  startFrame: 10,
  endFrame: 800,
  frameRate: 60,
  tracks: [{
    id: 'far-object:transform.position.x',
    targetObjectId: 'far-object',
    propertyPath: 'transform.position.x',
    keyframes: [{ frame: 10, value: 0 }, { frame: 80, value: 12, interpolation: 'step' }]
  }]
})

test('timeline pointer mapping honors zoom, bounds, and horizontal canvas offsets', () => {
  assert.equal(timelinePixelsPerFrame(4), 32)
  assert.equal(timelineFrameAtOffset(-100, animation), 10)
  assert.equal(timelineFrameAtOffset(999999, animation), 800)
  assert.equal(timelineFrameFromPointer({ clientX: 490, canvasLeft: 100, scrollLeft: 200, trackWidth: 210, animation, zoom: 1 }), 58)
  assert.ok(timelineRulerStep({ ...animation, zoom: 0.5 }) > timelineRulerStep({ ...animation, zoom: 4 }))
})

test('timeline grid, snapping, and time display keep frames authoritative', () => {
  assert.equal(timelineGridStep({ ...animation, zoom: 1, gridInterval: 5 }), 5)
  assert.equal(snapTimelineFrame(18, { ...animation, enabled: true, interval: 5 }), 20)
  assert.equal(snapTimelineFrame(18, { ...animation, enabled: false, interval: 5 }), 18)
  assert.equal(snapTimelineFrame(-10, { ...animation, enabled: true, interval: 5 }), animation.startFrame)
  assert.equal(timelineTimeLabel(120, 30), '00:00:04.000')
  assert.equal(timelineTimeLabel(24, 23.976), '00:00:01.001')
})

test('loop range remains independent from the project range and wraps deterministically', () => {
  assert.deepEqual(normalizeTimelineLoopRange({ startFrame: 30, endFrame: 80 }, animation), { startFrame: 30, endFrame: 80 })
  assert.deepEqual(normalizeTimelineLoopRange({ startFrame: -10, endFrame: 900 }, animation), { startFrame: 10, endFrame: 800 })
  assert.equal(loopedTimelineFrame(81, { startFrame: 30, endFrame: 80 }, animation), 30)
  assert.equal(loopedTimelineFrame(82, { startFrame: 30, endFrame: 80 }, animation), 31)
})

test('project animation accepts production frame-rate presets without retiming frames', () => {
  for (const frameRate of [23.976, 24, 25, 29.97, 30, 50, 59.94, 60]) {
    const normalized = normalizeProjectAnimation({ ...animation, frameRate })
    assert.equal(normalized.frameRate, frameRate)
    assert.deepEqual(normalized.tracks[0].keyframes.map((keyframe) => keyframe.frame), [10, 80])
  }
  assert.deepEqual(SUPPORTED_FRAME_RATES, [23.976, 24, 25, 29.97, 30, 50, 59.94, 60])
})

test('track hierarchy keeps UUID targeting and project-owned labels, including missing-source objects', () => {
  const hierarchy = buildTimelineTrackHierarchy(animation, [{ id: 'far-object', label: 'Relink Pending Object', assetReference: { packageId: '@test/pack' } }])
  assert.equal(hierarchy.length, 1)
  assert.equal(hierarchy[0].objectId, 'far-object')
  assert.equal(hierarchy[0].label, 'Relink Pending Object')
  assert.equal(hierarchy[0].tracks[0].label, 'Position X')
})

test('keyframe movement is one deterministic property-track mutation', () => {
  const moved = moveAnimationKeyframe(animation, 'far-object:transform.position.x', 80, 120)
  const keyframes = moved.tracks[0].keyframes
  assert.deepEqual(keyframes.map((keyframe) => keyframe.frame), [10, 120])
  assert.equal(keyframes[1].value, 12)
  assert.equal(keyframes[1].interpolation, 'step')

  const conflict = moveAnimationKeyframe(moved, 'far-object:transform.position.x', 120, 10)
  assert.deepEqual(conflict.tracks[0].keyframes.map((keyframe) => keyframe.frame), [10])
  assert.equal(conflict.tracks[0].keyframes[0].value, 12)
})

test('editor camera far plane grows with meaningful scene extents without using infinity', () => {
  assert.equal(editorFarPlaneForProject({ objects: [] }), 5000)
  const far = editorFarPlaneForProject({ objects: [{ position: { x: 100000, y: 0, z: 0 }, dimensions: { width: 50, depth: 50, height: 50 } }] })
  assert.ok(far > 100000)
  assert.equal(Number.isFinite(far), true)
  assert.ok(editorFarPlaneForProject({ animation: { tracks: [{ propertyPath: 'transform.position.z', keyframes: [{ frame: 80, value: 75000 }] }] } }) > 75000)
})
