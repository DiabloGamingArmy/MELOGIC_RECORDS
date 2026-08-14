import assert from 'node:assert/strict'
import test from 'node:test'
import { souraInstallDiagnostic, souraInstallErrorMessage } from '../src/soura/marketplace/souraInstallUi.js'

test('Soura install errors are actionable and diagnostics redact URLs and credentials', () => {
  const error = {
    code: 'functions/failed-precondition',
    message: 'This product has no verified creator-approved Soura assets.',
    details: { operation: 'validate-soura-capability', productId: 'product-1', signedUrl: 'https://example.test/file?token=secret', nested: { credential: 'secret' } }
  }
  assert.match(souraInstallErrorMessage(error), /installable, verified Soura pack/)
  assert.deepEqual(souraInstallDiagnostic(error, 'product-1').details, { operation: 'validate-soura-capability', productId: 'product-1', signedUrl: '[omitted]', nested: { credential: '[omitted]' } })
})
