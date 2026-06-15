const admin = require('firebase-admin')
const { logger } = require('firebase-functions')
const { defineSecret, defineString } = require('firebase-functions/params')
const { HttpsError, onCall } = require('firebase-functions/v2/https')
const Stripe = require('stripe')

const STRIPE_SECRET_KEY = defineSecret('STRIPE_SECRET_KEY')
const PUBLIC_SITE_URL = defineString('PUBLIC_SITE_URL', {
  default: 'https://melogic-records.web.app'
})

const ACCOUNT_CREATION_LOCK_MS = 60 * 1000
const ACCOUNT_RECOVERY_PAGE_LIMIT = 100
const ACCOUNT_RECOVERY_MAX_PAGES = 5

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

function stripeSecretMode(secret = '') {
  const value = cleanString(secret, 80)
  if (value.startsWith('sk_test_')) return 'test'
  if (value.startsWith('sk_live_')) return 'live'
  return value ? 'unknown' : 'missing'
}

function assertStripeSecret(secret = '') {
  const mode = stripeSecretMode(secret)
  if (!['test', 'live'].includes(mode)) {
    throw new HttpsError('failed-precondition', 'Stripe payouts are not configured.')
  }
  const expectedMode = cleanString(process.env.STRIPE_MODE || '', 20).toLowerCase()
  if (expectedMode && ['test', 'live'].includes(expectedMode) && expectedMode !== mode) {
    logger.error('[stripe-connect] Stripe mode mismatch', {
      stripeSecretMode: mode,
      expectedStripeMode: expectedMode
    })
    throw new HttpsError('failed-precondition', 'Stripe payouts are configured for the wrong mode.')
  }
  logger.info(`[stripe-connect] using ${mode} Stripe key`, {
    stripeSecretMode: mode
  })
  return mode
}

function stripeErrorSummary(error = {}) {
  return {
    type: cleanString(error.type || error.raw?.type || '', 120),
    code: cleanString(error.code || error.raw?.code || '', 120),
    declineCode: cleanString(error.decline_code || error.raw?.decline_code || '', 120),
    message: cleanString(error.message || error.raw?.message || '', 500),
    statusCode: Number(error.statusCode || error.raw?.statusCode || 0) || null,
    requestId: cleanString(error.requestId || error.raw?.requestId || '', 120)
  }
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
    mode: livemode ? 'live' : 'test',
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
    mode: cleanString(data.mode || (data.livemode === true ? 'live' : 'test'), 20),
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
    type: 'express',
    country: 'US',
    email: cleanString(email, 320) || undefined,
    capabilities: {
      transfers: { requested: true }
    },
    metadata: {
      firebaseUid: cleanString(uid, 180),
      platform: 'melogic_records'
    }
  }
}

function accountMatchesUid(account = {}, uid = '') {
  const metadata = account.metadata && typeof account.metadata === 'object' ? account.metadata : {}
  return cleanString(metadata.firebaseUid || '', 180) === uid
    || cleanString(metadata.melogicUid || '', 180) === uid
}

async function findExistingStripeConnectAccount({ stripe, uid = '' } = {}) {
  const matches = []
  let startingAfter = ''
  for (let page = 0; page < ACCOUNT_RECOVERY_MAX_PAGES; page += 1) {
    const response = await stripe.accounts.list({
      limit: ACCOUNT_RECOVERY_PAGE_LIMIT,
      ...(startingAfter ? { starting_after: startingAfter } : {})
    })
    for (const account of response.data || []) {
      if (accountMatchesUid(account, uid)) matches.push(account)
    }
    if (!response.has_more || !response.data?.length) break
    startingAfter = response.data[response.data.length - 1].id
  }
  return matches
}

