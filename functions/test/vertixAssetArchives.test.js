'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { deriveVertixProductFields, inspectVertixArchive, safePath } = require('../src/products/vertixAssetArchives')

function glb() {
  const json = Buffer.from(JSON.stringify({ asset: { version: '2.0' } }))
  const padded = Math.ceil(json.length / 4) * 4
  const out = Buffer.alloc(20 + padded, 0x20)
  out.writeUInt32LE(0x46546c67, 0); out.writeUInt32LE(2, 4); out.writeUInt32LE(out.length, 8)
  out.writeUInt32LE(padded, 12); out.writeUInt32LE(0x4e4f534a, 16); json.copy(out, 20)
  return out
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function storedZip(name, bytes) {
  const nameBytes = Buffer.from(name)
  const checksum = crc32(bytes)
  const local = Buffer.alloc(30 + nameBytes.length)
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(nameBytes.length, 26); nameBytes.copy(local, 30)
  const central = Buffer.alloc(46 + nameBytes.length)
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(checksum, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(nameBytes.length, 28); nameBytes.copy(central, 46)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length + bytes.length, 16)
  return Buffer.concat([local, bytes, central, end])
}

test('backend archive inspection validates GLB bytes and preserves nested paths', () => {
  const result = inspectVertixArchive(storedZip('Truss/Straight/1m.glb', glb()))
  assert.equal(result.compatible, true)
  assert.equal(result.compatibleAssetCount, 1)
  assert.deepEqual(result.assetPaths, ['Truss/Straight/1m.glb'])
})

test('backend rejects ZIP entries whose checksum does not match their bytes', () => {
  const archive = storedZip('Models/cube.glb', glb())
  archive[archive.indexOf(Buffer.from('{'))] ^= 1
  const result = inspectVertixArchive(archive)
  assert.equal(result.compatible, false)
  assert.match(result.errors[0], /checksum mismatch/i)
})

test('backend rejects traversal and derives public capability only from opt-in files', () => {
  assert.equal(safePath('../escape.glb'), false)
  const validation = inspectVertixArchive(storedZip('../escape.glb', glb()))
  assert.equal(validation.compatible, false)
  const fields = deriveVertixProductFields([{ id: 'a', name: 'a.zip', isVertixAsset: false, vertixAssetValidation: { status: 'compatible', compatible: true, compatibleAssetCount: 1 } }, { id: 'b', name: 'b.zip', isVertixAsset: true, vertixAssetValidation: { status: 'compatible', compatible: true, compatibleAssetCount: 2 } }])
  assert.equal(fields.containsVertixAssets, true)
  assert.equal(fields.hasVertixAssets, true)
  assert.deepEqual(fields.vertixAssetFileIds, ['b'])
})
