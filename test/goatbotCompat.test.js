"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createGoatBotLogin } = require("../src/compat/goatbotLogin");

test("adapts GoatBot AppState login signature to the client contract", async () => {
  let received;
  const client = {
    async login(credentials, options) {
      received = { credentials, options };
      return { getCurrentUserID: () => "123456", listenMqtt: () => {} };
    }
  };
  const login = createGoatBotLogin(client);
  let callbackResult;
  const api = await login(
    { appState: [{ key: "c_user", value: "123456" }] },
    { userAgent: "synthetic-agent" },
    (error, value) => { callbackResult = { error, value }; }
  );
  assert.equal(received.credentials.mode, "appstate");
  assert.equal(received.options.userAgent, "synthetic-agent");
  assert.equal(callbackResult.error, null);
  assert.equal(callbackResult.value, api);
});

test("rejects GoatBot credential login and manual 2FA instead of forwarding secrets", async () => {
  let called = false;
  const login = createGoatBotLogin({
    async login() { called = true; return { ok: true }; }
  });
  let failure;
  const result = await login(
    { email: "demo@example.com", pass: "synthetic-password", "2FASecret": "synthetic-2fa" },
    {},
    error => { failure = error; }
  );
  assert.equal(result, null);
  assert.equal(failure.code, "FCA_CREDENTIAL_LOGIN_UNSUPPORTED");
  assert.equal(failure.retryable, false);
  assert.equal(called, false);
});
