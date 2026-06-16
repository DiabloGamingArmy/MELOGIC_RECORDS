const { onCall, HttpsError } = require('firebase-functions/v2/https')
const admin = require('firebase-admin')
const { cleanString, requireAdminActionSecurity } = require('./adminAuth')
const { writeAdminAuditLog } = require('./auditLog')
const { mergeSettings, sanitizeSettingsPatch, settingsRef } = require('./adminSettingsShared')

function sellerAgreementVersionIsValid(version = '') {
  return /^v[0-9]+$/.test(String(version || '').trim())
}

async function mirrorSellerAgreementSettings(actor = {}, sectionAfter = {}) {
  const agreementId = cleanString(sectionAfter.sellerAgreementId || 'marketplace-product-seller-agreement', 180) || 'marketplace-product-seller-agreement'
  const version = cleanString(sectionAfter.sellerAgreementVersion || 'v1', 40) || 'v1'
  const storagePath = cleanString(sectionAfter.sellerAgreementPath || `legal/agreements/${agreementId}/${version}.md`, 900)
  await admin.firestore().collection('platformSettings').doc('marketplaceSellerAgreement').set({
    enabled: true,
    agreementId,
    activeVersion: version,
    title: 'Marketplace Product Seller Agreement',
    storagePath,
    format: 'markdown',
    requiresSignature: true,
    allowStorageFetch: true,
    storageDiscoveryEnabled: false,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: actor.uid
  }, { merge: true })
}

const updateAdminSettings = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async (request) => {
  const actor = await requireAdminActionSecurity(request, ['settingsManage', 'roleManage'])
  const patch = sanitizeSettingsPatch(request.data?.section || '', request.data?.values || {})
  if (!patch) throw new HttpsError('invalid-argument', 'A valid settings section and at least one setting are required.')

  const ref = settingsRef()
  const beforeSnap = await ref.get()
  const before = mergeSettings(beforeSnap.exists ? beforeSnap.data() || {} : {})
  const sectionBefore = before[patch.section] || {}
  const sectionAfter = {
    ...sectionBefore,
    ...patch.values,
    ...(patch.section === 'agreements'
      ? {
          sellerAgreementUpdatedAt: new Date().toISOString(),
          sellerAgreementUpdatedBy: actor.uid
        }
      : {}),
    ...(patch.section === 'supportAi'
      ? {
          updatedAt: new Date().toISOString(),
          updatedBy: actor.uid
        }
      : {})
  }
  if (patch.section === 'agreements' && !sellerAgreementVersionIsValid(sectionAfter.sellerAgreementVersion)) {
    throw new HttpsError('invalid-argument', 'Version must use lowercase v followed by a number, such as v2.')
  }

  await ref.set({
    [patch.section]: sectionAfter,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: actor.uid
  }, { merge: true })
  if (patch.section === 'agreements') {
    await mirrorSellerAgreementSettings(actor, sectionAfter)
  }

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
