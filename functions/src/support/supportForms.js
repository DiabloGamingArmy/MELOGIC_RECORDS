const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { FieldValue, getFirestore } = require('firebase-admin/firestore')
const { assertAnyPermission, cleanString } = require('../admin/adminAuth')

const db = getFirestore()
const CALLABLE_OPTIONS = {
  timeoutSeconds: 30,
  memory: '256MiB',
  cors: true,
  invoker: 'public'
}

const resolveSupportFormRequest = onCall(CALLABLE_OPTIONS, async (request) => {
  const claims = assertAnyPermission(request, ['emailSend', 'orderSupport'])
  const formId = cleanString(request.data?.formId || '', 180)
  if (!formId) throw new HttpsError('invalid-argument', 'Support request is required.')

  const formRef = db.collection('supportForms').doc(formId)
  const formSnap = await formRef.get()
  if (!formSnap.exists) throw new HttpsError('not-found', 'Support request was not found.')

  await formRef.update({
    status: 'resolved',
    resolvedAt: FieldValue.serverTimestamp(),
    resolvedBy: claims.uid,
    updatedAt: FieldValue.serverTimestamp()
  })

  return { ok: true, formId, status: 'resolved' }
})

module.exports = {
  resolveSupportFormRequest
}
