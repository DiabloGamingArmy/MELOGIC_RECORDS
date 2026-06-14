import test from 'node:test'
import assert from 'node:assert/strict'
import { getProductGiftSendUiState } from '../src/utils/productGiftState.js'

test('gift send button follows recipient and sending state', () => {
  assert.equal(getProductGiftSendUiState({ recipientCount: 0 }).disabled, true)
  assert.equal(getProductGiftSendUiState({ recipientCount: 1 }).disabled, false)
  assert.equal(getProductGiftSendUiState({ recipientCount: 1 }).title, 'Ready to send.')
  assert.equal(getProductGiftSendUiState({ recipientCount: 1, sending: true }).disabled, true)
  assert.equal(getProductGiftSendUiState({ recipientCount: 1, sending: true }).label, 'Sending Gift...')
})

test('gift send state exposes success and clean failure text', () => {
  assert.equal(getProductGiftSendUiState({ success: 'Sent to 1 recipient.' }).title, 'Gift sent successfully.')
  assert.equal(getProductGiftSendUiState({ recipientCount: 1, error: 'Try again.' }).title, 'Could not send gift.')
})
