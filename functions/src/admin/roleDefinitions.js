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
  serializeRoleDefinition,
  canonicalizeLegacyBadgeValues,
  canonicalizeLegacyRoleValues,
  normalizeRoleArray
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


const migrateCanonicalRoleAssignments = onCall({timeoutSeconds:540,memory:'512MiB'}, async(request)=>{
  const actor=await requireAdminActionSecurity(request,'roleManage')
  const apply=request.data?.apply===true
  const requestedLimit=Math.max(1,Math.min(500,Number(request.data?.limit)||250))
  const definitions=await listRoleDefinitions({includeDisabled:true})
  const known=new Set(definitions.map((item)=>item.key))
  const usersSnap=await db().collection('users').limit(requestedLimit).get()
  const report={scanned:0,changed:0,rolesMigrated:0,badgesMigrated:0,unknownKeys:[],apply}
  const unknown=new Set()
  const batch=apply ? db().batch() : null
  for(const userDoc of usersSnap.docs){
    report.scanned+=1
    const uid=userDoc.id
    const user=userDoc.data()||{}
    const profileRef=db().collection('profiles').doc(uid)
    const profileSnap=await profileRef.get()
    const profile=profileSnap.exists ? profileSnap.data()||{} : {}
    const currentRoles=normalizeRoleArray(user.roles||[])
    const currentBadges=normalizeRoleArray(profile.badges||[])
    const nextRoles=canonicalizeLegacyRoleValues(user,profile)
    const nextBadges=canonicalizeLegacyBadgeValues(profile)
    ;[...nextRoles,...nextBadges].filter((key)=>!known.has(key)).forEach((key)=>unknown.add(key))
    const rolesChanged=JSON.stringify([...currentRoles].sort())!==JSON.stringify([...nextRoles].sort())
    const badgesChanged=JSON.stringify([...currentBadges].sort())!==JSON.stringify([...nextBadges].sort())
    if(!rolesChanged&&!badgesChanged) continue
    report.changed+=1
    if(rolesChanged) report.rolesMigrated+=1
    if(badgesChanged) report.badgesMigrated+=1
    if(apply){
      const now=admin.firestore.FieldValue.serverTimestamp()
      if(rolesChanged) batch.set(userDoc.ref,{roles:nextRoles,updatedAt:now},{merge:true})
      if(badgesChanged) batch.set(profileRef,{badges:nextBadges,updatedAt:now},{merge:true})
    }
  }
  report.unknownKeys=[...unknown].sort()
  if(apply&&report.changed) await batch.commit()
  await writeAdminAuditLog({
    actorUid:actor.uid,actorEmail:actor.email,actorRole:actor.adminRole,
    action:apply?'canonical_role_migration_applied':'canonical_role_migration_previewed',
    targetType:'role_registry',targetId:'canonical-role-migration',
    targetPath:ROLE_REGISTRY_COLLECTION,
    reason:cleanString(request.data?.reason||`Canonical role/badge migration ${apply?'apply':'dry run'}.`,1200),
    before:null,after:report
  })
  return {ok:true,report}
})

module.exports={listAdminRoleDefinitions,upsertAdminRoleDefinition,deleteAdminRoleDefinition,migrateCanonicalRoleAssignments}
