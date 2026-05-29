const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp()
}

const { createOrGetDm } = require('./src/messages/createOrGetDm')
const { createGroupThread } = require('./src/messages/createGroupThread')
const { repairMyInboxThreads, syncInboxMirrorsOnThreadWrite } = require('./src/messages/inboxMirrors')
const { requestProductReview, processProductReviewJob } = require('./src/products/requestProductReview')
const { setProductEngagement, setProductReaction, setProductSaved } = require('./src/products/productEngagement')
const { provisionUserAccount } = require('./src/users/provisionUserAccount')
const { verifyRecaptchaEnterprise } = require('./src/security/verifyRecaptchaEnterprise')
const { createCheckoutSession } = require('./src/payments/createCheckoutSession')
const { stripeWebhook } = require('./src/payments/stripeWebhook')
const { claimFreeProduct } = require('./src/products/claimFreeProduct')
const { createProductDownloadUrl } = require('./src/products/createProductDownloadUrl')
const { createOrUpdateProductShell } = require('./src/products/createOrUpdateProductShell')

exports.createOrGetDm = createOrGetDm
exports.createGroupThread = createGroupThread
exports.repairMyInboxThreads = repairMyInboxThreads
exports.syncInboxMirrorsOnThreadWrite = syncInboxMirrorsOnThreadWrite
exports.requestProductReview = requestProductReview
exports.processProductReviewJob = processProductReviewJob
exports.provisionUserAccount = provisionUserAccount
exports.verifyRecaptchaEnterprise = verifyRecaptchaEnterprise

exports.setProductReaction = setProductReaction
exports.setProductSaved = setProductSaved

exports.setProductEngagement = setProductEngagement

exports.createCheckoutSession = createCheckoutSession
exports.stripeWebhook = stripeWebhook
exports.claimFreeProduct = claimFreeProduct
exports.createProductDownloadUrl = createProductDownloadUrl
exports.createOrUpdateProductShell = createOrUpdateProductShell
