# Melogic Community architecture, security, state, lifecycle, and performance audit

Audit date: 2026-09-21  
Repository baseline: `main` at `6681625e6381a3f0fcf55f36e1a072329e59c4cd`  
Audit mode: read-only investigation and verification; no Community implementation or rules changes were made.

## A. Executive summary

The intended desktop model—cache expensive surface-local DOM/state while keeping Stories, identity, focus, membership, counts, and authentication authoritative—is the correct model. The current implementation is directionally close: the desktop surface snapshots deliberately exclude shared Story/community state, update detached Story/community regions, preserve scroll and pagination, and guard feed requests with request IDs and query keys. Those parts should not be discarded.

The problem is that authority and lifecycle are still implicit inside a 9,439-line `src/community.js`. The same module owns routing, mutable data, detached DOM, event registration, media, camera handoff, optimistic mutations, and rendering. As a result, the cache preserves more than rendered pixels: it also preserves old listeners and media state, while auth changes and mobile runtime deactivation do not fully invalidate identity-scoped data or stop Story playback.

The audit confirmed one P0 policy bypass, eight P1 correctness/lifecycle problems, and several P2 reliability/performance issues:

1. **P0:** authenticated clients can create `communityStories` directly under Firestore rules, bypassing the callable's canonical identity, server timestamps, bounded expiry, remix validation, and Storage-object validation. Direct hard deletion is also permitted.
2. **P1:** account changes do not invalidate focus, membership, following-feed, viewer, recorded-view, and detached-surface state. A second account can temporarily see the first account's private UI state.
3. **P1:** mobile cached surfaces and feed-detail snapshots can restore stale Story/focus DOM even when the shared JavaScript state is newer; mobile resume does not refresh Stories.
4. **P1:** leaving Community through the mobile runtime does not close the Story viewer or stop its video, RAF, hold timer, signal analysis, and preloads.
5. **P1:** Story identity lookup permanently negative-caches transient failures as unverified, matching the reported intermittent badge symptom.
6. **P1:** anonymous Story views are not deduplicated and can be inflated without authentication.
7. **P1:** comment create/delete performs an O(n) comments query inside a transaction; deleting a parent leaves visible orphan replies, and moderation does not reconcile counters.
8. **P1:** Story/comment/post soft deletion does not delete Storage objects; Story media remains publicly readable by Storage rules after expiry or deletion.
9. **P1:** the service worker force-activates and claims old clients while deleting old caches. Existing clients can then request retired chunks. The recovery path helps, but deliberately defers reload during unsafe work; the PWA tests currently fail because they still assert the previous non-forced policy.
10. **P2:** every cached-surface restoration calls `bindEvents()` on already-bound nodes, accumulating listeners.
11. **P2:** Story waveform analysis downloads and decodes the full video independently of playback; the next-two preloader creates additional video elements that are not promoted into the viewer.
12. **P2:** route-view DOM, Storage URL, identity, Story signal, comments, and interaction maps have no coherent eviction policy.

No implementation was applied, including for the P0, because closing the direct Story path safely requires a coordinated rules/callable deployment and verification of all production clients. A one-sided rules edit could break an older deployed client. It should nevertheless be treated as the first patch stage.

## B. Current Community architecture map

### Frontend ownership

| Layer | Current owner | Responsibilities |
|---|---|---|
| Entry/controller | `src/community.js:145-9439` | Global state, route parsing, rendering, surface caches, comments, reactions, Stories, media, optimistic updates, lifecycle |
| Data access | `src/data/communityService.js` | Firestore reads, callable wrappers, Storage upload/download, normalization |
| Identity | `src/data/profileSearchService.js:7-199` | Public profile reads and process-lifetime identity cache |
| Mobile route runtime | `src/pwa/mobileAppRuntime.js:17-536` | Persistent view registry/instances, activation/deactivation, primary-tab interception, scroll |
| Mobile route classification | `src/pwa/mobileSpaRouter.js` | Route registry, prewarming, SPA events |
| Persistent shell | `src/pwa/mobileSpaShell.js`, `src/components/assetChrome.js` | Shared outlet, auth chrome, unread Inbox subscription |
| Camera | `src/camera.js:340-399, 1926-2004` | MediaStream/MediaRecorder ownership and in-memory Community handoff |
| PWA release | `src/pwa/register.js:50-247`, `public/melogic-push-sw.js:81-200` | update detection, worker activation, offline/static caches, stale-chunk recovery |

### Backend ownership

| Domain | Trusted writer |
|---|---|
| Posts | `createCommunityPost`, `updateCommunityPost`, Community moderation callables |
| Post/comment reactions and counters | engagement callables using Firestore transactions |
| Comments | `createCommunityComment`, `deleteCommunityComment`, moderation callables |
| Stories | Story callables in `functions/src/community/*Story*.js`, except the rules also permit direct client create/delete |
| Community focus | `toggleCommunityFocus` |
| Membership/roles/verification | `communityMembership.js` callables |
| Account/Inbox activity | backend writes `users/{uid}/accountEvents`; clients read their own mirror |

### Data flow

`community.js` renders from one module-global `state` object. Firestore reads return snapshots through `communityService`; mutations go mostly through callable Functions and update state optimistically. There is no Community Firestore `onSnapshot` usage. Desktop and mobile keep up to three Community sub-surfaces—For You, Following, Discover—as detached `DocumentFragment`s. The mobile app runtime additionally parks whole route views in an `instances` map.

## C. State-ownership map

