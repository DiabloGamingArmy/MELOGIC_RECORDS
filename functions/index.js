const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp()
}

const { createOrGetDm } = require('./src/messages/createOrGetDm')
const { createGroupThread } = require('./src/messages/createGroupThread')
const { requestProductReview } = require('./src/products/requestProductReview')
const { verifyRecaptchaEnterprise } = require('./src/security/verifyRecaptchaEnterprise')

exports.createOrGetDm = createOrGetDm
exports.createGroupThread = createGroupThread
exports.requestProductReview = requestProductReview
exports.verifyRecaptchaEnterprise = verifyRecaptchaEnterprise
