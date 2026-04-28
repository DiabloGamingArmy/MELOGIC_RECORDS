import { doc, getDoc, onSnapshot } from 'firebase/firestore'
import { db } from '../firebase/firestore'

const FALLBACK_MARKETPLACE_PRICING_SETTINGS = Object.freeze({
  enabled: true,
  version: 1,
  defaultCurrency: 'USD',
  supportedCurrencies: ['USD'],
  platformFeeLabel: 'Melogic Records Fee',
  platformFeeBps: 1500,
  processorFeeLabel: 'Stripe Fee',
  processorPercentBps: 290,
  processorFixedFeeCents: 30,
  feeMode: 'seller_absorbs',
  salesMilestones: [100, 1000, 100000],
  transactionNotice: {
    title: 'Transactions Notice:',
    commission: 'Commission: Our platform applies a standard 15% commission on all digital product sales.',
    processingFees: 'Processing Fees: Transactions are subject to standard third-party processing fees, which are deducted prior to payout.',
    supportedMethods: 'Supported Methods: Buyers can purchase via Credit Card, Apple Pay, and PayPal. Sellers can receive payouts via Direct Deposit or PayPal.'
  },
  updatedAt: null
})

function isDevEnvironment() {
  return typeof import.meta !== 'undefined' && Boolean(import.meta?.env?.DEV)
}

function devWarn(...args) {
  if (isDevEnvironment()) console.warn(...args)
}

function asPositiveInteger(value, fallback) {
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? Math.round(parsed) : fallback
}

export function normalizeMarketplacePricingSettings(raw = {}) {
  const fallback = FALLBACK_MARKETPLACE_PRICING_SETTINGS
  const supportedCurrencies = Array.isArray(raw.supportedCurrencies)
    ? raw.supportedCurrencies.map((item) => String(item || '').trim().toUpperCase()).filter(Boolean)
    : fallback.supportedCurrencies
  const defaultCurrency = String(raw.defaultCurrency || fallback.defaultCurrency).trim().toUpperCase() || fallback.defaultCurrency
  const normalizedCurrencies = supportedCurrencies.length
    ? supportedCurrencies
    : [defaultCurrency]
  const milestones = Array.isArray(raw.salesMilestones)
    ? raw.salesMilestones.map((value) => asPositiveInteger(value, 0)).filter((value) => value > 0)
    : fallback.salesMilestones

  return {
    enabled: raw.enabled !== false,
    version: asPositiveInteger(raw.version, fallback.version),
    defaultCurrency: normalizedCurrencies.includes(defaultCurrency) ? defaultCurrency : normalizedCurrencies[0],
    supportedCurrencies: normalizedCurrencies,
    platformFeeLabel: String(raw.platformFeeLabel || fallback.platformFeeLabel).trim() || fallback.platformFeeLabel,
    platformFeeBps: asPositiveInteger(raw.platformFeeBps, fallback.platformFeeBps),
    processorFeeLabel: String(raw.processorFeeLabel || fallback.processorFeeLabel).trim() || fallback.processorFeeLabel,
    processorPercentBps: asPositiveInteger(raw.processorPercentBps, fallback.processorPercentBps),
    processorFixedFeeCents: asPositiveInteger(raw.processorFixedFeeCents, fallback.processorFixedFeeCents),
    feeMode: String(raw.feeMode || fallback.feeMode).trim() || fallback.feeMode,
    salesMilestones: milestones.length ? milestones : fallback.salesMilestones,
    transactionNotice: {
      title: String(raw.transactionNotice?.title || fallback.transactionNotice.title).trim() || fallback.transactionNotice.title,
      commission: String(raw.transactionNotice?.commission || fallback.transactionNotice.commission).trim() || fallback.transactionNotice.commission,
      processingFees: String(raw.transactionNotice?.processingFees || fallback.transactionNotice.processingFees).trim() || fallback.transactionNotice.processingFees,
      supportedMethods: String(raw.transactionNotice?.supportedMethods || fallback.transactionNotice.supportedMethods).trim() || fallback.transactionNotice.supportedMethods
    },
    updatedAt: raw.updatedAt || null
  }
}

export async function getMarketplacePricingSettings() {
  if (!db) return { ...FALLBACK_MARKETPLACE_PRICING_SETTINGS }
  try {
    const snapshot = await getDoc(doc(db, 'platformSettings', 'marketplacePricing'))
    if (!snapshot.exists()) {
      devWarn('[marketplaceSettingsService] Missing platformSettings/marketplacePricing; using fallback values in development.')
      return { ...FALLBACK_MARKETPLACE_PRICING_SETTINGS }
    }
    return normalizeMarketplacePricingSettings(snapshot.data() || {})
  } catch (error) {
    devWarn('[marketplaceSettingsService] Failed to load platformSettings/marketplacePricing; using fallback values in development.', error?.code || error?.message || error)
    return { ...FALLBACK_MARKETPLACE_PRICING_SETTINGS }
  }
}

export function subscribeToMarketplacePricingSettings(callback = () => {}, onError = null) {
  if (!db || typeof callback !== 'function') return () => {}
  return onSnapshot(
    doc(db, 'platformSettings', 'marketplacePricing'),
    (snapshot) => {
      if (!snapshot.exists()) {
        devWarn('[marketplaceSettingsService] Missing platformSettings/marketplacePricing; using fallback values in development.')
        callback({ ...FALLBACK_MARKETPLACE_PRICING_SETTINGS })
        return
      }
      callback(normalizeMarketplacePricingSettings(snapshot.data() || {}))
    },
    (error) => {
      if (typeof onError === 'function') onError(error)
      devWarn('[marketplaceSettingsService] Realtime marketplace pricing subscription failed.', error?.code || error?.message || error)
    }
  )
}
