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
const { saveProductManifest } = require('./src/products/saveProductManifest')
const { createReport } = require('./src/reports/createReport')
const { reviewProductDecision } = require('./src/admin/reviewProductDecision')
const { listMarketplaceReviewQueue } = require('./src/admin/listMarketplaceReviewQueue')
const { setAdminUserRole } = require('./src/admin/setAdminUserRole')
const { listAdminProducts } = require('./src/admin/listAdminProducts')
const { listAdminUsers } = require('./src/admin/listAdminUsers')
const { getAdminUserProfile } = require('./src/admin/getAdminUserProfile')
const { listAdminReports } = require('./src/admin/listAdminReports')
const { updateReportDecision } = require('./src/admin/updateReportDecision')
const { listAdminOrders } = require('./src/admin/listAdminOrders')
const { getAdminOrder } = require('./src/admin/getAdminOrder')
const { listAdminLogs } = require('./src/admin/listAdminLogs')
const { listAdminTeam } = require('./src/admin/listAdminTeam')
const { listActiveStaffPresence } = require('./src/admin/listActiveStaffPresence')
const { getAdminSettings } = require('./src/admin/getAdminSettings')
const { updateAdminSettings } = require('./src/admin/updateAdminSettings')

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
exports.saveProductManifest = saveProductManifest
exports.createReport = createReport
exports.reviewProductDecision = reviewProductDecision
exports.listMarketplaceReviewQueue = listMarketplaceReviewQueue
exports.setAdminUserRole = setAdminUserRole
exports.listAdminProducts = listAdminProducts
exports.listAdminUsers = listAdminUsers
exports.getAdminUserProfile = getAdminUserProfile
exports.listAdminReports = listAdminReports
exports.updateReportDecision = updateReportDecision
exports.listAdminOrders = listAdminOrders
exports.getAdminOrder = getAdminOrder
exports.listAdminLogs = listAdminLogs
exports.listAdminTeam = listAdminTeam
exports.listActiveStaffPresence = listActiveStaffPresence
exports.getAdminSettings = getAdminSettings
exports.updateAdminSettings = updateAdminSettings
