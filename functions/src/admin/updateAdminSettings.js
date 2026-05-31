const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { assertPermission, cleanString } = require('./adminAuth')
const { writeAdminAuditLog } = require('./auditLog')
const { mergeSettings, sanitizeSettingsPatch, settingsRef } = require('./adminSettingsShared')

const updateAdminSettings = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const actor = assertPermission(request, 'roleManage')
  const patch = sanitizeSettingsPatch(request.data?.section || '', request.data?.values || {})
  if (!patch) throw new HttpsError('invalid-argument', 'A valid settings section and at least one setting are required.')

  const ref = settingsRef()
  const beforeSnap = await ref.get()
  const before = mergeSettings(beforeSnap.exists ? beforeSnap.data() || {} : {})
  const sectionBefore = before[patch.section] || {}
  const sectionAfter = { ...sectionBefore, ...patch.values }

  await ref.set({
    [patch.section]: sectionAfter,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: actor.uid
  }, { merge: true })

  const auditLogId = await writeAdminAuditLog({
    actorUid: actor.uid,
    actorEmail: actor.email,
    actorRole: actor.adminRole,
    action: 'admin_settings_updated',
    targetType: 'platformConfig',
    targetId: 'current',
    targetPath: 'platformConfig/current',
    reason: cleanString(request.data?.reason || `Updated ${patch.section} settings`, 1200),
    before: { [patch.section]: sectionBefore },
    after: { [patch.section]: sectionAfter },
    metadata: { section: patch.section, keys: Object.keys(patch.values) }
  })

  return {
    ok: true,
    section: patch.section,
    settings: mergeSettings({ ...before, [patch.section]: sectionAfter }),
    auditLogId
  }
})

module.exports = {
  updateAdminSettings
}
