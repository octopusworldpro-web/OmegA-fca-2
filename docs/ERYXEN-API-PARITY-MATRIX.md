# Eryxen FCA 1.3.5 — method-level parity audit

**Audit date:** 2026-11-21  
**Target:** `octopusworldpro-web/OmegA-FCA-2`, `main`  
**Target commit audited:** `8d9a2835d6636f58d27afee265b3441347f3cf6f`  
**Reference:** public npm README for `@eryxenx/fca` **1.3.5**: https://www.npmjs.com/package/%40eryxenx/fca  
**Important distinction:** `@eryxenx/fca` is the primary current reference. The separately named `fca-eryxenx` package/repository and its old API checklist are historical supporting material, not a substitute for the current npm README.

## Audit rules

- **Implemented (source present):** a first-party OmegA-FCA method is present and wired into the client facade. This is not proof of live Facebook acceptance.
- **Partial / different semantics:** a related method exists, but the reference contract, event shape, encrypted-thread behavior, or option semantics are not fully matched.
- **Missing:** no matching first-party method is currently exposed.
- **Live-unverified:** synthetic request/response tests exist, but authorized account delivery/acceptance has not been demonstrated.
- Never import the reference package or copy its bundled binary. This audit compares public API and observable behavior only.

## Executive result

OmegA-FCA already has broad first-party coverage for the core FCA surface: text/media sends, broadcast, receipts, most thread/group operations, account/session helpers, HTTP helpers, a namespaced facade, and a MessengerBot wrapper. However, **full Eryxen 1.3.5 parity is not complete**.

The definite public-README gaps found in this source audit are:

1. `pinMessage` and `unpinMessage`
2. `sendFriendRequest`
3. `followUser` and `unfollowUser`
4. `postComment` and `sharePost`
5. `uploadImageToImgbb`
6. `listenE2EE` as a distinct listener API (implemented in Step 8)

The E2EE namespace now exposes a distinct E2EE-only listener plus one-to-one reaction, typing, unsend and edit controls. E2EE mark-read, group Sender Keys, encrypted group media and Labyrinth backup/restore remain unsupported or partial.

## Method-level matrix