async function bindStripeConnectAccount({
  database,
  uid = '',
  account = {},
  livemode = false,
  source = 'created'
} = {}) {
  const now = admin.firestore.FieldValue.serverTimestamp()
  const privateRef = privateConnectRef(database, uid)
  const safeStatusRef = billingRef(database, uid)
  const batch = database.batch()
  batch.set(privateRef, {
    uid,
    stripeConnectAccountId: account.id,
    accountIdPreview: accountIdPreview(account.id),
    createdBy: uid,
    accountType: cleanString(account.type || 'express', 40),
    mode: livemode ? 'live' : 'test',
    livemode,
    bindingSource: source,
    accountCreationStatus: 'ready',
    createdAt: now,
    updatedAt: now
  }, { merge: true })
  batch.set(safeStatusRef, {
    uid,
    hasAccount: true,
    createdAt: now,
    updatedAt: now,
    ...safeConnectStatus(account, { livemode })
  }, { merge: true })
  await batch.commit()
}

function accountIdPreview(accountId = '') {
  const id = cleanString(accountId, 180)
  if (!id) return ''
  return `${id.slice(0, 8)}...${id.slice(-4)}`
}

function timestampMillis(value) {
  if (!value) return 0
  if (typeof value.toMillis === 'function') return value.toMillis()
  if (typeof value.toDate === 'function') return value.toDate().getTime()
  const parsed = new Date(value).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

async function acquireAccountCreationLock({ database, uid = '', livemode = false } = {}) {
  const privateRef = privateConnectRef(database, uid)
  return database.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(privateRef)
    const data = snapshot.exists ? snapshot.data() || {} : {}
    const existingAccountId = cleanString(data.stripeConnectAccountId || '', 180)
    if (existingAccountId) {
      return { locked: false, accountId: existingAccountId, existing: data }
    }
    const status = cleanString(data.accountCreationStatus || '', 40)
    const lockAge = Date.now() - timestampMillis(data.accountCreationStartedAt || data.updatedAt)
    if (status === 'creating' && lockAge >= 0 && lockAge < ACCOUNT_CREATION_LOCK_MS) {
      throw new HttpsError('failed-precondition', 'Stripe payout setup is already starting. Try again in a moment.')
    }
    const now = admin.firestore.FieldValue.serverTimestamp()
    transaction.set(privateRef, {
      uid,
      mode: livemode ? 'live' : 'test',
      livemode,
      accountCreationStatus: 'creating',
      accountCreationStartedAt: now,
      updatedAt: now
    }, { merge: true })
    return { locked: true }
  })
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
  const snapshot = await privateRef.get()
  const existing = snapshot.exists ? snapshot.data() || {} : {}
  const secretMode = assertStripeSecret(secret)
  const livemode = secretMode === 'live'
  const existingAccountId = cleanString(existing.stripeConnectAccountId || '', 180)
  logger.info('[stripe-connect] account lookup complete', {
    uid: userId,
    stripeSecretMode: secretMode,
    existingAccount: Boolean(existingAccountId)
  })

  if (existingAccountId) {
    if (existing.livemode !== undefined && existing.livemode !== livemode) {
      throw new HttpsError('failed-precondition', 'The saved Stripe account belongs to a different Stripe mode.')
    }
    return { accountId: existingAccountId, created: false, livemode }
  }

  let recoveredAccounts = []
  try {
    recoveredAccounts = await findExistingStripeConnectAccount({ stripe, uid: userId })
  } catch (error) {
    logger.error('[stripe-connect] account recovery search failed', {
      uid: userId,
      stripeSecretMode: secretMode,
      stripe: stripeErrorSummary(error)
    })
    throw error
  }
  if (recoveredAccounts.length === 1) {
    const recovered = recoveredAccounts[0]
    await bindStripeConnectAccount({
      database,
      uid: userId,
      account: recovered,
      livemode,
      source: 'stripe_metadata_recovery'
    })
    logger.info('[stripe-connect] recovered existing account from Stripe metadata', {
      uid: userId,
      stripeSecretMode: secretMode,
      accountIdPreview: accountIdPreview(recovered.id)
    })
    return { accountId: recovered.id, account: recovered, created: false, recovered: true, livemode }
  }
  if (recoveredAccounts.length > 1) {
    logger.error('[stripe-connect] multiple matching Stripe accounts require admin review', {
      uid: userId,
      stripeSecretMode: secretMode,
      matchCount: recoveredAccounts.length,
      accountIdPreviews: recoveredAccounts.map((account) => accountIdPreview(account.id)).slice(0, 10)
    })
    throw new HttpsError('failed-precondition', 'Multiple Stripe payout accounts were found for this user. Admin review is required.')
  }

  const lock = await acquireAccountCreationLock({ database, uid: userId, livemode })
  if (!lock.locked && lock.accountId) {
    if (lock.existing?.livemode !== undefined && lock.existing.livemode !== livemode) {
      throw new HttpsError('failed-precondition', 'The saved Stripe account belongs to a different Stripe mode.')
    }
    return { accountId: lock.accountId, created: false, livemode }
  }

  let account
  try {
    account = await stripe.accounts.create(connectAccountParams({
      uid: userId,
      email
    }))
    logger.info('[stripe-connect] account created', {
      uid: userId,
      stripeSecretMode: secretMode,
      accountIdPreview: accountIdPreview(account.id),
      accountType: cleanString(account.type || 'express', 40),
      livemode: account.livemode === true
    })
  } catch (error) {
    await privateRef.set({
      accountCreationStatus: 'failed',
      accountCreationErrorCode: cleanString(error.code || error.raw?.code || error.type || '', 120),
      updatedAt: admin.firestore.FieldValue.serverTimestamp()
    }, { merge: true }).catch(() => {})
    logger.error('[stripe-connect] account creation failed', {
      uid: userId,
      stripeSecretMode: secretMode,
      stripe: stripeErrorSummary(error)
    })
    throw error
  }

  await bindStripeConnectAccount({
    database,
    uid: userId,
    account,
    livemode,
    source: 'stripe_account_create'
  })

  return { accountId: account.id, account, created: true, livemode }
}

