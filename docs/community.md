# Melogic Community

## Purpose

Melogic Community is the first retention surface for the platform loop:

Create -> Share -> Feedback -> Notifications -> Return -> Create Again

The current goal is a clean public feed where creators can publish text posts, share public products, react to posts, save useful posts, comment, reply once, receive notifications, share links, and report unsafe content.

Phase 5 adds lightweight creator Stories. The story rail and viewer borrow the simple rail pattern from the older Nexera home feed, especially its horizontal "Your Story" + creator updates treatment, without importing Nexera globals, auth, routing, or data stores.

## Visual Phase A

The `/community` homepage uses a Nexara-inspired social layout adapted to the Melogic app shell:

- A compact full-width topic bar sits directly below the global site header.
- The topic bar exposes For You, Focused, and routable community chips. Real public communities are used first; if none are available, local fallback chips route to clean `/community/c/{slug}` pages without silently creating Firestore community documents.
- A standalone stories row sits below the topic bar with Melogic gradient story rings.
- The old inline "Share something" composer is hidden by default.
- Post creation now opens a wider unified composer with title, body, product attachment, mention search, emoji insertion, community destination, tags, Publish, and Cancel.
- The homepage body is a three-column layout: left navigation, center feed, and right rail.
- Feed cards use a cleaner social action row for Like, Comment, Save, and Share. Report, Delete, Copy Link, and coming-soon moderation/personalization actions live in the per-post three-dot menu.
- The left rail does not duplicate the primary Post button. Posting stays in the feed toolbar and community headers where the current destination is clear.
- The right rail is integrated into the page with divided sections for suggested communities, tags, creator history, and guidelines rather than heavy nested panels.

## Progressive Feed Loading

The `/community` feed renders progressively:

- The topic bar, story rail, left navigation, right rail, and center-feed skeletons render immediately.
- The first feed request loads 12 public/published posts, then renders cards as soon as that page returns.
- Stories, community suggestions, focus state, viewer like/save state, and Storage media URL resolution run as background enrichment and cannot block the first post page.
- Attachment cards render text/metadata first. Audio/media controls appear after cached Storage URLs resolve.
- Pagination uses a Firestore cursor for the primary query path, with an IntersectionObserver sentinel plus a manual "Load more" fallback button.
- Search, tag, community, and sort changes reset pagination and only reload the center feed.
- Topic/story chrome hides while scrolling down and reappears when scrolling up; the global navigation stays visible.

## Detail And Composer Polish

The New Post composer uses a header-safe fixed overlay. The backdrop locks page scrolling, keeps the close control visible below the global navigation, and lets the modal scroll internally on shorter viewports. On desktop the composer is wider, with a landscape flow: title/body first, attachment and enhancement tools next, and compact destination/visibility/tag controls below.

Post detail pages intentionally split detail cards from feed cards. Feed cards remain clickable and keep hover highlighting; detail cards use `.community-post-detail-card.is-detail`, do not render link roles/tab targets, do not get card-level navigation listeners, and keep a neutral cursor/background on hover while action buttons remain interactive.

Detail loading is staged: the shell and skeleton render first, `getCommunityPost` renders the post as soon as it returns, and comments, viewer like/save state, media URL resolution, and right-rail enrichment continue afterward. This keeps the main post readable before slower secondary data completes.

Known limitations: the Vite dev server does not mirror Firebase Hosting rewrites for direct `/community/post/{postId}` URLs, so direct detail-route smoke testing should use Firebase Hosting or a local Firebase hosting server.

Fallback and deferred surfaces:

- `Your Story`, `test1`, `test2`, and `test3` show the future story interaction with a coming-soon toast.
- Fallback community chips and cards are local UI scaffolds only. Focus and scoped posting are disabled until the corresponding community document exists.
- Live streams remain deferred.
- Advanced For You scoring remains deferred.
- The Creator History / This Day in History rail card is a designed placeholder for a later data source.

## Routes

