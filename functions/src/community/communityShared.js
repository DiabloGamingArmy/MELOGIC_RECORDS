const admin = require('firebase-admin')
const { cleanString } = require('../admin/adminAuth')

const POSTING_MODES = new Set(['open', 'focused_only', 'members_only', 'moderators_only'])
const COMMUNITY_CATEGORIES = [
  'Genre',
  'Production',
  'Stage',
  'Marketplace',
  'Feedback',
  'Creator Help'
]

const OFFICIAL_COMMUNITIES = [
  ['dubstep', 'Dubstep', 'Bass music, drops, sound design, and release feedback.', 'Genre'],
  ['sound-design', 'Sound Design', 'Synth patches, textures, resampling, and tone sculpting.', 'Production'],
  ['mixing-mastering', 'Mixing & Mastering', 'Mix critique, loudness, translation, and final polish.', 'Production'],
  ['stagemaker', 'StageMaker', 'Stage plots, lighting, rigging, and show design workflows.', 'Stage'],
  ['live-production', 'Live Production', 'Performance systems, playback, venues, and show operations.', 'Stage'],
  ['sample-packs', 'Sample Packs', 'Pack creation, curation, previews, and marketplace prep.', 'Marketplace'],
  ['feedback', 'Feedback', 'Share work in progress and get useful creator notes.', 'Feedback'],
  ['metalcore', 'Metalcore', 'Heavy guitars, vocals, drums, and hybrid production.', 'Genre'],
  ['vocals', 'Vocals', 'Recording, editing, chains, toplines, and vocal production.', 'Production'],
  ['creator-help', 'Creator Help', 'Questions about building, selling, and growing on Melogic.', 'Creator Help']
]

function db() {
  return admin.firestore()
}

function cleanSlug(value = '') {
  return cleanString(value, 80)
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
}

function communityIdForSlug(slug = '') {
  const clean = cleanSlug(slug)
  if (!clean) return ''
  return clean
}

function canManageCommunity(auth = {}, community = {}) {
  const uid = cleanString(auth?.uid || '', 180)
  const token = auth?.token || {}
  return Boolean(
    token.admin === true
    || community.ownerUid === uid
    || (Array.isArray(community.moderatorIds) && community.moderatorIds.includes(uid))
  )
}

async function seedOfficialCommunities() {
  const firestore = db()
  const snapshot = await firestore.collection('communities').limit(1).get()
  if (!snapshot.empty) return { seeded: false, count: 0 }

  const now = admin.firestore.FieldValue.serverTimestamp()
  const batch = firestore.batch()
  OFFICIAL_COMMUNITIES.forEach(([slug, name, description, category]) => {
    const ref = firestore.collection('communities').doc(communityIdForSlug(slug))
    batch.set(ref, {
      communityId: ref.id,
      slug,
      name,
      description,
      category,
      iconURL: '',
      bannerURL: '',
      createdBy: 'system',
      ownerUid: 'system',
      moderatorIds: [],
      memberCount: 0,
      focusCount: 0,
      postCount: 0,
      visibility: 'public',
      postingMode: 'open',
      status: 'active',
      official: true,
      createdAt: now,
      updatedAt: now
    })
  })
  await batch.commit()
  return { seeded: true, count: OFFICIAL_COMMUNITIES.length }
}

module.exports = {
  COMMUNITY_CATEGORIES,
  POSTING_MODES,
  canManageCommunity,
  cleanSlug,
  communityIdForSlug,
  seedOfficialCommunities
}
