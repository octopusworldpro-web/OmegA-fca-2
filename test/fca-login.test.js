"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFcaLogin } = require("../src/compat/fcaLogin");

function fakeClient({ result, failure } = {}) {
  const calls = [];
  return {
    calls,
    login: async (credentials, options) => {
      calls.push({ credentials, options });
      if (failure) throw failure;
      return result;
    },
    logout: callback => {
      calls.push({ logout: true });
      if (typeof callback === "function") callback(null);
      else return Promise.resolve();
    },
    getConnectionState: () => ({ state: "connected", connected: true, generation: 1 }),
    getLicense: () => null
  };
}

const appState = [
  { key: "c_user", value: "123456789" },
  { key: "xs", value: "synthetic-session" }
];

test("EryXen-style login(credentials, options, callback) maps AppState and options", async () => {
  const api = { getCurrentUserID: () => "123456789", listenMqtt() {} };
  const client = fakeClient({ result: api });
  const fca = createFcaLogin({ client });
  const received = [];

  const result = await fca.login({ appState }, { selfListen: true, listenEvents: true },
    (error, value) => received.push({ error, value }));

  assert.equal(result, api);
  assert.deepEqual(client.calls[0], {
    credentials: { mode: "appstate", appState },
    options: { selfListen: true, listenEvents: true }
  });
  assert.deepEqual(received, [{ error: null, value: api }]);
});

test("EryXen-style login(credentials, callback) supports the two-argument overload", async () => {
  const api = {};
  const client = fakeClient({ result: api });
  const fca = createFcaLogin({ client });
  let callbackApi;

  await fca.login({ appState }, (error, value) => {
    assert.equal(error, null);
    callbackApi = value;
  });

  assert.equal(callbackApi, api);
  assert.deepEqual(client.calls[0].options, {});
});

test("login without callback returns a Promise that resolves to the API", async () => {
  const api = {};
  const client = fakeClient({ result: api });
  const fca = createFcaLogin({ client });

  assert.equal(await fca.login({ appState }, { userAgent: "test-agent" }), api);
  assert.deepEqual(client.calls[0].credentials, { mode: "appstate", appState });
});

test("Promise login rejects with the original authentication error", async () => {
  const failure = new Error("synthetic authentication failure");
  const fca = createFcaLogin({ client: fakeClient({ failure }) });

  await assert.rejects(fca.login({ appState }), error => error === failure);
});

test("callback login reports authentication errors through error-first callback", async () => {
  const failure = new Error("synthetic authentication failure");
  const fca = createFcaLogin({ client: fakeClient({ failure }) });
  let received;

  await fca.login({ appState }, (error, api) => { received = { error, api }; });

  assert.deepEqual(received, { error: failure, api: undefined });
});

test("login validates callback and options without invoking the client", () => {
  const client = fakeClient({ result: {} });
  const fca = createFcaLogin({ client });

  assert.throws(() => fca.login({ appState }, {}, "not-a-callback"), /callback must be a function/);
  assert.throws(() => fca.login({ appState }, "invalid-options"), /options must be an object/);
  assert.equal(client.calls.length, 0);
});

test("FCA login controller exposes logout and connection state", async () => {
  const client = fakeClient({ result: {} });
  const fca = createFcaLogin({ client });

  assert.deepEqual(fca.getConnectionState(), { state: "connected", connected: true, generation: 1 });
  assert.equal(fca.getLicense(), null);
  await fca.logout();
  assert.deepEqual(client.calls.at(-1), { logout: true });
});