| State | Actual owner | Intended scope | Audit result |
|---|---|---|---|
| `posts`, cursor, filters, scroll, rendered media | Community surface snapshot | Surface-local | Correct in principle |
| `stories`, loading/error | Global `state` | Shared/live | JS ownership is correct; mobile and detail-return DOM reconciliation is incomplete |
| `communities`, `communityFocus` | Global `state` | Shared and auth-scoped for focus | Shared placement is correct; auth scoping/invalidation is missing |
| `communityMembership` | Global `state` | Auth-scoped/shared | Not cleared on sign-out/account change |
| `viewerState`, `commentViewerState` | Global `state`, partly snapshotted | Auth-scoped and surface-specific | Reloaded on auth change, but cached surface copies and async ownership can expose stale UI |
| `followingFeedCache` | Global `state`, snapshotted | User + query scoped | Cache key is not explicitly UID-scoped and is not cleared on auth change |
| `recordedStoryViews` | Module `Set` at `community.js:139` | User/session scoped | Not UID-scoped or cleared on auth change |
| public author identity | Two process-lifetime maps | Shared, TTL/realtime refreshed | Duplicate cache ownership; negative results become permanent in Community |
| Story viewer timers/preloads/signal cache | Module globals | Active-view scoped | Survive Community deactivation |
| desktop/mobile surface DOM | `desktopCommunitySurfaceCache`, `mobileCommunitySurfaceCache` | Route/surface scoped | Fixed three keys, but listeners/media have no explicit lifecycle |
| whole mobile route DOM | `mobileAppRuntime.instances` | Runtime view scoped | No normal eviction; up to all registered primary views stay mounted/parked |
| comments/replies maps | Global `state` | Post scoped with bounded recency | Accumulate across detail navigation; no LRU |

The immediate structural problem is not that state is global. It is that the global object has no declared scope metadata (`public`, `auth:<uid>`, `surface:<key>`, `view-active`) and therefore no deterministic invalidation contract.

## D. SPA lifecycle analysis

### Lifecycle paths

| Path | What happens now | Result |
|---|---|---|
| Cold `/community` | Boot shell, await initial auth, render, load feed/Stories/communities in parallel | Sound first-paint strategy; no realtime |
| For You ↔ Following ↔ Discover, desktop | Capture outgoing fragment/state; restore target; refresh shared desktop content | Fast and directionally sound, but restore rebinds existing nodes |
| Same transitions, mobile | Same three-surface cache inside the persistent Community runtime | No shared-region reconciliation for detached mobile fragments |
| Browser Back/Forward | `syncCommunityRouteStateFromLocation` and restore cache/snapshot | Bare `/community` does not reset an old Following tab; detail snapshot return skips shared refresh |
| Feed → detail → Back | Entire feed fragment saved in one `feedNavigationSnapshot` | Preserves media/scroll; can restore expired/stale shared DOM |
| Community → another primary mobile tab | Runtime calls Community `deactivate`, detaches all app DOM | Recording stops; Story viewer/media does not |
| Background/resume | Desktop refreshes shared Community content on visible; mobile explicitly returns without refresh | Mobile can retain expired/deleted Stories indefinitely until another navigation/load |
| Auth change | Reload viewer/comment state and Stories | Does not invalidate focus, membership, caches, following data, or recorded Story views |
| Camera → Community | File lives in `window.__melogicCommunityMediaHandoff`; Camera runtime activates Community | Hardware shutdown is good; handoff is deliberately same-document only and is lost on document reload |

### Confirmed lifecycle defects

#### D1. Auth-scoped state survives account changes — P1, architectural

- **Files/functions:** `src/community.js:145-347`, `loadActiveCommunityMembership` at `6206`, auth observer at `9342-9361`, surface capture/restore at `7050-7230`.
- **Current behavior:** the observer replaces `state.currentUser` and reloads viewer/comment state and Stories. It does not clear `communityFocus`, `communityMembership`, `followingFeedCache`, surface caches, `feedNavigationSnapshot`, interaction-version maps, or `recordedStoryViews`.
- **Cause:** state has no UID namespace or central auth transition.
- **Reproduction:** sign in as A, focus/join communities, open Following and save/like content, sign out and sign in as B without a document reload, then restore a cached surface.
- **Impact:** B can temporarily see A's focused/membership/saved/reaction UI and A's cached Following composition; mutations can be calculated from the wrong optimistic baseline.
- **Fix:** introduce `resetAuthScopedCommunityState(previousUid, nextUid)`, cancel generations, clear or UID-key surface caches, and rehydrate all auth-scoped repositories before rendering.

#### D2. Cached surfaces accumulate event handlers — P2, isolated first fix; architectural prevention

- **Files/functions:** `restoreMobileCommunitySurface` at `7087`, `restoreDesktopCommunitySurface` at `7196`, `bindEvents` at `8633`, `bindStoryRailEvents` at `3843`.
- **Current behavior:** DOM nodes retain their original `addEventListener` handlers while detached. Restoration then calls `bindEvents()` again with fresh closures. Each round trip adds another handler to unchanged nodes.
- **Reproduction:** open For You, switch to Following, return, repeat, then click an unguarded scroll/filter/navigation control and inspect repeated callbacks/history/render work.
- **Impact:** multiplicative UI work, duplicate loads/history actions, and long-session memory retention. Mutation pending guards reduce duplicate backend writes for several actions, but do not solve listener accumulation.
- **Fix:** use one delegated listener set on the stable Community root, or bind through per-node idempotence/AbortController. Do not call whole-page binding after attaching already-live DOM.

#### D3. Route canonicalization is incomplete — P2, isolated

- **Files/functions:** `syncCommunityRouteStateFromLocation` at `9266`.
- **Current behavior:** `activeTab` changes only when `feed=for-you|following` exists. Returning to bare `/community` can retain `following` from prior module state.
- **Impact:** URL, selected tab, cache key, and query can disagree after history/runtime transitions.
- **Fix:** treat bare `/community` as canonical `for-you`, except when an explicit history-state field says otherwise; encode the selected feed consistently in history.

