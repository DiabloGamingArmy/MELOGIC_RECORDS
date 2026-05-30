const test = require('node:test')
const assert = require('node:assert/strict')
const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'melogic-test' })
}

const { __test } = require('../src/products/reviewProductDecision')

test('staff authorization accepts safe custom claim roles only', () => {
  assert.equal(__test.tokenHasStaffRole({ admin: true }), true)
  assert.equal(__test.tokenHasStaffRole({ marketplaceReviewer: true }), true)
  assert.equal(__test.tokenHasStaffRole({ roles: ['marketplace_reviewer'] }), true)
  assert.equal(__test.tokenHasStaffRole({ role: 'user' }), false)
})

test('review queue candidate matches pending review states', () => {
  assert.equal(__test.productIsInReviewQueue({ status: 'review_pending' }), true)
  assert.equal(__test.productIsInReviewQueue({ reviewJobStatus: 'pending_manual_review' }), true)
  assert.equal(__test.productIsInReviewQueue({ moderationStatus: 'ai_error' }), true)
  assert.equal(__test.productIsInReviewQueue({ status: 'published', visibility: 'public', moderationStatus: 'approved' }), false)
})

test('approve decision publishes through server-controlled fields', () => {
  const update = __test.buildDecisionUpdate('approve', {
    uid: 'admin-1',
    reason: 'Passed manual review.',
    notes: 'Clean listing.',
    existing: { moderationSummary: 'AI review passed.' }
  })

  assert.equal(update.status, 'published')
  assert.equal(update.visibility, 'public')
  assert.equal(update.moderationStatus, 'approved')
  assert.equal(update.reviewJobStatus, 'approved')
  assert.equal(update.reviewedBy, 'admin-1')
  assert.match(update.moderationSummary, /AI review passed/)
})

test('request changes and reject keep products private', () => {
  const changes = __test.buildDecisionUpdate('request_changes', { uid: 'admin-1' })
  const reject = __test.buildDecisionUpdate('reject', { uid: 'admin-1' })
  const pending = __test.buildDecisionUpdate('keep_pending', { uid: 'admin-1' })

  assert.equal(changes.status, 'needs_changes')
  assert.equal(changes.visibility, 'private')
  assert.equal(reject.status, 'rejected')
  assert.equal(reject.visibility, 'private')
  assert.equal(pending.status, 'review_pending')
  assert.equal(pending.visibility, 'private')
  assert.equal(pending.reviewJobStatus, 'pending_manual_review')
})
