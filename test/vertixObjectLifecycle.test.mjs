import assert from 'node:assert/strict'
import test from 'node:test'
import { applyProjectObjectDeletion, createProjectObjectDeletion, selectionForProjectObjectDeletion } from '../src/stage/projectObjectLifecycle.js'
import { normalizeStagePlan } from '../src/stage/stagePlanModel.js'
import { buildSceneOutliner } from '../src/stage/outliner/sceneOutliner.js'

function projectFixture() {
  return {
    id: 'lifecycle-project',
    objects: [
      { id: 'stage-deck', label: 'Stage Deck', protected: true },
      { id: 'original-object', label: 'Shared Asset', assetReference: { packageId: '@test/pack', packageVersion: '1.0.0', assetUuid: 'source-a', integrity: 'sha256-test' } },
      { id: 'duplicate-object', label: 'Shared Asset Copy', parentId: 'stage-deck', metadata: { local: true } }
    ],
    audioInputs: [{ id: 'in-duplicate', linkedObjectId: 'duplicate-object' }],
    fixtures: [{ id: 'fx-duplicate', linkedObjectId: 'duplicate-object' }],
    rigging: [],
    video: [{ id: 'vid-original', linkedObjectId: 'original-object' }],
    power: [{ id: 'pwr-duplicate', linkedObjectId: 'duplicate-object' }],
    animation: {
      fps: 30,
      tracks: [
        { id: 'duplicate-object:transform.position.x', targetObjectId: 'duplicate-object', propertyPath: 'transform.position.x', keyframes: [{ frame: 1, value: 2 }] },
        { id: 'original-object:transform.position.x', targetObjectId: 'original-object', propertyPath: 'transform.position.x', keyframes: [{ frame: 1, value: 4 }] }
      ]
    }
  }
}

test('authoritative object deletion removes every project representation in one transaction', () => {
  const original = projectFixture()
  const operation = createProjectObjectDeletion(original, ['duplicate-object'], {
    selectedObjectIds: ['duplicate-object'],
    primaryObjectId: 'duplicate-object'
  })

  assert.ok(operation)
  assert.deepEqual(operation.project.objects.map((object) => object.id), ['stage-deck', 'original-object'])
  assert.equal(buildSceneOutliner(operation.project.objects).flatMap((node) => [node.id, ...node.children.map((child) => child.id)]).includes('duplicate-object'), false)
  assert.equal(operation.project.audioInputs.length, 0)
  assert.equal(operation.project.fixtures.length, 0)
  assert.equal(operation.project.power.length, 0)
  assert.deepEqual(operation.project.animation.tracks.map((track) => track.targetObjectId), ['original-object'])
  assert.deepEqual(selectionForProjectObjectDeletion(operation.project, operation.command, 'after'), { selectedObjectIds: [], primaryObjectId: '' })

  const reloaded = normalizeStagePlan(JSON.parse(JSON.stringify(operation.project)))
  assert.equal(reloaded.objects.some((object) => object.id === 'duplicate-object'), false)
})

test('undo restores the exact UUID, relationships, and animation; redo remains duplicate-free', () => {
  const operation = createProjectObjectDeletion(projectFixture(), ['duplicate-object'], {
    selectedObjectIds: ['duplicate-object'],
    primaryObjectId: 'duplicate-object'
  })
  const undone = applyProjectObjectDeletion(operation.project, operation.command, 'before')
  const redone = applyProjectObjectDeletion(undone, operation.command, 'after')
  const restoredAgain = applyProjectObjectDeletion(redone, operation.command, 'before')

  assert.equal(undone.objects.filter((object) => object.id === 'duplicate-object').length, 1)
  assert.equal(undone.objects.find((object) => object.id === 'duplicate-object').metadata.local, true)
  assert.equal(undone.audioInputs[0].linkedObjectId, 'duplicate-object')
  assert.equal(undone.animation.tracks.some((track) => track.targetObjectId === 'duplicate-object'), true)
  assert.deepEqual(selectionForProjectObjectDeletion(undone, operation.command, 'before'), { selectedObjectIds: ['duplicate-object'], primaryObjectId: 'duplicate-object' })
  assert.equal(redone.objects.some((object) => object.id === 'duplicate-object'), false)
  assert.equal(redone.animation.tracks.some((track) => track.targetObjectId === 'duplicate-object'), false)
  assert.equal(restoredAgain.objects.filter((object) => object.id === 'duplicate-object').length, 1)
})

test('protected objects retain the existing non-deletable policy', () => {
  assert.equal(createProjectObjectDeletion(projectFixture(), ['stage-deck']), null)
})
