const admin = require('firebase-admin')
const { logger } = require('firebase-functions')
const { defineSecret, defineString } = require('firebase-functions/params')
const { HttpsError, onCall } = require('firebase-functions/v2/https')
const Stripe = require('stripe')

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY')
const PUBLIC_SITE_URL = defineString('PUBLIC_SITE_URL', {
  default: 'https://melogic-records.web.app'
})

function cleanString(value = '', max = 500) {
  return String(value ?? '')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, max)
}

function safeRequirementList(value = []) {
  return [...new Set((Array.isArray(value) ? value : [])
    .map((item) => cleanString(item, 180))
    .filter(Boolean))]
    .slice(0, 100)
}

function stripeLivemode(secret = '') {
  return !cleanString(secret, 180).startsWith('sk_test_')
}

function safeConnectStatus(account = {}, { livemode = false } = {}) {
  const dashboardType = cleanString(account.controller?.stripe_dashboard?.type || '', 40)
  return {
    hasAccount: Boolean(account.id),
    accountType: dashboardType === 'express' ? 'express' : cleanString(account.type || 'express', 40),
    detailsSubmitted: account.details_submitted === true,
    chargesEnabled: account.charges_enabled === true,
    payoutsEnabled: account.payouts_enabled === true,
    disabledReason: cleanString(account.requirements?.disabled_reason || '', 180),
    currentlyDue: safeRequirementList(account.requirements?.currently_due),
    eventuallyDue: safeRequirementList(account.requirements?.eventually_due),
    pastDue: safeRequirementList(account.requirements?.past_due),
    pendingVerification: safeRequirementList(account.requirements?.pending_verification),
    livemode
  }
}

function publicConnectStatus(data = {}) {
  return {
    hasAccount: data.hasAccount === true,
    accountType: cleanString(data.accountType || 'express', 40),
    detailsSubmitted: data.detailsSubmitted === true,
    chargesEnabled: data.chargesEnabled === true,
    payoutsEnabled: data.payoutsEnabled === true,
    disabledReason: cleanString(data.disabledReason || '', 180),
    currentlyDue: safeRequirementList(data.currentlyDue),
    eventuallyDue: safeRequirementList(data.eventuallyDue),
    pastDue: safeRequirementList(data.pastDue),
    pendingVerification: safeRequirementList(data.pendingVerification),
    livemode: data.livemode === true
  }
}

function billingRef(database, uid) {
  return database.doc(`users/${uid}/billing/connect`)
}

function privateConnectRef(database, uid) {
  return database.doc(`stripeConnectAccounts/${uid}`)
}

function connectAccountParams({ uid = '', email = '' } = {}) {
  return {
    email: cleanString(email, 320) || undefined,
    controller: {
      fees: { payer: 'application' },
      losses: { payments: 'application' },
      requirement_collection: 'stripe',
      stripe_dashboard: { type: 'express' }
    },
    capabilities: {
      transfers: { requested: true }
    },
    metadata: {
      melogicUid: cleanString(uid, 180)
    }
  }
}

async function ensureStripeConnectAccount({
  database = admin.firestore(),
  stripe,
  uid = '',
  email = '',
  secret = ''
} = {}) {
  const userId = cleanString(uid, 180)
  if (!userId || userId.includes('/')) throw new HttpsError('unauthenticated', 'You must be signed in.')

  const privateRef = privateConnectRef(database, userId)
  const safeStatusRef = billingRef(database, userId)
  const snapshot = await privateRef.get()
  const existing = snapshot.exists ? snapshot.data() || {} : {}
  const livemode = stripeLivemode(secret)
  const existingAccountId = cleanString(existing.stripeConnectAccountId || '', 180)

  if (existingAccountId) {
    if (existing.livemode !== undefined && existing.livemode !== livemode) {
      throw new HttpsError('failed-precondition', 'The saved Stripe account belongs to a different Stripe mode.')
    }
    return { accountId: existingAccountId, created: false, livemode }
  }

  const account = await stripe.accounts.create(connectAccountParams({
    uid: userId,
    email
  }), {
    idempotencyKey: `melogic_connect_account_${livemode ? 'live' : 'test'}_${userId}`
  })

  const now = admin.firestore.FieldValue.serverTimestamp()
  const batch = database.batch()
  batch.set(privateRef, {
    uid: userId,
    stripeConnectAccountId: account.id,
    createdBy: userId,
    createdAt: now,
    updatedAt: now,
    livemode
  }, { merge: true })
  batch.set(safeStatusRef, {
    uid: userId,
    hasAccount: true,
    createdAt: now,
    updatedAt: now,
    ...safeConnectStatus(account, { livemode })
  }, { merge: true })
  await batch.commit()

  return { accountId: account.id, account, created: true, livemode }
}

