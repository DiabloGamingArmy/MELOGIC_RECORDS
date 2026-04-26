import fs from 'node:fs'
import path from 'node:path'

const failures = []

function pass(message) {
  console.log(`✅ ${message}`)
}

function fail(message) {
  failures.push(message)
  console.error(`❌ ${message}`)
}

function readJson(filePath) {
  try {
    const raw = fs.readFileSync(filePath, 'utf8')
    const parsed = JSON.parse(raw)
    pass(`Parsed ${filePath}`)
    return { parsed, raw }
  } catch (error) {
    fail(`Failed to parse ${filePath}: ${error.message}`)
    return { parsed: null, raw: '' }
  }
}

const firebase = readJson('firebase.json')
const indexes = readJson('firestore.indexes.json')

if (firebase.parsed) {
  if (firebase.parsed?.hosting?.public) pass('firebase.json contains hosting.public')
  else fail('firebase.json missing hosting.public')

  if (firebase.parsed?.storage?.rules) pass('firebase.json contains storage.rules')
  else fail('firebase.json missing storage.rules')

  if (firebase.parsed?.firestore?.rules) pass('firebase.json contains firestore.rules')
  else fail('firebase.json missing firestore.rules')

  if (firebase.parsed?.firestore?.indexes) pass('firebase.json contains firestore.indexes')
  else fail('firebase.json missing firestore.indexes')

  const invalidSupportEmail = 'support@' + 'undefined'
  if (firebase.raw.includes(invalidSupportEmail)) fail('firebase.json still contains invalid support email placeholder')
  else pass('firebase.json does not contain invalid support email placeholder')

  const references = [
    firebase.parsed?.storage?.rules,
    firebase.parsed?.firestore?.rules,
    firebase.parsed?.firestore?.indexes
  ].filter(Boolean)

  references.forEach((target) => {
    const absolutePath = path.resolve(process.cwd(), target)
    if (fs.existsSync(absolutePath)) pass(`Referenced file exists: ${target}`)
    else fail(`Referenced file is missing: ${target}`)
  })
}

if (indexes.parsed) {
  if (Array.isArray(indexes.parsed.indexes)) pass('firestore.indexes.json contains indexes array')
  else fail('firestore.indexes.json missing indexes array')
}

if (failures.length) {
  console.error(`\nConfig check failed with ${failures.length} issue(s).`)
  process.exit(1)
}

console.log('\nAll config checks passed.')
