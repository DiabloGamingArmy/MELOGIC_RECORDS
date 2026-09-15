const admin = require('firebase-admin')
const webpush = require('web-push')
const { defineSecret, defineString } = require('firebase-functions/params')
const { onCall, HttpsError } = require('firebase-functions/v2/https')

const WEB_PUSH_VAPID_PRIVATE_KEY = defineSecret('WEB_PUSH_VAPID_PRIVATE_KEY')
const WEB_PUSH_VAPID_PUBLIC_KEY = defineString('WEB_PUSH_VAPID_PUBLIC_KEY', { default: '' })
const WEB_PUSH_SUBJECT = defineString('WEB_PUSH_SUBJECT', { default: 'mailto:admin@melogicrecords.studio' })

function clean(value='', max=500) {
  return String(value ?? '').trim().slice(0,max)
}

function normalizeSubscription(data={}) {
  const endpoint=clean(data.endpoint,5000)
  const p256dh=clean(data.keys?.p256dh,2000)
  const auth=clean(data.keys?.auth,2000)
  if(!endpoint || !p256dh || !auth) return null
  return { endpoint, expirationTime: data.expirationTime || null, keys:{p256dh,auth} }
}

function configureWebPush() {
  const publicKey=clean(WEB_PUSH_VAPID_PUBLIC_KEY.value(),2000)
  const privateKey=clean(WEB_PUSH_VAPID_PRIVATE_KEY.value(),4000)
  const subject=clean(WEB_PUSH_SUBJECT.value(),500) || 'mailto:admin@melogicrecords.studio'
  if(!publicKey) throw new Error('WEB_PUSH_VAPID_PUBLIC_KEY is not configured for Functions.')
  if(!privateKey) throw new Error('WEB_PUSH_VAPID_PRIVATE_KEY is not configured.')
  webpush.setVapidDetails(subject,publicKey,privateKey)
}

async function sendPushToUser(uid,payload={}) {
  uid=clean(uid,180)
  if(!uid) return {ok:false,sent:0,failed:0,removed:0,reason:'missing-uid'}
  configureWebPush()

  const db=admin.firestore()
  const col=db.collection('users').doc(uid).collection('pushSubscriptions')
  const snap=await col.get()
  if(snap.empty) return {ok:true,sent:0,failed:0,removed:0,reason:'no-subscriptions'}

  const title=clean(payload.title,160)||'Melogic'
  const body=clean(payload.body,500)||'You have a new Melogic notification.'
  const rawUrl=clean(payload.url,1500)||'/'
  const navigate=/^https:\/\//i.test(rawUrl) ? rawUrl : `https://melogicrecords.studio${rawUrl.startsWith('/') ? rawUrl : `/${rawUrl}`}`
  const tag=clean(payload.tag,180)||undefined
  const data=payload.data && typeof payload.data==='object' ? payload.data : {}

  // Declarative Web Push (RFC 8030 marker) is the authoritative user-visible
  // notification on modern WebKit. The legacy fields are duplicated at the
  // top level so the existing service worker remains backward compatible.
  const message=JSON.stringify({
    web_push:8030,
    notification:{
      title,
      body,
      navigate,
      silent:false,
      ...(tag ? { tag } : {})
    },
    title,
    body,
    url:rawUrl,
    tag,
    icon:'/icons/pwa-192.png',
    badge:'/icons/favicon-48.png',
    silent:false,
    data
  })

  let sent=0,failed=0,removed=0
  await Promise.all(snap.docs.map(async d=>{
    const subscription=normalizeSubscription(d.data())
    if(!subscription){ failed++; return }
    try{
      await webpush.sendNotification(subscription,message,{TTL:300,urgency:'normal'})
      sent++
    }catch(error){
      failed++
      const status=Number(error?.statusCode||0)
      console.warn('[web-push] delivery failed',{uid,subscriptionId:d.id,status,message:error?.message})
      if(status===404 || status===410){
        try{ await d.ref.delete(); removed++ }catch(cleanupError){
          console.warn('[web-push] stale subscription cleanup failed',{uid,subscriptionId:d.id,message:cleanupError?.message})
        }
      }
    }
  }))
  return {ok:sent>0,sent,failed,removed,total:snap.size}
}

const sendWebPushTest = onCall(
  { timeoutSeconds:60, memory:'256MiB', secrets:[WEB_PUSH_VAPID_PRIVATE_KEY] },
  async request=>{
    const uid=clean(request.auth?.uid,180)
    if(!uid) throw new HttpsError('unauthenticated','Sign in required.')
    const result=await sendPushToUser(uid,{
      title:'Melogic · Test Notification',
      body:'Web Push delivery is operational on this device.',
      url:'/profile/edit#notifications',
      tag:`melogic-push-test-${Date.now()}`
    })
    if(!result.sent) throw new HttpsError('failed-precondition',`No push was delivered. ${JSON.stringify(result)}`)
    return result
  }
)

module.exports={
  WEB_PUSH_VAPID_PRIVATE_KEY,
  sendPushToUser,
  sendWebPushTest
}
