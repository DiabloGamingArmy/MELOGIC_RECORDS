export const STORAGE_PATHS = {
  productCover: (productId) => `products/${productId}/cover/cover.webp`,
  productGalleryRoot: (productId) => `products/${productId}/gallery`,
  productAudioPreviewsRoot: (productId) => `products/${productId}/audio-previews`,
  productDownloadsRoot: (productId) => `products/${productId}/downloads`,
  productThumb: (productId) => `products/${productId}/thumbnails/thumb.webp`,
  productManifest: (productId) => `products/${productId}/metadata/manifest.json`
}
