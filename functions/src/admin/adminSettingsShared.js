const admin = require('firebase-admin')
const { cleanString } = require('./adminAuth')

const DEFAULT_SETTINGS = {
  marketplace: {
    marketplaceEnabled: true,
    manualReviewRequired: true
  },
  aiModeration: {
    productModerationModel: 'gemini-2.5-flash-lite',
    fallbackModels: ['gemini-2.5-flash-lite', 'gemini-2.5-flash', 'gemini-flash-latest'],
    autoApproveProducts: false,
    aiModerationEnabled: true,
    productModerationInstructions: ''
  },
  uploadLimits: {
    coverMaxMb: 10,
    galleryMaxMb: 15,
    audioPreviewMaxMb: 50,
    videoPreviewMaxMb: 250,
    downloadsMaxMb: 1024
  },
  agreements: {
    sellerAgreementId: 'marketplace-product-seller-agreement',
    sellerAgreementVersion: 'v1',
    sellerAgreementPath: 'legal/agreements/marketplace-product-seller-agreement/v1.md',
    sellerAgreementUpdatedAt: '',
    sellerAgreementUpdatedBy: ''
  },
  reviewPolicy: {
    passBehavior: 'Publish product publicly after approval.',
    rejectBehavior: 'Keep product private and mark as rejected.',
    returnBehavior: 'Keep product private, request changes, and notify creator.'
  }
}

const SCHEMA = {
  marketplace: {
    marketplaceEnabled: 'boolean',
    manualReviewRequired: 'boolean'
  },
  aiModeration: {
    productModerationModel: 'string',
    fallbackModels: 'stringArray',
    autoApproveProducts: 'boolean',
    aiModerationEnabled: 'boolean',
    productModerationInstructions: 'longString'
  },
  uploadLimits: {
    coverMaxMb: 'number',
    galleryMaxMb: 'number',
    audioPreviewMaxMb: 'number',
    videoPreviewMaxMb: 'number',
    downloadsMaxMb: 'number'
  },
  agreements: {
    sellerAgreementId: 'string',
    sellerAgreementVersion: 'string',
    sellerAgreementPath: 'string',
    sellerAgreementUpdatedAt: 'string',
    sellerAgreementUpdatedBy: 'string'
  },
  reviewPolicy: {
    passBehavior: 'string',
    rejectBehavior: 'string',
    returnBehavior: 'string'
  }
}

function db() {
  return admin.firestore()
}

function settingsRef() {
  return db().collection('platformConfig').doc('current')
}

function sanitizeByType(value, type) {
  if (type === 'boolean') return value === true
  if (type === 'number') {
    const number = Number(value)
    return Number.isFinite(number) ? Math.max(0, Math.round(number)) : 0
  }
  if (type === 'stringArray') {
    if (!Array.isArray(value)) {
      return String(value || '')
        .split(',')
        .map((item) => cleanString(item, 120))
        .filter(Boolean)
        .slice(0, 12)
    }
    return value.map((item) => cleanString(item, 120)).filter(Boolean).slice(0, 12)
  }
  if (type === 'longString') return cleanString(value || '', 4000)
  return cleanString(value || '', 1200)
}

function mergeSettings(raw = {}) {
  return Object.entries(DEFAULT_SETTINGS).reduce((settings, [section, defaults]) => {
    const source = raw[section] && typeof raw[section] === 'object' && !Array.isArray(raw[section])
      ? raw[section]
      : {}
    settings[section] = { ...defaults, ...source }
    return settings
  }, {})
}

function sanitizeSettingsPatch(section = '', values = {}) {
  const sectionKey = cleanString(section, 80)
  const fields = SCHEMA[sectionKey]
  if (!fields) return null
  const source = values && typeof values === 'object' && !Array.isArray(values) ? values : {}
  const sanitized = {}
  Object.entries(fields).forEach(([key, type]) => {
    if (Object.prototype.hasOwnProperty.call(source, key)) {
      sanitized[key] = sanitizeByType(source[key], type)
    }
  })
  return Object.keys(sanitized).length ? { section: sectionKey, values: sanitized } : null
}

module.exports = {
  DEFAULT_SETTINGS,
  SCHEMA,
  mergeSettings,
  sanitizeSettingsPatch,
  settingsRef
}
