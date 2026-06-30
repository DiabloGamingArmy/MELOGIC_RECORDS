import { doc, getDoc } from 'firebase/firestore'
import { httpsCallable } from 'firebase/functions'
import { db } from '../firebase/firestore'
import { functions } from '../firebase/functions'

function safeStringList(value = []) {
  return (Array.isArray(value) ? value : []).map(String).map((item) => item.trim()).filter(Boolean)
}

function normalizeConnect(data = {}) {
  return {
    hasAccount: data.hasAccount === true,
    accountType: String(data.accountType || 'express'),
    detailsSubmitted: data.detailsSubmitted === true,
    chargesEnabled: data.chargesEnabled === true,
    payoutsEnabled: data.payoutsEnabled === true,
    disabledReason: String(data.disabledReason || ''),
    currentlyDue: safeStringList(data.currentlyDue),
    eventuallyDue: safeStringList(data.eventuallyDue),
    pastDue: safeStringList(data.pastDue),
    pendingVerification: safeStringList(data.pendingVerification),
    livemode: data.livemode === true,
    updatedAt: data.updatedAt || null,
    statusRefreshedAt: data.statusRefreshedAt || null
  }
}

function currencyMap(value = {}) {
  if (!value || typeof value !== 'object') return {}
  return Object.fromEntries(Object.entries(value).map(([currency, amount]) => [
    String(currency || '').toUpperCase(),
    Math.max(0, Math.round(Number(amount || 0)))
  ]).filter(([currency]) => Boolean(currency)))
}

function normalizeEarningsSummary(data = {}) {
  return {
    pendingByCurrency: currencyMap(data.pendingByCurrency),
    availableByCurrency: currencyMap(data.availableByCurrency),
    withdrawnByCurrency: currencyMap(data.withdrawnByCurrency),
    lifetimeGrossByCurrency: currencyMap(data.lifetimeGrossByCurrency),
    lifetimeNetByCurrency: currencyMap(data.lifetimeNetByCurrency),
    pendingAmount: Math.max(0, Math.round(Number(data.pendingAmount || 0))),
    availableAmount: Math.max(0, Math.round(Number(data.availableAmount || 0))),
    withdrawnAmount: Math.max(0, Math.round(Number(data.withdrawnAmount || 0))),
    lifetimeNetAmount: Math.max(0, Math.round(Number(data.lifetimeNetAmount || 0))),
    currency: String(data.currency || 'USD').toUpperCase(),
    entryCount: Math.max(0, Number(data.entryCount || 0)),
    unfinalizedEntryCount: Math.max(0, Number(data.unfinalizedEntryCount || 0)),
    updatedAt: data.updatedAt || null
  }
}

export async function getBillingPayoutData(uid = '') {
  const userId = String(uid || '').trim()
  if (!db || !userId) return { connect: normalizeConnect(), earningsSummary: normalizeEarningsSummary() }
  const [connectSnap, summarySnap] = await Promise.all([
    getDoc(doc(db, 'users', userId, 'billing', 'connect')),
    getDoc(doc(db, 'users', userId, 'earningsSummary', 'current'))
  ])
  return {
    connect: normalizeConnect(connectSnap?.exists() ? connectSnap.data() || {} : {}),
    earningsSummary: normalizeEarningsSummary(summarySnap?.exists() ? summarySnap.data() || {} : {})
  }
}

export async function createStripeConnectAccount() {
  const callable = httpsCallable(functions, 'createStripeConnectAccount')
  const result = await callable({})
  return {
    ...(result.data || {}),
    connect: normalizeConnect(result.data?.connect || {})
  }
}

export async function createStripeConnectOnboardingLink() {
  const callable = httpsCallable(functions, 'createStripeConnectOnboardingLink')
  const result = await callable({})
  return result.data || {}
}

export async function createCreatorWithdrawalRequest({ amountCents = 0, currency = 'USD', mode = 'standard', clientRequestId = '' } = {}) {
  const callable = httpsCallable(functions, 'createCreatorWithdrawalRequest')
  const result = await callable({
    amountCents,
    currency,
    mode,
    clientRequestId
  })
  return result.data || {}
}

export async function refreshStripeConnectStatus() {
  const callable = httpsCallable(functions, 'refreshStripeConnectStatus')
  const result = await callable({})
  return {
    ...(result.data || {}),
    connect: normalizeConnect(result.data?.connect || {})
  }
}
