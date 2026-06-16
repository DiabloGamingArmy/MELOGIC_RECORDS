const test = require('node:test')
const assert = require('node:assert/strict')

const { __test } = require('../src/support/aiSupportAgent')

test('detects explicit live-agent requests', () => {
  const result = __test.detectEscalationNeed('Can I talk to a real human support agent?')
  assert.equal(result.shouldEscalate, true)
  assert.equal(result.reason, 'human_requested')
})

test('routes missing paid purchases to live support', () => {
  const result = __test.detectEscalationNeed('I bought a kit and it is missing from my library downloads.')
  assert.equal(result.shouldEscalate, true)
  assert.equal(result.reason, 'missing_paid_purchase')
})

test('casual personality chat does not escalate', () => {
  const result = __test.detectEscalationNeed('Tell me a bit about yourself.')
  assert.equal(result.shouldEscalate, false)
  assert.equal(result.reason, '')
})

test('tone requests do not escalate', () => {
  const result = __test.detectEscalationNeed('Can you use more of a human tone and be less robotic?')
  assert.equal(result.shouldEscalate, false)
  assert.equal(result.reason, '')
})

test('refund issues escalate', () => {
  const result = __test.detectEscalationNeed('I need a refund for my order.')
  assert.equal(result.shouldEscalate, true)
  assert.equal(result.reason, 'refund_or_payment')
})

test('payout and Stripe issues escalate', () => {
  const result = __test.detectEscalationNeed('My Stripe Connect payout is missing and onboarding is broken.')
  assert.equal(result.shouldEscalate, true)
  assert.equal(result.reason, 'payout_or_stripe')
})

test('invalid AI secret returns unavailable escalation', async () => {
  const result = await __test.generateSupportReply({
    apiKey: '',
    model: 'gemini-2.5-flash-lite',
    userMessage: 'How do I find my library downloads?'
  })
  assert.equal(result.aiAvailable, false)
  assert.equal(result.shouldEscalate, true)
  assert.equal(result.escalationReason, 'ai_unavailable')
})

test('Gemini JSON response is parsed into a support reply', async () => {
  const result = await __test.generateSupportReply({
    apiKey: 'AIza-valid-looking-support-key-1234567890',
    model: 'gemini-2.5-flash-lite',
    userMessage: 'Where can I edit my profile?',
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                replyText: 'Open Edit Profile from your account menu to update your public profile.',
                confidence: 0.9,
                shouldEscalate: false,
                escalationReason: '',
                suggestedCategory: 'account'
              })
            }]
          }
        }]
      })
    })
  })

  assert.equal(result.aiAvailable, true)
  assert.equal(result.shouldEscalate, false)
  assert.equal(result.suggestedCategory, 'account')
  assert.match(result.replyText, /Edit Profile/)
})

test('screen visibility questions explain site-only context when active', async () => {
  const result = await __test.generateSupportReply({
    apiKey: '',
    model: 'gemini-2.5-flash-lite',
    userMessage: 'Can you see my screen?',
    safePageContext: {
      guidanceSessionActive: true,
      currentRoute: '/inbox',
      visibleGuideTargets: [{ guideId: 'inbox-thread-dblake', label: 'DBlake' }]
    }
  })

  assert.equal(result.aiAvailable, true)
  assert.equal(result.shouldEscalate, false)
  assert.match(result.replyText, /safe context from this Melogic page/)
  assert.match(result.replyText, /cannot see your full screen/)
})

test('Gemini highlight actions are parsed into a sanitized highlight intent', async () => {
  const result = await __test.generateSupportReply({
    apiKey: 'AIza-valid-looking-support-key-1234567890',
    model: 'gemini-2.5-flash-lite',
    userMessage: 'Highlight the DBlake conversation.',
    safePageContext: {
      guidanceSessionActive: true,
      visibleGuideTargets: [{ guideId: 'inbox-thread-dblake', label: 'DBlake' }]
    },
    fetchImpl: async () => ({
      ok: true,
      json: async () => ({
        candidates: [{
          content: {
            parts: [{
              text: JSON.stringify({
                replyText: 'I’ll highlight the DBlake conversation for you.',
                confidence: 0.93,
                shouldEscalate: false,
                escalationReason: '',
                suggestedCategory: 'site_guidance',
                actions: [{
                  type: 'highlight',
                  targetGuideId: 'inbox-thread-dblake',
                  fallbackText: 'DBlake',
                  label: 'DBlake conversation',
                  durationMs: 5000
                }]
              })
            }]
          }
        }]
      })
    })
  })

  assert.equal(result.shouldEscalate, false)
  assert.equal(result.highlightIntent?.action, 'highlight')
  assert.equal(result.highlightIntent?.targetGuideId, 'inbox-thread-dblake')
  assert.equal(result.highlightIntent?.fallbackText, 'DBlake')
})
