import './styles/base.css'
import './styles/account.css'
import { navShell } from './components/navShell'
import { initShellChrome } from './appBoot'
import { waitForInitialAuthState } from './firebase/auth'
import {
  createCreatorWithdrawalRequest,
  createStripeConnectOnboardingLink,
  getBillingPayoutData,
  refreshStripeConnectStatus
} from './data/billingPayoutsService'
import { authRoute, ROUTES } from './utils/routes'

const app = document.querySelector('#app')
const state = {
  user: null,
  loading: true,
  actioning: false,
  refreshing: false,
  withdrawing: false,
  error: '',
  errorDetails: null,
  notice: '',
  connect: null,
  earningsSummary: null
}

function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[character]))
}

function formatRequirement(value = '') {
  return String(value || '')
    .replaceAll('.', ' ')
    .replaceAll('_', ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function money(cents = 0, currency = 'USD') {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(cents || 0) / 100)
  } catch {
    return `${currency} ${(Number(cents || 0) / 100).toFixed(2)}`
  }
}

function formatCurrencyMap(value = {}) {
  const entries = Object.entries(value || {})
  if (!entries.length) return money(0, 'USD')
  return entries.map(([currency, amount]) => money(amount, currency)).join(' + ')
}

function primaryCurrency(summary = {}) {
  return summary.currency || Object.keys(summary.availableByCurrency || {})[0] || 'USD'
}

function primaryAmount(summary = {}, key = 'availableByCurrency') {
  const currency = primaryCurrency(summary)
  const fallbackKey = {
    pendingByCurrency: 'pendingAmount',
    availableByCurrency: 'availableAmount',
    withdrawnByCurrency: 'withdrawnAmount',
    lifetimeNetByCurrency: 'lifetimeNetAmount'
  }[key] || 'availableAmount'
  return Math.max(0, Math.round(Number(summary[key]?.[currency] ?? summary[fallbackKey] ?? 0)))
}

function connectState() {
  const connect = state.connect || {}
  const requirementsDue = [
    ...(connect.currentlyDue || []),
    ...(connect.pastDue || [])
  ]
  if (!connect.hasAccount) {
    return {
      title: 'Set up payouts',
      copy: 'Stripe securely collects required identity, tax, and bank details. Melogic does not store your bank information.',
      action: 'Set up Stripe payouts',
      tone: 'setup'
    }
  }
  if (!connect.detailsSubmitted) {
    return {
      title: 'Finish Stripe setup',
      copy: 'Your connected Stripe account exists, but onboarding is not complete.',
      action: 'Continue Stripe onboarding',
      tone: 'pending'
    }
  }
  if (!connect.payoutsEnabled || requirementsDue.length || connect.disabledReason) {
    return {
      title: 'Payout setup needs attention',
      copy: 'Stripe is reviewing your account or needs additional information before payouts can be enabled.',
      action: 'Update Stripe setup',
      tone: 'restricted'
    }
  }
  return {
    title: 'Payouts ready',
    copy: 'Your Stripe account is connected and currently eligible to receive creator payouts when transfers launch.',
    action: 'Update Stripe setup',
    tone: 'ready'
  }
}

function statusItem(label, value) {
  return `<div><span>${escapeHtml(label)}</span><strong class="${value ? 'is-positive' : 'is-muted'}">${value ? 'Yes' : 'No'}</strong></div>`
}

function requirementsMarkup() {
  const connect = state.connect || {}
  const groups = [
    ['Currently due', connect.currentlyDue],
    ['Past due', connect.pastDue],
    ['Pending verification', connect.pendingVerification]
  ].filter(([, values]) => values?.length)
  if (!groups.length) return '<p class="payout-requirements-empty">Stripe has not reported any outstanding requirements.</p>'
  return groups.map(([label, values]) => `
    <div class="payout-requirement-group">
      <strong>${escapeHtml(label)}</strong>
      <div>${values.map((value) => `<span>${escapeHtml(formatRequirement(value))}</span>`).join('')}</div>
    </div>
  `).join('')
}

