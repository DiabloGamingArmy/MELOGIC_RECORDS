import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createVertixAssetRegistry } from '../src/vertix/assets/assetRegistry.js'
import { builtInStageAssetProvider } from '../src/vertix/assets/builtInStageAssetProvider.js'
import { calculatePackageIntegrity, isValidPackageIntegrity } from '../src/vertix/packages/packageIntegrity.js'
import { parseVertixPackManifest, vertixPackageIdentity } from '../src/vertix/packages/packageManifest.js'
import { createPackageAssetProvider, createVertixPack, VertixPackValidationError } from '../src/vertix/packages/packageAssetProvider.js'
import { isSafePackagePath, validateVertixPackManifest } from '../src/vertix/packages/packageValidator.js'

const fixtureUrl = new URL('./fixtures/vertix-packs/reference-stage-essentials/vertix-pack.json', import.meta.url)
const fixtureText = await readFile(fixtureUrl, 'utf8')
const fixtureManifest = parseVertixPackManifest(fixtureText)

test('reference Vertix Pack parses and retains package identity and unknown metadata', () => {
  const pack = createVertixPack(fixtureText)

  assert.equal(pack.validation.valid, true)
  assert.equal(pack.identity, '@melogic/reference-stage-essentials@1.0.0')
  assert.equal(vertixPackageIdentity(pack.manifest), pack.identity)
  assert.equal(pack.manifest.experimentalMetadata.preserveAcrossParsing, true)
  assert.equal(pack.manifest.assets[0].metadata.futureSemanticBlock.revision, 7)
})

test('Package Asset Provider exposes package assets through the generic registry', () => {
  const provider = createPackageAssetProvider(fixtureManifest)
  const registry = createVertixAssetRegistry([builtInStageAssetProvider, provider])
  const packageAsset = provider.listAssets()[0]
  const resolved = registry.getAsset(packageAsset.id)

  assert.equal(registry.listAssets().length, 24)
  assert.equal(provider.getAsset(packageAsset.assetUuid), packageAsset)
  assert.equal(resolved, packageAsset)
  assert.equal(resolved.id, '@melogic/reference-stage-essentials@1.0.0:c5af3f58-0db4-4a84-9301-4a628d8c8422')
  assert.equal(resolved.assetUuid, 'c5af3f58-0db4-4a84-9301-4a628d8c8422')
  assert.equal(resolved.metadata.futureSemanticBlock.preserve, true)
  assert.deepEqual(resolved.provenance, {
    packageId: '@melogic/reference-stage-essentials',
    packageVersion: '1.0.0',
    publisherId: 'melogic',
    assetUuid: 'c5af3f58-0db4-4a84-9301-4a628d8c8422',
    source: 'vertix-pack',
    integrity: 'sha256-47DEQpj8HBSa+/TImW+5JCeuQeRkm5NMpJWZG3hSuFU='
  })
})

test('validator rejects duplicate asset UUIDs', () => {
  const duplicateManifest = structuredClone(fixtureManifest)
  duplicateManifest.assets.push(structuredClone(duplicateManifest.assets[0]))
  const validation = validateVertixPackManifest(duplicateManifest)

  assert.equal(validation.valid, false)
  assert.ok(validation.errors.some((error) => error.code === 'asset.uuid-duplicate'))
  assert.throws(() => createPackageAssetProvider(duplicateManifest), VertixPackValidationError)
})

test('validator rejects traversal, absolute, and URL resource paths', () => {
  assert.equal(isSafePackagePath('geometry/deck.glb'), true)
  assert.equal(isSafePackagePath('../outside.glb'), false)
  assert.equal(isSafePackagePath('/tmp/outside.glb'), false)
  assert.equal(isSafePackagePath('C:\\outside.glb'), false)
  assert.equal(isSafePackagePath('https://example.com/deck.glb'), false)
  assert.equal(isSafePackagePath('..%5Coutside.glb'), false)

  const traversalManifest = structuredClone(fixtureManifest)
  traversalManifest.assets[0].source.path = '../outside.glb'
  const validation = validateVertixPackManifest(traversalManifest)
  assert.equal(validation.valid, false)
  assert.ok(validation.errors.some((error) => error.code === 'package.path-invalid'))
})

test('validator fails safely for missing and unsupported manifests', () => {
  const missing = validateVertixPackManifest(null)
  const unsupported = structuredClone(fixtureManifest)
  unsupported.schemaVersion = 99
  const unsupportedValidation = validateVertixPackManifest(unsupported)

  assert.equal(missing.valid, false)
  assert.equal(missing.errors[0].code, 'manifest.invalid')
  assert.equal(unsupportedValidation.valid, false)
  assert.ok(unsupportedValidation.errors.some((error) => error.code === 'manifest.schema-version-unsupported'))
})

test('validator enforces publisher scope, semantic versions, and license information', () => {
  const invalidIdentity = structuredClone(fixtureManifest)
  invalidIdentity.id = '@another-publisher/reference-stage-essentials'
  invalidIdentity.version = 'latest'
  invalidIdentity.license = {}
  const validation = validateVertixPackManifest(invalidIdentity)

  assert.equal(validation.valid, false)
  assert.ok(validation.errors.some((error) => error.code === 'publisher.scope-mismatch'))
  assert.ok(validation.errors.some((error) => error.code === 'package.version-invalid'))
  assert.ok(validation.errors.some((error) => error.code === 'package.license-missing'))
})

test('SHA-256 integrity utility produces the supported package integrity format', async () => {
  const integrity = await calculatePackageIntegrity('Vertix Pack')
  assert.equal(isValidPackageIntegrity(integrity), true)
  assert.equal(await calculatePackageIntegrity('Vertix Pack'), integrity)
})
