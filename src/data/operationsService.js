import { doc, getDoc, serverTimestamp, setDoc } from 'firebase/firestore'
import { db } from '../firebase/firestore'

const BANNER_REF = ['operations', 'bannerAlerts']
const BETA_REF = ['operations', 'keyRequiredInfo']
const PRICING_REF = ['platformSettings', 'marketplacePricing']

export function linesToArray(value) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean)
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
}

export function arrayToLines(value) {
  return Array.isArray(value) ? value.map((item) => String(item || '').trim()).filter(Boolean).join('\n') : ''
}

export function toBoolean(value) {
  if (value === true || value === false) return value
  const text = String(value || '').trim().toLowerCase()
  return ['true', '1', 'yes', 'on', 'enabled'].includes(text)
}

export function toNumber(value, fallback = 0) {
  const next = Number(value)
  return Number.isFinite(next) ? next : fallback
}

export function safeBps(value, min = 0, max = 5000) {
  return Math.min(max, Math.max(min, Math.round(toNumber(value, min))))
}

export function safeCents(value, min = 0, max = 1000) {
  return Math.min(max, Math.max(min, Math.round(toNumber(value, min))))
}

function safeInteger(value, fallback = 1, min = 0, max = 100000) {
  return Math.min(max, Math.max(min, Math.round(toNumber(value, fallback))))
}

function dateOrNull(value) {
  if (!value) return null
  if (typeof value?.toDate === 'function') return value
  const parsed = value instanceof Date ? value : new Date(String(value))
  return Number.isFinite(parsed.getTime()) ? parsed : null
}

function normalizeBannerSettings(raw = {}) {
  return {
    bannerActive: toBoolean(raw.bannerActive),
    bannerAllowedPaths: linesToArray(raw.bannerAllowedPaths),
    bannerAudience: String(raw.bannerAudience || 'all').trim() || 'all',
    bannerBlockedPaths: linesToArray(raw.bannerBlockedPaths),
    bannerButtonText: String(raw.bannerButtonText || ''),
    bannerButtonUrl: String(raw.bannerButtonUrl || ''),
    bannerColor: String(raw.bannerColor || '#20d8ff').trim() || '#20d8ff',
    bannerContent: linesToArray(raw.bannerContent),
    bannerDismissible: raw.bannerDismissible !== false,
    bannerExpiresAt: dateOrNull(raw.bannerExpiresAt),
    bannerIcon: safeInteger(raw.bannerIcon, 1, 1, 20),
    bannerPriority: safeInteger(raw.bannerPriority, 1, 0, 1000),
    bannerStartsAt: dateOrNull(raw.bannerStartsAt),
    bannerType: safeInteger(raw.bannerType, 1, 1, 20),
    bannerVersion: safeInteger(raw.bannerVersion, 1, 1, 100000)
  }
}

function normalizeBetaSettings(raw = {}) {
  return {
    allowedPublicPaths: linesToArray(raw.allowedPublicPaths),
    brandName: String(raw.brandName || 'Melogic Records'),
    bypassUntil: dateOrNull(raw.bypassUntil),
    isKeyRequired: toBoolean(raw.isKeyRequired),
    keyHash: String(raw.keyHash || '').trim(),
    keyValue: String(raw.keyValue || ''),
    keyVersion: safeInteger(raw.keyVersion, 1, 1, 100000),
    message: String(raw.message || ''),
    supportEmail: String(raw.supportEmail || ''),
    title: String(raw.title || 'Private Beta')
  }
}

function normalizePricingSettings(raw = {}) {
  const notice = raw.transactionNotice && typeof raw.transactionNotice === 'object' ? raw.transactionNotice : {}
  return {
    defaultCurrency: String(raw.defaultCurrency || 'USD').trim().toUpperCase() || 'USD',
    enabled: raw.enabled !== false,
    feeMode: String(raw.feeMode || 'seller_absorbs').trim() || 'seller_absorbs',
    platformFeeBps: safeBps(raw.platformFeeBps, 0, 5000),
    platformFeeLabel: String(raw.platformFeeLabel || 'Melogic Records Fee'),
    processorFixedFeeCents: safeCents(raw.processorFixedFeeCents, 0, 1000),
    processorPercentBps: safeBps(raw.processorPercentBps, 0, 2000),
    professorFeeLabel: String(raw.professorFeeLabel || raw.processorFeeLabel || 'Stripe Fee'),
    salesMilestones: linesToArray(raw.salesMilestones).map((item) => safeInteger(item, 0, 0, 100000000)).filter((item) => item > 0),
    supportedCurrencies: linesToArray(raw.supportedCurrencies).map((item) => item.toUpperCase()),
    transactionNotice: {
      title: String(notice.title || ''),
      commission: String(notice.commission || ''),
      processingFees: String(notice.processingFees || ''),
      supportedMethods: String(notice.supportedMethods || '')
    },
    version: safeInteger(raw.version, 1, 1, 100000)
  }
}

async function getDocument(pathParts, normalizer) {
  const snap = await getDoc(doc(db, ...pathParts))
  return snap.exists() ? normalizer(snap.data()) : normalizer()
}

async function setDocument(pathParts, payload, normalizer) {
  const data = normalizer(payload)
  await setDoc(doc(db, ...pathParts), {
    ...data,
    updatedAt: serverTimestamp()
  }, { merge: true })
  return data
}

export async function getBannerAlertSettings() {
  return getDocument(BANNER_REF, normalizeBannerSettings)
}

export async function updateBannerAlertSettings(payload = {}) {
  return setDocument(BANNER_REF, payload, normalizeBannerSettings)
}

export async function getPrivateBetaSettings() {
  return getDocument(BETA_REF, normalizeBetaSettings)
}

export async function updatePrivateBetaSettings(payload = {}) {
  return setDocument(BETA_REF, payload, normalizeBetaSettings)
}

export async function getMarketplacePricingSettings() {
  return getDocument(PRICING_REF, normalizePricingSettings)
}

export async function updateMarketplacePricingSettings(payload = {}) {
  return setDocument(PRICING_REF, payload, normalizePricingSettings)
}
