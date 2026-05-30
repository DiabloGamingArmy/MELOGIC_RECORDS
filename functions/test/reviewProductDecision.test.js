const test = require('node:test')
const assert = require('node:assert/strict')
const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp({ projectId: 'melogic-test' })
}

const { __test } = require('../src/admin/reviewProductDecision')
const adminAuth = require('../src/admin/adminAuth')

test('admin claim roles merge without preserving old admin permissions', () => {
  const merged = adminAuth.mergeAdminClaims({ betaAccess: true, productReview: true, adminRole: 'owner' }, 'support')
  assert.equal(merged.betaAccess, true)
  assert.equal(merged.admin, true)
  assert.equal(merged.adminRole, 'support')
  assert.equal(merged.productReview, false)
  assert.equal(merged.userRead, true)
  assert.equal(merged.orderSupport, true)
  assert.equal(merged.roleManage, false)
})

test('remove role strips admin claims but preserves unrelated claims', () => {
  const stripped = adminAuth.mergeAdminClaims({ betaAccess: true, admin: true, adminRole: 'owner', roleManage: true }, 'remove')
  assert.deepEqual(stripped, { betaAccess: true })
})

test('requester permissions are derived from custom claims', () => {
  const claims = adminAuth.getRequesterClaims({
    auth: {
      uid: 'admin-1',
      token: { admin: true, adminRole: 'marketplaceReviewer' }
    }
  })
  assert.equal(claims.productReview, true)
  assert.equal(claims.roleManage, false)
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

test('approve validation blocks missing approval requirements', () => {
  const problems = __test.validateProductForApproval({
    status: 'review_pending',
    title: 'Track pack',
    slug: 'track-pack',
    artistId: 'artist-1',
    productType: 'Sample Pack',
    description: 'Clean loops.',
    sellerAgreementAccepted: false,
    priceCents: 1200,
    payoutTargetCents: 0,
    currency: 'USD',
    assetSummary: { downloadableCount: 0 }
  })
  assert.ok(problems.some((problem) => problem.includes('Seller agreement')))
  assert.ok(problems.some((problem) => problem.includes('deliverable')))
})