async function createAccountForRequest(request) {
  const uid = request.auth?.uid
  if (!uid) throw new HttpsError('unauthenticated', 'You must be signed in to set up payouts.')

  const secret = STRIPE_SECRET_KEY.value()
  assertStripeSecret(secret)
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
      const secret = STRIPE_SECRET_KEY.value()
      const account = result.account || await new Stripe(secret).accounts.retrieve(result.accountId)
      return {
        ok: true,
        created: result.created,
        connect: safeConnectStatus(account, { livemode: result.livemode })
      }
    } catch (error) {
      if (error instanceof HttpsError) throw error
      logger.error('[stripe-connect] account creation failed', {
        uid: request.auth?.uid || '',
        stripe: stripeErrorSummary(error)
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
      const secret = STRIPE_SECRET_KEY.value()
      const secretMode = assertStripeSecret(secret)
      const stripe = new Stripe(secret)
      const siteUrl = PUBLIC_SITE_URL.value().replace(/\/+$/, '')
      const returnUrl = `${siteUrl}/account/billing-payouts?stripeConnect=return`
      const refreshUrl = `${siteUrl}/account/billing-payouts?stripeConnect=refresh`
      logger.info('[stripe-connect] creating onboarding link', {
        uid,
        stripeSecretMode: secretMode,
        existingAccount: result.created !== true,
        accountIdPrefix: cleanString(result.accountId || '', 8),
        returnUrl,
        refreshUrl
      })
      const link = await stripe.accountLinks.create({
        account: result.accountId,
        type: 'account_onboarding',
        return_url: returnUrl,
        refresh_url: refreshUrl
      })
      logger.info('[stripe-connect] onboarding link created', {
        uid,
        stripeSecretMode: secretMode,
        accountIdPrefix: cleanString(result.accountId || '', 8)
      })
      return { ok: true, url: link.url }
    } catch (error) {
      if (error instanceof HttpsError) throw error
      logger.error('[stripe-connect] onboarding link creation failed', {
        uid,
        stripe: stripeErrorSummary(error)
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
      assertStripeSecret(secret)
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
        stripe: stripeErrorSummary(error)
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
    stripeErrorSummary,
    stripeSecretMode,
    stripeLivemode,
    accountMatchesUid,
    accountIdPreview,
    findExistingStripeConnectAccount
  }
}
