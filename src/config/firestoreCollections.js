export const FIRESTORE_COLLECTIONS = {
  products: 'products',
  productSubcollections: {
    comments: 'comments',
    files: 'files',
    likes: 'likes',
    dislikes: 'dislikes',
    saves: 'saves',
    shares: 'shares',
    contributors: 'contributors'
  },
  profiles: 'profiles',
  follows: 'follows',
  followsArtists: 'artists',
  studioProjects: 'studioProjects',
  stageAssets: 'stageAssets',
  stageAssetDrafts: 'stageAssetDrafts',
  stageAssetPacks: 'stageAssetPacks',
  stageTemplates: 'stageTemplates',
  stageProjects: 'stageProjects'
}

export function getProductCollectionPath(productId, subcollection) {
  return `${FIRESTORE_COLLECTIONS.products}/${productId}/${subcollection}`
}

export function getFollowArtistsPath(uid) {
  return `${FIRESTORE_COLLECTIONS.follows}/${uid}/${FIRESTORE_COLLECTIONS.followsArtists}`
}
