# Melogic Community

## Purpose

Melogic Community is the first retention surface for the platform loop:

Create -> Share -> Feedback -> Notifications -> Return -> Create Again

The current goal is a clean public feed where creators can publish text posts, share public products, react to posts, save useful posts, comment, reply once, receive notifications, share links, and report unsafe content.

Phase 5 adds lightweight creator Stories. The story rail and viewer borrow the simple rail pattern from the older Nexera home feed, especially its horizontal "Your Story" + creator updates treatment, without importing Nexera globals, auth, routing, or data stores.

## Routes

- `/community` - Community feed, composer, tabs, side panels.
- `/community/communities` - Community browser with search, category filters, and focus controls.
- `/community/c/{communitySlug}` - Community detail feed and scoped composer.
- `/community/create` - Opens the community browser with the create community panel.
- `/community/post/{postId}` - Full post detail with post actions, comments, one-level replies, comment likes, and comment reporting.

## Story Schema

Stories are stored in `communityStories/{storyId}`. Story images are uploaded to `communityStories/{uid}/{storyId}/{fileName}`.

```js
{
  storyId,
  authorUid,
  authorDisplayName,
  authorUsername,
  authorAvatarURL,
  mediaType: 'text' | 'image',
  text,
  mediaPath,
  background: 'aurora' | 'midnight' | 'sunset' | 'stage' | 'mono',
  linkedPostId: '',
  linkedProductId: '',
  expiresAt,
  createdAt,
  updatedAt,
  viewCount: 0,
  reportCount: 0,
  status: 'active',
  visibility: 'public'
}
```

Stories expire after 24 hours. The MVP supports text and image stories only; video, livestreams, and editing tools are intentionally deferred.

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
- The Focused feed loads recent public posts from `users/{uid}/focusedCommunities`.
- Likes go through `toggleCommunityPostLike` and are mirrored at `communityPosts/{postId}/likes/{uid}`.
- Saves go through `toggleCommunityPostSave` and are mirrored at `communityPosts/{postId}/saves/{uid}`.
- Shares copy `/community/post/{postId}`. Signed-in shares also call `recordCommunityPostShare`.
- Comments go through `createCommunityComment`.
- Comment deletion goes through `deleteCommunityComment`; owner/admin checks are enforced server-side.
- Comment likes go through `toggleCommunityCommentLike` and are mirrored at `communityPosts/{postId}/comments/{commentId}/likes/{uid}`.
- Stories go through `createCommunityStory`, `deleteCommunityStory`, and `recordCommunityStoryView`.
- Story reports reuse `createReport` with `targetType: 'community_story'`.

## Comment Schema

Comments are stored in `communityPosts/{postId}/comments/{commentId}`:

```js
{
  commentId,
  postId,
  authorUid,
  authorDisplayName,
  authorUsername,
  authorAvatarURL,
  body,
  parentCommentId: '',
  replyCount: 0,
  likeCount: 0,
  status: 'visible',
  createdAt,
  updatedAt
}
```

Replies are one level deep. `parentCommentId` can point to a visible top-level comment, but replies cannot receive replies yet.

## Notifications

Community interactions write account events through the existing inbox/account event system:

- `community_post_like` when a post receives a like
- `community_comment` when a post receives a top-level comment
- `community_reply` when a comment receives a reply
- `community_comment_like` when a comment receives a like

Own actions do not notify the actor. Events link back to `/community/post/{postId}`.

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

Community, community post, and community comment reports reuse `createReport` with:

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

Comment reports use:

```js
{
  targetType: 'community_comment',
  targetId: commentId,
  targetOwnerUid: authorUid,
  reason,
  description,
  sourcePath: `/community/post/${postId}`,
  metadata: { postId, commentId }
}
```

`targetType: 'community'` reports link to `/community/c/{slug}`. `targetType: 'community_post'` reports link to `/community/post/{postId}`. `targetType: 'community_comment'` reports link to the parent post thread.
`targetType: 'community_story'` reports link to `/community?story={storyId}`.

## Rules And Indexes

Firestore rules allow public reads for `published/public` community posts. Direct client creation and engagement writes are blocked because Admin SDK callables own those writes. Owners can make narrow edits to their own title/body/tags, and user moderators can update status/visibility moderation fields.

Visible comments on published public posts are publicly readable. Direct client comment creation and comment-like writes are blocked because Admin SDK callables own author snapshots, counters, and notification fanout. Owners and moderators can hide comments through the supported server path.

Community rules allow public reads for `active/public` communities. Direct client creation and focus writes are blocked because Admin SDK callables own those writes. Community owners/moderators can update basic fields; user moderators can hide/suspend communities.

Story rules allow public reads for `active/public` stories whose `expiresAt` is still in the future. Signed-in users may create tightly-shaped own stories, but the production UI uses callables so author identity, expiration, counters, and status stay server-controlled. Owner/admin delete/hide paths are narrow. Storage rules allow signed-in users to upload image stories only under `communityStories/{uid}/{storyId}`.

Indexes added:

- `communityPosts`: `status ASC`, `visibility ASC`, `createdAt DESC`
- `communityPosts`: `status ASC`, `visibility ASC`, `official ASC`, `createdAt DESC`
- `communityPosts`: `communitySlug ASC`, `status ASC`, `visibility ASC`, `createdAt DESC`
- `communityPosts`: `communityId ASC`, `status ASC`, `visibility ASC`, `createdAt DESC`
- `comments`: `status ASC`, `createdAt ASC`
- `comments`: `parentCommentId ASC`, `createdAt ASC`
- `communityStories`: `status ASC`, `visibility ASC`, `expiresAt ASC`
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
- Focused feed backed by the viewer's focused communities
- create community callable and UI
- community-scoped composer/feed
- community labels on post cards
- community and community post admin report links

Done in phase 3:

- post detail comments
- one-level replies
- comment likes
- comment reports
- comment delete path for owners/admins
- account event notifications for post likes, comments, replies, and comment likes
- admin report links for community comments

Done in phase 4:

- public profile tabs for Posts, Products, Stage Plans, About, and Communities
- profile Posts tab loads only `published/public` community posts by the profile owner
- profile Communities tab shows public communities the creator owns or moderates
- profile Stage Plans tab is public-safe and only reads StageMaker plans explicitly marked `visibility: public`
- profile header shows public-safe creator stats without scanning private data
- community post profile cards link to `/community/post/{postId}`

Done in phase 5:

- `/community` story rail
- text story composer
- image story upload/composer
- story viewer
- unique signed-in story view count path
- story reports through Admin Reports
- story Firestore/Storage rules and indexes
- Nexera story rail visual reference ported into the Melogic Community shell

Deferred:

- creator follow feed
- video stories and live streams
- FYP scoring
- full community moderation dashboard