function safeErrorDetails(error = {}) {
  const details = error?.details && typeof error.details === 'object' ? error.details : {}
  return {
    stage: String(details.stage || '').trim(),
    stripeRequestId: String(details.stripeRequestId || '').trim(),
    safeMessage: String(details.safeMessage || '').trim(),
    stripeType: String(details.stripeType || '').trim()
  }
}

function onboardingErrorMessage(error = {}) {
  const code = String(error?.code || '')
  const details = safeErrorDetails(error)
  if (code.includes('unauthenticated')) return 'Please sign in again to set up payouts.'
  if (code.includes('failed-precondition') || details.stage === 'config') return 'Stripe payouts are not configured correctly.'
  if (details.safeMessage) return details.safeMessage
  if (details.stage === 'account_creation' && details.stripeType === 'StripeInvalidRequestError') {
    return 'Stripe Connect setup may be incomplete. Please contact support.'
  }
  return 'Stripe onboarding could not be opened. Please try again.'
}

function errorDetailsMarkup() {
  const details = state.errorDetails || {}
  const lines = []
  if (details.stage) lines.push(`Stage: ${details.stage}`)
  if (details.stripeRequestId) lines.push(`Stripe request ID: ${details.stripeRequestId}`)
  if (!lines.length) return ''
  return `<div class="payout-error-details">${lines.map((line) => `<small>${escapeHtml(line)}</small>`).join('')}</div>`
}

function withdrawalPanelMarkup(summary = {}) {
  const currency = primaryCurrency(summary)
  const availableAmount = primaryAmount(summary, 'availableByCurrency')
  const maxLabel = money(availableAmount, currency)
  const disabled = state.withdrawing || !state.connect?.hasAccount || availableAmount <= 0
  return `
    <div class="payout-withdrawal-panel">
      <div>
        <span class="account-label">Withdrawals</span>
        <h3>Available to withdraw: ${escapeHtml(maxLabel)}</h3>
        <p>Standard withdrawals create a reviewed payout request. Funds are held for about 10-11 days before processing.</p>
      </div>
      <form class="payout-withdrawal-form" data-withdrawal-form>
        <label class="filter-control">
          <span>Amount</span>
          <input data-withdrawal-amount type="number" min="1" step="0.01" max="${(availableAmount / 100).toFixed(2)}" placeholder="0.00" ${disabled ? 'disabled' : ''} />
        </label>
        <input type="hidden" data-withdrawal-currency value="${escapeHtml(currency)}" />
        <button type="submit" class="button button-muted" ${disabled ? 'disabled' : ''}>${state.withdrawing ? 'Requesting...' : 'Request standard withdrawal'}</button>
      </form>
      <div class="payout-instant-disabled" aria-disabled="true">
        <strong>Instant withdrawal</strong>
        <span>$0.99 fee · unavailable until Stripe instant payout eligibility is verified.</span>
      </div>
    </div>
  `
}

function renderSignedOut() {
  return `
    <section class="account-panel account-empty">
      <p class="eyebrow">Creator Account</p>
      <h1>Sign in to manage billing and payouts.</h1>
      <p>Connected account and earnings information is private to your Melogic account.</p>
      <a class="button button-accent" href="${authRoute({ redirect: ROUTES.billingPayouts })}">Sign In / Sign Up</a>
    </section>
  `
}

