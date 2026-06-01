# Melogic Community

## Purpose

Melogic Community is the first retention surface for the platform loop:

Create -> Share -> Feedback -> Notifications -> Return -> Create Again

The phase 1 goal is a clean public feed where creators can publish text posts, share public products, react to posts, save useful posts, share links, and report unsafe content.

## Routes

- `/community` - Community feed, composer, tabs, side panels.
- `/community/post/{postId}` - Full post detail scaffold with actions and comments placeholder.

## Post Schema

Posts are stored in `communityPosts/{postId}`:

```js
{
  postId,
  authorUid,
  authorDisplayName,
  authorUsername,
  authorAvatarURL,
  type: 'text' | 'product_share',
  title,
  body,
  communityId: '',
  communitySlug: '',
  linkedProductId: '',
  linkedProductSnapshot: {},
  mediaPaths: [],
  tags: [],
  status: 'published',
  visibility: 'public',
  official: false,
  counts: { likes: 0, comments: 0, saves: 0, shares: 0, reports: 0 },
  score: 0,
  createdAt,
  updatedAt
}
```

## Interaction Model

- Post creation goes through `createCommunityPost`.
- Likes go through `toggleCommunityPostLike` and are mirrored at `communityPosts/{postId}/likes/{uid}`.
- Saves go through `toggleCommunityPostSave` and are mirrored at `communityPosts/{postId}/saves/{uid}`.
- Shares copy `/community/post/{postId}`. Signed-in shares also call `recordCommunityPostShare`.
- Comments are intentionally scaffolded only in phase 1.

## Reports

Community post reports reuse `createReport` with:

```js
{
  targetType: 'community_post',
  targetId: postId,
  targetOwnerUid: authorUid,
  reason,
  description,
  sourcePath
}
```

Admin Reports now links `community_post` targets to `/community/post/{postId}`.

## Rules And Indexes

Firestore rules allow public reads for `published/public` community posts. Direct client creation and engagement writes are blocked because Admin SDK callables own those writes. Owners can make narrow edits to their own title/body/tags, and user moderators can update status/visibility moderation fields.

Indexes added:

- `communityPosts`: `status ASC`, `visibility ASC`, `createdAt DESC`
- `communityPosts`: `status ASC`, `visibility ASC`, `official ASC`, `createdAt DESC`

## Phase Status

Done in phase 1:

- `/community` page shell
- feed tabs
- recent public feed
- signed-in text composer
- basic product share by product ID
- post cards
- like, save, share, report actions
- post detail route scaffold
- report integration

Deferred:

- nested comments
- creator follow feed
- communities/focus spaces
- notification fanout
- profile integration
- stories
- FYP scoring
