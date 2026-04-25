export const STORAGE_PATHS = {
  productCover: (productId) => `products/${productId}/cover/cover.webp`,
  productGalleryRoot: (productId) => `products/${productId}/gallery`,
  productAudioPreviewsRoot: (productId) => `products/${productId}/audio-previews`,
  productVideoPreviewsRoot: (productId) => `products/${productId}/video-previews`,
  productDownloadsRoot: (productId) => `products/${productId}/downloads`,
  productThumb: (productId) => `products/${productId}/thumbnails/thumb.webp`,
  productManifest: (productId) => `products/${productId}/metadata/manifest.json`,
  threadMessageAttachment: (threadId, messageId, filename) => `threads/${threadId}/messages/${messageId}/attachments/${filename}`,
  threadAvatar: (threadId, filename = 'avatar.webp') => `threads/${threadId}/avatar/${filename}`
}