- `/community` - Nexara-inspired community homepage with topic bar, stories row, modal composer, feed, and side rails.
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
  type: 'post',
  title,
  body,
  communityId: '',
  communitySlug: '',
  communityName: '',
  linkedProductId: '',
  linkedProductSnapshot: {},
  attachments: [
    {
      type: 'product',
      targetId: productId,
      productId,
      snapshot: { title, slug, thumbnailURL, creatorName, priceCents, isFree, currency }
    },
    {
      type: 'music',
      targetId: storagePath,
      sourceType: 'product_preview',
      sourceId: productId,
      storagePath,
      snapshot: { title, creatorName, durationSeconds, waveformData, coverURL, mimeType }
    },
    {
      type: 'stage_plan',
      targetId: stageProjectId,
      snapshot: { title, templateName, stageWidth, stageDepth, units, objectCount, previewImageURL, ownerDisplayName, ownerUsername, visibility, sharePath }
    },
    {
      type: 'studio_project',
      targetId: studioProjectId,
      snapshot: { title, bpm, key, durationSeconds, trackCount, coverURL, previewAudioPath, creatorDisplayName, creatorUsername, visibility, sharePath }
    }
  ],
  attachmentTypes: ['product'],
  mediaPaths: [],
  mentionedUserIds: [],
  mentionedUsernames: [],
  intent: 'feedback_request',
  intentData: {},
  scheduledAt: null,
  publishStatus: 'published',
  tags: [],
  tagKeys: [],
  searchKeywords: [],
  titleLower,
  authorDisplayNameLower,
  authorUsernameLower,
  status: 'published',
  visibility: 'public',
  official: false,
  commentsLocked: false,
  pinnedInCommunity: false,
  counts: { likes: 0, comments: 0, saves: 0, shares: 0, reports: 0 },
  likeCount: 0,
  commentCount: 0,
  saveCount: 0,
  shareCount: 0,
  reportCount: 0,
  score: 0,
  createdAt,
  updatedAt
}
```

Older posts may still use `type: 'product_share'` with `linkedProductId` and `linkedProductSnapshot`. The UI keeps rendering those fields, but new product shares should use `attachments`.

## Creator Content Attachments And Intents

The unified composer supports Melogic-specific attachments and structured post intents.

Attachment types:

- `product`: public published marketplace product snapshot. The backend rebuilds price, title, creator, and thumbnail from `products/{productId}`.
- `music`: public product audio preview only. This phase does not allow arbitrary community audio upload or private Studio audio sharing.
- `stage_plan`: owned or collaborated StageMaker plan snapshot. Private plans require an explicit confirmation in the composer and remain private; only title, dimensions, object count, template, and owner display fields are copied.
- `studio_project`: owned or collaborated Studio/DAW project snapshot. Stems, editor state, full project JSON, and private storage paths are not copied.

Attachment limits:

- 4 total attachments
- 1 Product
- 2 Music previews
- 1 Stage Plan
- 1 Studio Project

Structured intents:

- `feedback_request`: category, specific question, optional future deadline. The card shows `Feedback Requested` and the comment action says `Give Feedback`.
- `collaboration_request`: role, genre, compensation type, location mode/text, optional future deadline. The card shows `Looking for Collaborators`.

Security behavior:

- `createCommunityPost` requires Firebase Auth.
- The callable validates all attachment targets using Admin SDK and never trusts client-provided snapshots.
- Product music attachments must point to `products/{productId}/audio-previews/...`; paid downloads and deliverables are rejected.
- Stage/Studio project attachment targets must be owned by or shared with the author.
- Public posts remain readable, but attachment snapshots do not grant read access to private project source documents or Storage files.

Public project viewer status:

- StageMaker: no new public read-only Stage Plan viewer was added in this phase. Public StageMaker projects may use the existing route; private shared Stage Plans render as snapshot cards only.
- Studio/DAW: no public Studio Project viewer exists yet. Studio Project attachments render metadata cards only.
- Music upload: not implemented. Music attachments are limited to existing public product audio previews.

## Interaction Model

- Post creation goes through `createCommunityPost`.
- Community creation goes through `createCommunity` and is limited during first launch to admin/beta/verified/pro users.
- Community focus goes through `toggleCommunityFocus`.
- The Focused feed loads recent public posts from `users/{uid}/focusedCommunities`.
- Likes go through `toggleCommunityPostLike` and are mirrored at `communityPosts/{postId}/likes/{uid}`.
- Saves go through `toggleCommunityPostSave` and are mirrored at `communityPosts/{postId}/saves/{uid}`.
- Shares copy `/community/post/{postId}`. Signed-in shares also call `recordCommunityPostShare`.
- Search, tag filters, and feed sorts use denormalized post fields (`searchKeywords`, `tagKeys`, flat counts, and `score`) while preserving the existing nested `counts` map.
- Author post removal goes through `deleteOwnCommunityPost`, which hides the post instead of hard-deleting the public record.
- Comments go through `createCommunityComment`.
- Comment deletion goes through `deleteCommunityComment`; owner/admin checks are enforced server-side.
- Comment likes go through `toggleCommunityCommentLike` and are mirrored at `communityPosts/{postId}/comments/{commentId}/likes/{uid}`.
- Stories go through `createCommunityStory`, `deleteCommunityStory`, and `recordCommunityStoryView`.
- Story reports reuse `createReport` with `targetType: 'community_story'`.

Frontend interaction policy:

- Non-submit Community buttons must explicitly use `type="button"`; only composer, comment, story, search, report, and community-create submit buttons may use `type="submit"`.
- Post card actions call a shared action-event guard so likes, saves, shares, reports, deletes, menu clicks, and comment actions do not bubble into card navigation.
- The post three-dot menu is local UI state only. Opening, switching, Escape closing, and outside-click closing must not call Firebase or reload the feed.
- Post likes, saves, signed-in share counts, post deletes, comment likes, comment deletes, and community focus use optimistic local state first, then run the callable in the background.
- Optimistic writes are registered in a Community pending-action map. While the map is non-empty, `beforeunload` shows the browser-native leave warning.
- If an optimistic write fails, the UI rolls back to the saved local snapshot and shows a non-blocking Community toast.
- Simple post actions should update the affected card/action controls directly and preserve scroll position, feed pagination, active filters, and loaded posts.
- Full feed reloads are reserved for route/context changes, filter/sort/search changes, initial loads, and rare destructive recovery paths after failed rollbacks.

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
  reportCount: 0,
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

Reporting a community post increments both `counts.reports` and `reportCount`. Comment and community reports increment `reportCount` on their respective targets when the backend can resolve the target safely.

## Moderation and Discovery

Community moderation is callable-owned. Client writes to protected community paths remain blocked by rules except for narrow owner/admin-safe updates already documented in rules.

Callables added for this foundation:

- `hideCommunityPost`
- `restoreCommunityPost`
- `lockCommunityPostComments`
- `deleteOwnCommunityPost`
- `pinCommunityPost`
- `unpinCommunityPost`
- `hideCommunityComment`
- `restoreCommunityComment`
- `moderateCommunity`
- `listAdminCommunityModeration`

Pinned posts are stored on `communities/{communityId}.pinnedPostIds` with a maximum of three ids. The public community feed lifts matching loaded posts above the rest and marks them as pinned.

The Community feed supports:

- `?tag=sound-design`
- `?search=creator`
- `?sort=new`
- `?sort=top-today`
- `?sort=top-week`
- `?sort=most-discussed`

`top-today` and `top-week` are a foundation sort that favors denormalized `score` and recency; a later aggregation job can replace this with precise daily/weekly rollups.

Admin community moderation lives at `/admin/community`. It lists recent/reported/hidden posts, reported comments, communities, and community reports. Mutations write `adminLogs`.

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

Done in next phase interaction polish:

- community post cards open `/community/post/{postId}` from non-interactive card areas
- post cards are keyboard-openable with Enter or Space and keep button/link actions isolated from card navigation
- comment actions link to `/community/post/{postId}#comments`
- share copies the canonical post detail URL and confirms with `Post link copied.`
- New Post is now one unified composer instead of separate Text Post / Share Product modes
- product sharing is an attachment on a standard post through `attachments: [{ type: 'product', productId, snapshot }]`
- legacy `product_share` and `linkedProductId` posts still render
- Add Product uses the signed-in creator's public published products and writes a server-sanitized product snapshot
- Tag People has a username search foundation and stores sanitized mention ids/usernames
- Emoji insertion and session draft persistence are available in the composer
- attachment, music, schedule, poll, Stage Plan, and Studio Project tools are visible as disabled `Coming soon` scaffolds

