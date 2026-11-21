"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGoatBotLogin } = require("../src/compat/goatbotLogin");

test("GoatBot adapter maps AppState and forwards options", async () => {
  const api = { getCurrentUserID: () => "123456" };
  let received;
  const login = createGoatBotLogin({
    async login(credentials, options) {
      received = { credentials, options };
      return api;
    }
  });
  const callbacks = [];
  const result = await login(
    { appState: [{ key: "c_user", value: "123456" }, { key: "xs", value: "synthetic" }] },
    { forceLogin: true },
    (error, value) => callbacks.push({ error, value })
  );
  assert.equal(result, api);
  assert.deepEqual(received.credentials, {
    mode: "appstate",
    appState: [{ key: "c_user", value: "123456" }, { key: "xs", value: "synthetic" }]
  });
  assert.deepEqual(received.options, { forceLogin: true });
  assert.deepEqual(callbacks, [{ error: null, value: api }]);
});

test("GoatBot adapter rejects credential and 2FA login before calling native client", async () => {
  let called = false;
  const login = createGoatBotLogin({ async login() { called = true; return {}; } });
  let failure;
  assert.equal(await login({
    email: "owner@example.test",
    pass: "synthetic-password",
    twoFactorSecret: "synthetic-secret",
    twoFactorCode: "123456",
    userAgent: "test-agent",
    proxy: "http://127.0.0.1:8080"
  }, error => { failure = error; }), null);
  assert.equal(failure.code, "FCA_CREDENTIAL_LOGIN_UNSUPPORTED");
  assert.equal(failure.retryable, false);
  assert.equal(called, false);
});

test("GoatBot legacy twoFactorSecretOrCode credential login is explicitly unsupported", async () => {
  const login = createGoatBotLogin({ async login() { throw new Error("must not call native client"); } });
  let failure;
  assert.equal(await login({
    email: "owner@example.test",
    password: "example-password",
    twoFactorSecretOrCode: "654321"
  }, error => { failure = error; }), null);
  assert.equal(failure.code, "FCA_CREDENTIAL_LOGIN_UNSUPPORTED");
});

test("GoatBot adapter supports callback as second argument", async () => {
  const api = {};
  const login = createGoatBotLogin({ login: async () => api });
  let called = 0;
  await login({ appState: [] }, (error, value) => {
    called++;
    assert.equal(error, null);
    assert.equal(value, api);
  });
  assert.equal(called, 1);
});

test("GoatBot adapter reports login rejection exactly once", async () => {
  const failure = new Error("synthetic auth failure");
  const login = createGoatBotLogin({ login: async () => { throw failure; } });
  const received = [];
  const result = await login({ appState: [] }, (error, api) => received.push({ error, api }));
  assert.equal(result, null);
  assert.deepEqual(received, [{ error: failure, api: undefined }]);
});

test("GoatBot adapter never calls a callback twice when the success callback throws", async () => {
  const callbackFailure = new Error("callback failure");
  const login = createGoatBotLogin({ login: async () => ({}) });
  let calls = 0;
  await assert.rejects(login({ appState: [] }, () => {
    calls++;
    throw callbackFailure;
  }), error => error === callbackFailure);
  assert.equal(calls, 1);
});

test("GoatBot adapter rejects missing callback and unsupported login input", async () => {
  const login = createGoatBotLogin({ login: async () => ({}) });
  assert.throws(() => login({ appState: [] }), /callback is required/);
  let reported;
  assert.equal(await login({ token: "not-supported" }, error => { reported = error; }), null);
  assert.equal(reported.code, "FCA_LOGIN_INPUT_UNSUPPORTED");
  assert.match(reported.message, /requires AppState, cookies/);
  assert.equal(reported.retryable, false);
});

test("GoatBot adapter rejects FB_USERNAME/password instead of attempting unsafe credential login", async () => {
  let called = false;
  const login = createGoatBotLogin({ async login() { called = true; return {}; } });
  let failure;
  assert.equal(await login({ username: "fb_handle", password: "synthetic-password" }, error => { failure = error; }), null);
  assert.equal(failure.code, "FCA_CREDENTIAL_LOGIN_UNSUPPORTED");
  assert.equal(called, false);
});


