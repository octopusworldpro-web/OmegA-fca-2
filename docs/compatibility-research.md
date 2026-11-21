# FCA Compatibility Research Notes

This document records OmegA-FCA's independently maintained compatibility requirements. It is a requirements map, not a claim that every method or Facebook protocol flow is implemented.

## Security review

- Keep authentication, session state, and all outbound requests inside the first-party OmegA-FCA implementation.
- Never relay Facebook passwords, 2FA secrets, cookies, or AppState to an unrelated service.
- Build tests with synthetic fixtures and sanitized protocol observations only.
- Keep checkpoint and challenge completion manual and account-owner controlled.

## Compatibility surface

### Login and lifecycle
- Callback-style login compatible with the consuming bot's expectations.
- AppState/cookie session input.
- Credential login only if a safe, independently verified platform flow is available.
- Explicit manual 2FA/checkpoint outcomes; no security bypass.
- Validate listener options and reject unsupported settings explicitly.

### Messaging
- sendMessage, including supported body, attachment, mentions, sticker, and location payloads.
- editMessage, unsendMessage, deleteMessage, getMessage, forwardAttachment, and uploadAttachment.
- Read/delivery receipts and typing indicator methods.
- Media helpers and link/contact sharing as separately verified capabilities.

### Events and connection
- listen/listenMqtt callback contract.
- Stable reconnect with bounded backoff, subscription readiness, stale-client guard, and one active listener.
- Normalize incoming message, thread, typing, presence, and receipt events into documented event shapes.
- Preserve event ordering per thread and suppress bounded duplicate deliveries.

### Threads, groups, users, and social
- Thread info/list/history, create/delete/mute/archive, and search.
- Title/color/emoji/nickname/group image/admin/member operations.
- Poll and pin operations.
- User info/ID lookup, friends, profile, and friend-request/block/follow operations.
- Post/comment reactions, comments, and share operations.

### Session safety
- Persist only encrypted session material.
- Atomic writes, backup/restore, corruption checks, and secret redaction.
- Reuse valid sessions; do not force relogin on ordinary process restarts.
- Detect logged-out/checkpoint/transient/unknown states without treating transient failures as logout.

## Independent update system

- Publish versioned releases and a signed update manifest from an OmegA-controlled endpoint.
- Verify manifest signature, package digest, supported runtime, and release channel before applying.
- Support stable/beta channels, changelog display, staged rollout, backup, health check, and rollback.
- Auto-update must be configurable; never update while a live session is mid-operation.
- Never execute unsigned remote scripts or fetch update code from an unrelated package.

## Implementation status

This is a research checklist, not a claim that these APIs or Facebook protocol flows are already implemented. Actual authentication, MQTT framing/subscription, event decoding, and endpoint behavior must be independently verified before being marked complete.