function renderPage() {
  const summary = state.earningsSummary || {}
  const presentation = connectState()
  return `
    <section class="account-panel">
      <div class="account-heading">
        <div>
          <p class="eyebrow">Creator Account</p>
          <h1>Billing &amp; Payouts</h1>
          <p>Set up secure Stripe payouts and review server-trusted creator earnings.</p>
        </div>
        <a class="button button-muted" href="${ROUTES.profile}">Back to Account</a>
      </div>

      ${state.notice ? `<div class="account-success-banner" role="status">${escapeHtml(state.notice)}</div>` : ''}
      ${state.error ? `<div class="payout-error" role="alert">${escapeHtml(state.error)}${errorDetailsMarkup()}</div>` : ''}

      <section class="payout-setup-card is-${presentation.tone}">
        <div>
          <span class="account-label">Stripe Connect Express</span>
          <h2>${escapeHtml(presentation.title)}</h2>
          <p>${escapeHtml(presentation.copy)}</p>
          ${state.connect?.hasAccount && !state.connect?.livemode ? '<span class="account-mode-badge">Stripe Test Mode</span>' : ''}
        </div>
        <div class="payout-actions">
          <button type="button" class="button button-accent" data-start-stripe-onboarding ${state.actioning ? 'disabled' : ''}>
            ${state.actioning ? 'Opening Stripe...' : escapeHtml(presentation.action)}
          </button>
          ${state.connect?.hasAccount ? `<button type="button" class="button button-muted" data-refresh-stripe-status ${state.refreshing ? 'disabled' : ''}>${state.refreshing ? 'Refreshing...' : 'Refresh status'}</button>` : ''}
        </div>
      </section>

      <div class="payout-layout">
        <section class="payout-panel">
          <div class="payout-panel-heading">
            <div><span class="account-label">Connected account</span><h2>Status</h2></div>
            <span class="payout-status-pill is-${presentation.tone}">${escapeHtml(presentation.title)}</span>
          </div>
          <div class="payout-status-grid">
            ${statusItem('Details submitted', state.connect?.detailsSubmitted)}
            ${statusItem('Charges enabled', state.connect?.chargesEnabled)}
            ${statusItem('Payouts enabled', state.connect?.payoutsEnabled)}
            <div><span>Account type</span><strong>${escapeHtml(state.connect?.hasAccount ? state.connect.accountType : 'Not connected')}</strong></div>
          </div>
          ${state.connect?.disabledReason ? `<p class="payout-disabled-reason"><strong>Stripe status:</strong> ${escapeHtml(formatRequirement(state.connect.disabledReason))}</p>` : ''}
          <div class="payout-requirements">
            <h3>Requirements</h3>
            ${requirementsMarkup()}
          </div>
        </section>

        <section class="payout-panel">
          <div class="payout-panel-heading">
            <div><span class="account-label">Creator earnings</span><h2>Summary</h2></div>
            <span class="payout-entry-count">${Number(summary.entryCount || 0)} ledger entries</span>
          </div>
          <div class="payout-earnings-grid">
            <article><span>Pending</span><strong>${escapeHtml(formatCurrencyMap(summary.pendingByCurrency))}</strong></article>
            <article><span>Available</span><strong>${escapeHtml(formatCurrencyMap(summary.availableByCurrency))}</strong></article>
            <article><span>Lifetime net</span><strong>${escapeHtml(formatCurrencyMap(summary.lifetimeNetByCurrency))}</strong></article>
            <article><span>Transferred</span><strong>${escapeHtml(formatCurrencyMap(summary.withdrawnByCurrency))}</strong></article>
          </div>
          ${withdrawalPanelMarkup(summary)}
          <p class="payout-footnote">Earnings are calculated from the server-owned creator ledger. New earnings remain pending through the configured hold period.${summary.unfinalizedEntryCount ? ` ${Number(summary.unfinalizedEntryCount)} entr${Number(summary.unfinalizedEntryCount) === 1 ? 'y is' : 'ies are'} still waiting for final Stripe fee data.` : ''}</p>
        </section>
      </div>
    </section>
  `
}

function render() {
  document.title = 'Melogic | Billing & Payouts'
  const content = state.loading
    ? '<section class="account-panel"><div class="account-empty-inline">Loading payout settings...</div></section>'
    : state.user
      ? renderPage()
      : renderSignedOut()
  app.innerHTML = `${navShell({ currentPage: 'profile' })}<main class="account-page"><div class="account-shell">${content}</div></main>`
  initShellChrome()
  app.querySelector('[data-start-stripe-onboarding]')?.addEventListener('click', startOnboarding)
  app.querySelector('[data-refresh-stripe-status]')?.addEventListener('click', refreshStatus)
  app.querySelector('[data-withdrawal-form]')?.addEventListener('submit', requestWithdrawal)
}

