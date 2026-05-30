const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { onDocumentCreated } = require('firebase-functions/v2/firestore')
const { defineSecret, defineString } = require('firebase-functions/params')
const admin = require('firebase-admin')

const geminiApiKey = defineSecret('GEMINI_API_KEY')
const productModerationModel = defineString('PRODUCT_MODERATION_MODEL', {
  default: 'gemini-2.5-flash-lite'
})
const autoApproveProducts = defineString('AUTO_APPROVE_PRODUCTS', { default: 'false' })
const autoApproveRuleBasedOnly = defineString('AUTO_APPROVE_WITH_RULE_BASED_ONLY', { default: 'false' })

const DEFAULT_MODERATION_MODELS = [
  'gemini-2.5-flash-lite',
  'gemini-2.5-flash',
  'gemini-flash-latest'
]
const ALLOWED_MODERATION_MODELS = new Set(DEFAULT_MODERATION_MODELS)

const BLOCKED_KEYWORDS = [
  'terrorist',
  'child abuse',
  'rape',
  'kill',
  'meth',
  'cocaine'
]

function safeString(value = '', max = 240) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max)
}

function resolveModerationModelOrder(configuredModel = '') {
  const configured = safeString(configuredModel, 120)
  const ordered = []
  if (ALLOWED_MODERATION_MODELS.has(configured)) ordered.push(configured)
  DEFAULT_MODERATION_MODELS.forEach((model) => {
    if (!ordered.includes(model)) ordered.push(model)
  })
  return ordered
}

function isObviouslyInvalidGeminiSecret(apiKey = '') {
  const value = String(apiKey || '').trim()
  if (!value) return true
  if (value.length < 24) return true
  if (/\s/.test(value)) return true
  if (/^\{/.test(value)) return true
  if (/^ya29\./i.test(value)) return true
  if (/-----BEGIN/i.test(value)) return true
  if (/client_secret|oauth|service_account/i.test(value)) return true
  return false
}

function summarizeGeminiError(status = 0, body = '') {
  let parsed = null
  try { parsed = JSON.parse(String(body || '')) } catch {}
  const error = parsed?.error || {}
  const detailInfo = Array.isArray(error.details)
    ? error.details.find((detail) => detail?.reason || detail?.metadata?.method)
    : null
  const reason = safeString(detailInfo?.reason || error.status || '')
  const message = safeString(error.message || body || `Gemini HTTP ${status}`)
  const authFailure = status === 401 || status === 403 ||
    ['UNAUTHENTICATED', 'PERMISSION_DENIED', 'ACCESS_TOKEN_TYPE_UNSUPPORTED'].includes(reason) ||
    /credential|authentication|permission|api key|unauthenticated|forbidden/i.test(message)
  return {
    errorCode: authFailure ? 'gemini_auth_failed' : `gemini_http_${status || 'error'}`,
    errorCategory: authFailure ? 'auth' : status === 404 ? 'not_found' : 'http',
    error: authFailure
      ? 'Gemini authentication error. Product remains pending review.'
      : `Gemini review failed: ${message}`,
    safeMessage: message,
    status,
    reason
  }
}

function aiUnavailableResult({ configured = true, attempted = true, code = 'gemini_unavailable', category = 'unavailable', message = 'AI moderation unavailable; product remains pending review.', modelUsed = '', exhaustedModelFallbacks = false } = {}) {
  return {
    approved: true,
    reasons: [],
    riskLevel: 'unknown',
    suggestedAction: 'review_pending',
    summary: message,
    aiConfigured: configured,
    aiAttempted: attempted,
    aiSucceeded: false,
    aiEnabled: configured,
    error: message,
    errorCode: code,
    errorCategory: category,
    modelUsed,
    exhaustedModelFallbacks
  }
}

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

async function moderateProductWithAI(product = {}, { model = '', models = null, apiKey = '', fetchImpl = fetch } = {}) {
  const modelOrder = Array.isArray(models) && models.length ? models : resolveModerationModelOrder(model)
  const selectedModel = modelOrder[0] || ''
  const aiConfigured = Boolean(selectedModel && apiKey)
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
      error: '',
      errorCode: '',
      errorCategory: '',
      modelUsed: ''
    }
  }

  if (isObviouslyInvalidGeminiSecret(apiKey)) {
    return aiUnavailableResult({
      configured: true,
      attempted: false,
      code: 'gemini_secret_invalid',
      category: 'auth',
      message: 'Gemini API key is missing or invalid. Product remains pending review.',
      modelUsed: selectedModel
    })
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

  let lastFailure = null
  for (const candidateModel of modelOrder) {
    try {
      const resp = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(candidateModel)}:generateContent?key=${encodeURIComponent(apiKey)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] })
      })

      if (!resp.ok) {
        const errorText = await resp.text().catch(() => '')
        const summary = summarizeGeminiError(resp.status, errorText)
        lastFailure = {
          configured: true,
          attempted: true,
          code: summary.errorCode,
          category: summary.errorCategory,
          message: summary.error,
          modelUsed: candidateModel
        }
        if (resp.status === 404) continue
        return aiUnavailableResult(lastFailure)
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
          error: '',
          errorCode: '',
          errorCategory: '',
          modelUsed: candidateModel
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
          error: 'AI moderation returned an unreadable response.',
          errorCode: 'gemini_unreadable_response',
          errorCategory: 'response',
          modelUsed: candidateModel
        }
      }
    } catch (error) {
      return aiUnavailableResult({
        configured: true,
        attempted: true,
        code: 'gemini_request_failed',
        category: 'network',
        message: 'AI moderation unavailable; product remains pending review.',
        modelUsed: candidateModel
      })
    }
  }

  return aiUnavailableResult({
    ...(lastFailure || {
      configured: true,
      attempted: true,
      code: 'gemini_unavailable',
      category: 'unavailable',
      message: 'AI moderation unavailable; product remains pending review.',
      modelUsed: selectedModel
    }),
    exhaustedModelFallbacks: Boolean(lastFailure)
  })
}