Done in creator content phase:

- Add Music attaches existing public product audio previews only
- Add Stage Plan attaches owned/collaborated StageMaker projects as public-safe snapshot cards
- Add Studio Project attaches owned/collaborated Studio projects as public-safe metadata cards
- Request Feedback and Find Collaborators add structured `intent` data to standard posts
- feed/sidebar filters support Music, Products, Stage Plans, Studio Projects, Feedback, and Collaboration
- public profile post cards show intent/attachment badges
- backend validates attachment counts, ownership/share permissions, safe product preview paths, and future deadlines

Done in post interaction refinement:

- post Likes and Dislikes are visible actions with mutually exclusive optimistic state
- `toggleCommunityPostLike` and `toggleCommunityPostDislike` enforce one active reaction per viewer server-side
- post authors can edit title, body, tags, and safe public visibility through the `updateCommunityPost` callable
- edited posts keep immutable fields, attachments, counts, reports, and moderation fields server-controlled
- edited posts show an `edited` label near the timestamp
- topic and story rails expose left/right fade edges only when more horizontal content is available
- header profile menu reinitialization cleans up stale outside-click/auth listeners so the avatar menu stays reliable across Community routes

Deferred:

- creator follow feed
- video stories and live streams
- FYP scoring
- full community moderation dashboard
- mention notifications and scheduled publishing
- arbitrary Community audio upload
- public read-only Stage Plan viewer
- public Studio Project viewer
