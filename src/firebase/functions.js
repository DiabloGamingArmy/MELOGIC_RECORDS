import { getFunctions } from 'firebase/functions'
import { app } from './firebaseConfig'

export const functions = getFunctions(app)
