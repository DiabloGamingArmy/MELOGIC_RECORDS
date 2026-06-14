export function getProductGiftSendUiState({
  recipientCount = 0,
  sending = false,
  error = '',
  success = ''
} = {}) {
  const count = Math.max(0, Number(recipientCount) || 0)
  if (sending) {
    return {
      disabled: true,
      label: 'Sending Gift...',
      tone: 'is-sending',
      title: 'Sending gift...',
      detail: 'Creating the gift and notifying the selected recipients.'
    }
  }
  if (error) {
    return {
      disabled: count === 0,
      label: 'Send Gift',
      tone: 'is-error',
      title: 'Could not send gift.',
      detail: String(error)
    }
  }
  if (success) {
    return {
      disabled: count === 0,
      label: 'Send Gift',
      tone: 'is-success',
      title: 'Gift sent successfully.',
      detail: String(success)
    }
  }
  return count
    ? {
        disabled: false,
        label: 'Send Gift',
        tone: '',
        title: 'Ready to send.',
        detail: `${count} recipient${count === 1 ? '' : 's'} selected.`
      }
    : {
        disabled: true,
        label: 'Send Gift',
        tone: '',
        title: 'Select a recipient.',
        detail: 'Search for a Melogic user, then select them before sending.'
      }
}