function productHasDeliverables(product = {}) {
  const deliverableFiles = Array.isArray(product.deliverableFiles) ? product.deliverableFiles : []
  const assetSummary = product.assetSummary && typeof product.assetSummary === 'object' ? product.assetSummary : {}
  return deliverableFiles.some((file) => file?.storagePath || file?.path || file?.downloadPath) ||
    Number(assetSummary.downloadableCount || 0) > 0 ||
    Boolean(product.downloadPath || product.primaryDownloadPath)
}

function productHasRequiredReviewFields(product = {}) {
  const priceCents = Number(product.priceCents)
  const sellerAgreementAccepted = product.sellerAgreementAccepted === true || product.sellerAgreement?.accepted === true
  return Boolean(
    String(product.title || '').trim() &&
    String(product.productType || '').trim() &&
    String(product.shortDescription || product.description || '').trim() &&
    Number.isFinite(priceCents) &&
    priceCents >= 0 &&
    sellerAgreementAccepted &&
    productHasDeliverables(product)
  )
}

function productIsSafeForAIAutoApproval(product = {}, ruleResult = {}, aiResult = {}) {
  const combinedReasons = [...(ruleResult.reasons || []), ...(aiResult.reasons || [])].filter(Boolean)
  return Boolean(
    ruleResult.approved &&
    aiResult.aiSucceeded === true &&
    aiResult.suggestedAction === 'approve' &&
    ['low', 'unknown', ''].includes(String(aiResult.riskLevel || '').toLowerCase()) &&
    combinedReasons.length === 0 &&
    productHasRequiredReviewFields(product)
  )
}

