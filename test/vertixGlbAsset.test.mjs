import assert from 'node:assert/strict'
import test from 'node:test'
import { validateGlb } from '../src/vertix/assets/glbAsset.js'

function glbFromJson(value) {
  const json = Buffer.from(JSON.stringify(value))
  const paddedLength = Math.ceil(json.length / 4) * 4
  const buffer = Buffer.alloc(20 + paddedLength, 0x20)
  buffer.writeUInt32LE(0x46546c67, 0)
  buffer.writeUInt32LE(2, 4)
  buffer.writeUInt32LE(buffer.length, 8)
  buffer.writeUInt32LE(paddedLength, 12)
  buffer.writeUInt32LE(0x4e4f534a, 16)
  json.copy(buffer, 20)
  return buffer
}

test('GLB validation checks binary identity and computes trustworthy render statistics', () => {
  const valid = validateGlb(glbFromJson({ asset: { version: '2.0' }, accessors: [{ count: 6, min: [-1, -1, -1], max: [1, 1, 1] }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], nodes: [{}], materials: [{}] }))
  assert.equal(valid.valid, true)
  assert.equal(valid.technicalMetadata.vertices, 6)
  assert.equal(valid.technicalMetadata.triangles, 2)
  assert.deepEqual(valid.technicalMetadata.bounds, { min: [-1, -1, -1], max: [1, 1, 1] })
  assert.equal(validateGlb(Buffer.from('not a glb')).valid, false)
})

test('external GLB resources are rejected instead of creating broken library assets', () => {
  const invalid = validateGlb(glbFromJson({ asset: { version: '2.0' }, buffers: [{ uri: 'mesh.bin' }] }))
  assert.equal(invalid.valid, false)
  assert.ok(invalid.errors.some((error) => error.code === 'glb.external-resource'))
})
