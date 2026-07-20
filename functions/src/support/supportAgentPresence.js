const { onValueWritten } = require('firebase-functions/v2/database')
const { FieldValue, getFirestore } = require('firebase-admin/firestore')

const db = getFirestore()

function clean(value = '', max = 180) {
  return String(value || '').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, max)
}

const handleSupportAgentPresence = onValueWritten({
  ref: '/supportAgentSessions/{threadId}',
  instance: 'melogic-records-default-rtdb',
  region: 'us-central1',
  memory: '256MiB',
  timeoutSeconds: 30
}, async (event) => {
  const before = event.data.before.val() || {}
  const after = event.data.after.val() || {}
  if (before.active !== true || after.active !== false) return
  const threadId = clean(event.params.threadId)
  const agentUid = clean(after.agentUid || before.agentUid)
  const agentFirstName = clean(after.agentFirstName || before.agentFirstName || 'Support', 50) || 'Support'
  if (!threadId || !agentUid || !threadId.startsWith('resona_')) return
  const threadRef = db.collection('threads').doc(threadId)
  await db.runTransaction(async (transaction) => {
    const snap = await transaction.get(threadRef)
    if (!snap.exists) return
    const thread = snap.data() || {}
    if (thread.assignedAgentUid !== agentUid || thread.status !== 'assigned') return
    const message = `${agentFirstName} left the conversation. Resona is active again.`
    transaction.set(threadRef, {
      assignedAgentUid: null,
      assignedAgentFirstName: '',
      assignedAgentAvatarPath: '',
      status: 'ai_active',
      mode: 'general',
      aiEscalationReason: '',
      supportAgentDisconnectedAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      lastMessageAt: FieldValue.serverTimestamp(),
      lastMessageText: message,
      lastMessagePreview: message,
      lastMessageSenderId: 'system',
      lastMessageType: 'system'
    }, { merge: true })
    transaction.set(threadRef.collection('messages').doc(), {
      senderId: 'system',
      senderUid: '',
      senderType: 'system',
      body: message,
      type: 'system',
      attachments: [],
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      deleted: false,
      edited: false,
      metadata: {
        event: 'live_agent_disconnected',
        agentUid,
        agentFirstName,
        reason: clean(after.reason || 'connection_closed', 80)
      }
    })
  })
})

module.exports = { handleSupportAgentPresence }