### What is already correct

- Feed reads use `feedRequestId` plus `activeFeedQueryKey` before committing the principal response (`loadFeedPage`), which is the right stale-response pattern.
- Desktop surface snapshots intentionally omit Stories, communities, focus, and membership, and desktop refresh updates detached shared regions.
- `feedNavigationSnapshot` is single-use and does not rebind already-bound nodes.
- Camera runtime deactivation stops the recorder, capture tracks, intervals, and timeouts (`src/camera.js:340-399`); this contract should be copied to Story viewer ownership.
- Scroll and pagination are surface-local, which matches the desired model.

## E. Firestore/security matrix

“Expected result” means the result under the checked-in rules, not necessarily the desired policy.

| Collection/document | Operation | Client caller | Important fields | Client-owned | Server-owned | Rule | Expected result / audit |
|---|---|---|---|---|---|---|---|
| `profiles/{uid}` | Public get | `getPublicProfileIdentityByUid`, comment hydration | display name, username, avatar, badges | normal profile fields by owner | badges/publicBadges, role/status and counts | `firestore.rules:1462-1473` | Read allowed; owner cannot change protected verification/role fields. Correct. |
| `users/{uid}` | Own get/update | shared auth/profile code | private account plus roles/status | ordinary private fields | role, badge, status/security fields | `firestore.rules:1013+` | Owner-only read; protected keys excluded. Correct for Community. |
| `users/{uid}/following/{target}` | Own list | `listFollowedCreatorPosts` | followed UID docs | none through Community | relationship lifecycle | `firestore.rules:1278-1281` | Read allowed only for owning UID; write denied. Correct. |
| `users/{uid}/focusedCommunities/{id}` | Own list/get | `listFocusedCommunityIds`, focus hydration | community ID/snapshot | none | relationship and timestamps | `firestore.rules:1268-1271` | Read allowed; write denied; callable writes. Correct. |
| `communities/{id}` | Public read | list/get Community | content, owner/moderators, focus/post counts | limited content edit for owner/mod | status, visibility, counts, privileged moderation | `firestore.rules:2259-2295` | Public active reads work. Direct owner content edit is allowed, while the service currently routes `updateCommunity` through admin moderation; ownership paths should be unified. |
| `communities/{id}/members/{uid}` | Get through callable; no direct service read | membership callable | status, roles, verification | none | all membership fields | `firestore.rules:2244-2257` | Direct writes denied. Reads narrowly authorized. Correct. |
| `communityPosts/{id}` | Public list/get | feed/detail services | post body, denormalized identity, attachments, counters | callable request body; narrow direct title/body/tags update | canonical identity, status, counts, official, community counters | `firestore.rules:2297-2334` | Public query matches published/public rule. Create denied. Owner direct hard delete is allowed and bypasses soft-delete cleanup. |
| `communityPosts/{id}` | Create/update/delete | callable wrappers | canonical post document | title/body/tags/attachment references/intent | timestamps, author snapshot, counters/status | Admin SDK bypasses rules | Callable create validates uploaded Storage metadata. Correct primary path. Delete omits media and community post-count cleanup. |
| `communityPosts/{id}/{likes,dislikes,saves,shares}/{uid}` | Own get; callable mutation | viewer hydration and engagement callables | reaction state | desired action only | child document and counters | `firestore.rules:2336-2354` | Owner reads own marker; direct writes denied. Correct. |
| `communityPosts/{id}/comments/{comment}` | Public visible read; callable create/delete | comments UI | body, parent, attachments, counts, status | body and attachment references | identity, timestamps, counts/status | `firestore.rules:2356+` | Queries match visible + public-post rule. Direct create denied. Direct author status update to `deleted` remains an alternate path that bypasses counter reconciliation. |
| comment reaction children | Own get; callable mutation | comment viewer/reaction handlers | like/dislike marker | desired action | marker/counters | nested rules under comments | Direct writes denied; callable transaction is authoritative. Correct. |
| `communityStories/{id}` | Public active read | `listCommunityStories` | identity snapshot, media, expiry, counts | should be callable input only | canonical identity, timestamps, expiry, moderation/counters | `firestore.rules:2107-2233` | Read query is compatible. **Direct authenticated create and hard delete are allowed: P0 bypass.** |
| `communityStories/{id}/views/{uid}` | author/mod read; callable write | no direct write | viewer UID/time | none | all | `firestore.rules:2235-2241` | Direct writes denied. Callable deduplicates signed-in viewers only. |
| Story reactions | callable only | `setCommunityStoryReaction` | reaction marker/counts | desired reaction | documents/counts | no permissive client match | Direct client access denied by default; Admin callable works. Correct. |
| `users/{uid}/accountEvents/{event}` | own read/update read/hidden flags | Inbox integration | Community like/comment/reply/focus event | readAt/hiddenAt | creation and content | `firestore.rules:1405-1417` | Community backend writes and Inbox owner reads are compatible. |
| `users/{uid}/inboxThreads/{thread}` | own realtime read/write | Inbox and shell badge | denormalized thread/unread state | owner mirror state | backend also maintains mirrors | `firestore.rules:1373-1375` | Query is permitted. Historical permission-denied warnings are not caused by Community collections; likely auth/deployed-rules timing or wrong UID. Falling back from ordered to unordered on `permission-denied` cannot cure a permission problem. |
| reports/moderation data | callable | `createReport`, admin moderation | target IDs/reasons/status | report input | moderation/audit fields | server-controlled paths | Community does not directly write privileged moderation fields. Correct. |

### Storage companion matrix

