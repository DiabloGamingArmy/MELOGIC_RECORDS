const admin = require('firebase-admin')

if (!admin.apps.length) {
  admin.initializeApp()
}

const { createOrGetDm } = require('./src/messages/createOrGetDm')
const { createGroupThread } = require('./src/messages/createGroupThread')

exports.createOrGetDm = createOrGetDm
exports.createGroupThread = createGroupThread
