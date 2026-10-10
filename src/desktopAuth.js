import { httpsCallable } from 'firebase/functions'
import { waitForInitialAuthState } from './firebase/auth.js'
import { functions } from './firebase/functions.js'

const element = id => document.querySelector(`#${id}`)
const status = element('status'), approve = element('approve'), cancel = element('cancel')
const requestId = new URLSearchParams(location.search).get('request') || ''
let ready = false, finished = false
function complete(title, copy, approved = false) {
  ready = false
  element('consent').hidden = true
  element('completed').hidden = false
  element('success-icon').hidden = !approved
  element('result-title').textContent = title
  element('result-copy').textContent = copy
  status.textContent = ''
}
async function respond(accepted) {
  if (!ready || finished) return
  finished = true
  approve.disabled = cancel.disabled = true
  status.textContent = accepted ? 'Connecting…' : 'Declining…'
  try {
    const result = await httpsCallable(functions, 'approveDesktopLogin')({ requestId, approve: accepted })
    if (result.data?.ok !== true) throw Error('Unconfirmed approval')
    if (accepted) complete('Origami is connected', 'You can return to Origami. This window can now be closed.', true)
    else complete('Connection declined', 'Origami was not connected to your Melogic Account. You can close this window.')
  } catch (error) {
    const code = error?.code
    complete(code === 'functions/deadline-exceeded' ? 'Connection request expired' : 'Connection unavailable',
      code === 'functions/deadline-exceeded' ? 'Return to Origami and try again.' : code === 'functions/failed-precondition' || code === 'functions/invalid-argument' || code === 'functions/permission-denied' ? 'This connection request is no longer valid. Return to Origami and try again.' : 'The connection was not confirmed. Return to Origami and try again.')
  }
}
approve.addEventListener('click', () => respond(true))
cancel.addEventListener('click', () => respond(false))
if (!/^[a-f0-9]{64}$/.test(requestId)) {
  complete('Connection unavailable', 'This connection request is no longer valid.')
} else {
  try {
    const user = await waitForInitialAuthState()
    if (!user) {
      const destination = `/auth/desktop?request=${requestId}`
      location.replace(`/auth?redirect=${encodeURIComponent(destination)}`)
    } else {
      // textContent deliberately avoids interpreting account-controlled HTML.
      element('account-name').textContent = user.displayName || ''
      element('account-name').hidden = !user.displayName
      element('account-email').textContent = user.email || ''
      element('account-email').hidden = !user.email
      if (!user.displayName && !user.email) {
        element('account-name').textContent = 'Your Melogic Account'
        element('account-name').hidden = false
      }
      element('consent').hidden = false
      status.textContent = ''
      ready = true
      approve.disabled = cancel.disabled = false
    }
  } catch {
    complete('Connection unavailable', 'Return to Origami and try again.')
  }
}