| Path | Client behavior | Rule | Result |
|---|---|---|---|
| `community/posts/{uid}/{postId}/attachments/*` | upload before callable create with ownership metadata | `storage.rules:279-288` | Allowed; callable later verifies object metadata. This flow is sound. |
| `community/comments/{uid}/{postId}/{commentId}/*` | upload before comment callable | `storage.rules:263-277` | Requires published post and exact metadata. Compatible. |
| `communityStories/{uid}/{storyId}/*` | upload before Story callable | `storage.rules:451-465` | Owner upload allowed, public read always allowed, deletion owner/admin. No status/expiry coupling. |

### P0: direct Story create bypasses the trusted contract

- **Files/functions:** `firestore.rules:2107-2233`; trusted implementation `functions/src/community/createCommunityStory.js:20-115`.
- **Current behavior:** any signed-in client can directly create a Story document with self `authorUid` but client-chosen display identity, `createdAt`, `updatedAt`, and `expiresAt`. The rule checks `lifetimeHours <= 48` but never binds `expiresAt` to `request.time + lifetimeHours`. It checks only the path string, not whether a Storage object exists or matches type/size. Direct hard delete is also allowed.
- **Additional drift:** the rules allowlist omits newer callable-owned fields (`storyType`, remix fields, layers, `layerSchemaVersion`), proving the direct and callable schemas have already diverged.
- **Reproduction:** an authenticated SDK client calls `setDoc(collection('communityStories'))` with `lifetimeHours: 1`, an `expiresAt` years in the future, a chosen author display name, and a syntactically valid but nonexistent own media path.
- **Impact:** policy bypass, durable public content, spoofed denormalized identity for consumers that do not hydrate canonically, broken media, and deletion outside cleanup/audit.
- **Fix:** deny direct Story create/delete, require the callables, validate Storage metadata in `createCommunityStory`, and deploy compatibility telemetry before enforcing. Architectural security fix; highest priority.

### Alternate direct-write paths to remove

`communityPosts` owner hard delete and comment owner direct status update are allowed by rules while production UI uses callables. Those paths bypass aggregate and Storage cleanup. The system should choose exactly one mutation authority per entity. Prefer callables for all aggregate-bearing entities and make direct rules read-only except explicitly harmless owner fields.

## F. Story lifecycle analysis

### Actual lifecycle

1. `newCommunityStoryId()` allocates a client ID.
2. Image/video is normalized client-side and uploaded to `communityStories/{uid}/{storyId}/...` (`communityService.js:1300`).
3. `createCommunityStory` canonicalizes author identity and writes the Firestore document.
4. `listCommunityStories` queries public active Stories with `expiresAt > now + 60s`, ordered by ascending expiry (`communityService.js:973-1002`).
5. Storage URLs resolve through a module cache; Community groups rows by author.
6. Canonical profiles hydrate asynchronously; Story metadata is only fallback.
7. Mobile warms the next two image/video assets using separate `Image`/`video` objects.
8. Viewer renders a new media element, attempts unmuted autoplay, falls back to muted, records a view, and separately analyzes the full video audio signal.
9. Expiry/deletion is observed only on the next list fetch. There is no expiry timer or realtime status subscription.
10. Delete soft-deletes Firestore only. Media persists.

### Findings

#### F1. Verification failures are cached as authoritative unverified — P1, isolated then architectural

- **Files/functions:** `ensureCommunityAuthorIdentity` at `src/community.js:435-450`; shared cache at `src/data/profileSearchService.js:7-23, 157-199`.
- **Current behavior:** a timeout or both Firestore read failures cause Community to cache `{ uid, badges: [] }`. The cache has no TTL/invalidation and Community does not listen to the shared `melogic:public-profile-identity` event. That UID stays unverified until a full document reload.
- **Reproduction:** throttle/offline the initial profile read for a verified Story author, then restore connectivity.
- **Impact:** intermittent verified authors appear unverified across all cached Community surfaces.
- **Fix:** distinguish `unknown/error` from `known-unverified`; use a single identity store with TTL, retry/backoff, event/subscription updates, and `profiles/{uid}.badges` as the only authority.

#### F2. Story freshness is incomplete on mobile and detail return — P1, architectural

- **Files/functions:** `updateStoryRegionsOnly` at `3856`, `restoreMobileCommunitySurface` at `7087`, `restoreFeedNavigationSnapshot` at `7313`, desktop-only visibility branch at `606-610`.
- **Current behavior:** detached Story regions are patched only for desktop cache entries. Mobile restore attaches old Story DOM without reconciling it. Returning from a detail snapshot also restores old DOM and returns before `loadCommunity`. Mobile visibility resume intentionally skips the desktop refresh.
- **Reproduction:** open Community on mobile, navigate to another cached Community surface or a post detail, let a Story expire or publish/delete it on another client, then return/resume.
- **Impact:** expired/deleted Stories remain visible; new Stories and badge changes are missing.
- **Fix:** on every Community activation, visibility resume, and cached-fragment restore, run one cheap shared-state reconciliation; schedule a timer for the nearest `expiresAt`; optionally subscribe to the active Story window.

#### F3. Community deactivation does not stop Story media — P1, isolated

- **Files/functions:** Story timers/media at `src/community.js:7746-8120`; runtime lifecycle at `9393-9419`.
- **Current behavior:** `deactivate` only removes a class, resets recording, and detaches DOM. It does not call `closeStoryViewer`, pause/remove the active video `src`, clear RAF/hold/transition timers, invalidate signal analysis, or clear lookahead media.
- **Reproduction:** play a video Story, then tap Inbox/Streaming/Profile in the mobile primary nav.
- **Impact:** hidden audio/video may continue, network and decode work continue, and parked media buffers remain retained.
- **Fix:** add `deactivateStoryController({ preserveViewerPosition })` that pauses and unloads media, clears timers/lookahead, and invalidates async tokens. Reactivation may rebuild from state.

