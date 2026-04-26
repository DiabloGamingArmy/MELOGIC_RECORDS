import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'

let appCheckInstance = null
let hasWarnedDisabled = false

function shouldEnableAppCheck(siteKey) {
  if (!siteKey) return false
  if (import.meta.env.PROD) return true
  return import.meta.env.VITE_ENABLE_APP_CHECK === 'true'
}

export function initAppCheck(app) {
  if (!app || appCheckInstance) return appCheckInstance

  const appCheckSiteKey = String(import.meta.env.VITE_APPCHECK_RECAPTCHA_ENTERPRISE_SITE_KEY || '').trim()
  const authSiteKey = String(import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY || '').trim()
  let siteKey = appCheckSiteKey

  if (!siteKey && authSiteKey) {
    siteKey = authSiteKey
    console.warn('[firebase/appCheck] Using auth reCAPTCHA site key fallback for App Check. Configure VITE_APPCHECK_RECAPTCHA_ENTERPRISE_SITE_KEY to avoid cross-key collisions.')
  }

  if (import.meta.env.PROD && !appCheckSiteKey) {
    console.warn('[firebase/appCheck] Missing VITE_APPCHECK_RECAPTCHA_ENTERPRISE_SITE_KEY in production; App Check may use a fallback key or fail to initialize.')
  }

  if (!shouldEnableAppCheck(siteKey)) {
    if (import.meta.env.DEV && !hasWarnedDisabled) {
      hasWarnedDisabled = true
      console.warn('[firebase/appCheck] App Check disabled (missing site key or not enabled in development).')
    }
    return null
  }

  appCheckInstance = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true
  })

  return appCheckInstance
}
