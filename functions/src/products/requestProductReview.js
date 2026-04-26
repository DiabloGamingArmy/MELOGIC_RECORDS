const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')

const BLOCKED_KEYWORDS = [
  'terrorist',
  'child abuse',
  'rape',
  'kill',
  'meth',
  'cocaine'
]

function collectText(product = {}) {
  return [
    product.title,
    product.shortDescription,
    product.description,
    ...(Array.isArray(product.tags) ? product.tags : []),
    ...(Array.isArray(product.categories) ? product.categories : []),
    ...(Array.isArray(product.genres) ? product.genres : []),
    product.productType
  ].join(' ').toLowerCase()
}

function runRuleBasedModeration(product = {}) {
  const haystack = collectText(product)
  const matches = BLOCKED_KEYWORDS.filter((token) => haystack.includes(token))
  return {
    approved: matches.length === 0,
    reasons: matches,
    riskLevel: matches.length ? 'high' : 'low',
    suggestedAction: matches.length ? 'needs_changes' : 'approve'
  }
}

async function moderateProductWithAI(product = {}) {
  const model = process.env.PRODUCT_MODERATION_MODEL || ''
  if (!model) {
    return { approved: true, reasons: [], riskLevel: 'low', suggestedAction: 'approve', aiEnabled: false }
  }

  // TODO: integrate Vertex AI / Genkit call with strict JSON response schema.
  // TODO: add malware scanning, copyrighted content detection, NSFW detection, audio fingerprinting.
  return { approved: true, reasons: [], riskLevel: 'low', suggestedAction: 'approve', aiEnabled: true }
}

exports.requestProductReview = onCall(async (request) => {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'Authentication required.')

  const productId = String(request.data?.productId || '').trim()
  if (!productId) throw new HttpsError('invalid-argument', 'productId is required.')

  const db = admin.firestore()
  const productRef = db.collection('products').doc(productId)
  const productSnap = await productRef.get()
  if (!productSnap.exists) throw new HttpsError('not-found', 'Product not found.')

  const product = productSnap.data() || {}
  if (product.artistId !== uid) throw new HttpsError('permission-denied', 'You do not own this product.')

  if (!String(product.title || '').trim()) throw new HttpsError('failed-precondition', 'Title is required.')
  if (!String(product.productType || '').trim()) throw new HttpsError('failed-precondition', 'Product type is required.')
  if (!String(product.shortDescription || product.description || '').trim()) {
    throw new HttpsError('failed-precondition', 'Description is required.')
  }
  if (!Number.isFinite(Number(product.priceCents)) || Number(product.priceCents) < 0) {
    throw new HttpsError('failed-precondition', 'Invalid price.')
  }

  await productRef.set({
    status: 'review_pending',
    moderationStatus: 'pending',
    reviewedAt: null,
    reviewedBy: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true })

  const ruleResult = runRuleBasedModeration(product)
  const aiResult = await moderateProductWithAI(product).catch(() => ({ approved: true, reasons: [], suggestedAction: 'approve', aiEnabled: false }))
  const autoApprove = process.env.AUTO_APPROVE_PRODUCTS === 'true'

  let finalStatus = 'review_pending'
  let moderationStatus = 'pending'
  let reasons = [...(ruleResult.reasons || []), ...(aiResult.reasons || [])]

  if (!ruleResult.approved) {
    finalStatus = 'needs_changes'
    moderationStatus = 'rejected'
  } else if (autoApprove && aiResult.suggestedAction === 'approve') {
    finalStatus = 'published'
    moderationStatus = 'approved'
  }

  const nextVisibility = finalStatus === 'published' ? 'public' : (product.visibility === 'public' ? 'unlisted' : (product.visibility || 'private'))

  await productRef.set({
    status: finalStatus,
    visibility: nextVisibility,
    moderationStatus,
    moderationReasons: reasons,
    moderationSummary: reasons.length ? 'Automated moderation flagged content.' : 'Automated moderation passed.',
    reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
    reviewedBy: 'system',
    publishedAt: finalStatus === 'published' ? admin.firestore.FieldValue.serverTimestamp() : null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true })

  await db.collection('users').doc(uid).collection('systemNotifications').add({
    type: 'product_release',
    title: finalStatus === 'published' ? 'Product published' : finalStatus === 'needs_changes' ? 'Product needs changes' : 'Product submitted for review',
    body: finalStatus === 'published'
      ? `${product.title || 'Your product'} is now live.`
      : finalStatus === 'needs_changes'
        ? `${product.title || 'Your product'} needs changes before publishing.`
        : `${product.title || 'Your product'} is under review.`,
    productId,
    productTitle: product.title || '',
    status: finalStatus,
    severity: finalStatus === 'published' ? 'success' : finalStatus === 'needs_changes' ? 'warning' : 'info',
    actionHref: `/new-product.html?id=${productId}`,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    readAt: null
  })

  return { status: finalStatus, aiEnabled: Boolean(aiResult.aiEnabled) }
})