#### F4. Anonymous view counts are freely inflatable — P1, security/integrity, isolated

- **Files/functions:** `functions/src/community/recordCommunityStoryView.js:10-47`.
- **Current behavior:** signed-in viewers receive a per-UID view document; anonymous callers have no dedupe key and every call increments the Story.
- **Reproduction:** invoke the callable repeatedly without Firebase Auth for an active Story.
- **Impact:** manipulated popularity metrics and unbounded transaction/write cost.
- **Fix:** require auth, or issue a server-verified App Check/session-scoped anonymous ID with rate limiting. Add App Check enforcement/rate controls independently of UI dedupe.

#### F5. Upload/delete does not own Storage cleanup — P1, architectural

- **Files/functions:** upload at `communityService.js:1300`; publish paths `community.js:7548-7725`; delete callable `functions/src/community/deleteCommunityStory.js`; public Storage read `storage.rules:451-465`.
- **Current behavior:** a successful upload followed by callable failure leaves an orphan. Expiry and soft deletion leave the object. Storage reads are unconditional public reads.
- **Impact:** cost grows indefinitely and content remains retrievable after UI deletion/expiry if its path or download URL is known.
- **Fix:** callable should validate the object, delete it on failed finalize, and enqueue cleanup on delete/expiry. Use a scheduled cleanup job plus lifecycle status metadata; decide explicitly whether post-delete URLs must stop resolving.

#### F6. Ordering is “earliest expiry”, not clearly “newest Story” — P2, product semantics

With uniform lifetime this approximates oldest-created-first. Mixed 6/12/24/48-hour lifetimes reorder creators by expiry, and author grouping preserves the first query encounter. Define the product order explicitly (for example, unviewed creators first, then latest creator activity; chronological within creator) and encode it server-side/indexed rather than deriving it accidentally from expiry.

#### F7. Story load generation has a stale finalizer — P2, isolated

`loadStories` guards result assignment by `storyHydrationGeneration`, but its `finally` always sets `storiesLoading = false` and patches regions. An older request can clear the spinner while a newer request is still running. Gate catch/finally side effects by the same generation.

## G. Realtime/subscription analysis

Community currently has **zero Firestore realtime subscriptions**. It has an auth observer and imperative reads/callables. That avoids duplicate surface listeners, but means cached surfaces cannot receive external post/comment/reaction/Story/focus/membership/profile changes.

The recommended rule is:

> one authoritative repository/subscription per query and user scope → normalized shared state → DOM patches for active and cached surfaces

Do not attach listeners to rendered surfaces. A `communityRealtimeManager` should own subscriptions keyed by a stable query signature and UID, reference-count consumers, and suspend high-volume listeners when Community is inactive. Initial scope:

- active Story window/status and author identity changes;
- active post detail comments and counts;
- current user's focus/membership/reaction markers;
- optionally the first page of the active feed.

Keep pagination beyond the first page snapshot-based. Apply entity updates into normalized maps and patch all cached render projections by entity ID.

Cross-product note: the shell keeps an Inbox unread subscription (`assetChrome.js:280`), while a warmed Inbox runtime starts full thread/preferences/events/call subscriptions and does not stop them on deactivation (`inbox.js:7876+, 8548-8600`). This is separate from Community permissions, but it means Community sessions can pay for duplicate Inbox mirror listeners plus inactive Inbox realtime traffic. On Inbox deactivation, retain only the shell unread subscription unless an active call requires more.

## H. Mobile/PWA lifecycle analysis

### Mobile runtime

The lifecycle registry is useful and Camera implements the intended resource contract well. The runtime, however, retains every mounted view in `instances` (`mobileAppRuntime.js:19, 115-229`) and normal navigation never calls `unmountMobileRuntimeView`. Idle warmup can import all five primary tabs. This is a deliberate speed tradeoff without a memory-pressure policy.

Community also installs a body-wide MutationObserver and route listeners at module evaluation (`community.js:508-533`). Because primary-tab warmup imports the module before activation, Community observes the whole app even while another route owns the document. Move those registrations into `mount/activate`, and disconnect or narrow them on `deactivate/unmount`.

### Service worker and stale bundle behavior

The current system can reproduce the class of stale-hashed-chunk failure previously seen:

1. An old page remains open with old import URLs.
2. A new worker installs and immediately calls `skipWaiting()` (`public/melogic-push-sw.js:114-120`).
3. Activation deletes old Melogic shell and route caches and calls `clients.claim()` (`132-146`).
4. Firebase's new deployment may no longer contain an old dynamic chunk.
5. The old client requests that chunk and receives a preload/import failure.
6. `register.js` reloads on `vite:preloadError`, but refuses while recording/uploading/unsaved work is active.

The build manifest check (`register.js:141-242`) is a good defense and uses `no-store`; hashed assets are appropriate immutable cache entries. The unsafe-work deferral is also correct. The risky part is forced activation and deletion of assets still needed by old clients.

Additional confirmed defect: `ROUTE_CACHE` is read as an offline fallback at worker line 169, but successful route responses are never written to that cache. The comments promise a “most recently cached route document” that normally cannot exist.

#### H1. Worker policy, implementation, and tests disagree — P1, architectural deployment fix

- **Files:** `public/melogic-push-sw.js:81-200`, `src/pwa/register.js:141-242`, `test/melogicPwa.test.mjs:31-42`.
- **Verification:** the focused Node test run passed 10/12 tests and failed both worker lifecycle tests. The harness lacks the forced-activation APIs and the test explicitly asserts that `skipWaiting`/`clients.claim` do not exist.
- **Fix:** choose one release policy. Recommended: install and announce the update; activate after all clients are safe or after an explicit user action; keep old fingerprinted cache generations while clients of that build exist; reload only at a safe boundary. If forced release is a business requirement, version all dynamic-import recovery, keep at least one previous asset cache, and update tests to simulate registration/navigation preload/clients.

