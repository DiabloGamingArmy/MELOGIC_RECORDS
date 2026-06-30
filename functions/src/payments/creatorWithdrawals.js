const admin = require('firebase-admin')
const { logger } = require('firebase-functions')
const { HttpsError, onCall } = require('firebase-functions/v2/https')
const { assertAnyPermission } = require('../admin/adminAuth')
const { rebuildCreatorEarningsSummary } = require('./creatorEarnings')

const STANDARD_WITHDRAWAL_HOLD_DAYS = 11
const INSTANT_WITHDRAWAL_FEE_CENTS = 99

function cleanString(value = '', max = 180) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max)
}

function nonNegativeInt(value, fallback = 0) {
  const amount = Number(value)
  return Number.isInteger(amount) && amount >= 0 ? amount : fallback
}

function normalizeWithdrawalMode(value = '') {
  return cleanString(value, 40).toLowerCase() === 'instant' ? 'instant' : 'standard'
}

function withdrawalFeeCents(mode = 'standard') {
  return normalizeWithdrawalMode(mode) === 'instant' ? INSTANT_WITHDRAWAL_FEE_CENTS : 0
}

function availableLedgerAmount(entry = {}) {
  const status = cleanString(entry.status || '', 40).toLowerCase()
  if (!['available', 'partially_withdrawn'].includes(status)) return 0
  if (entry.creatorNetStatus === 'before_stripe_fee') return 0
  const net = nonNegativeInt(entry.creatorNetAmount, 0)
  const withdrawn = nonNegativeInt(entry.withdrawnAmount, 0)
  return Math.max(0, net - withdrawn)
}

function withdrawalAmounts({ amountCents = 0, mode = 'standard' } = {}) {
  const requestedAmount = nonNegativeInt(amountCents, 0)
  const withdrawalMode = normalizeWithdrawalMode(mode)
  const feeAmount = withdrawalFeeCents(withdrawalMode)
  return {
    amountCents: requestedAmount,
    feeAmountCents: feeAmount,
    payoutAmountCents: Math.max(0, requestedAmount - feeAmount),
    mode: withdrawalMode
  }
}

function withdrawalLedgerAllocations(entries = [], amountCents = 0) {
  let remaining = nonNegativeInt(amountCents, 0)
  const allocations = []
  for (const entry of entries) {
    if (remaining <= 0) break
    const available = availableLedgerAmount(entry.data || entry)
    if (available <= 0) continue
    const amount = Math.min(available, remaining)
    allocations.push({
      ref: entry.ref || null,
      id: entry.id || '',
      amountCents: amount,
      nextWithdrawnAmount: nonNegativeInt((entry.data || entry).withdrawnAmount, 0) + amount,
      nextStatus: amount === available ? 'withdrawn' : 'partially_withdrawn'
    })
    remaining -= amount
  }
  return { allocations, remaining }
}

function assertWithdrawalRequest({ uid = '', amountCents = 0, mode = 'standard', availableAmountCents = 0, connect = {} } = {}) {
  if (!uid || uid.includes('/')) throw new HttpsError('unauthenticated', 'You must be signed in to request a withdrawal.')
  const amounts = withdrawalAmounts({ amountCents, mode })
  if (amounts.amountCents <= 0) {
    throw new HttpsError('invalid-argument', 'Withdrawal amount must be greater than zero.')
  }
  if (!cleanString(connect.stripeConnectAccountId || '', 180)) {
    throw new HttpsError('failed-precondition', 'Set up Stripe payouts before requesting a withdrawal.')
  }
  if (amounts.mode === 'instant' && connect.instantPayoutsEligible !== true) {
    throw new HttpsError('failed-precondition', 'Instant withdrawals are not available for this Stripe account yet.')
  }
  if (amounts.mode === 'instant' && amounts.amountCents <= amounts.feeAmountCents) {
    throw new HttpsError('failed-precondition', 'Instant withdrawal amount must be greater than the instant fee.')
  }
  if (amounts.amountCents > availableAmountCents) {
    throw new HttpsError('failed-precondition', 'Withdrawal amount exceeds available creator earnings.')
  }
  return amounts
}

