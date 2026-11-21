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

test("GoatBot adapter maps credential aliases without persisting secrets", async () => {
  let received;
  const login = createGoatBotLogin({
    async login(credentials) { received = credentials; return {}; }
  });
  await login({
    email: "owner@example.test",
    pass: "synthetic-password",
    twoFactorSecret: "synthetic-secret",
    twoFactorCode: "123456",
    userAgent: "test-agent",
    proxy: "http://127.0.0.1:8080"
  }, () => {});
  assert.deepEqual(received, {
    mode: "credentials",
    email: "owner@example.test",
    password: "synthetic-password",
    twoFactorSecret: "synthetic-secret",
    twoFactorCode: "123456",
    userAgent: "test-agent",
    proxy: "http://127.0.0.1:8080"
  });
});

test("GoatBot legacy twoFactorSecretOrCode alias maps to a manual code", async () => {
  let received;
  const login = createGoatBotLogin({ async login(credentials) { received = credentials; return {}; } });
  await login({ email: "owner@example.test", password: "example-password", twoFactorSecretOrCode: "654321" }, () => {});
  assert.equal(received.twoFactorCode, "654321");
  assert.equal(received.twoFactorSecret, null);
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

test("GoatBot adapter rejects missing callback and reports unsupported login input", async () => {
  const login = createGoatBotLogin({ login: async () => ({}) });
  assert.throws(() => login({ appState: [] }), /callback is required/);
  let reported;
  assert.equal(await login({ token: "not-supported" }, error => { reported = error; }), null);
  assert.match(reported.message, /requires AppState, credentials, or an empty input/);
  assert.equal(reported.retryable, false);
});

test("GoatBot adapter maps FB_USERNAME instead of email", async () => {
  let received;
  const login = createGoatBotLogin({
    async login(credentials) { received = credentials; return {}; }
  });
  await login({ username: "fb_handle", password: "synthetic-password" }, () => {});
  assert.deepEqual(received, {
    mode: "credentials",
    username: "fb_handle",
    password: "synthetic-password",
    twoFactorSecret: null,
    twoFactorCode: null,
    userAgent: null,
    proxy: null
  });
});

test("GoatBot adapter rejects credentials stored in account.txt", async () => {
  const fs = require("node:fs");
  const os = require("node:os");
  const path = require("node:path");
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omega-goatbot-account-"));
  try {
    fs.writeFileSync(path.join(root, "account.txt"), "fb_email=owner@example.test\\nfb_password=private-password");
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
