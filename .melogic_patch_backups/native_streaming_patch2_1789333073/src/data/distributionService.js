import { httpsCallable } from 'firebase/functions'
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage'
import { functions } from '../firebase/functions'
import { storage } from '../firebase/storage'

function callDistributionFunction(name, payload = {}) {
  if (!functions) throw new Error('Distribution services are unavailable.')
  return httpsCallable(functions, name)(payload).then((result) => result?.data || { ok: false })
}

export function saveMusicReleaseDraft({ releaseId = '', release = {}, tracks = [] } = {}) {
  return callDistributionFunction('saveMusicReleaseDraft', { releaseId, release, tracks })
}

export function listMyMusicReleases() {
  return callDistributionFunction('listMyMusicReleases')
}

export function submitMusicRelease({ releaseId = '', rightsAccepted = false } = {}) {
  return callDistributionFunction('submitMusicRelease', { releaseId, rightsAccepted })
}

export function listMusicReleaseReviewQueue({ limit = 60 } = {}) {
  return callDistributionFunction('listMusicReleaseReviewQueue', { limit })
}

export function reviewMusicRelease({ releaseId = '', decision = '', reason = '' } = {}) {
  return callDistributionFunction('reviewMusicRelease', { releaseId, decision, reason })
}

function safeFileName(value = '') {
  const cleaned = String(value || 'cover-art')
    .normalize('NFKD')
    .replace(/[^\w.-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 120)
  return cleaned || 'cover-art'
}

export async function uploadDistributionArtwork({ uid = '', releaseId = '', file } = {}) {
  if (!storage) throw new Error('Artwork storage is unavailable.')
  if (!uid || !releaseId || !(file instanceof File)) throw new Error('Artwork upload is missing required information.')
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Artwork must be a JPG, PNG, or WebP image.')
  }
  if (file.size <= 0 || file.size > 10 * 1024 * 1024) {
    throw new Error('Artwork must be between 1 byte and 10 MB.')
  }
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg'
  const base = safeFileName(file.name.replace(/\.[^.]+$/, ''))
  const path = `users/${uid}/distribution/${releaseId}/artwork/${Date.now()}-${base}.${extension}`
  const artworkRef = ref(storage, path)
  await uploadBytes(artworkRef, file, {
    contentType: file.type,
    customMetadata: {
      ownerUid: uid,
      releaseId,
      assetRole: 'cover_art'
    }
  })
  return {
    path,
    url: await getDownloadURL(artworkRef)
  }
}

