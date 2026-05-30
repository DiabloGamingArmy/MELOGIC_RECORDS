#!/usr/bin/env node
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)

function loadFirebaseAdmin() {
  try {
    return require('../functions/node_modules/firebase-admin')
  } catch {
    return require('firebase-admin')
  }
}

const admin = loadFirebaseAdmin()
const {
  buildAdminClaims,
  mergeAdminClaims,
  normalizeRole,
  pickAdminClaims,
  stripAdminClaims
} = require('../functions/src/admin/adminAuth')

const [, , uidArg, roleArg] = process.argv
const uid = String(uidArg || '').trim()
const role = normalizeRole(roleArg || '')

function usage() {
  console.error('Usage: node scripts/setAdminClaims.js <uid> <owner|admin|marketplaceReviewer|support|auditor|remove>')
  process.exit(1)
}

if (!uid || uid.includes('/') || !role) usage()

if (!admin.apps.length) {
  admin.initializeApp({
    projectId: process.env.GOOGLE_CLOUD_PROJECT || process.env.GCLOUD_PROJECT || 'melogic-records'
  })
}

async function main() {
  const userRecord = await admin.auth().getUser(uid)
  const existingClaims = userRecord.customClaims || {}
  const active = role !== 'remove'
  const nextClaims = active
    ? mergeAdminClaims(existingClaims, role, true)
    : stripAdminClaims(existingClaims)
  await admin.auth().setCustomUserClaims(uid, nextClaims)

  const db = admin.firestore()
  const adminUserRef = db.collection('adminUsers').doc(uid)
  const adminSnap = await adminUserRef.get()
  await adminUserRef.set({
    ...(adminSnap.exists ? {} : { createdAt: admin.firestore.FieldValue.serverTimestamp() }),
    uid,
    active,
    role: active ? role : '',
    claims: active ? pickAdminClaims(buildAdminClaims(role)) : {},
    email: userRecord.email || '',
    displayName: userRecord.displayName || '',
    photoURL: userRecord.photoURL || '',
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    updatedBy: 'bootstrap-script'
  }, { merge: true })

  console.log(`Updated admin claims for ${uid}:`, pickAdminClaims(nextClaims))
  console.log('Claims updated. User must sign out/sign in or refresh ID token.')
}

main().then(() => process.exit(0)).catch((error) => {
  console.error(error?.message || error)
  process.exit(1)
})