async function createAccountForRequest(request) {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'You must be signed in to set up payouts.')

  const secret = STRIPE_SECRET_KEY.value()
  const stripe = new Stripe(secret)
  const authUser = await admin.auth().getUser(uid).catch(() => null)
  return ensureStripeConnectAccount({
    stripe,
    uid,
    email: authUser?.email || request.auth?.token?.email || '',
    secret
  })
}

const createStripeConnectAccount = onCall(
  {
    secrets: [STRIPE_SECRET_KEY],
    timeoutSeconds: 60,
    cors: true
  },
  async (request) => {
    try {
      const result = await createAccountForRequest(request)
      const account = result.account || await new Stripe(STRIPE_SECRET_KEY.value()).accounts.retrieve(result.accountId)
      return {
        ok: true,
        created: result.created,
        connect: safeConnectStatus(account, { livemode: result.livemode })
      }
    } catch (error) {
      if (error instanceof HttpsError) throw error
      logger.error('[stripe-connect] account creation failed', {
        uid: request.auth?.uid || '',
        code: error?.code || '',
        message: error?.message || ''
      })
      throw new HttpsError('internal', 'Stripe payout setup could not be started.')
    }
  }
)

const createStripeConnectOnboardingLink = onCall(
  {
    secrets: [STRIPE_SECRET_KEY],
    timeoutSeconds: 60,
    cors: true
  },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'You must be signed in to set up payouts.')

    try {
      const result = await createAccountForRequest(request)
      const stripe = new Stripe(STRIPE_SECRET_KEY.value())
      const siteUrl = PUBLIC_SITE_URL.value().replace(/\/+$/, '')
      const link = await stripe.accountLinks.create({
        account: result.accountId,
        type: 'account_onboarding',
        return_url: `${siteUrl}/account/billing-payouts?stripeConnect=return`,
        refresh_url: `${siteUrl}/account/billing-payouts?stripeConnect=refresh`
      })
      return { ok: true, url: link.url }
    } catch (error) {
      if (error instanceof HttpsError) throw error
      logger.error('[stripe-connect] onboarding link creation failed', {
        uid,
        code: error?.code || '',
        message: error?.message || ''
      })
      throw new HttpsError('internal', 'Stripe onboarding could not be opened.')
    }
  }
)

const refreshStripeConnectStatus = onCall(
  {
    secrets: [STRIPE_SECRET_KEY],
    timeoutSeconds: 60,
    cors: true
  },
  async (request) => {
    const uid = request.auth?.uid
    if (!uid) throw new HttpsError('unauthenticated', 'You must be signed in to refresh payout status.')

    const database = admin.firestore()
    const privateRef = privateConnectRef(database, uid)
    const safeStatusRef = billingRef(database, uid)
    const snapshot = await privateRef.get()
    const existing = snapshot.exists ? snapshot.data() || {} : {}
    const accountId = cleanString(existing.stripeConnectAccountId || '', 180)
    if (!accountId) {
      return { ok: true, connect: publicConnectStatus({}) }
    }

    try {
      const secret = STRIPE_SECRET_KEY.value()
      const account = await new Stripe(secret).accounts.retrieve(accountId)
      const status = safeConnectStatus(account, { livemode: stripeLivemode(secret) })
      await safeStatusRef.set({
        ...status,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
        statusRefreshedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true })
      return { ok: true, connect: status }
    } catch (error) {
      logger.error('[stripe-connect] status refresh failed', {
        uid,
        code: error?.code || '',
        message: error?.message || ''
      })
      throw new HttpsError('internal', 'Stripe payout status could not be refreshed.')
    }
  }
)

module.exports = {
  createStripeConnectAccount,
  createStripeConnectOnboardingLink,
  ensureStripeConnectAccount,
  refreshStripeConnectStatus,
  __test: {
    connectAccountParams,
    publicConnectStatus,
    safeConnectStatus,
    safeRequirementList,
    stripeLivemode
  }
}
