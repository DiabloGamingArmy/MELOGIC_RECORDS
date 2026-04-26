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

  const siteKey = String(
    import.meta.env.VITE_APPCHECK_RECAPTCHA_ENTERPRISE_SITE_KEY ||
    import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY ||
    ''
  ).trim()
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
