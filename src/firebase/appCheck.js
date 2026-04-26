import { initializeAppCheck, ReCaptchaEnterpriseProvider } from 'firebase/app-check'

let appCheckInstance = null
let hasWarnedDisabled = false

function isAuthPagePath() {
  if (typeof window === 'undefined') return false
  const pathname = String(window.location?.pathname || '').toLowerCase()
  return pathname === '/auth.html' || pathname.includes('auth')
}

function getAppCheckEnablement(siteKey) {
  if (!siteKey) {
    return { enabled: false, reason: 'missing site key' }
  }

  const flag = String(import.meta.env.VITE_ENABLE_APP_CHECK || '').trim().toLowerCase()
  if (flag === 'true') {
    return { enabled: true, reason: 'explicitly enabled by VITE_ENABLE_APP_CHECK=true' }
  }
  if (flag === 'false') {
    return { enabled: false, reason: 'explicitly disabled by VITE_ENABLE_APP_CHECK=false' }
  }

  if (import.meta.env.PROD) {
    return { enabled: true, reason: 'default enabled in production when flag is unset' }
  }

  return { enabled: false, reason: 'default disabled in development when flag is unset' }
}

export function initAppCheck(app) {
  if (!app || appCheckInstance) return appCheckInstance

  if (isAuthPagePath()) {
    console.warn('[firebase/appCheck] App Check skipped on auth page to avoid reCAPTCHA Enterprise collision.')
    return null
  }

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

  const { enabled, reason } = getAppCheckEnablement(siteKey)

  if (!enabled) {
    if (!hasWarnedDisabled) {
      hasWarnedDisabled = true
      const envLabel = import.meta.env.PROD ? 'production' : 'development'
      console.warn(`[firebase/appCheck] App Check disabled in ${envLabel} (${reason}).`)
    }
    return null
  }

  appCheckInstance = initializeAppCheck(app, {
    provider: new ReCaptchaEnterpriseProvider(siteKey),
    isTokenAutoRefreshEnabled: true
  })

  return appCheckInstance
}