test("GoatBot adapter converts raw Cookie mode to native AppState login", async () => {
  let received;
  const login = createGoatBotLogin({ async login(credentials) { received = credentials; return {}; } });
  await login({ mode: "cookie", cookie: "c_user=123456789; xs=session-cookie" }, () => {});
  assert.equal(received.mode, "appstate");
  assert.deepEqual(received.appState.map(cookie => cookie.key), ["c_user", "xs"]);
});

test("GoatBot adapter supports EryXen uppercase Cookie string, array and object aliases", async () => {
  for (const Cookie of [
    "c_user=123456789; xs=session-cookie",
    ["c_user=123456789", "xs=session-cookie"],
    { c_user: "123456789", xs: "session-cookie" }
  ]) {
    let received;
    const login = createGoatBotLogin({ async login(credentials) { received = credentials; return {}; } });
    await login({ Cookie }, () => {});
    assert.equal(received.mode, "appstate");
    assert.deepEqual(received.appState.map(cookie => cookie.key), ["c_user", "xs"]);
  }
});

test("GoatBot adapter accepts EryXen-style AppState string cookie header", async () => {
  let received;
  const login = createGoatBotLogin({ async login(credentials) { received = credentials; return {}; } });
  await login({ appState: "c_user=123456789; xs=session-cookie" }, () => {});
  assert.equal(received.mode, "appstate");
  assert.deepEqual(received.appState.map(cookie => cookie.key), ["c_user", "xs"]);
});

