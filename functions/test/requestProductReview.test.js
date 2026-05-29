const test = require('node:test')
const assert = require('node:assert/strict')

const { __test } = require('../src/products/requestProductReview')

test('Gemini 401 keeps product pending and marks AI auth failure', () => {
  const outcome = __test.decideReviewOutcome({
    product: { visibility: 'public' },
    ruleResult: { approved: true, reasons: [] },
    aiResult: {
      aiConfigured: true,
      aiAttempted: true,
      aiSucceeded: false,
      suggestedAction: 'review_pending',
      errorCode: 'gemini_auth_failed',
      errorCategory: 'auth',
      summary: 'AI moderation unavailable.'
    },
    autoApprove: true,
    allowRuleBasedAutoApprove: false,
    model: 'gemini-1.5-flash'
  })

  assert.equal(outcome.finalStatus, 'review_pending')
  assert.equal(outcome.visibility, 'unlisted')
  assert.equal(outcome.moderationStatus, 'ai_error')
  assert.equal(outcome.reviewJobStatus, 'failed_ai_auth')
  assert.equal(outcome.aiAuthFailed, true)
})

test('AI success can publish only when auto approval is enabled', () => {
  const base = {
    product: { visibility: 'private' },
    ruleResult: { approved: true, reasons: [] },
    aiResult: {
      aiConfigured: true,
      aiAttempted: true,
      aiSucceeded: true,
      suggestedAction: 'approve',
      riskLevel: 'low'
    },
    allowRuleBasedAutoApprove: false
  }

  assert.equal(__test.decideReviewOutcome({ ...base, autoApprove: false }).finalStatus, 'review_pending')
  assert.equal(__test.decideReviewOutcome({ ...base, autoApprove: true }).finalStatus, 'published')
})

test('rule-based fallback approval is labeled honestly', () => {
  const outcome = __test.decideReviewOutcome({
    product: { visibility: 'private' },
    ruleResult: { approved: true, reasons: [] },
    aiResult: {
      aiConfigured: true,
      aiAttempted: true,
      aiSucceeded: false,
      suggestedAction: 'review_pending',
      errorCode: 'gemini_request_failed',
      errorCategory: 'network'
    },
    autoApprove: true,
    allowRuleBasedAutoApprove: true
  })

  assert.equal(outcome.finalStatus, 'published')
  assert.equal(outcome.moderationStatus, 'rule_based_fallback_approved')
  assert.equal(outcome.reviewJobStatus, 'rule_based_fallback_approved')
  assert.match(outcome.summary, /rule-based fallback/i)
})

test('obvious non-Gemini secrets are rejected before request', () => {
  assert.equal(__test.isObviouslyInvalidGeminiSecret(''), true)
  assert.equal(__test.isObviouslyInvalidGeminiSecret('ya29.invalid-oauth-token'), true)
  assert.equal(__test.isObviouslyInvalidGeminiSecret('-----BEGIN PRIVATE KEY-----'), true)
})
