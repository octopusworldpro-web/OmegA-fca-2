# EryXen-compatible FCA login API

OmegA-FCA exports a package-level `login()` entry point with the familiar FCA call shape:

```js
const { login, logout } = require("@nirzon-islam/omega-fca");

login({ appState: require("./account.txt") }, {
  selfListen: false,
  listenEvents: true
}, (error, api) => {
  if (error) {
    console.error("Facebook login failed:", error.message);
    return;
  }

  console.log("Logged in as:", api.getCurrentUserID());
  api.listenMqtt((listenError, event) => {
    if (listenError) console.error("Messenger listener:", listenError.message);
    else if (event?.type !== "ready") console.log(event);
  });
});
```

The two-argument callback form `login({ appState }, callback)` is supported. If no callback is supplied, `login()` returns a Promise that resolves to the API or rejects with the login error.

The package also exports `createFcaLogin(options)` for isolated client instances. Its controller exposes `login`, `logout`, `getConnectionState`, and `getLicense`. The package-level `login` uses one shared client; call `logout()` before starting a separate account session in the same process.

## Supported authentication scope

This compatibility entry point preserves OmegA-FCA's current native authentication boundary:
- Owner-authorized AppState in `{ appState: [...] }`.
- Encrypted SessionGuard restore via `{ mode: "session" }` when configured.
- Empty input can load the supported local AppState files through the existing GoatBot adapter.

Facebook username/password and automated 2FA login are not enabled by this API. A Facebook checkpoint must be completed by the account owner. Cookie values, AppState, and session keys must never be logged or committed.

## Compatibility note

The login signature and error-first callback shape are compatible with the common EryXen/GoatBot call pattern. This does not claim complete FCA method/event parity or live Facebook acceptance. The native MQTT handshake and private Facebook endpoints remain subject to authorized live-account testing.