async function createCreatorWithdrawalRequestForUser({
  database = admin.firestore(),
  uid = '',
  amountCents = 0,
  currency = 'USD',
  mode = 'standard',
  clientRequestId = ''
} = {}) {
  const userId = cleanString(uid, 180)
  if (!userId || userId.includes('/')) throw new HttpsError('unauthenticated', 'You must be signed in to request a withdrawal.')
  const requestId = cleanString(clientRequestId, 120).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80)
    || database.collection('_ids').doc().id
  const safeCurrency = cleanString(currency || 'USD', 12).toUpperCase()
  const withdrawalRef = database.collection('creatorWithdrawalRequests').doc(`${userId}_${requestId}`)
  const connectRef = database.doc(`stripeConnectAccounts/${userId}`)
  const ledgerQuery = database.collection('creatorLedger')
    .where('creatorUid', '==', userId)
    .where('currency', '==', safeCurrency)
    .limit(1000)

  const result = await database.runTransaction(async (transaction) => {
    const [existingRequestSnap, connectSnap, ledgerSnap] = await Promise.all([
      transaction.get(withdrawalRef),
      transaction.get(connectRef),
      transaction.get(ledgerQuery)
    ])
    if (existingRequestSnap.exists) {
      return {
        ...(existingRequestSnap.data() || {}),
        idempotent: true,
        withdrawalId: withdrawalRef.id
      }
    }

    const connect = connectSnap.exists ? connectSnap.data() || {} : {}
    const ledgerEntries = ledgerSnap.docs.map((doc) => ({ id: doc.id, ref: doc.ref, data: doc.data() || {} }))
      .filter((entry) => ['available', 'partially_withdrawn'].includes(cleanString(entry.data.status || '', 40).toLowerCase()))
      .sort((a, b) => {
        const aMillis = typeof a.data.availableAt?.toMillis === 'function' ? a.data.availableAt.toMillis() : 0
        const bMillis = typeof b.data.availableAt?.toMillis === 'function' ? b.data.availableAt.toMillis() : 0
        return aMillis - bMillis || a.id.localeCompare(b.id)
      })
    const availableAmountCents = ledgerEntries.reduce((sum, entry) => sum + availableLedgerAmount(entry.data), 0)
    const amounts = assertWithdrawalRequest({
      uid: userId,
      amountCents,
      mode,
      availableAmountCents,
      connect
    })
    const { allocations, remaining } = withdrawalLedgerAllocations(ledgerEntries, amounts.amountCents)
    if (remaining > 0) {
      throw new HttpsError('failed-precondition', 'Withdrawal amount exceeds available creator earnings.')
    }

    const now = admin.firestore.FieldValue.serverTimestamp()
    allocations.forEach((allocation) => {
      transaction.set(allocation.ref, {
        withdrawnAmount: allocation.nextWithdrawnAmount,
        withdrawalRequestIds: admin.firestore.FieldValue.arrayUnion(withdrawalRef.id),
        status: allocation.nextStatus,
        updatedAt: now
      }, { merge: true })
    })

    const payload = {
      uid: userId,
      creatorUid: userId,
      clientRequestId: requestId,
      mode: amounts.mode,
      status: 'pending',
      movementMode: 'internal_record_only',
      amountCents: amounts.amountCents,
      feeAmountCents: amounts.feeAmountCents,
      payoutAmountCents: amounts.payoutAmountCents,
      currency: safeCurrency,
      standardHoldDays: amounts.mode === 'standard' ? STANDARD_WITHDRAWAL_HOLD_DAYS : 0,
      stripeConnectAccountIdPreview: cleanString(connect.accountIdPreview || '', 80),
      ledgerAllocations: allocations.map((allocation) => ({
        ledgerEntryId: allocation.id,
        amountCents: allocation.amountCents
      })),
      createdAt: now,
      updatedAt: now
    }
    transaction.set(withdrawalRef, payload, { merge: false })
    return { ...payload, withdrawalId: withdrawalRef.id, idempotent: false }
  })

  await rebuildCreatorEarningsSummary(database, userId).catch((error) => {
    logger.error('[creator-withdrawals] earnings summary rebuild failed', {
      uid: userId,
      withdrawalId: result.withdrawalId,
      message: error?.message || ''
    })
  })

  return {
    ok: true,
    withdrawal: {
      withdrawalId: result.withdrawalId,
      status: result.status,
      mode: result.mode,
      amountCents: result.amountCents,
      feeAmountCents: result.feeAmountCents,
      payoutAmountCents: result.payoutAmountCents,
      currency: result.currency,
      idempotent: result.idempotent === true
    }
  }
}

