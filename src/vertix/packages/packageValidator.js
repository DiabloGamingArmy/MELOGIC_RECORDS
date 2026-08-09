import {
  isPlainObject,
  parseVertixPackManifest,
  VERTIX_PACK_SCHEMA_VERSION,
  VERTIX_PACKAGE_ID_PATTERN,
  VERTIX_PUBLISHER_ID_PATTERN,
  VERTIX_SEMVER_PATTERN
} from './packageManifest.js'
import { isValidPackageIntegrity } from './packageIntegrity.js'

function validationIssue(code, path, message) {
  return { code, path, message }
}

export function isSafePackagePath(value = '') {
  if (typeof value !== 'string') return false
  const path = value.trim()
  const pathIsUnsafe = (candidate) => {
    if (!candidate || candidate.includes('\\') || /[\u0000-\u001F\u007F]/.test(candidate)) return true
    if (candidate.startsWith('/') || /^[A-Za-z]:/.test(candidate) || /^[a-z][a-z0-9+.-]*:/i.test(candidate)) return true
    return candidate.split('/').some((segment) => !segment || segment === '.' || segment === '..')
  }
  if (pathIsUnsafe(path)) return false
  try {
    if (pathIsUnsafe(decodeURIComponent(path))) return false
  } catch {
    return false
  }
  return true
}

function declaredPath(value) {
  if (typeof value === 'string') return value
  return isPlainObject(value) ? value.path : undefined
}

function collectResourceDeclarations(owner = {}, ownerPath = '') {
  const declarations = []
  const add = (path, value) => {
    const filePath = declaredPath(value)
    if (filePath !== undefined) declarations.push({ path, value: filePath })
  }
  ;['source', 'geometry', 'metadataPath', 'preview', 'thumbnail'].forEach((key) => add(`${ownerPath}.${key}`, owner[key]))
  ;['files', 'resources', 'materials', 'textures', 'previews'].forEach((key) => {
    if (!Array.isArray(owner[key])) return
    owner[key].forEach((entry, index) => add(`${ownerPath}.${key}[${index}]`, entry))
  })
  return declarations
}

function collectIntegrityDeclarations(owner = {}, ownerPath = '') {
  const declarations = []
  const add = (path, value) => {
    if (value !== undefined && value !== null && value !== '') declarations.push({ path, value })
  }
  add(`${ownerPath}.integrity`, owner.integrity)
  ;['source', 'geometry', 'preview', 'thumbnail'].forEach((key) => {
    if (isPlainObject(owner[key])) add(`${ownerPath}.${key}.integrity`, owner[key].integrity)
  })
  ;['files', 'resources', 'materials', 'textures', 'previews'].forEach((key) => {
    if (!Array.isArray(owner[key])) return
    owner[key].forEach((entry, index) => {
      if (isPlainObject(entry)) add(`${ownerPath}.${key}[${index}].integrity`, entry.integrity)
    })
  })
  return declarations
}

