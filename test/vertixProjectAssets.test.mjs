import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createVertixAssetRegistry } from '../src/vertix/assets/assetRegistry.js'
import { builtInStageAssetProvider } from '../src/vertix/assets/builtInStageAssetProvider.js'
import { createProjectAssetReference } from '../src/vertix/projects/assetReference.js'
import { AssetResolutionReason, AssetResolutionStatus, createProjectAssetResolver, reResolveProjectAssets, resolveProjectAssets, summarizeProjectAssetDependencies } from '../src/vertix/projects/assetResolver.js'
import { createPackageAssetProvider } from '../src/vertix/packages/packageAssetProvider.js'
import { parseVertixPackManifest } from '../src/vertix/packages/packageManifest.js'
import { normalizeStagePlan } from '../src/stage/stagePlanModel.js'

const fixtureUrl = new URL('./fixtures/vertix-packs/reference-stage-essentials/vertix-pack.json', import.meta.url)
const fixtureManifest = parseVertixPackManifest(await readFile(fixtureUrl, 'utf8'))
const packageProvider = createPackageAssetProvider(fixtureManifest)
const packageAsset = packageProvider.listAssets()[0]
const packageReference = createProjectAssetReference(packageAsset)

function projectWithAsset(reference = packageReference) {
  return {
    id: 'project-dependencies',
    name: 'Dependency Test',
    objects: [{
      id: 'placed-reference-deck',
      kind: 'stage-deck',
      type: 'stage-deck',
      category: 'stage',
      label: 'Show-owned deck label',
      position: { x: 7, y: 0.25, z: -3 },
      rotation: { x: 0, y: 20, z: 0 },
      scale: { x: 1.2, y: 1, z: 1 },
      dimensions: { width: 10, depth: 5, height: 0.75 },
      lastKnownBounds: { width: 10, depth: 5, height: 0.75 },
      assetReference: reference,
      metadata: { showOverride: 'keep-this' },
      parentId: 'main-stage-group',
      animationReferences: ['cue-17'],
      customProjectOwnedField: { preserve: true }
    }]
  }
}

test('project asset resolver requires an exact package, version, UUID, and integrity', () => {
  const resolver = createProjectAssetResolver(createVertixAssetRegistry([builtInStageAssetProvider, packageProvider]))

  assert.equal(resolver.resolve(packageReference).status, AssetResolutionStatus.RESOLVED)
  assert.equal(resolver.resolve({ ...packageReference, packageVersion: '9.9.9' }).reason, AssetResolutionReason.VERSION_NOT_AVAILABLE)
  assert.equal(resolver.resolve({ ...packageReference, assetUuid: '00000000-0000-4000-8000-000000000000' }).reason, AssetResolutionReason.ASSET_NOT_FOUND)
  assert.equal(resolver.resolve({ ...packageReference, integrity: 'sha256-not-the-package' }).reason, AssetResolutionReason.INTEGRITY_MISMATCH)
  assert.equal(resolver.resolve({ ...packageReference, packageId: '@missing/show-asset' }).reason, AssetResolutionReason.PACKAGE_NOT_AVAILABLE)
  assert.equal(resolver.resolve({ packageId: 'incomplete' }).reason, AssetResolutionReason.INVALID_REFERENCE)
})

test('missing resolution is runtime-only and preserves the complete placed object through serialization', () => {
  const original = projectWithAsset()
  const normalized = normalizeStagePlan(original)
  const beforeResolution = structuredClone(normalized.objects[0])
  const resolver = createProjectAssetResolver(createVertixAssetRegistry([builtInStageAssetProvider]))
  const results = resolveProjectAssets(normalized, resolver)
  const roundTripped = normalizeStagePlan(JSON.parse(JSON.stringify(normalized)))

  assert.equal(results['placed-reference-deck'].status, AssetResolutionStatus.MISSING)
  assert.equal(results['placed-reference-deck'].reason, AssetResolutionReason.PACKAGE_NOT_AVAILABLE)
  assert.deepEqual(normalized.objects[0], beforeResolution)
  assert.deepEqual(roundTripped.objects[0].assetReference, packageReference)
  assert.deepEqual(roundTripped.objects[0].lastKnownBounds, { width: 10, depth: 5, height: 0.75 })
  assert.deepEqual(roundTripped.objects[0].position, { x: 7, y: 0.25, z: -3 })
  assert.deepEqual(roundTripped.objects[0].rotation, { x: 0, y: 20, z: 0 })
  assert.deepEqual(roundTripped.objects[0].dimensions, { width: 10, depth: 5, height: 0.75 })
  assert.equal(roundTripped.objects[0].metadata.showOverride, 'keep-this')
  assert.equal(roundTripped.objects[0].parentId, 'main-stage-group')
  assert.deepEqual(roundTripped.objects[0].animationReferences, ['cue-17'])
  assert.deepEqual(roundTripped.objects[0].customProjectOwnedField, { preserve: true })
})

test('re-resolution restores an exact package asset without changing scene identity or overrides', () => {
  const project = normalizeStagePlan(projectWithAsset())
  const registry = createVertixAssetRegistry([builtInStageAssetProvider])
  const resolver = createProjectAssetResolver(registry)
  const before = reResolveProjectAssets(project, resolver)
  const objectBefore = structuredClone(project.objects[0])

  registry.registerProvider(packageProvider)
  const after = reResolveProjectAssets(project, resolver)

  assert.equal(before['placed-reference-deck'].status, AssetResolutionStatus.MISSING)
  assert.equal(after['placed-reference-deck'].status, AssetResolutionStatus.RESOLVED)
  assert.equal(after['placed-reference-deck'].asset, packageAsset)
  assert.deepEqual(project.objects[0], objectBefore)
  assert.equal(project.objects[0].id, 'placed-reference-deck')
  assert.equal(project.objects[0].label, 'Show-owned deck label')
  assert.equal(project.objects[0].metadata.showOverride, 'keep-this')
})

test('dependency summaries and legacy built-in objects remain compatible', () => {
  const registry = createVertixAssetRegistry([builtInStageAssetProvider, packageProvider])
  const resolver = createProjectAssetResolver(registry)
  const project = normalizeStagePlan(projectWithAsset())
  project.objects.push({ id: 'legacy-object', type: 'speaker', category: 'audio', label: 'Legacy Speaker', dimensions: { width: 1, depth: 1, height: 1 } })
  const builtInReference = createProjectAssetReference(builtInStageAssetProvider.listAssets()[0])
  const dependencies = summarizeProjectAssetDependencies(project, resolver)
  const resolutions = resolveProjectAssets(project, resolver)

  assert.equal(resolver.resolve(builtInReference).status, AssetResolutionStatus.RESOLVED)
  assert.equal(resolutions['legacy-object'].status, AssetResolutionStatus.RESOLVED)
  assert.equal(resolutions['legacy-object'].reason, AssetResolutionReason.LEGACY_OBJECT)
  assert.deepEqual(dependencies, [{
    packageId: packageReference.packageId,
    packageVersion: packageReference.packageVersion,
    integrity: packageReference.integrity,
    publisherId: packageReference.publisherId,
    assetUuids: [packageReference.assetUuid],
    objectIds: ['placed-reference-deck'],
    status: AssetResolutionStatus.RESOLVED,
    reasons: []
  }])
})
