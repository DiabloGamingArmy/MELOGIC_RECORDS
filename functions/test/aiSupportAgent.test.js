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
