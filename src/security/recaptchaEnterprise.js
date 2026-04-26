let recaptchaLoadPromise = null

export function getRecaptchaSiteKey() {
  return String(import.meta.env.VITE_RECAPTCHA_ENTERPRISE_SITE_KEY || '').trim()
}

export function isRecaptchaAuthEnabled() {
  const siteKey = getRecaptchaSiteKey()
  return Boolean(siteKey) && import.meta.env.VITE_RECAPTCHA_ENTERPRISE_AUTH_ENABLED !== 'false'
}

export function loadRecaptchaEnterprise() {
  if (recaptchaLoadPromise) return recaptchaLoadPromise

  const siteKey = getRecaptchaSiteKey()
  if (!siteKey) {
    recaptchaLoadPromise = Promise.reject(new Error('Security verification is not configured.'))
    return recaptchaLoadPromise
  }

  recaptchaLoadPromise = new Promise((resolve, reject) => {
    if (window.grecaptcha?.enterprise) {
      resolve(window.grecaptcha.enterprise)
      return
    }

    const existingScript = document.querySelector('[data-recaptcha-enterprise]')
    if (existingScript) {
      existingScript.addEventListener('load', () => resolve(window.grecaptcha?.enterprise))
      existingScript.addEventListener('error', () => reject(new Error('Failed to load reCAPTCHA Enterprise script.')))
      return
    }

    const script = document.createElement('script')
    script.src = `https://www.google.com/recaptcha/enterprise.js?render=${encodeURIComponent(siteKey)}`
    script.async = true
    script.defer = true
    script.dataset.recaptchaEnterprise = 'true'
    script.onload = () => resolve(window.grecaptcha?.enterprise)
    script.onerror = () => reject(new Error('Failed to load reCAPTCHA Enterprise script.'))
    document.head.appendChild(script)
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
