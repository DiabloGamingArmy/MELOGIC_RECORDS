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
    model: 'gemini-2.5-flash-lite'
  })

  assert.equal(outcome.finalStatus, 'review_pending')
  assert.equal(outcome.visibility, 'unlisted')
  assert.equal(outcome.moderationStatus, 'ai_error')
  assert.equal(outcome.reviewJobStatus, 'failed_ai_auth')
  assert.equal(outcome.aiAuthFailed, true)
  assert.equal(outcome.model, 'gemini-2.5-flash-lite')
})

test('moderation model order ignores legacy and disallowed configured models', () => {
  assert.deepEqual(__test.resolveModerationModelOrder('gemini-1.5-flash'), [
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-flash-latest'
  ])
  assert.deepEqual(__test.resolveModerationModelOrder('gemini-2.5-pro'), [
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-flash-latest'
  ])
  assert.deepEqual(__test.resolveModerationModelOrder('gemini-2.5-flash'), [
    'gemini-2.5-flash',
    'gemini-2.5-flash-lite',
    'gemini-flash-latest'
  ])
})

test('Gemini 404 falls back and records the model that succeeded', async () => {
  const calls = []
  const result = await __test.moderateProductWithAI(
    { title: 'Clean sample pack', description: 'Loops and one-shots', productType: 'Sample Pack' },
    {
      models: ['gemini-2.5-flash-lite', 'gemini-2.5-flash'],
      apiKey: 'AIza-valid-looking-test-key-1234567890',
      fetchImpl: async (url) => {
        calls.push(url)
        if (calls.length === 1) {
          return {
            ok: false,
            status: 404,
            text: async () => JSON.stringify({ error: { status: 'NOT_FOUND', message: 'model not found' } })
          }
        }
        return {
          ok: true,
          json: async () => ({
            candidates: [{
              content: {
                parts: [{
                  text: JSON.stringify({
                    approved: true,
                    riskLevel: 'low',
                    suggestedAction: 'approve',
                    reasons: [],
                    summary: 'Clean.'
                  })
                }]
              }
            }]
          })
        }
      }
    }
  )

  assert.equal(calls.length, 2)
  assert.match(calls[0], /gemini-2\.5-flash-lite/)
  assert.match(calls[1], /gemini-2\.5-flash/)
  assert.equal(result.aiSucceeded, true)
  assert.equal(result.modelUsed, 'gemini-2.5-flash')
})

test('all Gemini 404 fallbacks keep product pending with ai_error inputs', async () => {
  const result = await __test.moderateProductWithAI(
    { title: 'Clean kit', description: 'Clean description', productType: 'Drum Kit' },
    {
      models: ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-flash-latest'],
      apiKey: 'AIza-valid-looking-test-key-1234567890',
      fetchImpl: async () => ({
        ok: false,
        status: 404,
        text: async () => JSON.stringify({ error: { status: 'NOT_FOUND', message: 'model not found' } })
      })
    }
  )
  const outcome = __test.decideReviewOutcome({
    product: { visibility: 'private' },
    ruleResult: { approved: true, reasons: [] },
    aiResult: result,
    autoApprove: true,
    allowRuleBasedAutoApprove: true,
    model: result.modelUsed
  })

  assert.equal(result.aiSucceeded, false)
  assert.equal(result.errorCode, 'gemini_http_404')
  assert.equal(result.modelUsed, 'gemini-flash-latest')
  assert.equal(result.exhaustedModelFallbacks, true)
  assert.equal(outcome.finalStatus, 'review_pending')
  assert.equal(outcome.moderationStatus, 'ai_error')
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
