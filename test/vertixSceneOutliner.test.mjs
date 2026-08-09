import assert from 'node:assert/strict'
import test from 'node:test'
import { buildSceneOutliner, filterSceneOutliner, sceneObjectIcon } from '../src/stage/outliner/sceneOutliner.js'

test('scene outliner uses project objects as tree node sources and keeps unresolved parents at root', () => {
  const deck = { id: 'deck', label: 'Stage Deck', type: 'Base Stage' }
  const fixture = { id: 'fixture', label: 'Key Fixture', category: 'lighting', parentId: 'deck' }
  const orphan = { id: 'orphan', label: 'Unresolved Parent', parentId: 'not-in-project' }
  const tree = buildSceneOutliner([deck, fixture, orphan])
  assert.deepEqual(tree.map((node) => node.id), ['deck', 'orphan'])
  assert.strictEqual(tree[0].object, deck)
  assert.strictEqual(tree[0].children[0].object, fixture)
})

test('scene outliner filtering retains a parent needed to reach a matching child', () => {
  const tree = buildSceneOutliner([
    { id: 'deck', label: 'Stage Deck' },
    { id: 'fixture', label: 'Front Wash', type: 'Lighting', parentId: 'deck' },
    { id: 'speaker', label: 'Speaker Left', type: 'Audio' }
  ])
  const filtered = filterSceneOutliner(tree, 'wash')
  assert.deepEqual(filtered.map((node) => node.id), ['deck'])
  assert.deepEqual(filtered[0].children.map((node) => node.id), ['fixture'])
  assert.equal(sceneObjectIcon({ type: 'Lighting' }), '◉')
})