const createCreatorWithdrawalRequest = onCall(
  {
    timeoutSeconds: 60,
    cors: true
  },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'You must be signed in to request a withdrawal.')
    const result = await createCreatorWithdrawalRequestForUser({
      uid,
      amountCents: request.data?.amountCents,
      currency: request.data?.currency || 'USD',
      mode: request.data?.mode || 'standard',
      clientRequestId: request.data?.clientRequestId || ''
    })
    logger.info('[creator-withdrawals] withdrawal request created', {
      uid,
      withdrawalId: result.withdrawal.withdrawalId,
      mode: result.withdrawal.mode,
      amountCents: result.withdrawal.amountCents,
      feeAmountCents: result.withdrawal.feeAmountCents,
      currency: result.withdrawal.currency,
      idempotent: result.withdrawal.idempotent
    })
    return result
  }
)

const auditCreatorPayoutLedger = onCall(
  {
    timeoutSeconds: 60,
    cors: true
  },
  async (request) => {
    assertAnyPermission(request, ['auditRead', 'orderSupport'])
    const uid = cleanString(request.data?.uid || '', 180)
    if (!uid || uid.includes('/')) throw new HttpsError('invalid-argument', 'A valid creator uid is required.')
    const database = admin.firestore()
    const [summarySnap, connectSnap, ledgerSnap, withdrawalSnap] = await Promise.all([
      database.doc(`users/${uid}/earningsSummary/current`).get(),
      database.doc(`stripeConnectAccounts/${uid}`).get(),
      database.collection('creatorLedger').where('creatorUid', '==', uid).limit(100).get(),
      database.collection('creatorWithdrawalRequests').where('creatorUid', '==', uid).limit(50).get()
    ])
    const ledger = ledgerSnap.docs.map((doc) => {
      const data = doc.data() || {}
      return {
        id: doc.id,
        orderId: cleanString(data.orderId || '', 180),
        productId: cleanString(data.productId || '', 180),
        grossAmount: nonNegativeInt(data.grossAmount, 0),
        platformFeeAmount: nonNegativeInt(data.platformFeeAmount, 0),
        platformFeeBps: nonNegativeInt(data.platformFeeBps, 0),
        creatorNetAmount: nonNegativeInt(data.creatorNetAmount, 0),
        withdrawnAmount: nonNegativeInt(data.withdrawnAmount, 0),
        availableAmount: availableLedgerAmount(data),
        currency: cleanString(data.currency || 'USD', 12).toUpperCase(),
        status: cleanString(data.status || '', 40),
        creatorNetStatus: cleanString(data.creatorNetStatus || '', 80)
      }
    })
    const summary = summarySnap.exists ? summarySnap.data() || {} : {}
    const connect = connectSnap.exists ? connectSnap.data() || {} : {}
    return {
      uid,
      connect: {
        hasAccount: Boolean(connect.stripeConnectAccountId),
        accountIdPreview: cleanString(connect.accountIdPreview || '', 80),
        mode: cleanString(connect.mode || '', 20),
        instantPayoutsEligible: connect.instantPayoutsEligible === true
      },
      summary: {
        pendingByCurrency: summary.pendingByCurrency || {},
        availableByCurrency: summary.availableByCurrency || {},
        withdrawnByCurrency: summary.withdrawnByCurrency || {},
        lifetimeNetByCurrency: summary.lifetimeNetByCurrency || {},
        entryCount: nonNegativeInt(summary.entryCount, 0),
        unfinalizedEntryCount: nonNegativeInt(summary.unfinalizedEntryCount, 0)
      },
      ledger,
      withdrawals: withdrawalSnap.docs.map((doc) => {
        const data = doc.data() || {}
        return {
          id: doc.id,
          status: cleanString(data.status || '', 40),
          mode: cleanString(data.mode || '', 40),
          amountCents: nonNegativeInt(data.amountCents, 0),
          feeAmountCents: nonNegativeInt(data.feeAmountCents, 0),
          payoutAmountCents: nonNegativeInt(data.payoutAmountCents, 0),
          currency: cleanString(data.currency || 'USD', 12).toUpperCase()
        }
      })
    }
  }
)

module.exports = {
  auditCreatorPayoutLedger,
  createCreatorWithdrawalRequest,
  createCreatorWithdrawalRequestForUser,
  __test: {
    availableLedgerAmount,
    assertWithdrawalRequest,
    withdrawalAmounts,
    withdrawalFeeCents,
    withdrawalLedgerAllocations,
    normalizeWithdrawalMode
  }
}
