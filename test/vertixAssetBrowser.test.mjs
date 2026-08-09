import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createVertixAssetRegistry } from '../src/vertix/assets/assetRegistry.js'
import { builtInStageAssetProvider } from '../src/vertix/assets/builtInStageAssetProvider.js'
import { createAssetBrowserCatalog, filterAssetBrowserAssets, selectedAssetBrowserAsset } from '../src/vertix/assets/assetBrowserModel.js'
import { createPackageAssetProvider } from '../src/vertix/packages/packageAssetProvider.js'
import { parseVertixPackManifest } from '../src/vertix/packages/packageManifest.js'
import { createProjectAssetReference, lastKnownBoundsFromAsset } from '../src/vertix/projects/assetReference.js'

const fixtureUrl = new URL('./fixtures/vertix-packs/reference-stage-essentials/vertix-pack.json', import.meta.url)
const fixtureManifest = parseVertixPackManifest(await readFile(fixtureUrl, 'utf8'))
const packageProvider = createPackageAssetProvider(fixtureManifest)

test('Asset Browser catalogue derives built-in and registered package assets from the registry', () => {
  const registry = createVertixAssetRegistry([builtInStageAssetProvider])
  const builtInCatalog = createAssetBrowserCatalog(registry)
  assert.equal(builtInCatalog.assets.length, 23)
  assert.ok(builtInCatalog.sources.some((source) => source.key === 'built-in'))

  registry.registerProvider(packageProvider)
  const catalog = createAssetBrowserCatalog(registry)
  const packageAsset = packageProvider.listAssets()[0]
  assert.equal(catalog.assets.length, 24)
  assert.ok(catalog.sources.some((source) => source.packageId === fixtureManifest.id))
  assert.equal(selectedAssetBrowserAsset(catalog, packageAsset.id)?.assetUuid, packageAsset.assetUuid)
})

test('Asset Browser search and category/source filters compose deterministically', () => {
  const catalog = createAssetBrowserCatalog(createVertixAssetRegistry([builtInStageAssetProvider, packageProvider]))
  const packageAsset = packageProvider.listAssets()[0]

  assert.deepEqual(filterAssetBrowserAssets(catalog, { search: 'moving head' }).map((asset) => asset.id), ['asset-moving-head'])
  assert.ok(filterAssetBrowserAssets(catalog, { category: 'audio' }).every((asset) => asset.category === 'audio'))
  assert.deepEqual(filterAssetBrowserAssets(catalog, { source: `${fixtureManifest.id}@${fixtureManifest.version}` }).map((asset) => asset.id), [packageAsset.id])
  assert.deepEqual(filterAssetBrowserAssets(catalog, { source: `${fixtureManifest.id}@${fixtureManifest.version}`, category: 'stage', search: 'reference deck' }).map((asset) => asset.id), [packageAsset.id])
})

test('Asset Browser selection uses stable registry identity, not display names', () => {
  const duplicateProvider = {
    id: 'duplicate-display-names',
    listAssets: () => [
      { id: 'local-a', label: 'Shared Name', type: 'model', category: 'stage', tags: [], provenance: { packageId: '@test/a', packageVersion: '1.0.0', assetUuid: 'asset-a', integrity: 'sha256-a', publisherId: 'test', source: 'vertix-pack' } },
      { id: 'local-b', label: 'Shared Name', type: 'model', category: 'stage', tags: [], provenance: { packageId: '@test/b', packageVersion: '1.0.0', assetUuid: 'asset-b', integrity: 'sha256-b', publisherId: 'test', source: 'vertix-pack' } }
    ]
  }
  const catalog = createAssetBrowserCatalog(createVertixAssetRegistry([duplicateProvider]))
  assert.equal(selectedAssetBrowserAsset(catalog, 'local-b')?.provenance.assetUuid, 'asset-b')
  assert.equal(filterAssetBrowserAssets(catalog, { search: 'shared name' }).length, 2)
})

test('Package browser assets retain the exact portable project reference needed for placement', () => {
  const packageAsset = packageProvider.listAssets()[0]
  assert.deepEqual(createProjectAssetReference(packageAsset), {
    packageId: packageAsset.provenance.packageId,
    packageVersion: packageAsset.provenance.packageVersion,
    assetUuid: packageAsset.provenance.assetUuid,
    integrity: packageAsset.provenance.integrity,
    publisherId: packageAsset.provenance.publisherId,
    providerId: ''
  })
  assert.deepEqual(lastKnownBoundsFromAsset(packageAsset), {
    width: packageAsset.dimensions.width,
    depth: packageAsset.dimensions.depth,
    height: packageAsset.dimensions.height
  })
})