function decideReviewOutcome({ product = {}, ruleResult = {}, aiResult = {}, autoApprove = false, allowRuleBasedAutoApprove = false, model = '' } = {}) {
  const aiFailed = Boolean(aiResult.aiAttempted || aiResult.aiConfigured) && aiResult.aiSucceeded !== true
  const aiAuthFailed = aiResult.errorCategory === 'auth' || aiResult.errorCode === 'gemini_auth_failed' || aiResult.errorCode === 'gemini_secret_invalid'
  const exhaustedModelFallbacks = Boolean(aiResult.exhaustedModelFallbacks)
  const aiAutoApproved = Boolean(autoApprove && productIsSafeForAIAutoApproval(product, ruleResult, aiResult))
  const ruleFallbackApproved = false
  let finalStatus = 'review_pending'
  let moderationStatus = aiFailed ? 'ai_error' : 'pending'

  if (!ruleResult.approved || aiResult.suggestedAction === 'needs_changes' || aiResult.suggestedAction === 'reject') {
    finalStatus = 'needs_changes'
    moderationStatus = 'rejected'
  } else if (aiAutoApproved) {
    finalStatus = 'published'
    moderationStatus = 'approved'
  } else if (ruleFallbackApproved) {
    finalStatus = 'published'
    moderationStatus = 'rule_based_fallback_approved'
  } else if (aiAuthFailed || exhaustedModelFallbacks) {
    moderationStatus = 'ai_error'
  }

  const reviewJobStatus = ruleFallbackApproved
    ? 'rule_based_fallback_approved'
    : aiAuthFailed && finalStatus === 'review_pending'
    ? 'failed_ai_auth'
    : aiFailed && finalStatus === 'review_pending'
    ? 'ai_failed'
    : finalStatus === 'review_pending'
    ? 'pending_manual_review'
    : 'completed'

  const summary = ruleFallbackApproved
    ? 'AI moderation failed, but rule-based moderation passed and explicit rule-based fallback auto-approval published the product.'
    : aiAuthFailed
    ? 'AI review failed: Gemini authentication error. Product remains pending review.'
    : (aiResult.summary || (finalStatus === 'review_pending' ? 'Product remains pending review.' : 'Automated moderation passed.'))

  return {
    finalStatus,
    moderationStatus,
    reviewJobStatus,
    summary,
    aiFailed,
    aiAuthFailed,
    aiAutoApproved,
    ruleFallbackApproved,
    visibility: finalStatus === 'published' ? 'public' : (product.visibility === 'public' ? 'unlisted' : (product.visibility || 'private')),
    model
  }
}