#### H2. Route offline cache is never populated — P2, isolated

On a successful navigation, clone the response into `ROUTE_CACHE` under a normalized request/key after verifying it is public HTML and not `no-store`, or remove the dead fallback claim and rely only on `offline.html`. Because Hosting currently marks Community HTML `no-store`, implementing route caching requires an explicit offline policy rather than silently overriding headers.

### iOS/PWA-specific assessment

- Camera tracks are stopped on pagehide/hidden/deactivation, which is appropriate for iOS privacy and device contention.
- Community Story recording tracks are stopped on runtime deactivation, but viewer playback is not.
- Object URLs used by Community composers are usually revoked on replace/remove/success; failed pending Story upload intentionally retains the preview for retry.
- BFCache pageshow repairs the active runtime view, but does not refresh Community shared data.
- The camera-to-Community file handoff exists only in memory; sessionStorage stores only the destination. A process kill/document navigation cannot resume the captured file. Treat this as an explicit non-durable contract or persist a bounded Blob in IndexedDB.

## I. Media pipeline analysis

| Media | Current pipeline | Main issue |
|---|---|---|
| Camera photo/video | MediaStream → Blob/File → in-memory handoff → post/Story normalization/upload | Correct hardware shutdown; handoff not durable |
| Post image/video/audio/file | object URL preview → Storage upload → callable verifies object metadata → Firestore attachment | Good trust boundary; cleanup after post deletion missing |
| Comment image/audio/project | preview/upload → callable path/type validation → Firestore | Cleanup after delete/moderation missing |
| Story image/video | normalization → Storage → callable → download URL → rail/viewer | orphan/public-retention risk; no server thumbnail/poster validation |
| Story lookahead | next two independent Image/video objects | preloaded video element is not reused by viewer |
| Story signal | second `fetch` of full video → `arrayBuffer` → `decodeAudioData` | duplicate bytes/memory/CPU, especially near 150 MB limit |

#### I1. Story signal analysis duplicates full-media work — P2, isolated design replacement

- **Files/functions:** `analyzeStorySignal` at `community.js:7855-7909`; `storySignalCache` at `7834`.
- **Current behavior:** playback loads the video, while signal analysis fetches the same URL into a full ArrayBuffer and decodes all audio in an AudioContext. The result is retained indefinitely by Story ID.
- **Impact:** large transient memory, double network/cache pressure, decode CPU/battery, and poor iOS behavior.
- **Fix:** generate a small waveform envelope/poster during upload or backend processing and store it with Story metadata. Until then, use deterministic bars or cap analysis by size/device/network and clear its cache on expiry.

#### I2. Preload assets are not promoted — P2, architectural media manager

`warmStoryMediaLookahead` correctly limits targets to two and clears removed entries, but it creates media elements only to warm browser cache. The viewer creates another element. HTTP cache may avoid transfer, but buffer/decode reuse is not guaranteed. A `communityMediaManager` should own preload handles and transfer/promote the exact element or MediaSource state into the viewer where safe.

#### I3. Poster/thumbnail lifecycle is incomplete — P2

The Story callable accepts an optional thumbnail path but does not verify Storage existence/metadata, and the client does not establish a unified poster generation contract. Generate a bounded WebP/JPEG poster for every uploaded/captured video, validate it server-side, use `preload="metadata"` for offscreen video, and reserve `auto` for the active plus tightly bounded next item.

## J. Performance/memory analysis

### Bounded today

- Community sub-surface cache keys are fixed to For You, Following, and Discover.
- Following feed cache is capped at 24 posts.
- Story lookahead keeps the active next two target IDs and clears non-target media.
- Composer object URLs are generally revoked on removal/reset.
- Camera capture resources are explicitly stopped.

### Unbounded or lifetime-bound today

| Retained item | Location | Recommended bound/eviction |
|---|---|---|
| whole mobile route fragments | `mobileAppRuntime.instances` | Keep active + two MRU; evict inactive heavy views on memory warning, long background, or device-memory threshold |
| Storage download URLs | `communityService.js:195-260` | LRU 250-500, TTL aligned to token policy; evict deleted paths |
| public identities and negative identity state | `profileSearchService.js:7`, `community.js:376` | One cache, UID keyed, positive TTL 5-15 min, error retry in seconds, subscription invalidation |
| Story signal arrays | `community.js:7834` | active Story group only; clear on expiry/deactivate |
| comments/replies per post | `state.commentsByPostId`, `repliesByCommentId` | 5-10 post LRU, preserve current detail |
| interaction version maps | `community.js:367-371` | delete after settlement and on auth reset |
| image retry timers | `community.js:2610` | cancel on deactivation/unmount |
| body MutationObservers/global listeners | Community and PWA modules | lifecycle-owned AbortController/disconnect |
| detached DOM decoded media | surface/route fragments | keep DOM but unload inactive video/audio; cap surface memory by media count/device memory |

Do not evict the three desktop surfaces merely because they are detached; that would defeat the requested speed model. Instead, retain markup and decoded images where affordable, unload video/audio buffers immediately, and evict least-recently-used surfaces only under an explicit budget.

## K. Confirmed bugs

