const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret, defineString } = require('firebase-functions/params')
const admin = require('firebase-admin')

const geminiApiKey = defineSecret('GEMINI_API_KEY')
const productModerationModel = defineString('PRODUCT_MODERATION_MODEL', {
  default: 'gemini-1.5-flash'
})
const autoApproveProducts = defineString('AUTO_APPROVE_PRODUCTS', { default: 'false' })
const autoApproveRuleBasedOnly = defineString('AUTO_APPROVE_WITH_RULE_BASED_ONLY', { default: 'false' })

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

async function moderateProductWithAI(product = {}, { model = '', apiKey = '' } = {}) {
  const aiConfigured = Boolean(model && apiKey)
  if (!aiConfigured) {
    return {
      approved: true,
      reasons: [],
      riskLevel: 'low',
      suggestedAction: 'approve',
      summary: 'AI moderation not configured; rule-based moderation only.',
      aiConfigured: false,
      aiAttempted: false,
      aiSucceeded: false,
      aiEnabled: false,
      error: ''
    }
  }

  const moderationInput = {
    title: product.title || '',
    shortDescription: product.shortDescription || '',
    description: product.description || '',
    productType: product.productType || '',
    categories: Array.isArray(product.categories) ? product.categories : [],
    genres: Array.isArray(product.genres) ? product.genres : [],
    tags: Array.isArray(product.tags) ? product.tags : [],
    filePaths: [
      ...(Array.isArray(product.galleryPaths) ? product.galleryPaths : []),
      ...(Array.isArray(product.previewAudioPaths) ? product.previewAudioPaths : []),
      ...(Array.isArray(product.previewVideoPaths) ? product.previewVideoPaths : []),
      product.coverPath || '',
      product.downloadPath || ''
    ].filter(Boolean),
    assetSummary: product.assetSummary || {},
    priceCents: product.priceCents,
    isFree: product.isFree
  }
  const prompt = `Return ONLY strict JSON with keys approved,riskLevel,suggestedAction,reasons,summary.
${JSON.stringify(moderationInput)}`

  try {
    const resp = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
    })

    if (!resp.ok) {
      const errorText = await resp.text().catch(() => '')
      throw new Error(`Gemini HTTP ${resp.status}: ${errorText.slice(0, 500)}`)
    }

    const data = await resp.json()
    const text = data?.candidates?.[0]?.content?.parts?.map((part) => part.text || '').join('') || ''
    const cleaned = text.replace(/```json|```/g, '').trim()

    try {
      const parsed = JSON.parse(cleaned)
      return {
        approved: parsed?.approved !== false,
        riskLevel: ['low', 'medium', 'high'].includes(parsed?.riskLevel) ? parsed.riskLevel : 'unknown',
        suggestedAction: ['approve', 'review_pending', 'needs_changes', 'reject'].includes(parsed?.suggestedAction) ? parsed.suggestedAction : 'review_pending',
        reasons: Array.isArray(parsed?.reasons) ? parsed.reasons.map(String) : ['AI moderation returned an unreadable response.'],
        summary: String(parsed?.summary || 'AI moderation was inconclusive.'),
        aiConfigured: true,
        aiAttempted: true,
        aiSucceeded: true,
        aiEnabled: true,
        error: ''
      }
    } catch (error) {
      return {
        approved: true,
        riskLevel: 'unknown',
        suggestedAction: 'review_pending',
        reasons: ['AI moderation returned an unreadable response.'],
        summary: 'AI moderation was inconclusive.',
        aiConfigured: true,
        aiAttempted: true,
        aiSucceeded: false,
        aiEnabled: true,
        error: error?.message || 'json-parse-error'
      }
    }
  } catch (error) {
    return {
      approved: true,
      riskLevel: 'unknown',
      suggestedAction: 'review_pending',
      reasons: [],
      summary: 'AI moderation unavailable; product remains pending review.',
      aiConfigured: true,
      aiAttempted: true,
      aiSucceeded: false,
      aiEnabled: true,
      error: error?.message || 'ai-error'
    }
  }
}

