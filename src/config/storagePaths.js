export const STORAGE_PATHS = {
  productCover: (productId) => `products/${productId}/cover/cover.webp`,
  productGalleryRoot: (productId) => `products/${productId}/gallery`,
  productAudioPreviewsRoot: (productId) => `products/${productId}/audio-previews`,
  productVideoPreviewsRoot: (productId) => `products/${productId}/video-previews`,
  productDownloadsRoot: (productId) => `products/${productId}/downloads`,
  productFile: (productId, fileId, fileName) => `products/${productId}/files/${fileId}/${fileName}`,
  productLicensesRoot: (productId) => `products/${productId}/licenses`,
  productThumb: (productId) => `products/${productId}/thumbnails/thumb.webp`,
  productManifest: (productId) => `products/${productId}/metadata/manifest.json`,
  threadMessageAttachment: (threadId, messageId, filename) => `threads/${threadId}/messages/${messageId}/attachments/${filename}`,
  threadAvatar: (threadId, filename = 'avatar.webp') => `threads/${threadId}/avatar/${filename}`,
  stageProjectRoot: (projectId) => `stage/projects/${projectId}`,
  stageProjectAssetsRoot: (projectId) => `stage/projects/${projectId}/assets`,
  stageProjectThumbnailsRoot: (projectId) => `stage/projects/${projectId}/thumbnails`,
  stageProjectSnapshotsRoot: (projectId) => `stage/projects/${projectId}/snapshots`,
  stageProjectExportsRoot: (projectId) => `stage/projects/${projectId}/exports`,
  stageAssetPackRoot: (packId) => `stage/asset-packs/${packId}`,
  stageTemplateRoot: (templateId) => `stage/templates/${templateId}`,

  stageAssetRoot: (category, assetSlug, version = 1) => `assets/stage/library/${category}/${assetSlug}/v${version}`,
  stageAssetModel: (category, assetSlug, version = 1) => `assets/stage/library/${category}/${assetSlug}/v${version}/model.glb`,
  stageAssetThumbnail: (category, assetSlug, version = 1) => `assets/stage/library/${category}/${assetSlug}/v${version}/thumbnail.webp`,
  stageAssetPreview: (category, assetSlug, version = 1) => `assets/stage/library/${category}/${assetSlug}/v${version}/preview.webp`,
  stageAssetManifest: (category, assetSlug, version = 1) => `assets/stage/library/${category}/${assetSlug}/v${version}/manifest.json`,
  stageAssetDraftRoot: (adminId, draftAssetId) => `admin/stage/staging/${adminId}/${draftAssetId}`,
  stageProjectExport: (userId, projectId, filename = 'stage-plot.pdf') => `stage-projects/${userId}/${projectId}/exports/${filename}`,
  stageProjectSnapshot: (userId, projectId, filename = 'snapshot.webp') => `stage-projects/${userId}/${projectId}/snapshots/${filename}`,
  stageProjectAttachment: (userId, projectId, filename) => `stage-projects/${userId}/${projectId}/attachments/${filename}`,
  stageCustomAssetRoot: (userId, assetId, version = 1) => `users/${userId}/stage/custom-assets/${assetId}/v${version}`,
  productRoleFile: (productId, role, fileId, safeName) => {
    const name = safeName || 'file.bin'
    if (role === 'cover') return `products/${productId}/cover/${name}`
    if (role === 'thumbnail') return `products/${productId}/thumbnails/${name}`
    if (role === 'gallery') return `products/${productId}/gallery/${fileId}-${name}`
    if (role === 'previewAudio') return `products/${productId}/audio-previews/${fileId}-${name}`
    if (role === 'previewVideo') return `products/${productId}/video-previews/${fileId}-${name}`
    if (role === 'deliverable') return `products/${productId}/downloads/${fileId}-${name}`
    if (role === 'license') return `products/${productId}/licenses/${fileId}-${name}`
    return `products/${productId}/files/${fileId}-${name}`
  }
}