| ID | Severity | Finding | Fix type |
|---|---:|---|---|
| K1 | P0 | Direct Story create/delete bypasses callable policy and bounded expiry | Security architecture/rules |
| K2 | P1 | Auth changes leave prior user's Community state/caches | Architectural state scope |
| K3 | P1 | Mobile/detail cache restore can show stale Stories/focus | Surface reconciliation |
| K4 | P1 | Story viewer media/timers survive mobile runtime deactivation | Isolated lifecycle contract |
| K5 | P1 | Transient identity failure is permanently cached unverified | Identity store |
| K6 | P1 | Anonymous Story view callable permits unlimited count inflation | Isolated backend security |
| K7 | P1 | Parent comment deletion or moderation leaves count/reply inconsistency | Backend data model |
| K8 | P1 | Soft-deleted/expired Community media is not deleted and Story bytes stay public | Backend/Storage lifecycle |
| K9 | P1 | Forced SW activation can strand old clients; existing lifecycle tests fail | Release architecture |
| K10 | P2 | Cached-surface restore accumulates event listeners | Event architecture |
| K11 | P2 | Story request generation has an unguarded stale finalizer | Isolated async fix |
| K12 | P2 | Offline route cache is read but never populated | Isolated PWA policy fix |

### Comment correctness and scale detail (K7)

- **Files/functions:** `createCommunityComment.js:67-108`, `deleteCommunityComment.js:31-70`, `communityModeration.js:343-372`.
- **Current behavior:** every create/delete reads every visible comment inside the transaction to derive the total. Deleting a top-level comment changes only that document; visible reply documents remain and remain counted, but the UI removes/loses their parent. Moderator hide/restore changes status without changing post `commentCount` or parent `replyCount`.
- **Reproduction:** create a parent plus replies; delete/hide the parent; reload detail. The displayed tree and aggregate diverge. At large comment counts, mutations become expensive and approach transaction/read limits.
- **Fix:** use atomic server-owned counters with idempotency keys, or sharded counters at high scale. Define cascade policy: soft-hide descendants with the parent, or render a tombstone parent so replies remain reachable. Moderation and author deletion must call one counter/cascade routine.

### Media retention detail (K8)

Post deletion (`communityModeration.js:252-275`) and Story deletion update Firestore status only. Comment deletion clears attachment references but not Storage. Direct post hard delete is also permitted by rules. Add a durable cleanup queue/outbox written in the same trusted mutation, process it idempotently, and reconcile community/post/comment counts in the same domain service.

## L. Architectural risks

These are important but were not labeled confirmed production failures without runtime telemetry:

1. Surface snapshots preserve `feedRequestId`; a late enrichment operation mutates shared state inside helper functions before the final request-ID check. Restoring older request counters can make async ownership hard to reason about. Use monotonic operation tokens that are never restored from a surface snapshot.
2. Two overlapping mobile navigation foundations remain in source (`mobilePrimaryTabs` snapshot code, marked disabled, and the active `mobileAppRuntime`). Stale comments describe both as non-intercepting while the runtime bridge actively intercepts primary tabs. This increases maintenance error risk.
3. `community.js` module evaluation has side effects during speculative warm import. More warm-loaded entry modules can create cross-route observers/listeners before ownership.
4. Firestore index fallback loads broad sets and filters client-side. It protects availability but can silently disable pagination (`hasMore: false`) and increase reads. Missing indexes should alert rather than become a normal mode.
5. Community has no realtime convergence. Optimistic counts remain stale when other clients mutate.
6. Denormalized author/community identity is necessary for feeds but lacks a documented refresh/backfill strategy. Canonical profile hydration corrects only visible author presentation, not all denormalized consumers.
7. There is no Community-specific Firestore or Storage rules test coverage. The current rules test files contain no Community cases.

## M. Recommended architecture

Do not rewrite `community.js` wholesale. Extract behavior behind its current call sites in this order:

### 1. `communityStore`

A normalized store with explicit partitions:

- public entities: posts, comments, Stories, communities, profiles;
- auth scope: `{ uid, viewerState, focus, membership, following, recordedViews }`;
- surfaces: query/filter/cursor/scroll/post IDs;
- transient view: active modal, viewer, composer, timers.

It should expose `setAuthScope(uid)`, invalidate old generations, and publish entity-level changes. Surface snapshots should store IDs/query state, not copies of authoritative entity objects.

### 2. `spaSurfaceManager`

Own fragment capture/restore, LRU metadata, scroll, active surface, and resource suspend/resume. It should never call broad `bindEvents`; the stable root should use delegated events. On restore it asks renderers to reconcile shared regions from the store.

### 3. `storyController` + `communityMediaManager`

`storyController` owns ordering, viewed state, expiry timers, viewer navigation, and realtime Story status. `communityMediaManager` owns object URLs, active playback, preloads, posters, pause/unload, and memory budget. Both expose `activate`, `deactivate`, and `dispose`.

### 4. `identityStore`

Replace the two maps with one canonical cache containing `{status, value, fetchedAt, errorAt}`. It consumes profile subscriptions/events, never converts a transport error into a negative identity fact, and patches all author projections.

### 5. `feedController` and `commentController`

Own monotonic, non-restorable request tokens; query keys; pagination; optimistic mutations; and normalized merge rules. Backend comment mutations should share one aggregate/cascade implementation.

### 6. `communityRealtimeManager`

One reference-counted subscription per UID/query/entity. It updates the store, not DOM. Surface renderers subscribe to store changes. Suspend broad feed/comment subscriptions when inactive; retain only small auth/Story status listeners as product needs dictate.

### 7. `communityRenderer`

Keep current string templates initially. Add keyed patch functions for shared Stories, identity, focus, membership, and counts. A framework migration is not required to fix ownership.

## N. Incremental refactor plan

### Phase 0 — security containment

Dependency: inventory deployed clients and callable adoption.

