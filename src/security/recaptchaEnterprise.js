let recaptchaLoadPromise = null
const AUTH_SCRIPT_SELECTOR = 'script[data-recaptcha-enterprise-auth="true"]'
const ENTERPRISE_TIMEOUT_MS = 5000

function getSiteKeyHint(siteKey) {
  if (!siteKey) return 'missing'
  if (siteKey.length <= 8) return siteKey
  return `${siteKey.slice(0, 4)}...${siteKey.slice(-4)}`
}

function logDevDebug(message, data) {
  if (!import.meta.env.DEV) return
  if (typeof data === 'undefined') {
    console.debug(`[recaptchaEnterprise] ${message}`)
    return
  }
  console.debug(`[recaptchaEnterprise] ${message}`, data)
}

export function getRecaptchaSiteKey() {
  return String(import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY || '').trim()
}

export function isRecaptchaAuthEnabled() {
  const siteKey = getRecaptchaSiteKey()
  return Boolean(siteKey) && import.meta.env.VITE_RECAPTCHA_ENTERPRISE_AUTH_ENABLED !== 'false'
}

function waitForEnterpriseApi(timeoutMs = ENTERPRISE_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const check = () => {
      if (window.grecaptcha?.enterprise) {
        resolve(window.grecaptcha.enterprise)
        return
      }

      if (Date.now() - startedAt >= timeoutMs) {
        reject(new Error('Security verification could not load. Please refresh and try again.'))
        return
      }

      window.setTimeout(check, 50)
    }

    check()
  })
}

function getAuthScript(siteKey) {
  const script = document.querySelector(AUTH_SCRIPT_SELECTOR)
  if (!script) return null
  if (script.dataset.siteKey !== siteKey) return null
  return script
}

function clearStaleAuthScripts(siteKey) {
  const scripts = Array.from(document.querySelectorAll(AUTH_SCRIPT_SELECTOR))
  scripts.forEach((script) => {
    if (script.dataset.siteKey !== siteKey) {
      logDevDebug('Removing stale auth reCAPTCHA script.', {
        staleSiteKeyHint: getSiteKeyHint(script.dataset.siteKey || ''),
        currentSiteKeyHint: getSiteKeyHint(siteKey)
      })
      script.remove()
    }
  })
}

function loadScript(src, siteKey) {
  const host = src.includes('recaptcha.net') ? 'recaptcha.net' : 'google.com'
  logDevDebug('Loading reCAPTCHA enterprise script host.', {
    host,
    siteKeyHint: getSiteKeyHint(siteKey)
  })

  return new Promise((resolve, reject) => {
    const script = document.createElement('script')
    script.src = src
    script.async = true
    script.defer = true
    script.dataset.recaptchaEnterpriseAuth = 'true'
    script.dataset.siteKey = siteKey
    script.onload = () => resolve()
    script.onerror = () => {
      script.remove()
      reject(new Error('Failed to load reCAPTCHA Enterprise script.'))
    }
    document.head.appendChild(script)
  })
}

export function loadRecaptchaEnterprise() {
  if (recaptchaLoadPromise) return recaptchaLoadPromise

  const siteKey = getRecaptchaSiteKey()
  if (!siteKey) {
    return Promise.reject(new Error('Security verification is not configured.'))
  }

  clearStaleAuthScripts(siteKey)

  recaptchaLoadPromise = new Promise((resolve, reject) => {
    const existingScript = getAuthScript(siteKey)
    if (existingScript) {
      waitForEnterpriseApi().then(resolve).catch((error) => {
        recaptchaLoadPromise = null
        reject(error)
      })
      return
    }

    const googleSrc = `https://www.google.com/recaptcha/enterprise.js?render=${encodeURIComponent(siteKey)}`
    const recaptchaNetSrc = `https://www.recaptcha.net/recaptcha/enterprise.js?render=${encodeURIComponent(siteKey)}`

    loadScript(googleSrc, siteKey)
      .catch(() => loadScript(recaptchaNetSrc, siteKey))
      .then(() => waitForEnterpriseApi())
      .then(resolve)
      .catch((error) => {
        recaptchaLoadPromise = null
        reject(error)
      })
  })

  return recaptchaLoadPromise
}

function registerRecaptchaDiag(siteKey) {
  if (!import.meta.env.DEV) return
  window.__MELOGIC_RECAPTCHA_DIAG__ = () => {
    const recaptchaScripts = Array.from(document.querySelectorAll('script[src*="recaptcha"]')).map((script) => script.src)
    const authScriptKeys = Array.from(document.querySelectorAll(AUTH_SCRIPT_SELECTOR)).map((script) => script.dataset.siteKey || '')

    return {
      recaptchaScripts,
      authRecaptchaSiteKeys: authScriptKeys,
      enterpriseReady: Boolean(window.grecaptcha?.enterprise),
      currentSiteKeyHint: getSiteKeyHint(siteKey)
    }
  }
}

export async function executeRecaptchaAction(action = 'LOGIN') {
  const siteKey = getRecaptchaSiteKey()
  registerRecaptchaDiag(siteKey)
  logDevDebug('Starting executeRecaptchaAction.', {
    action,
    siteKeyHint: getSiteKeyHint(siteKey)
  })

  let enterprise
  try {
    enterprise = await loadRecaptchaEnterprise()
  } catch (error) {
    recaptchaLoadPromise = null
    logDevDebug('executeRecaptchaAction setup failed.', {
      action,
      message: error?.message || 'unknown'
    })
    throw error
  }

  return new Promise((resolve, reject) => {
    if (!enterprise) {
      recaptchaLoadPromise = null
      reject(new Error('Security verification could not load. Please refresh and try again.'))
      return
    }

    enterprise.ready(async () => {
      try {
        const token = await enterprise.execute(siteKey, { action })
        if (!token) {
          reject(new Error('Security verification failed. Please try again.'))
          return
        }
        resolve(token)
      } catch (error) {
        recaptchaLoadPromise = null
        logDevDebug('executeRecaptchaAction failed.', {
          action,
          message: error?.message || 'unknown'
        })
        reject(error)
      }
    })
  })
}
