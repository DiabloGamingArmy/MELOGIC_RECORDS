const admin = require('firebase-admin')

// melogic-canonical-role-registry-v1
// Registry defines identity; assignment stays separate:
// users/{uid}.roles[] = backend authority
// profiles/{uid}.badges[] = public visual identity
const ROLE_REGISTRY_COLLECTION = 'roleDefinitions'
const SYSTEM_ROLE_DEFINITIONS = Object.freeze([
  ['moderator','Moderator','Melogic moderation role and optional public moderator identity.',100],
  ['founder','Founder','Melogic founder role and public founder identity.',200],
  ['pro','Pro','Melogic Pro backend entitlement/status and optional retained public identity.',300],
  ['verified','Verified','Verified account role and public verification identity.',400],
  ['beta','Beta','Melogic beta-program role and optional public beta identity.',500]
].map(([key,displayName,description,sortOrder]) => Object.freeze({
  key, roleName:key, displayName, description, iconKey:key,
  // melogic-badge-storage-preview-fix-v1
  iconPath:`assets/badges/${key}Badge.png`,
  backendAssignable:true, badgeAssignable:true, system:true, protected:true,
  enabled:true, sortOrder
})))

function db(){ return admin.firestore() }
function normalizeRoleKey(value=''){
  return String(value||'').trim().toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,64)
}
function normalizeRoleArray(value=[]){
  return [...new Set((Array.isArray(value)?value:[]).map(normalizeRoleKey).filter(Boolean))]
}
function serializeRoleDefinition(key='',raw={}){
  const cleanKey=normalizeRoleKey(key||raw.key||raw.roleName)
  return {
    key:cleanKey, roleName:normalizeRoleKey(raw.roleName||cleanKey),
    displayName:String(raw.displayName||cleanKey).trim().slice(0,120),
    description:String(raw.description||'').trim().slice(0,600),
    iconKey:String(raw.iconKey||cleanKey).trim().slice(0,120),
    iconPath:String(raw.iconPath||'').trim().slice(0,500),
    // melogic-transparent-badge-icon-path-v1
    transparentIconPath:String(raw.transparentIconPath||'').trim().slice(0,500),
    backendAssignable:raw.backendAssignable===true, badgeAssignable:raw.badgeAssignable===true,
    system:raw.system===true, protected:raw.protected===true, enabled:raw.enabled!==false,
    sortOrder:Number.isFinite(Number(raw.sortOrder))?Number(raw.sortOrder):1000
  }
}
function roleDefinitionRef(key=''){
  const cleanKey=normalizeRoleKey(key)
  if(!cleanKey) throw new Error('A valid role key is required.')
  return db().collection(ROLE_REGISTRY_COLLECTION).doc(cleanKey)
}
async function listRoleDefinitions({includeDisabled=false}={}){
  const snap=await db().collection(ROLE_REGISTRY_COLLECTION).get(), stored=new Map()
  snap.docs.forEach(doc=>{ const item=serializeRoleDefinition(doc.id,doc.data()||{}); if(item.key) stored.set(item.key,item) })
  SYSTEM_ROLE_DEFINITIONS.forEach(def=>{ if(!stored.has(def.key)) stored.set(def.key,serializeRoleDefinition(def.key,def)) })
  return [...stored.values()].filter(x=>includeDisabled||x.enabled)
    .sort((a,b)=>a.sortOrder-b.sortOrder||a.displayName.localeCompare(b.displayName))
}
async function seedSystemRoleDefinitions({actorUid='system'}={}){
  const batch=db().batch(), now=admin.firestore.FieldValue.serverTimestamp()
  SYSTEM_ROLE_DEFINITIONS.forEach(def=>batch.set(roleDefinitionRef(def.key),{
    ...serializeRoleDefinition(def.key,def),createdAt:now,updatedAt:now,
    updatedByUid:String(actorUid||'system').slice(0,180)
  },{merge:true}))
  await batch.commit()
  return SYSTEM_ROLE_DEFINITIONS.map(x=>x.key)
}

function canonicalizeLegacyBadgeValues(profile = {}) {
  const direct = normalizeRoleArray(profile.badges || [])
  if (direct.length) return direct
  const legacyArrays = [
    ...(Array.isArray(profile.publicRoles) ? profile.publicRoles : []),
    ...(Array.isArray(profile.publicBadges) ? profile.publicBadges : [])
  ]
  const legacyMap = profile.publicBadges && !Array.isArray(profile.publicBadges) && typeof profile.publicBadges === 'object'
    ? Object.entries(profile.publicBadges).filter(([, enabled]) => enabled === true).map(([key]) => key.replace(/^badge_/, ''))
    : []
  return normalizeRoleArray([...legacyArrays, ...legacyMap])
}

function canonicalizeLegacyRoleValues(user = {}, profile = {}) {
  // Migration may inspect legacy profile roles, but runtime authorization must not.
  const direct = normalizeRoleArray(user.roles || [])
  if (direct.length) return direct
  return normalizeRoleArray([
    ...(Array.isArray(user.publicRoles) ? user.publicRoles : []),
    ...(Array.isArray(profile.roles) ? profile.roles : [])
  ])
}

module.exports={ROLE_REGISTRY_COLLECTION,SYSTEM_ROLE_DEFINITIONS,canonicalizeLegacyBadgeValues,canonicalizeLegacyRoleValues,listRoleDefinitions,normalizeRoleArray,normalizeRoleKey,roleDefinitionRef,seedSystemRoleDefinitions,serializeRoleDefinition}