| Reference API | OmegA-FCA source status | Evidence / notes |
|---|---|---|
| `sendMessage` | Implemented; live-unverified | Client facade supports legacy positional reply ID; MQTT and authenticated attachment/share-URL send paths exist. E2EE auto-routing parity is not established for every action. |
| `sendBroadcast` | Implemented; live-unverified | Bounded parallel/sequential sender reports per-recipient success and failure. |
| `sendGif` | Implemented; live-unverified | Client helper routes URL GIFs through share-URL path and file inputs through attachment path. |
| `sendLocation` | Implemented; live-unverified | Client helper and MQTT location payload builder exist. |
| `sendImage` | Implemented; live-unverified | Client helper and bounded attachment upload path exist. |
| `sendVideo` | Implemented; live-unverified | Client helper and attachment upload path exist. |
| `sendAudio` | Implemented; live-unverified | Client helper and attachment upload path exist. |
| `sendFile` | Implemented; live-unverified | Client helper and attachment upload path exist. |
| `shareLink` | Implemented; live-unverified | Client helper uses authenticated share-URL preparation and send flow. |
| `shareContact` | Implemented; live-unverified | Native driver uses correlated `/ls_req`–`/ls_resp` response handling; live broker acceptance remains unverified. |
| `editMessage` | Implemented; live-unverified | Native driver and authenticated request path exist. |
| `unsendMessage` | Implemented; live-unverified | Authenticated unsend endpoint exists. |
| `deleteMessage` | Implemented; semantics differ from unsend | Explicit delete-for-me operation; not a substitute for unsend. |
| `setMessageReaction` | Implemented; live-unverified | Native thread API exists. Optional-thread and custom-reaction overload parity needs focused contract tests. |
| `getMessage` | Implemented; limited | Resolves from bounded recent thread history; not a dedicated arbitrary-message lookup. |
| `forwardAttachment` | Implemented; live-unverified | Native authenticated forward path exists. |
| `uploadAttachment` | Implemented; live-unverified | Bounded file reading, MIME detection and upload metadata validation exist. |
| `pinMessage` | Implemented; live-unverified | Native Lightspeed task builder and client methods added for pin/unpin; server acceptance still requires an authorized live account. |
| `unpinMessage` | Implemented; live-unverified | Native Lightspeed task builder and client methods added for pin/unpin; server acceptance still requires an authorized live account. |
| `markAsRead` | Implemented; live-unverified | Authenticated read action exists. |
| `markAsReadAll` | Implemented; live-unverified | Authenticated inbox-folder read action exists. |
| `markAsDelivered` | Implemented; live-unverified | Authenticated delivery receipt action exists. |
| `markAsSeen` | Implemented; live-unverified | Authenticated seen-watermark action exists. |
| `sendTypingIndicator` | Partial | Native typing action exists; reference documents an explicit `isTyping` boolean overload. Exact true/false timing and callback contract require parity tests. |
| `getThreadInfo` | Implemented; live-unverified | GraphQL adapter and normalized legacy thread shape exist. |
| `getThreadList` | Implemented; live-unverified | Bounded pagination exists; legacy large-limit and tag compatibility are covered in the audit notes. |
| `getThreadHistory` | Implemented; live-unverified | Bounded pagination exists; capped at 1,000. |
| `createGroup` | Implemented; adapter | Client facade adapts reference order `(title, participantIDs)` to native `createNewGroup(participantIDs, title)`. |
| `deleteThread` | Implemented; live-unverified | Authenticated delete action exists. |
| `muteThread` | Implemented; live-unverified | Authenticated mute action exists. |
| `changeArchivedStatus` | Implemented; live-unverified | Authenticated archive/unarchive action exists. |
| `handleMessageRequest` | Implemented; live-unverified | Native authenticated request handler exists. |
| `searchForThread` | Implemented; live-unverified | Native typeahead/search adapter exists. |
| `getThreadPictures` | Implemented; live-unverified | Native thread-photo lookup and validation exist. |
| `setTitle` | Implemented; live-unverified | Authenticated thread-title action exists. |
| `changeThreadColor` | Implemented; live-unverified | Authenticated customization action exists. |
| `changeThreadEmoji` | Implemented; live-unverified | Authenticated customization action exists. |
| `changeNickname` | Implemented; live-unverified | Authenticated customization action exists. |
| `changeGroupImage` | Implemented; live-unverified | Bounded image upload plus thread action exists. |
| `changeAdminStatus` | Implemented; live-unverified | Native group-admin action exists. |
| `addUserToGroup` | Implemented; live-unverified | Native group-member action exists. |
| `removeUserFromGroup` | Implemented; live-unverified | Native group-member action exists. |
| `createPoll` | Implemented; live-unverified | Native poll action exists; private endpoint is especially subject to protocol drift. |
| `getUserInfo` | Implemented; live-unverified | Authenticated profile lookup and normalization exist. |
| `getUserID` | Implemented; live-unverified | Authenticated typeahead lookup exists. |
| `getUID` | Implemented | Local ID/profile URL/vanity resolution helper exists. |
| `getFriendsList` | Implemented; live-unverified | Authenticated friend-list adapter exists. |
| `getAvatarUser` | Implemented; adapter | Derived from normalized `getUserInfo` thumbnail. |
| `getProfileInfo` | Implemented; adapter | Derived from normalized `getUserInfo`; no additional fields are promised. |
| `getPublicData` | Implemented; adapter | Derived from normalized `getUserInfo`; no additional fields are promised. |
| `sendFriendRequest` | Implemented; live-unverified | Authenticated Comet friend-request mutation; returns friendship status. |
| `handleFriendRequest` | Implemented; live-unverified | Authenticated accept/reject action exists. |
| `changeBlockedStatus` | Implemented; live-unverified | Authenticated block/unblock action exists. |
| `followUser` | Implemented; live-unverified | Authenticated Comet follow mutation. |
| `unfollowUser` | Implemented; live-unverified | Authenticated Comet unfollow mutation. |
| `unfriend` | Implemented; live-unverified | Authenticated friend-removal action exists. |
| `reactToPost` | Implemented; live-unverified | Adapter over post-reaction action exists. |
| `reactToComment` | Implemented; live-unverified | Adapter over post-reaction action exists; comment reaction semantics need live confirmation. |
| `postComment` | Implemented; live-unverified | Authenticated Comet comment mutation for text comments and optional comment replies; rich attachment/mention parity is not claimed. |
| `sharePost` | Implemented; live-unverified | Comet feed-to-feed reshare mutation; accepts an optional text message and normalizes the returned shared story ID. |
| `getCurrentUserID` | Implemented | Native authenticated session identity exists. |
| `getAppState` | Implemented | Native session cookie/AppState export exists. |
| `setOptions` | Partial | Supported listener/runtime flags are validated; not every Eryxen option is implemented. |
| `logout` | Implemented | Client lifecycle shutdown and callback/Promise form exist. |
| `refreshFb_dtsg` | Implemented | Authenticated web-client token refresh exists. |
| `addExternalModule` | Implemented; both contracts supported | Preserves OmegA object-of-functions form and adds Eryxen `(moduleName, factory)` overload with restricted helpers and account context. |
| `httpGet` | Implemented | Authenticated HTTPS allowlisted web client. |
| `httpPost` | Implemented | Authenticated HTTPS allowlisted web client. |
| `httpPostFormData` | Implemented | Authenticated multipart helper with URL and size controls. |
| `uploadImageToImgbb` | Implemented; requires owner-supplied ImgBB API key | HTTPS image URL upload through ImgBB API; key is read from login options or environment and never logged. |
| `createFcaClient` | Implemented; partial surface | Namespaced groups exist; only available methods are bound. Audit namespace aliases and exact reference shape separately. |
| `createMessengerBot` / `MessengerBot` | Implemented; partial behavior | Command/hears/messageCreate/launch/stop wrapper exists; it is not a full Telegraf/Discord clone. |

