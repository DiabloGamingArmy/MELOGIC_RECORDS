const admin = require('firebase-admin')
const { onCall } = require('firebase-functions/v2/https')
const { adminLicensingCore } = require('./adminLicensingCore')
const { verifyLicensingAdmin } = require('./adminLicensingSecurity')
const core = () => adminLicensingCore({ db: admin.firestore(), auth: admin.auth() })
const operations = {
  listLicensingProducts: [false, (s, d) => s.catalog()],
  saveLicensingProduct: [true, (s, d, a) => s.saveProduct(d, a)],
  getAdminProductAccess: [false, (s, d) => s.access(d.targetUid)],
  grantProductEntitlement: [true, (s, d, a) => s.changeAccess(d, a)],
  revokeProductEntitlement: [true, (s, d, a) => s.changeAccess(d, a, true)],
  generateLicenseKeys: [true, (s, d, a) => s.generate(d, a)],
  listLicenseKeys: [false, (s, d) => s.listKeys(d)],
  revokeLicenseKey: [true, (s, d, a) => s.revokeKey(d, a)]
}
for (const [name, [mutation, run]] of Object.entries(operations)) {
  exports[name] = onCall({ region: 'us-central1', timeoutSeconds: 60, maxInstances: 10 }, async request => {
    const actor = await verifyLicensingAdmin(request, mutation, { auth: admin.auth(), db: admin.firestore() })
    return run(core(), request.data || {}, actor)
  })
}
