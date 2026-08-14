'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { deriveSouraProductFields, inspectSouraArchive, safePath, souraEntitlementAllows } = require('../src/products/souraAssetArchives')

function wav() {
  const bytes = Buffer.alloc(44)
  bytes.write('RIFF', 0); bytes.writeUInt32LE(36, 4); bytes.write('WAVE', 8); bytes.write('fmt ', 12); bytes.writeUInt32LE(16, 16); bytes.writeUInt16LE(1, 20); bytes.writeUInt16LE(1, 22); bytes.writeUInt32LE(44100, 24); bytes.writeUInt32LE(88200, 28); bytes.writeUInt16LE(2, 32); bytes.writeUInt16LE(16, 34); bytes.write('data', 36)
  return bytes
}

function crc32(bytes) {
  let crc = 0xffffffff
  for (const byte of bytes) { crc ^= byte; for (let bit = 0; bit < 8; bit += 1) crc = (crc & 1) ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1 }
  return (crc ^ 0xffffffff) >>> 0
}

function storedZip(name, bytes) {
  const nameBytes = Buffer.from(name); const checksum = crc32(bytes)
  const local = Buffer.alloc(30 + nameBytes.length); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt32LE(checksum, 14); local.writeUInt32LE(bytes.length, 18); local.writeUInt32LE(bytes.length, 22); local.writeUInt16LE(nameBytes.length, 26); nameBytes.copy(local, 30)
  const central = Buffer.alloc(46 + nameBytes.length); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt32LE(checksum, 16); central.writeUInt32LE(bytes.length, 20); central.writeUInt32LE(bytes.length, 24); central.writeUInt16LE(nameBytes.length, 28); nameBytes.copy(central, 46)
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(1, 8); end.writeUInt16LE(1, 10); end.writeUInt32LE(central.length, 12); end.writeUInt32LE(local.length + bytes.length, 16)
  return Buffer.concat([local, bytes, central, end])
}

test('authoritative inspection validates audio bytes and preserves hierarchy', () => {
  const result = inspectSouraArchive(storedZip('Drums/Kicks/one.wav', wav()))
  assert.equal(result.compatible, true)
  assert.deepEqual(result.assetPaths, ['Drums/Kicks/one.wav'])
})

test('unsafe paths, invalid audio, and archive limits fail closed', () => {
  assert.equal(safePath('../escape.wav'), false)
  assert.equal(inspectSouraArchive(storedZip('../escape.wav', wav())).compatible, false)
  assert.equal(inspectSouraArchive(storedZip('fake.wav', Buffer.from('not audio'))).compatible, false)
  assert.equal(inspectSouraArchive(Buffer.alloc(20), { maxArchiveBytes: 10 }).compatible, false)
})

test('product intent and entitlement enforcement are explicit', () => {
  const validation = { status: 'compatible', compatible: true, compatibleAssetCount: 1 }
  const fields = deriveSouraProductFields([{ id: 'detected', name: 'a.zip', isSouraAsset: false, souraAssetValidation: validation }, { id: 'approved', name: 'b.zip', isSouraAsset: true, souraAssetValidation: validation }])
  assert.equal(fields.containsSouraAssets, true); assert.equal(fields.hasSouraAssets, true); assert.deepEqual(fields.souraAssetFileIds, ['approved'])
  assert.equal(souraEntitlementAllows({ uid: 'buyer', artistId: 'seller' }), false)
  assert.equal(souraEntitlementAllows({ uid: 'buyer', artistId: 'seller', entitlementExists: true, entitlementStatus: 'active' }), true)
  assert.equal(souraEntitlementAllows({ uid: 'seller', artistId: 'seller' }), true)
})
