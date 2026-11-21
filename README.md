<div align="center">

<a href="https://github.com/nirzon-islam/OmegA-FCA">
  <img src="https://capsule-render.vercel.app/api?type=waving&color=0:071426,35:123B67,70:5B2D91,100:00BFA6&height=230&section=header&text=OmegA-FCA&fontSize=64&fontColor=ffffff&fontAlignY=38&desc=Messenger%20Client%20%7C%20FCA%20Compatibility%20Layer&descAlignY=59&descSize=17&animation=fadeIn" alt="OmegA-FCA animated header" width="100%" />
</a>

### ⚡ A modern, AppState-first Messenger client & FCA compatibility layer

**Built with care by [NirZon](https://github.com/nirzon-islam) · Part of the OmegA Bot ecosystem**

<p>
  <img src="https://img.shields.io/badge/Status-Experimental-orange?style=for-the-badge&logo=github" alt="Experimental status" />
  <img src="https://img.shields.io/badge/Node.js-20%2B-339933?style=for-the-badge&logo=nodedotjs&logoColor=white" alt="Node.js 20+" />
  <img src="https://img.shields.io/badge/License-MIT-7c3aed?style=for-the-badge&logo=opensourceinitiative&logoColor=white" alt="MIT License" />
</p>
<p>
  <a href="https://github.com/nirzon-islam/OmegA-FCA"><img src="https://img.shields.io/github/stars/nirzon-islam/OmegA-FCA?style=flat-square&color=f5a623&label=Stars" alt="GitHub stars" /></a>
  <a href="https://github.com/nirzon-islam/OmegA-FCA/commits/main"><img src="https://img.shields.io/github/last-commit/nirzon-islam/OmegA-FCA?style=flat-square&color=0ea5e9" alt="Last commit" /></a>
  <a href="https://github.com/nirzon-islam/OmegA-FCA/actions"><img src="https://img.shields.io/github/actions/workflow/status/nirzon-islam/OmegA-FCA/ci.yml?branch=main&style=flat-square&label=CI" alt="CI status" /></a>
</p>

[Features](#included) · [Quick Start](#appstate-first-test-run) · [Documentation](#documentation) · [Security](#security) · [Development](#development)

</div>

---

> [!IMPORTANT]
> **Experimental — not a verified drop-in FCA replacement.** AppState session validation, MQTT/WebSocket bootstrap, a limited event normalizer, a limited action set, and GoatBot callback compatibility are implemented with synthetic tests. Live Facebook broker acceptance, complete event/action parity, and authorized-account end-to-end tests remain outstanding.

<div align="center">

| Package | Runtime | Maintainer |
|:---:|:---:|:---:|
| `@nirzon-islam/omega-fca` | **Node.js 20+** | **NirZon** |

</div>

## ✨ Project overview

OmegA-FCA is the Facebook integration library maintained under the **OmegA Bot** brand by **NirZon**. It brings together an AppState-first personal Messenger session foundation, experimental MQTT transport, FCA-style APIs, and GoatBot compatibility utilities.

### 🧭 Documentation

| Guide | What you'll find |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | Project structure and system design |
| [Implementation status](docs/IMPLEMENTATION-STATUS.md) | Implemented features and remaining work |
| [GoatBot compatibility](docs/GOATBOT-COMPATIBILITY-MATRIX.md) | Compatibility notes and known gaps |
| [NTKhang architecture study](docs/NTKHANG-REFERENCE-STUDY.md) | Independent architecture and compatibility study |
| [Deployment](docs/DEPLOYMENT.md) | Setup and test instructions |
| [E2EE](docs/E2EE.md) | Experimental encrypted messaging notes |
| [TypeScript](docs/TYPESCRIPT.md) | Types and package exports |

> **Quick install**
> ```bash
> npm install @nirzon-islam/omega-fca
> ```


## Included

- AppState/cookie validation, secure encrypted session storage, secret redaction.
- Optional encrypted SessionGuard with explicit owner-managed key, verified backup recovery, periodic saves, account-bound restore, and a non-destructive GoatBot `account.txt` compatibility alias. Configure it with `FCA_SESSION_FILE`, `FCA_SESSION_KEY`, and optionally `FCA_SESSION_INTERVAL_MS`; encrypted output never replaces `account.txt`.
- `createDiagnosticRecorder()`: bounded request metadata reports that omit header values, query values, body values, response bodies and credentials.
- Native personal-session bootstrap for owner-supplied AppState, including HTTPS-only Facebook/Messenger requests, cookie rotation, and checkpoint/expiry detection.
- `createFacebookWebClient()`: bounded authenticated GET/POST/HEAD request layer, session-token injection for POST forms, redirect challenge classification, response normalization, and request/response size limits. It deliberately requires caller-supplied verified paths and payload schemas.
- AppState/cookie login is the only enabled login path in this phase. Direct email/username-password and 2FA login attempts are rejected before the authentication provider is called; credential login is deferred.
- Checkpoint/session-expiry classification. Challenges must be resolved by the account owner.
- Connection supervision, bounded reconnect/backoff and event dispatch.
- Bounded realtime binary-frame envelope inspection based on observed captures.
- Experimental Facebook Messenger MQTT 3.1 transport adapter using public FCA observations: `edge-chat.facebook.com/chat`, broker handshake, subscriptions and sync-queue bootstrap. Event normalization and live validation remain incomplete.
- `createFacebookMqttClient()`: first-party AppState client factory with optional encrypted SessionGuard restore that wires the native personal-session bootstrap, MQTT driver, reconnect supervisor and GoatBot-style `listenMqtt` facade. The package supplies its own `ws` WebSocket implementation by default (injection remains available for tests); real Facebook broker acceptance is not yet verified.
- `inspectRealtimeSyncEnvelope()`: parses the captured outer sync JSON envelope and nested payload with size/type checks; it does not infer the unknown binary prefix or protocol semantics.
- `createLegacyFcaProvider()`: adapter for an existing callback-style personal-account FCA implementation.
- `createGoatBotLogin()`: callback-style GoatBot login adapter.
- GoatBot login-time listener options are forwarded to the native driver: `selfListen`, `selfListenEvent`, `listenEvents`, `listenTyping`, `updatePresence`, `autoMarkDelivery`, `autoMarkRead`, `online`, and `userAgent`. Supported event filters can be changed with `setOptions()`; unknown options are rejected.
- Personal-account driver method forwarding for messaging, threads, reactions, typing, and group actions when the supplied FCA implementation supports those methods.
- Native `getMessage(threadID, messageID)` looks up the target in the latest 100 normalized thread-history messages; older-history cursor lookup is not yet implemented.
- Sensitive legacy `getCookies()` exposes the current Facebook cookie header for owner-only compatibility paths; never log or send it to ordinary users.
- Native `editMessage()` and `shareContact()` use correlated Messenger MQTT task requests; both remain subject to live-account acceptance checks.
- Native user/profile lookup (`getUserID`, `getUID`, `resolvePhotoUrl`), friend-list retrieval, and `createNewGroup` use authenticated Facebook web requests; their private endpoints require live-account verification.
- GoatBot's `getHumanizer()` compatibility hook is created with the MQTT listener and supports reaction delay, typing indicator, cooldown, per-thread and per-minute limits.
- Separate official Meta Messenger Page transport (not a personal-account replacement).
- TypeScript declarations, signed update-manifest verification, optional Ed25519 licensing.

## GoatBot account configuration

The current authentication phase is **AppState-only**. Email/password and username/password login are deferred and are not loaded from configuration or environment variables.

Put only an authorized cookie export in the project-root `account.txt`. Accepted formats are:
- Raw cookie header (`c_user=...; xs=...`).
- Netscape cookie export.
- JSON cookie array.

Alternatively, put a JSON cookie array in `appstate.json`. A non-empty `account.txt` takes precedence. Credential-like key/value text in `account.txt` is rejected. The loader deliberately does not fall back to `fb_email`, `fb_username`, passwords, 2FA values, or `FB_*` environment variables.

`account.txt`, `appstate.json`, passwords, cookies, 2FA seeds, and session keys must stay private and must not be committed. Email/password authentication will be implemented as a separate later phase; it is not available in this AppState-only release path.

## Personal AppState session foundation

The first native session layer can validate an owner-supplied AppState and issue bounded HTTPS requests only to Facebook/Messenger hosts. It preserves scoped response cookies and stops with an explicit checkpoint or expired-session error; it does not bypass either state.

```js
const { createPersonalSession } = require("@nirzon-islam/omega-fca");
const session = await createPersonalSession({ appState: require("./account.json") });
const response = await session.request("https://www.facebook.com/");
console.log(session.userId, response.status);
// Call session.close() when finished.
```

This is a session foundation only: it does not yet provide the full FCA action API or realtime listener.

## Experimental Messenger MQTT transport

`createFacebookMqttClient()` provides the first-party AppState and optional encrypted-session restore path: it validates the supplied session, opens the native WebSocket/MQTT transport, subscribes and initializes sync, and exposes a GoatBot-style callback listener. Known Messenger delta classes are normalized conservatively; unknown classes remain explicit. A limited set of web/thread and MQTT actions is available, but this is not full FCA parity. The private broker protocol, delta schemas, and action payloads are unofficial and have not been validated against a live Facebook account. See [Facebook MQTT transport notes](docs/FACEBOOK-MQTT-TRANSPORT.md), [implementation status](docs/IMPLEMENTATION-STATUS.md), and the [NTKhang architecture study](docs/NTKHANG-REFERENCE-STUDY.md).

## Realtime frame inspection

The Android Messenger Web capture confirmed a successful `/ws/realtime` WebSocket handshake and binary frames containing a JSON-like `events` envelope with `name` and `args` fields. OmegA-FCA now includes `decodeRealtimeFrame()` and `summarizeRealtimeFrame()` for bounded inspection of that observed envelope. The undocumented binary prefix remains opaque; this is not yet a socket client, authentication flow, subscription/acknowledgement implementation, event semantic map, message sender, or E2EE implementation. See [Realtime frame evidence](docs/REALTIME-FRAME-EVIDENCE.md).

## Safe diagnostic reports

A secret-safe diagnostic recorder is available for the current AppState-backed session layer. It records request structure and response metadata, not secrets or payload contents. See [Safe diagnostics](docs/SAFE-DIAGNOSTICS.md) for usage.

**Important:** this currently instruments AppState session requests only. It cannot capture a username/password login trace because native Facebook credential login is not implemented yet.

## Legacy compatibility adapter (temporary migration/test utility)

The adapter is a temporary migration/test utility for AppState-backed sessions. It lets an existing FCA implementation plug into OmegA-FCA without pretending that the Facebook protocol has been reimplemented:

```js
const { createClient, createLegacyFcaProvider } = require("@nirzon-islam/omega-fca");
// Supply a caller-owned FCA implementation only when testing the migration adapter.
const legacyFcaLogin = require("your-existing-fca");

const authenticate = createLegacyFcaProvider({
  login: legacyFcaLogin,
  options: { forceLogin: false }
});
const client = createClient({ authenticate });

const api = await client.login({
  mode: "appstate",
  appState: require("./account.json")
});
api.listenMqtt((error, event) => {
  if (error) console.error("FCA listener error:", error.message);
  else if (event) console.log("Event:", event.type);
});
```

Use only an account and session you own or are authorized to operate. Keep `account.json`, passwords, 2FA secrets, and session keys outside source control. If Facebook presents a checkpoint, resolve it through Facebook as the account owner and then retry with a fresh authorized session.

This adapter is optional and is not required by the first-party `createFacebookMqttClient()` path.

## Remaining standalone-replacement gates

- Native username/password authentication and owner-controlled 2FA/checkpoint continuation are deferred; AppState/cookie is the only native login path in this phase.
- Full Messenger event normalization, attachment handling, and the complete legacy FCA action catalog are not implemented.
- Facebook MQTT broker acceptance, event delivery, message send, reconnect recovery, and group operations still need authorized live-account verification.
- Complete legacy FCA behavior parity and GoatBot integration tests must pass before production migration.

Do not treat this experimental release as a drop-in production replacement until those gates pass. The official Meta Page transport is separate and does not satisfy personal-profile or group-chat requirements.

## Security

Never commit cookies, AppState, passwords, 2FA secrets, encryption keys, or tokens. The library does not bypass checkpoints, 2FA, rate limits, or platform security controls. Unofficial interfaces may change and may result in account restrictions.

## AppState-first test run

Email/password login is deferred for the current testing phase. To validate an authorized AppState session, place only the cookie export in the project-root `account.txt` (or `appstate.json`) and run:

~~~bash
npm ci
npm test
npm run test:syntax
npm run test:appstate
npm run test:messenger-mqtt
~~~

The live AppState check prints only the account ID and session status; it does not print cookies. It validates the HTTPS session bootstrap only—not Messenger realtime, message sending, or full GoatBot compatibility. See [AppState deployment/test instructions](docs/DEPLOYMENT.md). The separate `test:messenger-mqtt` command attempts the native broker handshake and listens for event types without printing message content. An outgoing test message requires explicit `--send`, `FCA_TEST_THREAD_ID`, and `FCA_TEST_MESSAGE` settings; verify actual delivery on the recipient device.

## Development

```bash
npm ci
npm test
npm run test:syntax
npm pack --dry-run
```

## Ownership

**OmegA Bot** — developed and maintained by **NirZon**.

MIT License. See [LICENSE](LICENSE).


## Browser-based protocol capture

OmegA-FCA includes an owner-operated Playwright capture utility. On desktop it launches Chromium; on Android/Termux it can attach to an already-running Android Chrome browser through CDP when that browser exposes a debugging endpoint. Setup and privacy guidance: [Browser Capture](docs/BROWSER-CAPTURE.md).

Desktop:

```sh
npm install --no-save playwright
npx playwright install chromium
npm run capture:browser
```

Android/Termux: run `bash tools/termux-capture-setup.sh`, pair/connect ADB Wireless debugging, forward Chrome's DevTools socket, then run `npm run capture:browser -- --cdp http://127.0.0.1:9222`. Lemur/other browser compatibility is not assumed; verify the CDP endpoint first.

The browser runs locally; it is not remotely visible to ChatGPT. The default report omits cookies, query strings, request/response bodies, and binary frame contents. An explicit `--save-private-frames` option stores raw WebSocket frames locally for owner-only inspection; those files may contain secrets or private messages and must not be shared unredacted.


### Session bootstrap redirect handling

The personal-session bootstrap follows up to five same-site HTTPS redirects on Facebook/Messenger hosts, preserving rotated cookies between hops. Login and checkpoint redirects remain authentication failures, and redirects to unrelated hosts are rejected.


## Messenger E2EE (experimental)

The package includes an MIT-licensed, separate Messenger E2EE client for one-to-one encrypted text and media, with a Noise WebSocket transport, device/prekey management, per-device sessions, and encrypted media transfer. Connect with `api.connectE2EE()`, then use `api.sendE2EEMessage()` or `api.sendMessage(input, { e2ee: "required" })`. Persistent device keys are encrypted with AES-256-GCM; configure a 32-byte `e2eeStorageKey` (or reuse the configured SessionGuard key). See [docs/E2EE.md](docs/E2EE.md) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

Group Sender Keys/SKDM, encrypted history backup/restore, E2EE calls and key-transparency verification are not implemented. Private Meta endpoint and Noise-handshake live acceptance with an authorized AppState is still required; synthetic tests do not prove live Meta compatibility.


## FCA convenience APIs

The native FCA facade also exposes media/location helpers and a namespaced client:

```js
const { createFcaClient, createMessengerBot } = require("@nirzon-islam/omega-fca");

const client = createFcaClient(api);
await client.messages.send("Hello!", threadID);
await client.threads.getInfo(threadID);
await client.users.getInfo(userID);
await client.account.refreshDtsg();
```

A small command/keyword bot wrapper is available when you want a higher-level event-driven interface:

```js
const bot = await createMessengerBot(
  { appState: JSON.parse(require("node:fs").readFileSync("./account.txt", "utf8")) },
  { commandPrefix: "/" }
);

bot.command("ping", async ctx => ctx.replyAsync("pong"));
bot.hears(/hello/i, async ctx => ctx.replyAsync("Hi!"));
bot.on("messageCreate", event => console.log(event.body));
bot.launch();
```

`createMessengerBot` uses the same owner-supplied AppState/session login and FCA transport. It does not bypass Facebook checkpoints or provide credential login.


Custom API extensions can be registered without mutating the frozen FCA facade:

```js
api.addExternalModule({
  async replyToOwner(message) {
    return this.sendMessage(message, OWNER_THREAD_ID);
  }
});
```

The registered functions are bound to the FCA API object and cannot replace built-in methods.


## TypeScript

The package ships CommonJS runtime exports and declarations from `index.d.ts`. Node.js 20 or newer is required. In TypeScript projects, install Node.js type definitions so the public `Buffer` and Node runtime types resolve:

```sh
npm install @nirzon-islam/omega-fca
npm install --save-dev @types/node
```

Example using the typed bot wrapper:

```ts
import { createMessengerBot, type Cookie, type MessengerBotContext } from "@nirzon-islam/omega-fca";

const appState: Cookie[] = loadYourAuthorizedAppState();
const bot = await createMessengerBot({ mode: "appstate", appState });

bot.command("ping", async (ctx: MessengerBotContext) => {
  await ctx.replyAsync("pong");
});

bot.launch();
```

See [TypeScript API and package exports](docs/TYPESCRIPT.md) for the declaration contract and compatibility notes. The declarations describe the implemented API surface; they do not imply live Facebook endpoint acceptance or complete FCA parity.
