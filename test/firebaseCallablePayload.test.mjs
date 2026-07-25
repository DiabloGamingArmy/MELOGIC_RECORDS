import test from 'node:test'
import assert from 'node:assert/strict'
import { sanitizeFirebaseCallablePayload } from '../src/utils/firebaseCallablePayload.js'

test('Firebase callable payload sanitizer replaces non-finite numbers at every depth', () => {
  const input = {
    peakDb: -Infinity,
    meter: {
      rms: Number.NaN,
      peak: Infinity,
      finite: -120
    },
    samples: [0, -Infinity, undefined],
    optional: undefined
  }

  assert.deepEqual(sanitizeFirebaseCallablePayload(input), {
    peakDb: null,
    meter: {
      rms: null,
      peak: null,
      finite: -120
    },
    samples: [0, null, null]
  })
})

test('Firebase callable payload sanitizer preserves non-plain values', () => {
  const date = new Date('2026-07-25T00:00:00.000Z')
  assert.equal(sanitizeFirebaseCallablePayload(date), date)
})
