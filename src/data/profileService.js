import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase/functions'

export async function loadPublicProfileStats(uid = '') {
  const callable = httpsCallable(functions, 'getPublicProfileStats')
  const result = await callable({ uid: String(uid || '').trim() })
  return result?.data || {
    ok: false,
    stats: {},
    isFollowing: false,
    failedStatQueries: []
  }
}

export async function setProfileFollowState(targetUid = '', follow = true) {
  const callable = httpsCallable(functions, 'toggleProfileFollow')
  const result = await callable({
    targetUid: String(targetUid || '').trim(),
    follow: Boolean(follow)
  })
  return result?.data || { ok: false, following: Boolean(follow) }
}