1. Add emulator tests for direct Story create/delete, expiry bounds, media fields, and all Community Storage paths.
2. Add callable telemetry/version marker to confirm Story writes arrive through Functions.
3. Make `createCommunityStory` validate Storage object existence, owner metadata, content type, and size.
4. Deny direct Story create/delete and route every mutation through callables.
5. Require auth/App Check/rate limits for Story views.

### Phase 1 — deterministic auth and lifecycle

Depends on no architectural extraction.

1. Centralize auth reset; clear/cancel every UID-scoped field and cache.
2. Stop Story playback/timers/preloads on Community deactivation/pagehide.
3. Refresh/reconcile shared regions on mobile activation, resume, cached restore, and detail return.
4. Fix `loadStories` finalizer generation and bare-route canonicalization.

### Phase 2 — event and surface ownership

Depends on Phase 1 regression tests.

1. Move Community UI events to stable-root delegation.
2. Introduce `spaSurfaceManager` behind existing capture/restore functions.
3. Make async operation IDs monotonic outside snapshots.
4. Add cache diagnostics: retained nodes, video/audio count, listener registration count, surface age.

### Phase 3 — Story/identity extraction

Depends on store event primitives from Phase 2.

1. Extract identity store with TTL/error semantics.
2. Extract Story controller and expiry timer.
3. Extract media manager; replace full-video signal decode with generated envelopes/posters.
4. Add Story lifecycle integration tests for create, expiry, delete, resume, cached restore, and account switch.

### Phase 4 — backend aggregate and cleanup consistency

Can run parallel to Phase 3 after Phase 0 test infrastructure.

1. Replace O(n) comment recount transactions with idempotent deltas.
2. Define and implement parent-delete cascade/tombstone policy.
3. Route moderation/author/direct mutations through one domain service.
4. Add cleanup outbox and scheduled orphan/expired-media sweeper.
5. Reconcile existing counts and orphaned attachments with a one-off admin job.

### Phase 5 — bounded realtime

Depends on normalized store/entity merge rules.

1. Subscribe to active Story status/window and active detail comments/counts.
2. Add auth-scoped focus/membership/reaction subscriptions only where needed.
3. Optionally subscribe to first-page feed entities; keep older pages snapshot-based.
4. Measure reads per active user and verify a single listener per query signature.

### Phase 6 — PWA release hardening

Independent of Community store work, but must precede broader runtime expansion.

1. Decide forced versus safe activation policy and update implementation/comments/tests together.
2. Preserve previous build assets until old clients close or safely reload.
3. Implement or remove route HTML offline caching explicitly.
4. Add a two-build browser test: old client open, new deploy, dynamic import, unsafe editor active, then safe reload.
5. Add iOS installed-PWA tests for background/resume, BFCache, camera, Story viewer audio, and update activation.

## O. Prioritized patch roadmap

| Stage | Priority | Small reviewable patch | Depends on | Acceptance signal |
|---|---:|---|---|---|
| 0A | P0 | Community Firestore/Storage emulator tests and callable Storage validation | none | direct bypass test fails before fix; callable path passes |
| 0B | P0 | Deny direct Story create/hard delete; enforce callable path | 0A + deployed-client check | unauthorized direct writes denied; create/delete UI works |
| 0C | P1 | Auth/App Check/rate limit Story views | 0A | repeated anonymous calls rejected/throttled |
| 1A | P1 | UID-scoped auth reset and cache invalidation | none | A→B switch shows no A focus/membership/viewer state |
| 1B | P1 | Story controller deactivation cleanup | none | no audio, active media network, RAF, or preload after leaving Community |
| 1C | P1 | Mobile/detail shared-region refresh and expiry timer | 1B | expired/deleted/new Story converges on resume/restore |
| 1D | P1 | Identity cache error state/TTL | none | transient profile failure self-recovers without reload |
| 2A | P2 | Delegated/idempotent events | 1A | 50 surface round trips still invoke each action once |
| 2B | P2 | Non-restorable request tokens and stale-finalizer fix | 1A | out-of-order requests never alter current loading/data |
| 3A | P1 | Comment aggregate/cascade service | tests | delete/hide/restore preserves tree and exact counts at scale |
| 3B | P1 | Media cleanup outbox/sweeper | 0B, 3A | deleted/expired objects removed; retries idempotent |
| 4A | P2 | Story poster/envelope generation and media manager | 0A | one video transfer, bounded preload, stable first frame |
| 4B | P2 | LRU/memory-pressure policy | 2A, 4A | bounded maps/views; active + MRU surfaces retained |
| 5A | P1 | Safe SW activation and prior-build retention | independent | two-build test passes without hard refresh or lost work |
| 6A | P2 | Authoritative realtime manager, Stories/detail first | normalized store | one listener/query; all surfaces converge |

## Verification performed

- `npm run check`: passed configuration checks and production Vite build.
- `node --test test/communityEngagementState.test.mjs test/melogicPwa.test.mjs`: 10 passed, 2 failed. All six Community engagement-state tests passed. Both PWA lifecycle tests failed against the current forced worker lifecycle.
- Checked-in `test/firestoreRules.test.mjs` and `test/storageRules.test.mjs` contain no Community-specific cases, so they cannot currently validate the matrix above.
- The build regenerated only a timestamp in a Soura DSP metadata file; that unrelated generated change was reverted. The audit adds only this report.

## Final verdict

Keep the desktop surface-caching strategy. Do not add more ad hoc refreshes or listener flags inside `community.js`. First close the Story write bypass, make auth/media lifecycle explicit, and make every cache restoration reconcile shared authority. Then extract the store, surface manager, Story/media controller, and subscription manager behind existing behavior. That sequence preserves the speed gains while removing the cross-account, stale-DOM, hidden-media, and rule-ownership hazards that will otherwise compound as Community becomes realtime.