exports.requestProductReview = onCall(
  {
    secrets: [geminiApiKey],
    timeoutSeconds: 60,
    memory: '256MiB'
  },
  async (request) => {
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
  const priceCents = Number(product.priceCents)
  if (!Number.isFinite(priceCents) || priceCents < 0) {
    throw new HttpsError('failed-precondition', `Invalid price. priceCents=${JSON.stringify(product.priceCents)}`)
  }
  const normalizedPriceCents = Math.max(0, Math.round(priceCents))

  await productRef.set({
    status: 'review_pending',
    moderationStatus: 'pending',
    reviewedAt: null,
    reviewedBy: null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true })

  const ruleResult = runRuleBasedModeration(product)
  const model = productModerationModel.value() || 'gemini-1.5-flash'
  const apiKey = geminiApiKey.value()

  await productRef.set({
    moderationAIConfigured: Boolean(apiKey && model),
    moderationAIModel: model || '',
    moderationAIConfigCheckedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true })

  console.info('[requestProductReview] moderation config', {
    productId,
    hasApiKey: Boolean(apiKey),
    model: model || '',
    aiConfigured: Boolean(apiKey && model)
  })

  const aiResult = await moderateProductWithAI(product, { model, apiKey })

  console.info('[requestProductReview] AI moderation result', {
    productId,
    aiConfigured: Boolean(aiResult.aiConfigured),
    aiAttempted: Boolean(aiResult.aiAttempted),
    aiSucceeded: Boolean(aiResult.aiSucceeded),
    riskLevel: aiResult.riskLevel || 'unknown',
    suggestedAction: aiResult.suggestedAction || 'review_pending',
    error: aiResult.error || ''
  })

  const autoApprove = autoApproveProducts.value() === 'true'
  const allowRuleBasedAutoApprove = autoApproveRuleBasedOnly.value() === 'true'

  let finalStatus = 'review_pending'
  let moderationStatus = 'pending'
  let reasons = [...(ruleResult.reasons || []), ...(aiResult.reasons || [])]

  if (!ruleResult.approved) {
    finalStatus = 'needs_changes'
    moderationStatus = 'rejected'
  } else if (aiResult.suggestedAction === 'needs_changes' || aiResult.suggestedAction === 'reject') {
    finalStatus = 'needs_changes'
    moderationStatus = 'rejected'
  } else if (autoApprove && aiResult.aiSucceeded === true && aiResult.suggestedAction === 'approve') {
    finalStatus = 'published'
    moderationStatus = 'approved'
  } else if (autoApprove && allowRuleBasedAutoApprove && ruleResult.approved) {
    // TESTING ONLY: unsafe in production because it can publish when AI moderation fails/unavailable.
    finalStatus = 'published'
    moderationStatus = 'approved'
  }

  const nextVisibility = finalStatus === 'published' ? 'public' : (product.visibility === 'public' ? 'unlisted' : (product.visibility || 'private'))


  const releasedAtValue = finalStatus === 'published'
    ? (product.releasedAt || admin.firestore.FieldValue.serverTimestamp())
    : (product.releasedAt || null)
  const featuredValue = finalStatus === 'published' ? (product.featured === true) : false
  const listingCounts = {
    likeCount: Number(product.likeCount || 0),
    saveCount: Number(product.saveCount || 0),
    downloadCount: Number(product.downloadCount || 0),
    commentCount: Number(product.commentCount || 0),
    shareCount: Number(product.shareCount || 0),
    followCount: Number(product.followCount || 0),
    counts: {
      likes: Number(product.counts?.likes || 0),
      dislikes: Number(product.counts?.dislikes || 0),
      saves: Number(product.counts?.saves || 0),
      shares: Number(product.counts?.shares || 0),
      comments: Number(product.counts?.comments || 0),
      downloads: Number(product.counts?.downloads || 0),
      follows: Number(product.counts?.follows || 0)
    }
  }

  await productRef.set({
    status: finalStatus,
    visibility: nextVisibility,
    featured: featuredValue,
    releasedAt: releasedAtValue,
    moderationStatus,
    moderationReasons: reasons,
    moderationSummary: aiResult.summary || (reasons.length ? 'Automated moderation flagged content.' : 'Automated moderation passed.'),
    moderationRiskLevel: aiResult.riskLevel || 'unknown',
    moderationAIConfigured: Boolean(aiResult.aiConfigured),
    moderationAIAttempted: Boolean(aiResult.aiAttempted),
    moderationAISucceeded: Boolean(aiResult.aiSucceeded),
    moderationAIEnabled: Boolean(aiResult.aiEnabled),
    moderationAIModel: model || '',
    moderationAIError: aiResult.error || '',
    moderationAICompletedAt: admin.firestore.FieldValue.serverTimestamp(),
    ...listingCounts,
    priceCents: normalizedPriceCents,
    isFree: normalizedPriceCents === 0,
    currency: String(product.currency || 'USD').trim().toUpperCase() || 'USD',
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

  return {
    status: finalStatus,
    aiEnabled: Boolean(aiResult.aiEnabled),
    aiConfigured: Boolean(aiResult.aiConfigured),
    aiSucceeded: Boolean(aiResult.aiSucceeded),
    summary: aiResult.summary || '',
    reasons: Array.isArray(aiResult.reasons) ? aiResult.reasons : []
  }
})