function isStripeOnboardingUrl(value = '') {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && (url.hostname === 'connect.stripe.com' || url.hostname.endsWith('.stripe.com'))
  } catch {
    return false
  }
}

async function startOnboarding() {
  state.actioning = true
  state.error = ''
  state.errorDetails = null
  render()
  try {
    const result = await createStripeConnectOnboardingLink()
    if (!isStripeOnboardingUrl(result.url)) throw new Error('Stripe returned an invalid onboarding URL.')
    window.location.assign(result.url)
  } catch (error) {
    console.error('[billing-payouts] onboarding failed', {
      code: error?.code || '',
      message: error?.message || '',
      details: error?.details || null
    })
    state.errorDetails = safeErrorDetails(error)
    state.error = onboardingErrorMessage(error)
    state.actioning = false
    render()
  }
}

async function refreshStatus({ returnedFromStripe = false } = {}) {
  state.refreshing = true
  state.error = ''
  state.errorDetails = null
  render()
  try {
    const result = await refreshStripeConnectStatus()
    state.connect = result.connect
    state.notice = returnedFromStripe ? 'Stripe setup status refreshed.' : 'Payout status refreshed.'
  } catch (error) {
    console.error('[billing-payouts] status refresh failed', error)
    state.error = error?.message || 'Payout status could not be refreshed.'
  }
  state.refreshing = false
  render()
}

async function requestWithdrawal(event) {
  event.preventDefault()
  if (state.withdrawing) return
  const form = event.currentTarget
  const amountValue = Number(form.querySelector('[data-withdrawal-amount]')?.value || 0)
  const currency = form.querySelector('[data-withdrawal-currency]')?.value || primaryCurrency(state.earningsSummary || {})
  const amountCents = Math.round(amountValue * 100)
  state.error = ''
  state.errorDetails = null
  state.notice = ''
  state.withdrawing = true
  render()
  try {
    const result = await createCreatorWithdrawalRequest({
      amountCents,
      currency,
      mode: 'standard',
      clientRequestId: `web_${state.user?.uid || 'user'}_${Date.now()}`
    })
    const withdrawal = result.withdrawal || {}
    state.notice = `Withdrawal request created for ${money(withdrawal.amountCents || amountCents, withdrawal.currency || currency)}.`
    const data = await getBillingPayoutData(state.user.uid)
    state.connect = data.connect
    state.earningsSummary = data.earningsSummary
  } catch (error) {
    console.error('[billing-payouts] withdrawal request failed', error)
    state.error = error?.message || 'Withdrawal request could not be created.'
  }
  state.withdrawing = false
  render()
}

async function load(user) {
  state.user = user
  state.loading = true
  state.error = ''
  render()
  if (!user?.uid) {
    state.loading = false
    render()
    return
  }
  try {
    const data = await getBillingPayoutData(user.uid)
    state.connect = data.connect
    state.earningsSummary = data.earningsSummary
    state.loading = false
    render()

    const params = new URLSearchParams(window.location.search)
    const stripeReturn = params.get('stripeConnect')
    if (stripeReturn === 'return' || stripeReturn === 'refresh') {
      params.delete('stripeConnect')
      const query = params.toString()
      window.history.replaceState({}, '', `${window.location.pathname}${query ? `?${query}` : ''}`)
      if (stripeReturn === 'refresh') await startOnboarding()
      else await refreshStatus({ returnedFromStripe: true })
    }
  } catch (error) {
    console.error('[billing-payouts] load failed', error)
    state.error = 'Billing and payout information could not be loaded.'
    state.errorDetails = null
    state.loading = false
    render()
  }
}

waitForInitialAuthState().then(load)
