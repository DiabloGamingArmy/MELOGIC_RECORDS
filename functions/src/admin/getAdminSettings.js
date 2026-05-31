const { onCall } = require('firebase-functions/v2/https')
const { assertAdmin } = require('./adminAuth')
const { mergeSettings, settingsRef } = require('./adminSettingsShared')

const getAdminSettings = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const claims = assertAdmin(request)
  const snap = await settingsRef().get()
  const raw = snap.exists ? snap.data() || {} : {}
  return {
    ok: true,
    exists: snap.exists,
    settings: mergeSettings(raw),
    updatedAt: raw.updatedAt?.toDate ? raw.updatedAt.toDate().toISOString() : null,
    updatedBy: raw.updatedBy || '',
    requester: { uid: claims.uid, role: claims.adminRole }
  }
})

module.exports = {
  getAdminSettings
}
