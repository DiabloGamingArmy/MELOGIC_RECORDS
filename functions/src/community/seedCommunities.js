const { onCall } = require('firebase-functions/v2/https')
const { seedOfficialCommunities } = require('./communityShared')

const seedCommunities = onCall({ timeoutSeconds: 60, memory: '256MiB' }, async () => {
  const result = await seedOfficialCommunities()
  return { ok: true, ...result }
})

module.exports = {
  seedCommunities
}
