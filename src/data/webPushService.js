import { doc, serverTimestamp, setDoc, updateDoc, getDoc, deleteDoc } from 'firebase/firestore'
import { db } from '../firebase/firestore'

const SW_URL = '/melogic-push-sw.js'
const VAPID_PUBLIC_KEY = String(import.meta.env.VITE_WEB_PUSH_VAPID_PUBLIC_KEY || '').trim()

function base64UrlToUint8Array(value = '') {
  const padding = '='.repeat((4 - value.length % 4) % 4)
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map((char) => char.charCodeAt(0)))
}

async function sha256Hex(value = '') {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

export function getWebPushCapability() {
  return {
    supported: Boolean(window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window),
    secureContext: window.isSecureContext,
    permission: 'Notification' in window ? Notification.permission : 'unsupported',
    vapidConfigured: Boolean(VAPID_PUBLIC_KEY),
    standalone: window.matchMedia?.('(display-mode: standalone)')?.matches === true || navigator.standalone === true
  }
}

export async function ensureMelogicPushServiceWorker() {
  if (!('serviceWorker' in navigator)) throw new Error('Service workers are not supported on this device.')
  return navigator.serviceWorker.register(SW_URL, { scope: '/' })
}

export async function getCurrentWebPushSubscription() {
  if (!('serviceWorker' in navigator)) return null

  // State reads must be side-effect free. The diagnostic proved the active
  // root-scoped registration is authoritative, so read navigator.serviceWorker.ready
  // instead of re-registering the worker every time the UI asks for state.
  const registration = await navigator.serviceWorker.ready
  return registration.pushManager.getSubscription()
}

export async function enableWebPushForUser(uid) {
  if (!uid) throw new Error('Sign in before enabling push notifications.')
  const capability = getWebPushCapability()
  if (!capability.supported) throw new Error('Web Push is not supported in this browser or context.')
  if (!VAPID_PUBLIC_KEY) throw new Error('Melogic Web Push server key has not been configured yet.')

  // This function MUST be invoked directly from a user click/tap handler.
  const permission = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission()
  if (permission !== 'granted') throw new Error('Notification permission was not granted.')

  const registration = await ensureMelogicPushServiceWorker()
  let subscription = await registration.pushManager.getSubscription()
  if (!subscription) {
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToUint8Array(VAPID_PUBLIC_KEY)
    })
  }

  const json = subscription.toJSON()
  const id = (await sha256Hex(subscription.endpoint)).slice(0, 40)
  const subscriptionRef = doc(db, 'users', uid, 'pushSubscriptions', id)

  // A browser may reuse the same push endpoint after unsubscribe/re-subscribe.
  // Because the document ID is derived from that endpoint, this can be an
  // UPDATE rather than a CREATE. Keep createdAt immutable on re-enrollment so
  // Firestore's update allowlist is satisfied.
  const subscriptionData = {
    endpoint: json.endpoint,
    expirationTime: json.expirationTime || null,
    keys: {
      p256dh: json.keys?.p256dh || '',
      auth: json.keys?.auth || ''
    },
    platform: navigator.platform || '',
    userAgent: navigator.userAgent || '',
    standalone: capability.standalone,
    enabled: true,
    updatedAt: serverTimestamp()
  }

  const existing = await getDoc(subscriptionRef)
  if (existing.exists()) {
    await updateDoc(subscriptionRef, subscriptionData)
  } else {
    await setDoc(subscriptionRef, {
      ...subscriptionData,
      createdAt: serverTimestamp()
    })
  }

  return { subscription, id }
}

export async function disableWebPushForUser(uid) {
  if (!uid) throw new Error('Sign in before changing push notifications.')
  const registration = await ensureMelogicPushServiceWorker()
  const subscription = await registration.pushManager.getSubscription()
  if (!subscription) return { disabled: true, subscription: null }

  const id = (await sha256Hex(subscription.endpoint)).slice(0, 40)
  const unsubscribed = await subscription.unsubscribe()

  // Do not lie to the UI or delete the server record if the browser did not
  // actually revoke the subscription.
  const remaining = await registration.pushManager.getSubscription()
  if (!unsubscribed || remaining) {
    throw new Error('This browser did not revoke the push subscription. Please try again.')
  }

  await deleteDoc(doc(db, 'users', uid, 'pushSubscriptions', id))
  return { disabled: true, subscription: null }
}
