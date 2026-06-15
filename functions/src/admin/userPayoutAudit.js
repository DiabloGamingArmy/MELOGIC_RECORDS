const { cleanString } = require('./adminAuth')
const { db, safeSummaryValue, serializeDate } = require('./adminListShared')

function safeStringList(value = []) {
  return (Array.isArray(value) ? value : [])
    .map((item) => cleanString(item, 180))
    .filter(Boolean)
    .slice(0, 100)
}

function connectAudit(data = {}) {
  return {
    hasAccount: data.hasAccount === true,
    accountType: cleanString(data.accountType || 'express', 40),
    detailsSubmitted: data.detailsSubmitted === true,
    chargesEnabled: data.chargesEnabled === true,
    payoutsEnabled: data.payoutsEnabled === true,
    disabledReason: cleanString(data.disabledReason || '', 180),
    currentlyDue: safeStringList(data.currentlyDue),
    eventuallyDue: safeStringList(data.eventuallyDue),
    pastDue: safeStringList(data.pastDue),
    pendingVerification: safeStringList(data.pendingVerification),
    livemode: data.livemode === true,
    createdAt: serializeDate(data.createdAt),
    updatedAt: serializeDate(data.updatedAt),
    statusRefreshedAt: serializeDate(data.statusRefreshedAt)
  }
}

function ledgerAuditRow(docSnap) {
  const data = docSnap.data() || {}
  return {
    id: docSnap.id,
    creatorUid: cleanString(data.creatorUid || '', 180),
    productId: cleanString(data.productId || '', 180),
    orderId: cleanString(data.orderId || '', 180),
    stripeCheckoutSessionId: cleanString(data.stripeCheckoutSessionId || '', 180),
    grossAmount: Number.isFinite(Number(data.grossAmount)) ? Math.max(0, Math.round(Number(data.grossAmount))) : null,
    platformFeeAmount: Number.isFinite(Number(data.platformFeeAmount)) ? Math.max(0, Math.round(Number(data.platformFeeAmount))) : null,
    stripeFeeAmount: Number.isFinite(Number(data.stripeFeeAmount)) ? Math.max(0, Math.round(Number(data.stripeFeeAmount))) : null,
    creatorNetAmount: Number.isFinite(Number(data.creatorNetAmount)) ? Math.max(0, Math.round(Number(data.creatorNetAmount))) : null,
    currency: cleanString(data.currency || 'USD', 12).toUpperCase(),
    status: cleanString(data.status || 'pending', 40),
    availableAt: serializeDate(data.availableAt),
    createdAt: serializeDate(data.createdAt),
    updatedAt: serializeDate(data.updatedAt)
  }
}

async function loadUserPayoutAudit(uid = '') {
  const [connectSnap, summarySnap, ledgerSnap] = await Promise.all([
    db().doc(`users/${uid}/billing/connect`).get(),
    db().doc(`users/${uid}/earningsSummary/current`).get(),
    db().collection('creatorLedger').where('creatorUid', '==', uid).limit(100).get()
  ])
  const ledgerEntries = ledgerSnap.docs
    .map(ledgerAuditRow)
    .sort((a, b) => new Date(b.createdAt || b.updatedAt || 0).getTime() - new Date(a.createdAt || a.updatedAt || 0).getTime())
    .slice(0, 25)

  return {
    connect: connectSnap.exists ? connectAudit(connectSnap.data() || {}) : connectAudit({}),
    earningsSummary: summarySnap.exists ? safeSummaryValue(summarySnap.data() || {}) : null,
    ledgerEntries
  }
}

module.exports = {
  loadUserPayoutAudit,
  __test: {
    connectAudit,
    ledgerAuditRow
  }
}
