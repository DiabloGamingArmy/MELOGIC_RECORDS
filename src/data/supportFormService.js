import { addDoc, collection, serverTimestamp } from 'firebase/firestore'
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