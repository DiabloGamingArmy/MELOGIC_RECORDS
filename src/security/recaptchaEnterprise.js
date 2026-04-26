let recaptchaLoadPromise = null
const AUTH_SCRIPT_SELECTOR = 'script[data-recaptcha-enterprise-auth="true"]'

export function getRecaptchaSiteKey() {
  return String(import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY || '').trim()
}

export function isRecaptchaAuthEnabled() {
  const siteKey = getRecaptchaSiteKey()
  return Boolean(siteKey) && import.meta.env.VITE_RECAPTCHA_ENTERPRISE_AUTH_ENABLED !== 'false'
}

function waitForEnterpriseApi(timeoutMs = 3000) {
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

function loadScript(src, siteKey) {
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
    recaptchaLoadPromise = Promise.reject(new Error('Security verification is not configured.'))
    return recaptchaLoadPromise
  }

  recaptchaLoadPromise = new Promise((resolve, reject) => {
    const existingScript = getAuthScript(siteKey)
    if (existingScript) {
      waitForEnterpriseApi().then(resolve).catch(reject)
      return
    }

    const googleSrc = `https://www.google.com/recaptcha/enterprise.js?render=${encodeURIComponent(siteKey)}`
    const recaptchaNetSrc = `https://www.recaptcha.net/recaptcha/enterprise.js?render=${encodeURIComponent(siteKey)}`

    loadScript(googleSrc, siteKey)
      .catch(() => loadScript(recaptchaNetSrc, siteKey))
      .then(() => waitForEnterpriseApi())
      .then(resolve)
      .catch(reject)
  })

  return recaptchaLoadPromise
}

export async function executeRecaptchaAction(action = 'LOGIN') {
  const siteKey = getRecaptchaSiteKey()
  const enterprise = await loadRecaptchaEnterprise()

  return new Promise((resolve, reject) => {
    if (!enterprise) {
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
        reject(error)
      }
    })
  })
}