## E2EE parity matrix

| Reference E2EE capability | OmegA-FCA status |
|---|---|
| Automatic E2EE connection after login | Partial / not claimed as reference-equivalent |
| `listenE2EE` E2EE-only listener | Implemented; synthetic API coverage; live-unverified |
| `e2ee.isConnected()`, status, thread detection | Implemented |
| `e2ee.sendMessage()` | Implemented for the supported native client path; live-unverified |
| `e2ee.sendAttachment()` / download | Implemented; live-unverified |
| `e2ee.sendReaction()` | Implemented for verified one-to-one threads; synthetic payload tests; live-unverified |
| `e2ee.sendTyping()` | Implemented for verified one-to-one threads; synthetic frame tests; live-unverified |
| `e2ee.unsendMessage()` | Implemented for verified one-to-one threads; synthetic payload tests; live-unverified |
| `e2ee.editMessage()` | Implemented for verified one-to-one threads; synthetic payload tests; live-unverified |
| E2EE mark-read | **Missing** |
| Encrypted group threads / group Sender Keys | Not implemented / explicitly out of scope for current engine |
| Incoming E2EE media and quoted-reply media parity | Partial; must not be assumed from regular MQTT attachment normalization |

## Login options parity

| Reference option | OmegA-FCA status |
|---|---|
| `selfListen`, `listenEvents`, `listenTyping`, `updatePresence` | Implemented for supported event filters |
| `autoMarkDelivery`, `autoMarkRead` | Implemented |
| `autoReconnect` | Partial | Reconnect supervisor exists and reconnects on transport failure; the reference boolean option is not mapped as a verified per-login disable switch. |
| `userAgent` | Implemented / forwarded to authenticated web client |
| `proxy` | Unsupported in current native transport; must fail/document explicitly rather than silently claim parity |
| `online` | Implemented | Login option is passed into MQTT protocol metadata as `chat_on`; live presence behavior remains unverified. |
| `emitReady` | Not verified / no parity claim |
| Reference `humanize` options | Partial; OmegA has its own humanizer and option schema, not guaranteed drop-in equivalent |