export function validateVertixPackManifest(input) {
  const errors = []
  const warnings = []
  let manifest = null

  try {
    manifest = parseVertixPackManifest(input)
  } catch (error) {
    errors.push(validationIssue('manifest.invalid', 'manifest', error?.message || 'Manifest could not be parsed.'))
    return { valid: false, errors, warnings, manifest: null }
  }

  if (manifest.schemaVersion !== VERTIX_PACK_SCHEMA_VERSION) {
    errors.push(validationIssue('manifest.schema-version-unsupported', 'schemaVersion', `Only Vertix Pack schema version ${VERTIX_PACK_SCHEMA_VERSION} is supported.`))
  }
  if (!VERTIX_PACKAGE_ID_PATTERN.test(String(manifest.id || ''))) {
    errors.push(validationIssue('package.id-invalid', 'id', 'Package id must be a lowercase publisher-scoped id such as @publisher/package-name.'))
  }
  if (!String(manifest.name || '').trim()) errors.push(validationIssue('package.name-missing', 'name', 'Package display name is required.'))
  if (!VERTIX_SEMVER_PATTERN.test(String(manifest.version || ''))) {
    errors.push(validationIssue('package.version-invalid', 'version', 'Package version must be semantic-version compatible.'))
  }
  if (!isPlainObject(manifest.publisher) || !VERTIX_PUBLISHER_ID_PATTERN.test(String(manifest.publisher?.id || ''))) {
    errors.push(validationIssue('publisher.id-invalid', 'publisher.id', 'Publisher identity is required.'))
  } else if (String(manifest.id || '').split('/')[0] !== `@${manifest.publisher.id}`) {
    errors.push(validationIssue('publisher.scope-mismatch', 'id', 'Package namespace must match publisher.id.'))
  }
  if (!String(manifest.publisher?.name || '').trim()) errors.push(validationIssue('publisher.name-missing', 'publisher.name', 'Publisher display name is required.'))
  if (!(typeof manifest.license === 'string' && manifest.license.trim()) && !(isPlainObject(manifest.license) && Object.keys(manifest.license).length)) {
    errors.push(validationIssue('package.license-missing', 'license', 'Package license information is required.'))
  }
  if (!isPlainObject(manifest.vertix) || !VERTIX_SEMVER_PATTERN.test(String(manifest.vertix?.minimumVersion || ''))) {
    errors.push(validationIssue('package.compatibility-invalid', 'vertix.minimumVersion', 'A semantic-version-compatible Vertix minimumVersion is required.'))
  }
  if (!Array.isArray(manifest.assets) || !manifest.assets.length) {
    errors.push(validationIssue('assets.missing', 'assets', 'At least one asset declaration is required.'))
  }

  const assetUuids = new Set()
  ;(Array.isArray(manifest.assets) ? manifest.assets : []).forEach((asset, index) => {
    const assetPath = `assets[${index}]`
    if (!isPlainObject(asset)) {
      errors.push(validationIssue('asset.invalid', assetPath, 'Asset declaration must be an object.'))
      return
    }
    const assetUuid = String(asset.uuid || asset.id || '').trim()
    if (!assetUuid || !/^[A-Za-z0-9][A-Za-z0-9._:-]{2,199}$/.test(assetUuid)) {
      errors.push(validationIssue('asset.uuid-invalid', `${assetPath}.uuid`, 'Asset uuid must be a stable non-path identifier.'))
    } else if (assetUuids.has(assetUuid)) {
      errors.push(validationIssue('asset.uuid-duplicate', `${assetPath}.uuid`, `Duplicate asset uuid: ${assetUuid}`))
    } else {
      assetUuids.add(assetUuid)
    }
    if (!String(asset.name || asset.label || '').trim()) errors.push(validationIssue('asset.name-missing', `${assetPath}.name`, 'Asset display name is required.'))
    if (!String(asset.type || '').trim()) errors.push(validationIssue('asset.type-missing', `${assetPath}.type`, 'Asset type is required.'))
    if (!String(asset.category || '').trim()) errors.push(validationIssue('asset.category-missing', `${assetPath}.category`, 'Asset category is required.'))
    if (asset.metadata !== undefined && !isPlainObject(asset.metadata)) errors.push(validationIssue('asset.metadata-invalid', `${assetPath}.metadata`, 'Asset metadata must be an object.'))
    if (asset.dimensions !== undefined && !isPlainObject(asset.dimensions)) errors.push(validationIssue('asset.dimensions-invalid', `${assetPath}.dimensions`, 'Asset dimensions must be an object.'))
    if (asset.tags !== undefined && (!Array.isArray(asset.tags) || asset.tags.some((tag) => typeof tag !== 'string'))) {
      errors.push(validationIssue('asset.tags-invalid', `${assetPath}.tags`, 'Asset tags must be an array of strings.'))
    }
    collectResourceDeclarations(asset, assetPath).forEach((entry) => {
      if (!isSafePackagePath(entry.value)) errors.push(validationIssue('package.path-invalid', entry.path, 'Package resource paths must be safe paths relative to the package root.'))
    })
    collectIntegrityDeclarations(asset, assetPath).forEach((entry) => {
      if (!isValidPackageIntegrity(entry.value)) errors.push(validationIssue('package.integrity-invalid', entry.path, 'Integrity must use a SHA-256 SRI value.'))
    })
  })

  collectResourceDeclarations(manifest, 'manifest').forEach((entry) => {
    if (!isSafePackagePath(entry.value)) errors.push(validationIssue('package.path-invalid', entry.path, 'Package resource paths must be safe paths relative to the package root.'))
  })
  collectIntegrityDeclarations(manifest, 'manifest').forEach((entry) => {
    if (!isValidPackageIntegrity(entry.value)) errors.push(validationIssue('package.integrity-invalid', entry.path, 'Integrity must use a SHA-256 SRI value.'))
  })
  if (!manifest.integrity) warnings.push(validationIssue('package.integrity-missing', 'integrity', 'Package integrity is recommended for exact artifact identification.'))

  return { valid: errors.length === 0, errors, warnings, manifest }
}
