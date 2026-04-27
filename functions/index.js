const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp()
}

const { createOrGetDm } = require('./src/messages/createOrGetDm')
const { createGroupThread } = require('./src/messages/createGroupThread')
const { repairMyInboxThreads, syncInboxMirrorsOnThreadWrite } = require('./src/messages/inboxMirrors')
const { requestProductReview } = require('./src/products/requestProductReview')
const { provisionUserAccount } = require('./src/users/provisionUserAccount')
const { verifyRecaptchaEnterprise } = require('./src/security/verifyRecaptchaEnterprise')

exports.createOrGetDm = createOrGetDm
exports.createGroupThread = createGroupThread
exports.repairMyInboxThreads = repairMyInboxThreads
exports.syncInboxMirrorsOnThreadWrite = syncInboxMirrorsOnThreadWrite
exports.requestProductReview = requestProductReview
exports.provisionUserAccount = provisionUserAccount
exports.verifyRecaptchaEnterprise = verifyRecaptchaEnterprise
