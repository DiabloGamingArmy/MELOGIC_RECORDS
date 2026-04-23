export const FIRESTORE_COLLECTIONS = {
  products: 'products',
  productSubcollections: {
    comments: 'comments',
    likes: 'likes',
    dislikes: 'dislikes',
    saves: 'saves',
    shares: 'shares',
    contributors: 'contributors'
  },
  profiles: 'profiles',
  follows: 'follows',
  followsArtists: 'artists'
}

export function getProductCollectionPath(productId, subcollection) {
  return `${FIRESTORE_COLLECTIONS.products}/${productId}/${subcollection}`
}

export function getFollowArtistsPath(uid) {
  return `${FIRESTORE_COLLECTIONS.follows}/${uid}/${FIRESTORE_COLLECTIONS.followsArtists}`
}