async function processReviewJob(jobId, job = {}) {
  const db = admin.firestore()
  const productId = String(job.productId || '').trim()
  if (!productId) throw new Error('Missing productId in job')
  const productRef = db.collection('products').doc(productId)
  const productSnap = await productRef.get()
  if (!productSnap.exists) throw new Error('Product not found')
  const product = productSnap.data() || {}
  const modelOrder = resolveModerationModelOrder(productModerationModel.value())
  const apiKey = geminiApiKey.value()
  const ruleResult = runRuleBasedModeration(product)
  const aiResult = await moderateProductWithAI(product, { models: modelOrder, apiKey })
  const selectedModel = aiResult.modelUsed || modelOrder[0] || ''
  const autoApprove = autoApproveProducts.value() === 'true'
  const allowRuleBasedAutoApprove = autoApproveRuleBasedOnly.value() === 'true'
  const outcome = decideReviewOutcome({ product, ruleResult, aiResult, autoApprove, allowRuleBasedAutoApprove, model: selectedModel })
  const productUpdate = {
    status: outcome.finalStatus,
    visibility: outcome.visibility,
    moderationStatus: outcome.moderationStatus,
    moderationReasons: [...(ruleResult.reasons || []), ...(aiResult.reasons || [])],
    moderationSummary: outcome.summary,
    moderationRiskLevel: aiResult.riskLevel || 'unknown',
    moderationAIConfigured: Boolean(aiResult.aiConfigured),
    moderationAIAttempted: Boolean(aiResult.aiAttempted),
    moderationAISucceeded: Boolean(aiResult.aiSucceeded),
    moderationAIEnabled: Boolean(aiResult.aiEnabled),
    moderationAIModel: selectedModel,
    moderationAIError: aiResult.error || '',
    moderationAIErrorCode: aiResult.errorCode || '',
    moderationAIErrorCategory: aiResult.errorCategory || '',
    reviewJobStatus: outcome.reviewJobStatus,
    reviewedAt: admin.firestore.FieldValue.serverTimestamp(),
    reviewedBy: 'system',
    publishedAt: outcome.finalStatus === 'published' ? admin.firestore.FieldValue.serverTimestamp() : null,
    releasedAt: outcome.finalStatus === 'published' ? (product.releasedAt || admin.firestore.FieldValue.serverTimestamp()) : (product.releasedAt || null),
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }
  if (aiResult.aiSucceeded) {
    productUpdate.moderationAICompletedAt = admin.firestore.FieldValue.serverTimestamp()
    productUpdate.moderationAIFailedAt = null
  }
  if (aiResult.aiAttempted && !aiResult.aiSucceeded) {
    productUpdate.moderationAICompletedAt = null
    productUpdate.moderationAIFailedAt = admin.firestore.FieldValue.serverTimestamp()
  }
  await productRef.set(productUpdate, { merge: true })
  await db.collection('productReviewJobs').doc(jobId).set({
    status: outcome.reviewJobStatus,
    completedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    resultStatus: outcome.finalStatus,
    moderationStatus: outcome.moderationStatus,
    aiSucceeded: Boolean(aiResult.aiSucceeded),
    aiErrorCode: aiResult.errorCode || '',
    moderationAIModel: selectedModel
  }, { merge: true })
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

  const existingJob = await db.collection('productReviewJobs').where('productId', '==', productId).where('status', 'in', ['queued', 'running']).limit(1).get()
  if (!existingJob.empty) {
    return { status: 'review_pending', reviewJobStatus: existingJob.docs[0].data().status, productId, jobId: existingJob.docs[0].id }
  }
  await productRef.set({
    status: 'review_pending',
    visibility: product.visibility === 'public' ? 'unlisted' : (product.visibility || 'private'),
    moderationStatus: 'queued',
    reviewRequestedAt: admin.firestore.FieldValue.serverTimestamp(),
    reviewRequestedBy: uid,
    reviewJobStatus: 'queued',
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge: true })
  const jobRef = await db.collection('productReviewJobs').add({
    productId,
    artistId: product.artistId || uid,
    status: 'queued',
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    attempts: 0,
    source: 'creator-submit',
    requestedBy: uid
  })
  return { status: 'review_pending', reviewJobStatus: 'queued', productId, jobId: jobRef.id }
})

exports.__test = {
  decideReviewOutcome,
  isObviouslyInvalidGeminiSecret,
  moderateProductWithAI,
  resolveModerationModelOrder,
  runRuleBasedModeration,
  summarizeGeminiError
}

exports.processProductReviewJob = onDocumentCreated({ document: 'productReviewJobs/{jobId}', secrets: [geminiApiKey], timeoutSeconds: 180, memory: '512MiB' }, async (event) => {
  const jobId = event.params.jobId
  const job = event.data?.data() || {}
  const db = admin.firestore()
  await db.collection('productReviewJobs').doc(jobId).set({ status: 'running', updatedAt: admin.firestore.FieldValue.serverTimestamp(), attempts: Number(job.attempts || 0) + 1 }, { merge: true })
  await db.collection('products').doc(String(job.productId || '')).set({ moderationStatus: 'running', reviewJobStatus: 'running', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
  try {
    await processReviewJob(jobId, job)
  } catch (error) {
    await db.collection('productReviewJobs').doc(jobId).set({ status: 'failed', error: error?.message || 'job-failed', updatedAt: admin.firestore.FieldValue.serverTimestamp(), completedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
    await db.collection('products').doc(String(job.productId || '')).set({ reviewJobStatus: 'failed', moderationStatus: 'pending', updatedAt: admin.firestore.FieldValue.serverTimestamp() }, { merge: true })
  }
})
