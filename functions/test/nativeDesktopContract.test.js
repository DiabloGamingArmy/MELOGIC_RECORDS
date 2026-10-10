const { test } = require('node:test')
const assert = require('node:assert/strict')
const http = require('node:http')
const { spawn } = require('node:child_process')
const path = require('node:path')
const { randomUUID } = require('node:crypto')
const { initializeApp, deleteApp } = require('firebase-admin/app')
const { getFirestore } = require('firebase-admin/firestore')
const { desktopAuthCore } = require('../src/desktop/desktopAuthCore')
const { origamiLicensingCore, keyDigest } = require('../src/desktop/origamiLicensingCore')
const { adminLicensingCore } = require('../src/licensing/adminLicensingCore')
const publicConfig = require('../../config/firebase-client.json')
const native = process.env.ORIGAMI_NATIVE_CONTRACT_BINARY

test('actual native JUCE wire → production cores → Firestore emulator → activation', { skip: !process.env.FIRESTORE_EMULATOR_HOST || !native, timeout: 180000 }, async t => {
  const app = initializeApp({ projectId: 'demo-melogic-wire-tests' }, 'native-wire')
  const db = getFirestore(app)
  try {
    for (const mode of ['success-delayed-pending', 'cancelled', 'expired-login', 'malformed-approval', 'consumed-login', 'token-rejected', 'exchange-server-error', 'lookup-rejected', 'invalid-key', 'revoked-key', 'expired-key', 'exhausted-key', 'wrong-product', 'revoked-account', 'lost-begin', 'lost-poll', 'lost-exchange', 'lost-lookup', 'lost-redeem', 'keychain-failed', 'poll-timeout', 'lost-authorization'].filter(mode => !process.env.ORIGAMI_NATIVE_CONTRACT_CASE || mode === process.env.ORIGAMI_NATIVE_CONTRACT_CASE)) {
      await t.test(mode, async () => {
        const uid = `wire-${mode}-${randomUUID()}`, actor = { uid: 'fixture-admin', adminRole: 'owner' }
        let clock = Date.now(), issued = 0, polls = 0, redeemed = 0, lostAuthorization = false
        const failures = [], customToken = 'fixture-custom-token-not-valid', idToken = 'fixture-id-token-not-valid'
        const auth = { getUser: async user => ({ uid: user, disabled: mode === 'revoked-account' && issued > 0 }), createCustomToken: async () => { issued++; return customToken } }
        const desktop = desktopAuthCore({ db, auth, now: () => clock })
        const licensing = origamiLicensingCore({ db, now: () => clock }), admin = adminLicensingCore({ db, auth, now: () => clock })
        await admin.saveProduct({ productId: 'origami', name: 'Origami', status: 'beta', editions: ['beta'] }, actor)
        const generated = await admin.generate({ productId: 'origami', edition: 'beta', quantity: 1, maxRedemptions: 1, campaign: 'Emulator contract only' }, actor)
        const key = generated.keys[0], keyRef = db.doc(`licenseKeys/${keyDigest(key)}`)
        assert.match(key, /^MELOGIC-[a-f0-9]{64}$/)
        assert.equal(keyDigest(` \n${key}\n `), keyDigest(key)); assert.notEqual(keyDigest(key.toUpperCase()), keyDigest(key))
        if(mode==='revoked-key')await keyRef.update({status:'revoked'})
        if(mode==='expired-key')await keyRef.update({expiresAt:new Date(clock-1)})
        if(mode==='exhausted-key')await keyRef.update({redemptionCount:1})
        if(mode==='wrong-product')await keyRef.update({productId:'other'})
        const expect = ({ 'cancelled':'cancelled', 'expired-login':'expired', 'malformed-approval':'verified', 'consumed-login':'already handled', 'token-rejected':'complete account sign-in', 'exchange-server-error':'temporarily unavailable', 'lookup-rejected':'revoked', 'invalid-key':'Invalid license', 'revoked-key':'unavailable', 'expired-key':'expired', 'exhausted-key':'already been redeemed', 'wrong-product':'not valid', 'revoked-account':'revoked', 'keychain-failed':'securely', 'poll-timeout':'too long', 'lost-authorization':'authorized' })[mode] || (mode.startsWith('lost-')?'connection':'authorized')
        const server = http.createServer(async (req, res) => {
          try {
            const url = new URL(req.url, 'http://127.0.0.1');let bytes='';for await(const part of req)bytes+=part
            assert.equal(req.method,'POST');assert.match(req.headers['content-type'],/^application\/json/)
            const body=JSON.parse(bytes);const reply=(value,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(value))}
            if(url.pathname==='/fixture')return reply({key:mode==='invalid-key'?'MELOGIC-'+'0'.repeat(64):key,expect,failStorage:mode==='keychain-failed'})
            const lost=({ 'lost-begin':'/functions/beginDesktopLogin','lost-poll':'/functions/pollDesktopLogin','lost-exchange':'/identity/accounts:signInWithCustomToken','lost-lookup':'/identity/accounts:lookup','lost-redeem':'/functions/redeemOrigamiLicense', 'lost-authorization':'/functions/getOrigamiAuthorization' })[mode]
            if(url.pathname===lost && (mode!=='lost-authorization' || !lostAuthorization)){lostAuthorization=true;req.socket.destroy();return}
            if(url.pathname.startsWith('/functions/')) {
              assert.deepEqual(Object.keys(body),['data']);const data=body.data;let result
              switch(url.pathname) {
                case '/functions/beginDesktopLogin':
                  assert.deepEqual(Object.keys(data).sort(),['challenge','requestId']);result=await desktop.begin(data,uid);break
                case '/functions/pollDesktopLogin': {
                  assert.deepEqual(Object.keys(data).sort(),['requestId','verifier']);polls++
                  if(mode==='poll-timeout'){await new Promise(resolve=>setTimeout(resolve,31000));reply({result:{requestId:data.requestId,status:'pending'}});return}
                  if(mode==='expired-login')clock+=300001
                  result=await desktop.poll(data,uid)
                  if(result.status==='pending') {
                    if(mode==='success-delayed-pending')await new Promise(resolve=>setTimeout(resolve,4000))
                    reply({result})
                    await desktop.approve({requestId:data.requestId,approve:mode!=='cancelled'},uid,Math.floor(clock/1000))
                    await assert.rejects(desktop.approve({requestId:data.requestId,approve:true},uid),{code:'failed-precondition'})
                    return
                  }
                  if(result.status==='approved') {
                    assert.equal((await desktop.poll(data,uid)).status,'consumed');assert.equal(issued,1)
                    if(mode==='malformed-approval')delete result.customToken
                    if(mode==='consumed-login')result={requestId:data.requestId,status:'consumed'}
                  }
                  break
                }
                case '/functions/getOrigamiAuthorization':assert.equal(req.headers.authorization,`Bearer ${idToken}`);result=await licensing.authorization(uid);break
                case '/functions/redeemOrigamiLicense':
                  assert.equal(req.headers.authorization,`Bearer ${idToken}`);assert.deepEqual(Object.keys(data),['key']);redeemed++;result=await licensing.redeem(data,uid);break
                default:throw Error('Unexpected callable endpoint')
              }
              return reply({result})
            }
            assert.equal(url.searchParams.get('key'),publicConfig.apiKey,'API identifier stays in URL query')
            if(url.pathname==='/identity/accounts:signInWithCustomToken') {
              assert.deepEqual(body,{token:customToken,returnSecureToken:true})
              if(mode==='token-rejected')return reply({error:{message:'INVALID_CUSTOM_TOKEN'}},400)
              if(mode==='exchange-server-error')return reply({error:{message:'fixture-only'}},503)
              return reply({idToken,refreshToken:'fixture-refresh-token-not-valid',expiresIn:'3600'})
            }
            if(url.pathname==='/identity/accounts:lookup') {
              assert.deepEqual(body,{idToken})
              if(mode==='lookup-rejected'||mode==='revoked-account')return reply({error:{message:'USER_DISABLED'}},401)
              return reply({users:[{localId:uid,displayName:'Wire Fixture',email:'wire@example.invalid',disabled:false}]})
            }
            throw Error('Unexpected wire endpoint')
          } catch(error) {
            if(error.code && typeof error.code==='string') {res.writeHead(400,{'Content-Type':'application/json'});res.end(JSON.stringify({error:{status:error.code.replaceAll('-','_').toUpperCase(),message:'Fixture classification'}}))}
            else {failures.push(error);res.writeHead(500);res.end('{}')}
          }
        })
        await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
        try {
          const output=await new Promise((resolve,reject)=>{
            const child=spawn(path.resolve(native),[],{env:{...process.env,ORIGAMI_ACCOUNT_CONTRACT_BASE:`http://127.0.0.1:${server.address().port}`,MELOGIC_ACCOUNT_DIAGNOSTICS:'1'}})
            let text='';child.stdout.on('data',x=>text+=x);child.stderr.on('data',x=>text+=x);child.on('error',reject);child.on('exit',code=>resolve({code,text}))
          })
          assert.deepEqual(failures,[])
          assert.equal(output.text.includes(key),false);assert.equal(output.text.includes(customToken),false);assert.equal(output.text.includes(idToken),false)
          assert.equal(output.code,0,output.text)
          const doc=(await keyRef.get()).data(), entitlement=(await db.doc(`users/${uid}/entitlements/origami`).get()).data()
          if(expect==='authorized') {
            assert.equal(redeemed,1);assert.equal(doc.redemptionCount,1);assert.equal(entitlement.status,'active');assert.equal(entitlement.edition,'beta');assert.equal((await licensing.authorization(uid)).authorized,true)
            assert.equal((await keyRef.collection('redemptions').get()).size,1)
            assert.match(output.text,/pending_key_continue/);assert.match(output.text,/firebase_exchange.*response_success/);assert.match(output.text,/session_publish.*signed_in/)
          } else {assert.equal(doc.redemptionCount,mode==='exhausted-key'?1:0);assert.equal(entitlement,undefined)}
          assert.equal(JSON.stringify(doc).includes(key),false)
        } finally {server.closeAllConnections();await new Promise(resolve=>server.close(resolve))}
      })
    }
  } finally {await db.terminate();await deleteApp(app)}
})
