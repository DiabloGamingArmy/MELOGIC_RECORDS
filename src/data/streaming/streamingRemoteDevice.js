const DEVICE_KEY = 'melogic.streaming.remote.device.v1'
const SESSION_KEY = 'melogic.streaming.remote.session.v1'

function randomId(prefix = '') {
  const value = typeof window.crypto?.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return `${prefix}${value}`.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120)
}

function storedId(storage, key, prefix) {
  try {
    const existing = String(storage.getItem(key) || '').replace(/[^A-Za-z0-9_-]/g, '').slice(0, 120)
    if (existing) return existing
    const created = randomId(prefix)
    storage.setItem(key, created)
    return created
  } catch {
    return randomId(prefix)
  }
}

function browserLabel() {
  const ua = navigator.userAgent || ''
  if (/Edg\//.test(ua)) return 'Edge'
  if (/OPR\//.test(ua)) return 'Opera'
  if (/CriOS|Chrome\//.test(ua)) return 'Chrome'
  if (/FxiOS|Firefox\//.test(ua)) return 'Firefox'
  if (/Safari\//.test(ua)) return 'Safari'
  return 'Web browser'
}

function platformLabel() {
  const platform = navigator.userAgentData?.platform || navigator.platform || ''
  if (/Mac/i.test(platform)) return 'Mac'
  if (/Win/i.test(platform)) return 'Windows PC'
  if (/iPhone|iPad|iPod/i.test(platform)) return 'iPhone or iPad'
  if (/Android/i.test(navigator.userAgent || platform)) return 'Android device'
  if (/Linux/i.test(platform)) return 'Linux device'
  return 'Device'
}

export function streamingRemoteDeviceInfo() {
  const deviceId = storedId(window.localStorage, DEVICE_KEY, 'device-')
  const controlSessionId = storedId(window.sessionStorage, SESSION_KEY, 'session-')
  const mobile = /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || '')
  const browser = browserLabel()
  const platform = platformLabel()
  return {
    deviceId,
    controlSessionId,
    label: `${platform} · ${browser}`,
    browser,
    platform,
    deviceType: mobile ? 'mobile' : 'desktop'
  }
}
