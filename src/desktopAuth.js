import { httpsCallable } from 'firebase/functions'
import { waitForInitialAuthState } from './firebase/auth.js'
import { functions } from './firebase/functions.js'

const status = document.querySelector('#status')
const approve = document.querySelector('#approve')
const cancel = document.querySelector('#cancel')
const requestId = new URLSearchParams(location.search).get('request') || ''
let finished = false
async function respond(accepted) {
  if (finished) return
  finished = true
  approve.disabled = cancel.disabled = true
  try {
    await httpsCallable(functions, 'approveDesktopLogin')({ requestId, approve: accepted })
    status.textContent = accepted ? 'Approved. Return to Origami to finish signing in.' : 'Request cancelled. You can close this page.'
  } catch {
    status.textContent = 'This request is unavailable or expired. Start a new sign-in from Origami.'
  }
}
approve.addEventListener('click', () => respond(true))
cancel.addEventListener('click', () => respond(false))
if (!/^[a-f0-9]{64}$/.test(requestId)) {
  status.textContent = 'Invalid login request. Start sign-in from Origami.'
} else {
  try {
    const user = await waitForInitialAuthState()
    if (!user) {
      const destination = `/auth/desktop?request=${requestId}`
      location.replace(`/auth?redirect=${encodeURIComponent(destination)}`)
    } else {
      document.querySelector('#identity').textContent = [user.displayName, user.email].filter(Boolean).join(' · ')
      document.querySelector('#verification').textContent = `CODE ${requestId.slice(0, 8).toUpperCase()}`
      status.textContent = 'Confirm this account for the Origami request below.'
      approve.disabled = cancel.disabled = false
    }
  } catch {
    status.textContent = 'Melogic is unavailable. Try again from Origami.'
  }
}
