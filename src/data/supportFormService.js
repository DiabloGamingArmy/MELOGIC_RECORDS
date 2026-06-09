import {
  addDoc,
  collection,
  doc,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
  where
} from 'firebase/firestore'
import { db } from '../firebase/firestore'

const SUPPORT_FORMS_COLLECTION = 'supportForms'

function cleanText(value = '', maxLength = 1000) {
  return String(value || '').trim().slice(0, maxLength)
}

function cleanEmail(value = '') {
  return String(value || '').trim().toLowerCase().slice(0, 254)
}

function isProbablyEmail(value = '') {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim())
}

export async function submitSupportForm({
  name = '',
  email = '',
  username = '',
  subject = '',
  message = ''
} = {}) {
  const cleanName = cleanText(name, 120)
  const cleanEmailAddress = cleanEmail(email)
  const cleanUsername = cleanText(username, 80)
  const cleanSubject = cleanText(subject, 180)
  const cleanMessage = cleanText(message, 5000)

  if (!cleanName) throw new Error('Please enter your name.')
  if (!cleanEmailAddress || !isProbablyEmail(cleanEmailAddress)) throw new Error('Please enter a valid email address.')
  if (!cleanSubject) throw new Error('Please enter a subject.')
  if (!cleanMessage) throw new Error('Please enter a message.')
  if (cleanMessage.length < 10) throw new Error('Please include a little more detail in your message.')

  const docRef = await addDoc(collection(db, SUPPORT_FORMS_COLLECTION), {
    name: cleanName,
    email: cleanEmailAddress,
    username: cleanUsername,
    subject: cleanSubject,
    message: cleanMessage,
    status: 'new',
    source: 'support_page',
    adminNote: '',
    assignedTo: '',
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp()
  })

  return docRef.id
}

function timestampToIso(value) {
  if (!value) return ''
  if (typeof value.toDate === 'function') return value.toDate().toISOString()
  if (value instanceof Date) return value.toISOString()
  if (typeof value === 'string') return value
  return ''
}

export function normalizeSupportForm(id, data = {}) {
  return {
    id,
    name: data.name || '',
    email: data.email || '',
    username: data.username || '',
    subject: data.subject || '',
    message: data.message || '',
    status: data.status || 'new',
    source: data.source || 'support_page',
    adminNote: data.adminNote || '',
    assignedTo: data.assignedTo || '',
    createdAt: timestampToIso(data.createdAt),
    updatedAt: timestampToIso(data.updatedAt)
  }
}

export function watchSupportForms(callback, onError, { limitCount = 50 } = {}) {
  const formsQuery = query(
    collection(db, SUPPORT_FORMS_COLLECTION),
    orderBy('createdAt', 'desc'),
    limit(limitCount)
  )

  return onSnapshot(
    formsQuery,
    (snapshot) => {
      const forms = snapshot.docs.map((formDoc) => normalizeSupportForm(formDoc.id, formDoc.data()))
      callback(forms)
    },
    (error) => {
      console.warn('[support forms] watch failed', error)
      if (typeof onError === 'function') onError(error)
    }
  )
}

export async function listUnresolvedSupportForms({ limitCount = 8 } = {}) {
  const formsQuery = query(
    collection(db, SUPPORT_FORMS_COLLECTION),
    where('status', 'in', ['new', 'reviewing', 'reviewed']),
    orderBy('createdAt', 'desc'),
    limit(limitCount)
  )
  const snapshot = await getDocs(formsQuery)
  return snapshot.docs.map((docSnap) => normalizeSupportForm(docSnap.id, docSnap.data()))
}

export async function updateSupportFormStatus(formId, status = 'reviewed') {
  const cleanStatus = ['new', 'reviewing', 'reviewed', 'resolved', 'archived'].includes(status)
    ? status
    : 'reviewed'

  await updateDoc(doc(db, SUPPORT_FORMS_COLLECTION, formId), {
    status: cleanStatus,
    updatedAt: serverTimestamp()
  })
}

export async function updateSupportFormAdminNote(formId, adminNote = '') {
  await updateDoc(doc(db, SUPPORT_FORMS_COLLECTION, formId), {
    adminNote: cleanText(adminNote, 2000),
    updatedAt: serverTimestamp()
  })
}
