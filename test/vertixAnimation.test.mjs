import assert from 'node:assert/strict'
import test from 'node:test'
import { evaluateProjectAnimation, normalizeProjectAnimation, removeAnimationKeyframe, retargetAnimationTracks, upsertAnimationKeyframe, valueAtFrame } from '../src/stage/animation/animationModel.js'
import { normalizeStagePlan } from '../src/stage/stagePlanModel.js'

test('animation keyframes replace the same object/path/frame and evaluate linearly', () => {
  let animation = upsertAnimationKeyframe({}, 'project-object-a', 'transform.position.x', 1, 0)
  animation = upsertAnimationKeyframe(animation, 'project-object-a', 'transform.position.x', 61, 10)
  animation = upsertAnimationKeyframe(animation, 'project-object-a', 'transform.position.x', 61, 12)
  assert.equal(animation.tracks[0].keyframes.length, 2)
  assert.equal(valueAtFrame(animation.tracks[0].keyframes, 31), 6)
  assert.equal(evaluateProjectAnimation({ animation }, 31)['project-object-a'].x, 6)
})

test('step interpolation, track retargeting, and removal retain stable project object ids', () => {
  let animation = upsertAnimationKeyframe({}, 'project-object-a', 'transform.rotation.z', 1, 0, 'step')
  animation = upsertAnimationKeyframe(animation, 'project-object-a', 'transform.rotation.z', 20, 90)
  assert.equal(valueAtFrame(animation.tracks[0].keyframes, 10), 0)
  animation = retargetAnimationTracks(animation, 'project-object-a', 'project-object-b')
  assert.equal(animation.tracks[1].targetObjectId, 'project-object-b')
  assert.equal(removeAnimationKeyframe(animation, animation.tracks[0].id, 1).tracks[0].keyframes.length, 1)
})

test('existing projects gain a compatible empty animation model and preserve future animation fields', () => {
  const project = normalizeStagePlan({ id: 'legacy-project', objects: [{ id: 'project-object-a', label: 'Renamed object' }] })
  assert.deepEqual(project.animation.tracks, [])
  const animation = normalizeProjectAnimation({ frameRate: 24, customFutureField: { kept: true }, tracks: [{ targetObjectId: 'project-object-a', propertyPath: 'transform.scale.x', keyframes: [{ frame: 4, value: 1.5 }] }] })
  assert.equal(animation.customFutureField.kept, true)
  assert.equal(evaluateProjectAnimation({ animation }, 4)['project-object-a'].scaleX, 1.5)
})
