const { onDocumentCreated, onDocumentUpdated } = require('firebase-functions/v2/firestore')
const admin = require('firebase-admin')
const { EMAIL_SECRETS, renderPremiumEmailHtml, sendEmail, validateEmailAddress } = require('./emailSender')
const REGION='us-central1'
const db=()=>admin.firestore()
const opts=document=>({document,region:REGION,secrets:EMAIL_SECRETS,retry:false})
const roles=new Set(['admin','administrator','founder','owner','staff','superadmin','super_admin'])
function allowed(u,g,k){
  const p=u?.settings?.notificationPreferences||{}
  return p?.delivery?.email!==false && p?.[g]?.[k]!==false
}
const esc=(v='')=>String(v||'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;')
async function getUser(uid){if(!uid)return null;const s=await db().collection('users').doc(uid).get();return s.exists?{uid,...s.data()}:null}
async function sendUser(uid,key,title,body,url='/'){
 const u=await getUser(uid);if(!u||!allowed(u,'email',key))return
 const to=validateEmailAddress(u.email||'');if(!to)return
 const cta='https://melogicrecords.studio'+url
 await sendEmail({to,subject:title,category:'notification',metadata:{uid,key},
 html:renderPremiumEmailHtml({eyebrow:'Melogic notification',title,body:`<p>${esc(body)}</p>`,ctaLabel:'Open Melogic',ctaUrl:cta,footer:'Manage alerts in Profile → Edit → Notifications.'}),
 text:`${title}\n\n${body}\n\n${cta}`})
}
async function adminUsers(){
 const s=await db().collection('users').get()
 return s.docs.map(d=>({uid:d.id,...d.data()})).filter(u=>u.admin===true||roles.has(String(u.role||u.accountRole||u.adminRole||'').toLowerCase()))
}
async function sendAdmins(key,title,body,url='/admin.html'){
 await Promise.allSettled((await adminUsers()).map(async u=>{
  if(!allowed(u,'admin',key))return
  const to=validateEmailAddress(u.email||'');if(!to)return
  const cta='https://melogicrecords.studio'+url
  await sendEmail({to,subject:title,category:'admin_notification',metadata:{uid:u.uid,key},
   html:renderPremiumEmailHtml({eyebrow:'Melogic admin',title,body:`<p>${esc(body)}</p>`,ctaLabel:'Open Admin Panel',ctaUrl:cta,footer:'Manage admin alerts in Profile → Edit → Notifications.'}),
   text:`${title}\n\n${body}\n\n${cta}`})
 }))
}
const emailOnInboxMessageCreated=onDocumentCreated(opts('threads/{threadId}/messages/{messageId}'),async e=>{
 const m=e.data?.data()||{},sender=String(m.senderId||m.senderUid||'');if(!sender||m.deleted===true)return
 const t=(await db().collection('threads').doc(e.params.threadId).get()).data()||{}
 const ids=[...(t.participantUids||t.participantIds||t.memberUids||[])].map(String)
 const key=t.type==='group'?'groupMessages':'directMessages'
 const body=String(m.body||'Sent an attachment').replace(/\s+/g,' ').slice(0,180)
 await Promise.allSettled(ids.filter(x=>x&&x!==sender).map(x=>sendUser(x,key,'New Melogic inbox message',body,`/inbox.html?thread=${encodeURIComponent(e.params.threadId)}`)))
})
const emailOnProductSubmitted=onDocumentUpdated(opts('products/{productId}'),async e=>{
 const b=e.data?.before?.data()||{},a=e.data?.after?.data()||{},q=new Set(['submitted','pending_review','in_review','review'])
 if(b.status===a.status||!q.has(String(a.status||'').toLowerCase()))return
 await sendAdmins('marketplaceSubmissions','New marketplace submission',`${a.title||a.name||'A product'} was submitted for review.`,'/admin.html#products')
})
const emailOnMusicReleaseSubmitted=onDocumentUpdated(opts('musicReleases/{releaseId}'),async e=>{
 const b=e.data?.before?.data()||{},a=e.data?.after?.data()||{},q=new Set(['submitted','pending_review','in_review','review'])
 if(b.status===a.status||!q.has(String(a.status||'').toLowerCase()))return
 await sendAdmins('streamingSubmissions','New music submission',`${a.title||'A release'} was submitted for streaming/distribution review.`,'/admin.html#music')
})
const emailOnSupportFormCreated=onDocumentCreated(opts('supportForms/{formId}'),async e=>{
 const a=e.data?.data()||{}
 const name=String(a.name||a.username||a.email||'A user').trim()
 const email=String(a.email||'').trim()
 const subject=String(a.subject||'Support request').trim()
 const message=String(a.message||'').replace(/\s+/g,' ').trim()
 const preview=message.length>220?`${message.slice(0,217)}...`:message
 const source=String(a.source||'support_page').replaceAll('_',' ')
 const body=[
   `${name}${email?` (${email})`:''} submitted a new ${source} request.`,
   `Subject: ${subject}`,
   preview?`Message: ${preview}`:''
 ].filter(Boolean).join('\n\n')

 console.log('[email notifications] support form created',{
   formId:e.params.formId,
   source:a.source||'support_page',
   subject,
   hasEmail:Boolean(email)
 })

 await sendAdmins(
   'supportRequests',
   `New support request: ${subject}`.slice(0,140),
   body,
   '/admin.html#support'
 )
})
const emailOnAdminAuditCreated=onDocumentCreated(opts('adminLogs/{logId}'),async e=>{
 const a=e.data?.data()||{},action=String(a.action||'admin action');if(action.includes('email_notification'))return
 await sendAdmins('auditActivity','Admin audit activity',`${a.actorEmail||a.actorUid||'An administrator'} performed ${action}.`,'/admin.html#logs')
})
module.exports={emailOnInboxMessageCreated,emailOnProductSubmitted,emailOnMusicReleaseSubmitted,emailOnSupportFormCreated,emailOnAdminAuditCreated}
