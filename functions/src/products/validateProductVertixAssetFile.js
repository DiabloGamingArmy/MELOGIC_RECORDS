'use strict'

const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { deriveVertixProductFields, inspectVertixArchive, isZipFile, STATUS } = require('./vertixAssetArchives')

const db = admin.firestore()
const { FieldValue } = admin.firestore

function safeId(value = '', field = 'id') {
  const id = String(value || '').trim()
  if (!id || id === '.' || id === '..' || id.includes('/')) throw new HttpsError('invalid-argument', `${field} is invalid.`)
  return id
}

async function validateRequestedFile(productId, file) {
  if (!isZipFile(file)) return { ...file, isVertixAsset: false, vertixAssetValidation: { status: STATUS.INCOMPATIBLE, compatible: false, compatibleAssetCount: 0, errors: ['Only ZIP deliverables can be Vertix Assets.'], validatedAt: new Date().toISOString() } }
  const storagePath = String(file.storagePath || '')
  if (!storagePath.startsWith(`products/${productId}/`) || storagePath.includes('..')) throw new HttpsError('invalid-argument', 'File storage path is not product-scoped.')
  const storageFile = admin.storage().bucket().file(storagePath)
  const [metadata] = await storageFile.getMetadata()
  if (Number(metadata.size || 0) > 512 * 1024 * 1024) throw new HttpsError('resource-exhausted', 'ZIP exceeds the supported validation size.')
  const [buffer] = await storageFile.download()
  const validation = inspectVertixArchive(buffer)
  return { ...file, isVertixAsset: validation.compatible === true, vertixAssetValidation: validation, updatedAt: new Date().toISOString() }
}

const validateProductVertixAssetFile = onCall({ timeoutSeconds: 120, memory: '1GiB', cors: true }, async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Sign in required.')
  const productId = safeId(request.data?.productId, 'productId')
  const fileId = safeId(request.data?.fileId, 'fileId')
  const productRef = db.collection('products').doc(productId)
  const productSnap = await productRef.get()
  if (!productSnap.exists) throw new HttpsError('not-found', 'Product not found.')
  const product = productSnap.data() || {}
  if (product.artistId !== uid) throw new HttpsError('permission-denied', 'This product does not belong to the signed-in account.')
  const files = Array.isArray(product.deliverableFiles) ? product.deliverableFiles : []
  const index = files.findIndex((file) => String(file.id || '') === fileId)
  if (index < 0) throw new HttpsError('not-found', 'Product file not found.')
  let file = { ...files[index], isVertixAsset: false }
  if (request.data?.isVertixAsset === true) file = await validateRequestedFile(productId, file)
  else file.vertixAssetValidation = file.vertixAssetValidation || { status: STATUS.UNCHECKED, compatible: false, compatibleAssetCount: 0, errors: [] }
  files[index] = file
  const derived = deriveVertixProductFields(files)
  const fileRef = productRef.collection('files').doc(fileId)
  const batch = db.batch()
  batch.set(fileRef, { ...file, productId, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  batch.set(productRef, { deliverableFiles: files, ...derived, updatedAt: FieldValue.serverTimestamp() }, { merge: true })
  await batch.commit()
  return { ok: file.isVertixAsset === true, file, validation: file.vertixAssetValidation, ...derived }
})

module.exports = { validateProductVertixAssetFile, validateRequestedFile }