test("GoatBot adapter rejects credentials stored in account.txt", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omega-goatbot-account-"));
  try {
    fs.writeFileSync(path.join(root, "account.txt"), "fb_email=owner@example.test\nfb_password=private-password");
    let received;
    const login = createGoatBotLogin({
      async login(credentials) { received = credentials; return {}; }
    }, { cwd: root, env: {} });
    let failure;
    assert.equal(await login({}, error => { failure = error; }), null);
    assert.match(failure.message, /account.txt is AppState\/cookie-only/);
    assert.equal(received, undefined);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("GoatBot adapter loads root appstate.json when account.txt is absent", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omega-goatbot-appstate-"));
  try {
    const appState = [{ key: "c_user", value: "12345", domain: "facebook.com" }, { key: "xs", value: "synthetic", domain: "facebook.com" }];
    fs.writeFileSync(path.join(root, "appstate.json"), JSON.stringify(appState));
    let received;
    const login = createGoatBotLogin({ async login(credentials) { received = credentials; return {}; } }, { cwd: root, env: {} });
    await login({}, () => {});
    assert.equal(received.mode, "appstate");
    assert.deepEqual(received.appState, appState.map(cookie => ({ path: "/", hostOnly: false, secure: false, httpOnly: false, ...cookie })));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("GoatBot adapter reports missing root account config through callback", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omega-goatbot-missing-"));
  try {
    const login = createGoatBotLogin({ async login() { throw new Error("must not login"); } }, { cwd: root, env: {} });
    let received;
    assert.equal(await login({}, error => { received = error; }), null);
    assert.equal(received.code, "FCA_ACCOUNT_CONFIG_MISSING");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("GoatBot adapter forwards encrypted SessionGuard restore mode", async () => {
  let received;
  const api = { getCurrentUserID: () => "123456" };
  const login = createGoatBotLogin({
    async login(credentials) { received = credentials; return api; }
  });
  const result = await login({ mode: "session" }, () => {});
  assert.equal(result, api);
  assert.deepEqual(received, { mode: "session" });
});

test("GoatBot adapter maps a raw Cookie header to native AppState login", async () => {
  let received;
  const login = createGoatBotLogin({ async login(credentials) { received = credentials; return {}; } });
  await login({ cookie: "c_user=123456789; xs=session-cookie" }, () => {});
  assert.equal(received.mode, "appstate");
  assert.deepEqual(received.appState.map(cookie => cookie.key), ["c_user", "xs"]);
});

test("GoatBot adapter accepts the cookies array alias used by FCA integrations", async () => {
  let received;
  const cookies = [{ key: "c_user", value: "123456789" }, { key: "xs", value: "session-cookie" }];
  const login = createGoatBotLogin({ async login(credentials) { received = credentials; return {}; } });
  await login({ cookies }, () => {});
  assert.deepEqual(received, { mode: "appstate", appState: cookies });
});

test("GoatBot adapter converts Netscape cookie text into AppState", async () => {
  let received;
  const netscape = [
    "# Netscape HTTP Cookie File",
    ".facebook.com\tTRUE\t/\tTRUE\t1893456000\tc_user\t123456789",
    "#HttpOnly_.facebook.com\tTRUE\t/\tTRUE\t1893456000\txs\tsession-cookie"
  ].join("\n");
  const login = createGoatBotLogin({ async login(credentials) { received = credentials; return {}; } });
  await login({ mode: "netscape", netscape }, () => {});
  assert.equal(received.mode, "appstate");
  assert.equal(received.appState.length, 2);
  assert.equal(received.appState[0].key, "c_user");
  assert.equal(received.appState[1].key, "xs");
  assert.equal(received.appState[1].httpOnly, true);
});

test("GoatBot adapter reports malformed Netscape input through the error callback", async () => {
  const login = createGoatBotLogin({ async login() { throw new Error("must not login"); } });
  let failure;
  assert.equal(await login({ mode: "netscape", netscape: "not-a-cookie-file" }, error => { failure = error; }), null);
  assert.match(failure.message, /Malformed Netscape cookie row/);
});


test("GoatBot adapter exchanges an EAAAA token before native AppState login", async () => {
  const token = "EAAAA" + "A".repeat(64);
  const calls = [];
  const fetchImpl = async url => {
    calls.push(new URL(url));
    if (calls.length === 1) return { ok: true, json: async () => ({ id: "123456" }) };
    return { ok: true, json: async () => ({ session_cookies: [
      { name: "c_user", value: "123456789", domain: ".facebook.com", path: "/" },
      { name: "xs", value: "session-cookie-value", domain: ".facebook.com", path: "/" }
    ] }) };
  };
  let received;
  const login = createGoatBotLogin({ async login(credentials) { received = credentials; return { id: "api" }; } }, { fetchImpl });
  await login({ token }, () => {});
  assert.equal(calls.length, 2);
  assert.equal(calls[0].hostname, "graph.facebook.com");
  assert.equal(calls[1].hostname, "api.facebook.com");
  assert.equal(calls[1].searchParams.get("new_app_id"), "123456");
  assert.equal(received.mode, "appstate");
  assert.deepEqual(received.appState.map(cookie => cookie.key), ["c_user", "xs"]);
});

test("GoatBot adapter loads an EAAAA token from account.txt and exchanges it", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omega-goatbot-token-"));
  try {
    const token = "EAAAA" + "B".repeat(64);
    fs.writeFileSync(path.join(root, "account.txt"), token);
    let calls = 0;
    const fetchImpl = async () => {
      calls++;
      return calls === 1
        ? { ok: true, json: async () => ({ id: "123456" }) }
        : { ok: true, json: async () => ({ session_cookies: [
            { name: "c_user", value: "123456789" },
            { name: "xs", value: "session-cookie-value" }
          ] }) };
    };
    let received;
    const login = createGoatBotLogin({ async login(credentials) { received = credentials; return {}; } }, { cwd: root, env: {}, fetchImpl });
    await login({}, () => {});
    assert.equal(calls, 2);
    assert.equal(received.mode, "appstate");
    assert.deepEqual(received.appState.map(cookie => cookie.key), ["c_user", "xs"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("GoatBot adapter accepts Cookie header aliases as native AppState", async () => {
  let received;
  const login = createGoatBotLogin({ async login(credentials) { received = credentials; return {}; } });
  await login({ cookieHeader: "c_user=123456789; xs=session-cookie-value" }, () => {});
  assert.equal(received.mode, "appstate");
  assert.deepEqual(received.appState.map(cookie => cookie.key), ["c_user", "xs"]);
});

test("GoatBot adapter reports token exchange failures without leaking the token", async () => {
  const token = "EAAAA" + "C".repeat(64);
  const login = createGoatBotLogin({ async login() { throw new Error("must not reach native login"); } }, {
    fetchImpl: async () => ({ ok: true, json: async () => ({ error: { message: "bad token " + token } }) })
  });
  let failure;
  assert.equal(await login({ accessToken: token }, error => { failure = error; }), null);
  assert.match(failure.message, /rejected the supplied access token/);
  assert.doesNotMatch(failure.message, new RegExp(token));
});
