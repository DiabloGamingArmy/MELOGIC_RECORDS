import { httpsCallable } from 'firebase/functions'
import { functions } from '../firebase/functions'

async function requireAdminStepUp(label = 'Engineering action') {
  const guard = window.__melogicAdminRequireStepUp
  if (typeof guard !== 'function') throw new Error('Admin 2FA security controller is unavailable. Refresh the Admin Panel.')
  const ok = await guard(label)
  if (!ok) {
    const error = new Error('Engineering action cancelled before 2FA verification.')
    error.code = 'admin/step-up-cancelled'
    throw error
  }
}
export async function createEngineeringJob({ title = '', report = '' } = {}) {
  await requireAdminStepUp('Create engineering job')
  const result = await httpsCallable(functions, 'createEngineeringJob')({ title, report, source: 'admin' })
  return result.data || {}
}
export async function listEngineeringJobs({ limit = 40 } = {}) {
  const result = await httpsCallable(functions, 'listEngineeringJobs')({ limit })
  return result.data || { jobs: [] }
}
export async function getEngineeringJob(jobId = '') {
  const result = await httpsCallable(functions, 'getEngineeringJob')({ jobId })
  return result.data || {}
}

export async function startEngineeringTriage(jobId = '') {
  await requireAdminStepUp('Start engineering triage')
  const result = await httpsCallable(functions, 'startEngineeringTriage')({ jobId })
  return result.data || {}
}
