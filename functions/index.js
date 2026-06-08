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
const { createCommunityPost } = require('./src/community/createCommunityPost')
const { toggleCommunityPostLike, toggleCommunityPostDislike, toggleCommunityPostSave, recordCommunityPostShare } = require('./src/community/communityPostEngagement')
const { updateCommunityPost } = require('./src/community/updateCommunityPost')
const { createCommunity } = require('./src/community/createCommunity')
const { toggleCommunityFocus } = require('./src/community/toggleCommunityFocus')
const { seedCommunities } = require('./src/community/seedCommunities')
const { createCommunityComment } = require('./src/community/createCommunityComment')
const { deleteCommunityComment } = require('./src/community/deleteCommunityComment')
const { toggleCommunityCommentLike, toggleCommunityCommentDislike } = require('./src/community/toggleCommunityCommentLike')
const { createCommunityStory } = require('./src/community/createCommunityStory')
const { deleteCommunityStory } = require('./src/community/deleteCommunityStory')
const { recordCommunityStoryView } = require('./src/community/recordCommunityStoryView')
const {
  hideCommunityPost,
  restoreCommunityPost,
  lockCommunityPostComments,
  deleteOwnCommunityPost,
  pinCommunityPost,
  unpinCommunityPost,
  hideCommunityComment,
  restoreCommunityComment,
  moderateCommunity,
  listAdminCommunityModeration
} = require('./src/community/communityModeration')
const { createReport } = require('./src/reports/createReport')
const { recordAccountSecurityEvent } = require('./src/account/recordAccountSecurityEvent')
const { generateRecoveryCodes, getRecoveryCodeStatus, useRecoveryCode } = require('./src/account/recoveryCodes')
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
const { getAdminLog } = require('./src/admin/getAdminLog')
const { listAdminTeam } = require('./src/admin/listAdminTeam')
const { listActiveStaffPresence } = require('./src/admin/listActiveStaffPresence')
const { getAdminSettings } = require('./src/admin/getAdminSettings')
const { updateAdminSettings } = require('./src/admin/updateAdminSettings')
const { addAdminUserNote } = require('./src/admin/addAdminUserNote')
const { setUserSuspension } = require('./src/admin/setUserSuspension')
const { sendAdminSystemMessage } = require('./src/admin/sendAdminSystemMessage')
const { forcePasswordReset, revokeRecoveryCodes, setTemporaryPassword } = require('./src/admin/adminUserSecurityTools')
const { requestEmailVerification, requestPasswordResetEmail } = require('./src/email/authEmails')
const { getEmailAdminStatus, listAdminEmailLogs, sendAdminAuthEmail, sendAdminEmail } = require('./src/email/adminEmail')
const { createLiveKitToken } = require('./src/livekit/createLiveKitToken')

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
exports.createCommunityPost = createCommunityPost
exports.toggleCommunityPostLike = toggleCommunityPostLike
exports.toggleCommunityPostDislike = toggleCommunityPostDislike
exports.toggleCommunityPostSave = toggleCommunityPostSave
exports.recordCommunityPostShare = recordCommunityPostShare
exports.updateCommunityPost = updateCommunityPost
exports.createCommunity = createCommunity
exports.toggleCommunityFocus = toggleCommunityFocus
exports.seedCommunities = seedCommunities
exports.createCommunityComment = createCommunityComment
exports.deleteCommunityComment = deleteCommunityComment
exports.toggleCommunityCommentLike = toggleCommunityCommentLike
exports.toggleCommunityCommentDislike = toggleCommunityCommentDislike
exports.createCommunityStory = createCommunityStory
exports.deleteCommunityStory = deleteCommunityStory
exports.recordCommunityStoryView = recordCommunityStoryView
exports.hideCommunityPost = hideCommunityPost
exports.restoreCommunityPost = restoreCommunityPost
exports.lockCommunityPostComments = lockCommunityPostComments
exports.deleteOwnCommunityPost = deleteOwnCommunityPost
exports.pinCommunityPost = pinCommunityPost
exports.unpinCommunityPost = unpinCommunityPost
exports.hideCommunityComment = hideCommunityComment
exports.restoreCommunityComment = restoreCommunityComment
exports.moderateCommunity = moderateCommunity
exports.listAdminCommunityModeration = listAdminCommunityModeration
exports.createReport = createReport
exports.recordAccountSecurityEvent = recordAccountSecurityEvent
exports.generateRecoveryCodes = generateRecoveryCodes
exports.getRecoveryCodeStatus = getRecoveryCodeStatus
exports.useRecoveryCode = useRecoveryCode
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
exports.getAdminLog = getAdminLog
exports.listAdminTeam = listAdminTeam
exports.listActiveStaffPresence = listActiveStaffPresence
exports.getAdminSettings = getAdminSettings
exports.updateAdminSettings = updateAdminSettings
exports.addAdminUserNote = addAdminUserNote
exports.setUserSuspension = setUserSuspension
exports.sendAdminSystemMessage = sendAdminSystemMessage
exports.forcePasswordReset = forcePasswordReset
exports.revokeRecoveryCodes = revokeRecoveryCodes
exports.setTemporaryPassword = setTemporaryPassword
exports.requestPasswordResetEmail = requestPasswordResetEmail
exports.requestEmailVerification = requestEmailVerification
exports.sendAdminEmail = sendAdminEmail
exports.sendAdminAuthEmail = sendAdminAuthEmail
exports.getEmailAdminStatus = getEmailAdminStatus
exports.listAdminEmailLogs = listAdminEmailLogs
exports.createLiveKitToken = createLiveKitToken
