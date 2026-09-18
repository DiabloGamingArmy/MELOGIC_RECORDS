const admin = require('firebase-admin')
const { onCall, HttpsError } = require('firebase-functions/v2/https')
const { assertAnyPermission, cleanString, requireAdminActionSecurity } = require('./adminAuth')
const { writeAdminAuditLog } = require('./auditLog')
const {
  ROLE_REGISTRY_COLLECTION,
  SYSTEM_ROLE_DEFINITIONS,
  listRoleDefinitions,
  normalizeRoleKey,
  roleDefinitionRef,
  serializeRoleDefinition
} = require('../roles/roleRegistry')

// melogic-admin-role-registry-crud-v2
function systemDefinition(key='') {
  return SYSTEM_ROLE_DEFINITIONS.find((item)=>item.key===normalizeRoleKey(key)) || null
}
function publicDefinition(raw={}) {
  const item=serializeRoleDefinition(raw.key||raw.roleName,raw)
  return { ...item, createdAt: raw.createdAt?.toDate?.()?.toISOString?.() || '', updatedAt: raw.updatedAt?.toDate?.()?.toISOString?.() || '', updatedByUid: cleanString(raw.updatedByUid||'',180) }
}

const listAdminRoleDefinitions = onCall({timeoutSeconds:60,memory:'256MiB'}, async(request)=>{
  assertAnyPermission(request,'roleManage')
  return {ok:true,roles:await listRoleDefinitions({includeDisabled:true}),collection:ROLE_REGISTRY_COLLECTION}
})

const upsertAdminRoleDefinition = onCall({timeoutSeconds:60,memory:'256MiB'}, async(request)=>{
  const actor=await requireAdminActionSecurity(request,'roleManage')
  const input=request.data?.definition || {}
  const key=normalizeRoleKey(input.key||input.roleName)
  if(!key) throw new HttpsError('invalid-argument','Role name/key is required.')
  const ref=roleDefinitionRef(key), snap=await ref.get()
  const before=snap.exists ? publicDefinition({key,...snap.data()}) : null
  const sys=systemDefinition(key)
  const normalized=serializeRoleDefinition(key,{
    ...input,
    key,
    roleName:key,
    system: sys ? true : input.system===true,
    protected: sys ? true : input.protected===true
  })
  if(!normalized.displayName) throw new HttpsError('invalid-argument','Display name is required.')
  if(!normalized.backendAssignable && !normalized.badgeAssignable) throw new HttpsError('invalid-argument','A definition must be assignable as a backend role, public badge, or both.')
  const now=admin.firestore.FieldValue.serverTimestamp()
  const payload={...normalized,updatedAt:now,updatedByUid:actor.uid,updatedByEmail:actor.email||''}
  if(!snap.exists) payload.createdAt=now
  await ref.set(payload,{merge:true})
  await writeAdminAuditLog({actorUid:actor.uid,actorEmail:actor.email,actorRole:actor.adminRole,action:snap.exists?'role_definition_updated':'role_definition_created',targetType:'role_definition',targetId:key,targetPath:`${ROLE_REGISTRY_COLLECTION}/${key}`,reason:cleanString(request.data?.reason||`Admin ${snap.exists?'updated':'created'} role definition ${key}.`,1200),before,after:normalized})
  return {ok:true,role:normalized,created:!snap.exists}
})

const deleteAdminRoleDefinition = onCall({timeoutSeconds:60,memory:'256MiB'}, async(request)=>{
  const actor=await requireAdminActionSecurity(request,'roleManage')
  const key=normalizeRoleKey(request.data?.key)
  if(!key) throw new HttpsError('invalid-argument','Role key is required.')
  if(systemDefinition(key)) throw new HttpsError('failed-precondition','Core Melogic role definitions cannot be deleted. Disable or edit their presentation instead.')
  const ref=roleDefinitionRef(key), snap=await ref.get()
  if(!snap.exists) return {ok:true,key,deleted:false}
  const before=publicDefinition({key,...snap.data()})
  await ref.delete()
  await writeAdminAuditLog({actorUid:actor.uid,actorEmail:actor.email,actorRole:actor.adminRole,action:'role_definition_deleted',targetType:'role_definition',targetId:key,targetPath:`${ROLE_REGISTRY_COLLECTION}/${key}`,reason:cleanString(request.data?.reason||`Admin deleted role definition ${key}.`,1200),before,after:null})
  return {ok:true,key,deleted:true}
})

module.exports={listAdminRoleDefinitions,upsertAdminRoleDefinition,deleteAdminRoleDefinition}
