import assert from 'node:assert/strict'
import test from 'node:test'
import { createDefaultVertixFilesystem, createVertixAssetRecord, createVertixAssetVersion, createVertixFilesystem, createVertixFolderEntry } from '../src/vertix/assets/assetFilesystem.js'

test('Vertix filesystem derives paths from stable folder and asset identities', () => {
  const defaults = createDefaultVertixFilesystem({ ownerId: 'u1', projects: [{ id: 'a', name: 'Project A' }, { id: 'b', name: 'Project B' }], activeProjectId: 'a' })
  const version = createVertixAssetVersion({ versionId: 'version-1', assetId: 'asset-1', contentHash: 'abc', storageObjectId: 'cloud/object' })
  const asset = createVertixAssetRecord({ assetId: 'asset-1', displayName: 'Fixture', fileName: 'fixture.glb', format: 'glb', currentVersionId: version.versionId, contentHash: 'abc' })
  const sourceEntry = createVertixFolderEntry({ entryId: 'entry-b', folderId: 'vertix-project:b', assetId: asset.assetId })
  const fs = createVertixFilesystem({ ...defaults, assets: [asset], versions: [version], entries: [sourceEntry], activeProjectId: 'a' })

  assert.deepEqual(fs.breadcrumb('vertix-project:a').map((folder) => folder.name), ['VERTIX', 'Project A'])
  assert.throws(() => fs.moveAsset('entry-b', 'vertix-project:a'), /FOLDER_READ_ONLY/)
  const copied = fs.copyAssetToCurrentProject('asset-1', 'vertix-project:a')
  assert.equal(copied.assetId, asset.assetId)
  assert.equal(fs.listAssets('vertix-project:b').length, 1)
  assert.equal(fs.listAssets('vertix-project:a').length, 1)
})

test('owned folders can move without changing asset identity and cannot form cycles', () => {
  const defaults = createDefaultVertixFilesystem({ ownerId: 'u1', projects: [{ id: 'a', name: 'Project A' }], activeProjectId: 'a' })
  const fs = createVertixFilesystem({ ...defaults, activeProjectId: 'a' })
  const custom = fs.createFolder('vertix-project:a', 'Custom', { folderId: 'custom' })
  const nested = fs.createFolder(custom.folderId, 'Lighting', { folderId: 'lighting' })
  assert.throws(() => fs.moveFolder(custom.folderId, nested.folderId), /FOLDER_RECURSIVE_MOVE/)
  assert.equal(fs.renameFolder(nested.folderId, 'Rigging').name, 'Rigging')
})
