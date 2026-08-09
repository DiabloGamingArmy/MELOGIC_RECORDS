import { collection, doc, getDocs, serverTimestamp, setDoc, writeBatch } from 'firebase/firestore'
import { ref, uploadBytes } from 'firebase/storage'
import { db } from '../firebase/firestore'
import { storage } from '../firebase/storage'
import { prepareGlbAssetImport } from '../vertix/assets/glbAsset.js'
import { createVertixFolderEntry } from '../vertix/assets/assetFilesystem.js'

const providerIds = new WeakMap()
const providerLoads = new WeakMap()

function toProviderAsset(record = {}, linkage = {}) {
  const sourceType = record.sourceType === 'marketplace' ? 'marketplace' : record.sourceType || 'imported'
  return Object.freeze({
    id: record.assetId,
    assetId: record.assetId,
    assetUuid: record.assetId,
    label: record.displayName,
    name: record.displayName,
    fileName: record.fileName,
    type: 'glb-model',
    category: 'model',
    layer: 'stage',
    format: 'glb',
    mimeType: record.mimeType || 'model/gltf-binary',
    dimensions: record.technicalMetadata?.bounds ? {
      width: Math.max(0.01, Number(record.technicalMetadata.bounds.max?.[0] || 0) - Number(record.technicalMetadata.bounds.min?.[0] || 0)),
      height: Math.max(0.01, Number(record.technicalMetadata.bounds.max?.[1] || 0) - Number(record.technicalMetadata.bounds.min?.[1] || 0)),
      depth: Math.max(0.01, Number(record.technicalMetadata.bounds.max?.[2] || 0) - Number(record.technicalMetadata.bounds.min?.[2] || 0))
    } : { width: 1, height: 1, depth: 1 },
    tags: ['glb', 'imported', ...(record.metadata?.tags || [])],
    metadata: { ...(record.metadata || {}), vertixFolderIds: linkage.folderIds || [], vertixProjectIds: linkage.projectIds || [] },
    technicalMetadata: record.technicalMetadata || {},
    source: sourceType,
    sourceType,
    sourceUri: record.storageObjectId || record.sourceId || '',
    preview: { kind: 'glb-3d', sourceUri: record.storageObjectId || record.sourceId || '' },
    defaultTransform: { position: { x: 0, y: 0, z: 0 }, rotation: { x: 0, y: 0, z: 0 }, scale: { x: 1, y: 1, z: 1 } },
    provenance: {
      packageId: sourceType === 'marketplace' ? `@marketplace/${record.sourceProductId || record.sourceId || 'pack'}` : `@account/${record.ownerId || 'user'}-library`,
      packageVersion: record.currentVersionId,
      publisherId: record.ownerId || 'account',
      source: sourceType,
      integrity: record.contentHash,
      assetUuid: record.assetId
    }
  })
}

export async function loadVertixAccountAssets(uid = '') {
  if (!db || !uid) return []
  const [assetSnapshot, entrySnapshot] = await Promise.all([
    getDocs(collection(db, 'users', uid, 'vertixAssets')),
    getDocs(collection(db, 'users', uid, 'vertixFolderEntries'))
  ])
  const linkageByAsset = new Map()
  entrySnapshot.docs.forEach((row) => {
    const entry = row.data() || {}
    if (!entry.assetId) return
    const linkage = linkageByAsset.get(entry.assetId) || { folderIds: new Set(), projectIds: new Set() }
    if (entry.folderId) linkage.folderIds.add(entry.folderId)
    if (entry.projectId) linkage.projectIds.add(entry.projectId)
    linkageByAsset.set(entry.assetId, linkage)
  })
  return assetSnapshot.docs.map((row) => ({ id: row.id, ...row.data() })).map((asset) => {
    const linkage = linkageByAsset.get(asset.assetId)
    return toProviderAsset(asset, { folderIds: [...(linkage?.folderIds || [])], projectIds: [...(linkage?.projectIds || [])] })
  })
}

export async function hydrateVertixAccountAssetProvider(uid, registry) {
  if (!registry) return []
  const loadGeneration = (providerLoads.get(registry) || 0) + 1
  providerLoads.set(registry, loadGeneration)
  const existingProviderId = providerIds.get(registry)
  if (existingProviderId) registry.unregisterProvider(existingProviderId)
  providerIds.delete(registry)
  if (!uid) return []
  const assets = await loadVertixAccountAssets(uid)
  if (providerLoads.get(registry) !== loadGeneration) return []
  const providerId = `account-assets:${uid}`
  registry.registerProvider(Object.freeze({ id: providerId, listAssets: () => assets, listAssetGroups: () => [{ key: 'account-library', label: 'Account Library', assetIds: assets.map((asset) => asset.id) }] }))
  providerIds.set(registry, providerId)
  return assets
}

export async function importGlbToVertixAccount(file, user, { folderId = '', projectId = '' } = {}) {
  if (!db || !storage || !user?.uid) throw new Error('Sign in to import an account asset.')
  const prepared = await prepareGlbAssetImport(file, { ownerId: user.uid, folderId })
  if (!prepared.ok) return prepared
  const safeFileName = String(file.name || 'asset.glb').replace(/[^a-zA-Z0-9._-]/g, '-')
  const storageObjectId = `users/${user.uid}/vertix/assets/${prepared.asset.assetId}/${prepared.version.contentHash}/${safeFileName}`
  await uploadBytes(ref(storage, storageObjectId), prepared.bytes, { contentType: 'model/gltf-binary', customMetadata: { assetId: prepared.asset.assetId, versionId: prepared.version.versionId, contentHash: prepared.version.contentHash } })
  const asset = { ...prepared.asset, sourceId: storageObjectId, storageObjectId, updatedAt: new Date().toISOString() }
  const version = { ...prepared.version, storageObjectId }
  const entry = createVertixFolderEntry({ folderId: folderId || `vertix-project:${projectId}`, assetId: asset.assetId })
  const batch = writeBatch(db)
  batch.set(doc(db, 'users', user.uid, 'vertixAssets', asset.assetId), { ...asset, updatedAt: serverTimestamp() })
  batch.set(doc(db, 'users', user.uid, 'vertixAssetVersions', version.versionId.replaceAll('/', '_')), { ...version, createdAt: serverTimestamp() })
  batch.set(doc(db, 'users', user.uid, 'vertixFolderEntries', entry.entryId.replaceAll('/', '_')), { ...entry, projectId, createdAt: serverTimestamp() })
  await batch.commit()
  return Object.freeze({ ...prepared, asset, version, entry, storageObjectId })
}

export async function saveVertixFolder(uid, folder) {
  if (!db || !uid || !folder?.folderId) throw new Error('A signed-in owner and folder are required.')
  await setDoc(doc(db, 'users', uid, 'vertixFolders', folder.folderId.replaceAll('/', '_')), { ...folder, ownerId: uid, updatedAt: serverTimestamp() }, { merge: true })
}
