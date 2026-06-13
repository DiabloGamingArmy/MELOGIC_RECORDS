function safeUserAgent() {
  return typeof navigator === 'undefined' ? '' : String(navigator.userAgent || '')
}

function detectBrowserName(userAgent = safeUserAgent()) {
  if (/Edg\//i.test(userAgent)) return 'Edge'
  if (/CriOS|Chrome\//i.test(userAgent) && !/Edg\//i.test(userAgent)) return 'Chrome'
  if (/FxiOS|Firefox\//i.test(userAgent)) return 'Firefox'
  if (/Safari\//i.test(userAgent) && !/Chrome|CriOS|Edg\//i.test(userAgent)) return 'Safari'
  return 'Unknown'
}

function detectOsName(userAgent = safeUserAgent()) {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'iOS'
  if (/Android/i.test(userAgent)) return 'Android'
  if (/Macintosh|Mac OS X/i.test(userAgent)) return 'macOS'
  if (/Windows/i.test(userAgent)) return 'Windows'
  if (/Linux/i.test(userAgent)) return 'Linux'
  return 'Unknown'
}

export function detectPlatformCapabilities() {
  const userAgent = safeUserAgent()
  const isIos = /iPhone|iPad|iPod/i.test(userAgent)
  const isAndroid = /Android/i.test(userAgent)
  const coarsePointer = typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)')?.matches === true
  const narrowViewport = typeof window !== 'undefined' && window.matchMedia?.('(max-width: 760px)')?.matches === true
  const isMobile = isIos || isAndroid || (coarsePointer && narrowViewport)
  const standaloneMedia = typeof window !== 'undefined' && window.matchMedia?.('(display-mode: standalone)')?.matches === true
  const isPwaStandalone = standaloneMedia || (typeof navigator !== 'undefined' && navigator.standalone === true)
  const likelyNativeWrapper = typeof window !== 'undefined' && Boolean(
    window.Capacitor
    || window.ReactNativeWebView
    || window.webkit?.messageHandlers?.melogicNative
  )
  const browserName = detectBrowserName(userAgent)
  const osName = detectOsName(userAgent)

  return {
    isDesktop: !isMobile,
    isMobile,
    isPwaStandalone,
    isIos,
    isAndroid,
    isSafari: browserName === 'Safari',
    isChrome: browserName === 'Chrome',
    isSecureContext: typeof window !== 'undefined' && window.isSecureContext === true,
    supportsContactPicker: typeof navigator !== 'undefined' && typeof navigator.contacts?.select === 'function',
    supportsFilePicker: typeof window !== 'undefined' && (
      typeof window.showOpenFilePicker === 'function'
      || typeof document !== 'undefined'
    ),
    supportsClipboard: typeof navigator !== 'undefined' && Boolean(navigator.clipboard),
    supportsShare: typeof navigator !== 'undefined' && typeof navigator.share === 'function',
    supportsNotifications: typeof window !== 'undefined' && 'Notification' in window,
    supportsPush: typeof window !== 'undefined' && 'PushManager' in window,
    likelyNativeWrapper,
    browserName,
    osName,
    platform: likelyNativeWrapper
      ? 'native-wrapper'
      : isPwaStandalone
        ? 'pwa'
        : isMobile
          ? 'mobile-web'
          : 'desktop-web'
  }
}

export function platformRecommendation(capabilities = detectPlatformCapabilities()) {
  if (capabilities.likelyNativeWrapper) {
    return {
      title: 'Native contact access available',
      body: 'Use the app contact permission flow when enabled. Username search remains available without sharing contacts.'
    }
  }
  if (capabilities.supportsContactPicker) {
    return {
      title: 'Choose only the contacts you want',
      body: 'This browser supports selective contact access. Melogic will never open your address book without your action.'
    }
  }
  if (capabilities.isMobile) {
    return {
      title: 'Mobile web discovery',
      body: 'Contact Picker is unavailable here. Use username search or import a CSV/vCard file you choose.'
    }
  }
  return {
    title: 'Desktop web discovery',
    body: 'Username search and manual CSV/vCard import are the most reliable options on this device.'
  }
}
