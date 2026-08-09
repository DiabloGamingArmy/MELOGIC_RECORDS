import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { createVertixAssetRegistry } from '../src/vertix/assets/assetRegistry.js'
import { createMemoryPackRegistryStorage, createPackInstallationRegistry, PackAvailability } from '../src/vertix/packages/packInstallationRegistry.js'
import { createProjectAssetReference } from '../src/vertix/projects/assetReference.js'
import { AssetResolutionStatus, createProjectAssetResolver } from '../src/vertix/projects/assetResolver.js'
import { createPackageAssetProvider } from '../src/vertix/packages/packageAssetProvider.js'
import { parseVertixPackManifest } from '../src/vertix/packages/packageManifest.js'

const fixtureUrl = new URL('./fixtures/vertix-packs/reference-stage-essentials/vertix-pack.json', import.meta.url)
const manifest = parseVertixPackManifest(await readFile(fixtureUrl, 'utf8'))
const reference = createProjectAssetReference(createPackageAssetProvider(manifest).listAssets()[0])

test('installed packs feed the shared asset registry without serializing local locations into projects', () => {
  const registry = createVertixAssetRegistry()
  const installs = createPackInstallationRegistry({ assetRegistry: registry, environment: 'desktop', storage: createMemoryPackRegistryStorage() })
  const installed = installs.install(manifest, { location: '/application-managed/vertix-packs/reference-stage-essentials' })
  const resolver = createProjectAssetResolver(registry, { packRegistry: installs })

  assert.equal(installed.ok, true)
  assert.equal(installed.record.availability, PackAvailability.INSTALLED)
  assert.equal(resolver.resolve(reference).status, AssetResolutionStatus.RESOLVED)
  assert.equal('location' in reference, false)
  assert.equal(registry.listAssets().length, manifest.assets.length)
})

test('unavailable and incompatible packages are structured runtime states, not deletions', () => {
  const registry = createVertixAssetRegistry()
  const installs = createPackInstallationRegistry({ assetRegistry: registry, storage: createMemoryPackRegistryStorage() })
  installs.install(manifest)
  const resolver = createProjectAssetResolver(registry, { packRegistry: installs })

  installs.setAvailability(manifest.id, manifest.version, PackAvailability.UNAVAILABLE)
  assert.equal(resolver.resolve(reference).status, AssetResolutionStatus.UNAVAILABLE)
  assert.equal(resolver.resolve({ ...reference, packageVersion: '2.0.0' }).status, AssetResolutionStatus.INCOMPATIBLE)
})

test('metadata-only registry hydration and malformed packs fail safely', () => {
  const storage = createMemoryPackRegistryStorage()
  const firstRegistry = createPackInstallationRegistry({ assetRegistry: createVertixAssetRegistry(), environment: 'desktop', storage })
  firstRegistry.install(manifest, { location: '/application-managed/reference' })
  const registry = createVertixAssetRegistry()
  const restored = createPackInstallationRegistry({ assetRegistry: registry, environment: 'desktop', storage })

  assert.equal(restored.hydrate().length, 1)
  assert.equal(registry.listAssets().length, manifest.assets.length)
  assert.equal(restored.relink({ invalid: true }).ok, false)
})
