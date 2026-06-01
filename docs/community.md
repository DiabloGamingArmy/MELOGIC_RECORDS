# Melogic Community

## Purpose

Melogic Community is the first retention surface for the platform loop:

Create -> Share -> Feedback -> Notifications -> Return -> Create Again

The phase 1 goal is a clean public feed where creators can publish text posts, share public products, react to posts, save useful posts, share links, and report unsafe content.

## Routes

- `/community` - Community feed, composer, tabs, side panels.
- `/community/communities` - Community browser with search, category filters, and focus controls.
- `/community/c/{communitySlug}` - Community detail feed and scoped composer.
- `/community/create` - Opens the community browser with the create community panel.
- `/community/post/{postId}` - Full post detail scaffold with actions and comments placeholder.

## Community Schema

Communities are stored in `communities/{communityId}`. Phase 2 uses the slug as the document id for simple route lookup.

```js
{
  communityId,
  slug,
  name,
  description,
  category,
  iconURL,
  bannerURL,
  createdBy,
  ownerUid,
  moderatorIds: [],
  memberCount: 0,
  focusCount: 0,
  postCount: 0,
  visibility: 'public',
  postingMode: 'open' | 'focused_only' | 'members_only' | 'moderators_only',
  status: 'active',
  official,
  createdAt,
  updatedAt
}
```

Official starter communities are seeded by the `seedCommunities` callable if the `communities` collection is empty:

- `dubstep`
- `sound-design`
- `mixing-mastering`
- `stagemaker`
- `live-production`
- `sample-packs`
- `feedback`
- `metalcore`
- `vocals`
- `creator-help`

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
  communityName: '',
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
- Community creation goes through `createCommunity` and is limited during first launch to admin/beta/verified/pro users.
- Community focus goes through `toggleCommunityFocus`.
- Likes go through `toggleCommunityPostLike` and are mirrored at `communityPosts/{postId}/likes/{uid}`.
- Saves go through `toggleCommunityPostSave` and are mirrored at `communityPosts/{postId}/saves/{uid}`.
- Shares copy `/community/post/{postId}`. Signed-in shares also call `recordCommunityPostShare`.
- Comments are intentionally scaffolded only in phase 1.

## Focus Model

Focused communities are stored at `users/{uid}/focusedCommunities/{communityId}`. The callable updates `communities/{communityId}.focusCount` transactionally and returns the new focus state.

UI language uses:

- Focus
- Focused
- Focused Communities

## Posting Rules

Community-scoped posts include `communityId`, `communitySlug`, and `communityName`. The `createCommunityPost` callable validates:

- community exists
- community is `active/public`
- posting mode allows the signed-in user to post
- `focused_only` and `members_only` require the user to focus the community unless they moderate it
- `moderators_only` requires owner/moderator access

## Reports

Community and community post reports reuse `createReport` with:

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

`targetType: 'community'` reports link to `/community/c/{slug}`. `targetType: 'community_post'` reports link to `/community/post/{postId}`.

## Rules And Indexes

Firestore rules allow public reads for `published/public` community posts. Direct client creation and engagement writes are blocked because Admin SDK callables own those writes. Owners can make narrow edits to their own title/body/tags, and user moderators can update status/visibility moderation fields.

Community rules allow public reads for `active/public` communities. Direct client creation and focus writes are blocked because Admin SDK callables own those writes. Community owners/moderators can update basic fields; user moderators can hide/suspend communities.

Indexes added:

- `communityPosts`: `status ASC`, `visibility ASC`, `createdAt DESC`
- `communityPosts`: `status ASC`, `visibility ASC`, `official ASC`, `createdAt DESC`
- `communityPosts`: `communitySlug ASC`, `status ASC`, `visibility ASC`, `createdAt DESC`
- `communities`: `status ASC`, `visibility ASC`, `updatedAt DESC`
- `communities`: `category ASC`, `status ASC`, `visibility ASC`, `updatedAt DESC`

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

Done in phase 2:

- community browser
- official starter community seed callable
- community detail routes
- focus/unfocus callable and UI
- create community callable and UI
- community-scoped composer/feed
- community labels on post cards
- community and community post admin report links

Deferred:

- nested comments
- creator follow feed
- notification fanout
- profile integration
- stories
- FYP scoring
- full community moderation dashboard
