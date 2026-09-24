const assert = require('node:assert/strict')
const test = require('node:test')
const { __test } = require('../src/engineering/engineeringJobs')

test('engineering lifecycle contains guarded approval and deployment states', () => {
  for (const status of ['submitted','triaging','auditing','fixing','reviewing','awaiting_approval','approved','deploying','deployed','rejected','failed']) {
    assert.equal(__test.ALLOWED_STATUSES.has(status), true)
  }
})
test('engineering jobs normalize to inert defaults', () => {
  const job = __test.normalizeJob('job-1', { title: 'Camera issue', report: 'Camera does not take a photo.' })
  assert.equal(job.status, 'submitted')
  assert.equal(job.classification.status, 'pending')
  assert.equal(job.implementation.status, 'blocked')
  assert.equal(job.approval.status, 'not_requested')
  assert.equal(job.deployment.status, 'blocked')
})
