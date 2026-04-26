const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { defineSecret } = require('firebase-functions/params')

const RECAPTCHA_ENTERPRISE_API_KEY = defineSecret('RECAPTCHA_ENTERPRISE_API_KEY')

const PROJECT_ID = process.env.GCLOUD_PROJECT || 'melogic-records'
const SITE_KEY =
  process.env.AUTH_RECAPTCHA_ENTERPRISE_SITE_KEY ||
  process.env.RECAPTCHA_ENTERPRISE_SITE_KEY ||
  '6LfCgsssAAAAADPv2fFgoS9Eyi9G4jkyicLSuUOv'
const THRESHOLDS = {
  LOGIN: 0.3,
  SIGNUP: 0.5,
  GOOGLE_LOGIN: 0.3
}

exports.verifyRecaptchaEnterprise = onCall({ secrets: [RECAPTCHA_ENTERPRISE_API_KEY] }, async (request) => {
  const token = String(request.data?.token || '').trim()
  const action = String(request.data?.action || '').trim().toUpperCase()

  if (!token || !action || !(action in THRESHOLDS)) {
    throw new HttpsError('failed-precondition', 'Security verification failed. Please try again.')
  }

  const apiKey = RECAPTCHA_ENTERPRISE_API_KEY.value()
  const inEmulator = process.env.FUNCTIONS_EMULATOR === 'true'
  if (!apiKey) {
    if (inEmulator) {
      return { ok: true, score: 0.9, action, emulatorBypass: true }
    }
    throw new HttpsError('failed-precondition', 'Security verification failed. Please try again.')
  }

  const endpoint = `https://recaptchaenterprise.googleapis.com/v1/projects/${PROJECT_ID}/assessments?key=${encodeURIComponent(apiKey)}`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      event: {
        token,
        expectedAction: action,
        siteKey: SITE_KEY
      }
    })
  }).catch(() => null)

  if (!response || !response.ok) {
    console.warn('[verifyRecaptchaEnterprise] Assessment request failed.', {
      status: response?.status ?? null
    })
    throw new HttpsError('failed-precondition', 'Security verification failed. Please try again.')
  }

  const data = await response.json().catch(() => null)
  const validToken = Boolean(data?.tokenProperties?.valid)
  const responseAction = String(data?.tokenProperties?.action || '')
  const score = Number(data?.riskAnalysis?.score ?? 0)
  const scoreThreshold = THRESHOLDS[action] ?? 0.5

  if (!validToken || responseAction !== action || score < scoreThreshold) {
    console.warn('[verifyRecaptchaEnterprise] Verification rejected.', {
      action,
      responseAction,
      score,
      threshold: scoreThreshold,
      validToken
    })
    throw new HttpsError('failed-precondition', 'Security verification failed. Please try again.')
  }

  return { ok: true, score, action }
})