## Reference and source files reviewed

- npm public README for `@eryxenx/fca@1.3.5`: https://www.npmjs.com/package/%40eryxenx/fca
- OmegA-FCA `index.js`, `index.d.ts`
- `src/api/client.js`, `src/compat/namespacedClient.js`, `src/compat/messengerBot.js`, `src/compat/humanizer.js`, `src/compat/broadcast.js`
- `src/transport/facebookMqttDriver.js`, `src/transport/facebookThreadApi.js`, `src/transport/facebookMqttEvents.js`, `src/transport/messengerActions.js`
- `src/compat/imageUpload.js`, `src/e2ee/client.js`
- Relevant tests: `test/facebook-fca-parity.test.js`, `test/facebook-thread-api.test.js`, `test/facebook-fca-account-actions.test.js`, `test/facebook-fca-thread-actions.test.js`, `test/namespaced-client.test.js`, `test/messenger-bot.test.js`, `test/messenger-actions.test.js`, `test/e2ee.test.js`

## Step 2 exit criteria

- [x] Primary reference corrected to current `@eryxenx/fca@1.3.5`.
- [x] Public README API methods and login options enumerated.
- [x] Existing first-party source paths checked for each method family.
- [x] Definite missing methods separated from adapters and partial semantics.
- [x] E2EE and login-option parity gaps recorded separately.
- [x] No reference-package code or dependency added to OmegA-FCA.
- [ ] Implementation of the missing APIs — later implementation steps, not an audit task.
- [ ] Authorized live Facebook acceptance — separate release gate, not a synthetic audit claim.

**Result:** Step 2 (reference/API parity audit) is complete. The library itself is not yet full-parity or release-complete. Use this matrix as the authoritative checklist for subsequent implementation steps.


## Step 5 implementation checkpoint (2026-11-21)

- Reply metadata is carried in the correlated MQTT send request; explicit Messenger send rejection payloads are surfaced as errors.
- `editMessage`, `unsendMessage`, `markAsRead`, `markAsReadAll`, `markAsSeen`, and `markAsDelivered` have implementation and synthetic contract coverage. Read-receipt event normalization preserves metadata watermark timestamps.
- Concurrent MQTT request failures are isolated, request capacity is checked before publishing, and request-ID wraparound avoids IDs still pending.
- All listed Facebook-specific wire behavior remains live-unverified; this checkpoint does not claim full FCA parity or production acceptance.


## Step 8 E2EE implementation checkpoint (2026-11-21)

- Added dedicated `listenE2EE` subscription and `api.e2ee.listen()` without requiring consumers to subscribe to regular MQTT events.
- Added E2EE one-to-one reaction, edit, revoke/unsend and composing/paused typing operations. All are guarded by a verified one-to-one thread lookup; group Sender Keys are not silently attempted.
- Added API facade wiring, TypeScript declarations, usage documentation and synthetic payload/frame tests.
- E2EE key agreement, signed-prekey verification, media encryption/HMAC integrity, encrypted device-store persistence and Facebook-host cookie isolation remain covered by the existing suite.
- E2EE mark-read, group Sender Keys/group media, encrypted backup restore and key transparency remain unsupported; do not claim complete Messenger E2EE.
- All Meta private endpoint, Noise handshake and real-account send/receive behavior remains live-unverified pending authorized Facebook acceptance.
