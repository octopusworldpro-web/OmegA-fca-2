"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createClient } = require("../src/api/client");

test("client accepts a valid AppState and exposes a narrow API facade", async () => {
  const client = createClient({
    authenticate: async ({ mode, credentials }) => {
      assert.equal(mode, "appstate");
      assert.equal(credentials[0].key, "c_user");
      return {
        getCurrentUserID: () => "123456",
        sendMessage: async () => ({ messageID: "m1" }),
        listen: () => () => {},
        disconnect: async () => {}
      };
    }
  });
  const api = await client.login({ mode: "appstate", appState: [
    { key: "c_user", value: "123456", domain: "facebook.com" },
    { key: "xs", value: "synthetic-session-value", domain: "facebook.com" }
  ] });
  assert.equal(api.getCurrentUserID(), "123456");
  assert.equal(typeof api.sendMessage, "function");
  assert.equal(typeof api.listen, "function");
  await client.logout();
  assert.equal(client.getConnectionState().state, "idle");
});

test("client rejects a session without required auth cookies", async () => {
  const client = createClient({ requireLicense: false, authenticate: async () => ({}) });
  await assert.rejects(client.login({ mode: "appstate", appState: [
    { key: "c_user", value: "123456", domain: "facebook.com" }
  ] }), /c_user and xs/);
});

test("client rejects missing login mode", async () => {
  const client = createClient({ requireLicense: false, authenticate: async () => ({}) });
  await assert.rejects(client.login({}), /Login mode/);
});

test("client enforces owner-signed licensing when explicitly enabled", async () => {
  const client = createClient({ requireLicense: true, authenticate: async () => ({}) });
  await assert.rejects(client.login({ mode: "credentials", email: "demo@example.com", password: "not-a-real-password" }), /License token is missing/);
});


test("GoatBot MQTT callback receives (error, event) and can stop listening", async () => {
  let transportCallback;
  let detached = 0;
  const client = createClient({
    requireLicense: false,
    authenticate: async () => ({
      getCurrentUserID: () => "123456",
      listen(callback) {
        transportCallback = callback;
        return () => { detached++; };
      },
      disconnect: async () => {}
    })
  });
  const api = await client.login({ mode: "appstate", appState: [
    { key: "c_user", value: "123456", domain: "facebook.com" },
    { key: "xs", value: "synthetic-session-value", domain: "facebook.com" }
  ] });
  const received = [];
  api.listenMqtt((error, event) => received.push({ error, event }));
  transportCallback(null, { type: "message", messageID: "m1" });
  assert.equal(received[0].error, null);
  assert.equal(received[0].event.messageID, "m1");
  api.stopListening();
  assert.equal(detached, 1);
  await client.logout();
});


test("client refreshes and verifies an owner license before transport authentication", async () => {
  const crypto = require("node:crypto");
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "OmegA-License-Service",
    aud: "OmegA-FCA",
    licenseId: "lic_0123456789abcdef0123456789abcdef",
    ownerId: "owner-test",
    installationId: "install-test",
    iat: now,
    exp: now + 900,
    features: ["messaging"]
  };
  const bytes = Buffer.from(JSON.stringify(payload));
  const token = bytes.toString("base64url") + "." + crypto.sign(null, bytes, privateKey).toString("base64url");
  let refreshCount = 0;
  let authenticated = false;
  const client = createClient({
    requireLicense: true,
    license: {
      refresh: async () => { refreshCount++; return token; },
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
      installationId: "install-test",
      ownerId: "owner-test",
      checkIntervalMs: 30_000
    },
    authenticate: async ({ license }) => {
      authenticated = true;
      assert.equal(license.licenseId, payload.licenseId);
      return { getCurrentUserID: () => "123456", listen: () => () => {}, disconnect: async () => {} };
    }
  });
  await client.login({ mode: "appstate", appState: [
    { key: "c_user", value: "123456", domain: "facebook.com" },
    { key: "xs", value: "synthetic-session-value", domain: "facebook.com" }
  ] });
  assert.equal(refreshCount, 1);
  assert.equal(authenticated, true);
  await client.logout();
});


test("client enforces feature entitlements for methods and event listeners", async () => {
  const crypto = require("node:crypto");
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: "OmegA-License-Service", aud: "OmegA-FCA",
    licenseId: "lic_0123456789abcdef0123456789abcdef",
    ownerId: "owner-test", installationId: "install-test",
    iat: now, exp: now + 900, features: ["messaging"]
  };
  const bytes = Buffer.from(JSON.stringify(payload));
  const token = bytes.toString("base64url") + "." + crypto.sign(null, bytes, privateKey).toString("base64url");
  const client = createClient({
    requireLicense: true,
    license: {
      token,
      publicKey: publicKey.export({ type: "spki", format: "pem" }).toString(),
      installationId: "install-test", ownerId: "owner-test"
    },
    authenticate: async () => ({
      getCurrentUserID: () => "123456",
      sendMessage: async () => "sent",
      getThreadInfo: async () => ({}),
      listen: () => () => {},
      disconnect: async () => {}
    })
  });
  const api = await client.login({ mode: "appstate", appState: [
    { key: "c_user", value: "123456", domain: "facebook.com" },
    { key: "xs", value: "synthetic-session-value", domain: "facebook.com" }
  ] });
  assert.equal(await api.sendMessage("hello"), "sent");
  await assert.rejects(api.getThreadInfo("thread-1"), { code: "FCA_LICENSE_FEATURE_DENIED" });
  assert.throws(() => api.listenMqtt(() => {}), /events feature/);
  await client.logout();
});


test("client rejects overlapping login attempts", async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const client = createClient({
    requireLicense: false,
    reconnect: { maxAttempts: 1 },
    authenticate: async () => {
      await gate;
      return { listen: () => () => {}, disconnect: async () => {} };
    }
  });
  const credentials = { mode: "appstate", appState: [
    { key: "c_user", value: "123456", domain: "facebook.com" },
    { key: "xs", value: "synthetic-session-value", domain: "facebook.com" }
  ] };
  const first = client.login(credentials);
  await new Promise(resolve => setImmediate(resolve));
  await assert.rejects(client.login(credentials), /already in progress/);
  release();
  await first;
  await client.logout();
});

test("client preserves safe realtime transport failure codes after AppState validation", async () => {
  const client = createClient({
    requireLicense: false,
    authenticate: async () => {
      const error = new Error("provider detail must not be exposed");
      error.code = "FCA_MQTT_CONNACK_REJECTED";
      error.retryable = false;
      throw error;
    }
  });
  await assert.rejects(
    client.login({ mode: "appstate", appState: [
      { key: "c_user", value: "123456", domain: "facebook.com" },
      { key: "xs", value: "synthetic-session-value", domain: "facebook.com" }
    ] }),
    error => {
      assert.equal(error.code, "FCA_MQTT_CONNACK_REJECTED");
      assert.match(error.message, /session was accepted, but Messenger realtime setup failed/);
      assert.equal(error.retryable, false);
      assert.equal(error.message.includes("provider detail"), false);
      return true;
    }
  );
});

test("client does not expose arbitrary provider error codes or messages", async () => {
  const client = createClient({
    requireLicense: false,
    authenticate: async () => {
      const error = new Error("private cookie value");
      error.code = "PRIVATE_PROVIDER_SECRET";
      throw error;
    }
  });
  await assert.rejects(
    client.login({ mode: "appstate", appState: [
      { key: "c_user", value: "123456", domain: "facebook.com" },
      { key: "xs", value: "synthetic-session-value", domain: "facebook.com" }
    ] }),
    error => {
      assert.equal(error.code, "FCA_AUTHENTICATION_FAILED");
      assert.equal(error.message, "Authentication failed; inspect provider diagnostics securely");
      assert.equal(error.message.includes("private cookie value"), false);
      return true;
    }
  );
});


test("client facade forwards native httpGet Promise and callback signatures", async () => {
  const calls = [];
  const client = createClient({
    requireLicense: false,
    authenticate: async () => ({
      getCurrentUserID: () => "123456",
      httpGet(url, query, callback) {
        if (typeof query === "function") {
          callback = query;
          query = undefined;
        }
        calls.push({ url, query });
        if (typeof callback === "function") {
          callback(null, "callback response");
          return undefined;
        }
        return Promise.resolve("promise response");
      },
      listen: () => () => {},
      disconnect: async () => {}
    })
  });
  const api = await client.login({ mode: "appstate", appState: [
    { key: "c_user", value: "123456", domain: "facebook.com" },
    { key: "xs", value: "synthetic-session-value", domain: "facebook.com" }
  ] });

  assert.equal(await api.httpGet("https://www.facebook.com/", { __a: 1 }), "promise response");
  assert.deepEqual(calls[0], { url: "https://www.facebook.com/", query: { __a: 1 } });

  const callbackResult = await new Promise((resolve, reject) => {
    const returned = api.httpGet("https://www.facebook.com/", (error, value) => {
      if (error) reject(error);
      else resolve(value);
    });
    assert.equal(returned, undefined);
  });
  assert.equal(callbackResult, "callback response");
  assert.deepEqual(calls[1], { url: "https://www.facebook.com/", query: undefined });
  await client.logout();
});

test("legacy sendMessage accepts a reply ID in the third argument when callback is omitted", async () => {
  let captured;
  const client = createClient({
    requireLicense: false,
    authenticate: async () => ({
      getCurrentUserID: () => "123456",
      sendMessage: async input => { captured = input; return { messageID: "m2" }; },
      listen: () => () => {},
      disconnect: async () => {}
    })
  });
  const api = await client.login({ mode: "appstate", appState: [
    { key: "c_user", value: "123456", domain: "facebook.com" },
    { key: "xs", value: "synthetic-session-value", domain: "facebook.com" }
  ] });
  await api.sendMessage("reply body", "987654321", "mid.reply-target");
  assert.deepEqual(captured, {
    threadID: "987654321",
    message: "reply body",
    replyToMessageID: "mid.reply-target"
  });
  await client.logout();
});

test("client exposes legacy media, link and location send helpers", async () => {
  const sent = [];
  const client = createClient({
    requireLicense: false,
    authenticate: async () => ({
      getCurrentUserID: () => "123456",
      sendMessage: async input => { sent.push(input); return { messageID: "m" + sent.length }; },
      listen: () => () => {},
      disconnect: async () => {}
    })
  });
  const api = await client.login({ mode: "appstate", appState: [
    { key: "c_user", value: "123456", domain: "facebook.com" },
    { key: "xs", value: "synthetic-session-value", domain: "facebook.com" }
  ] });
  await api.sendLocation(23.8, 90.4, "987654321");
  await api.sendImage(Buffer.from("image"), "987654321", "caption");
  await api.sendGif("https://media.example.test/clip.gif", "987654321", "gif caption");
  await api.shareLink("https://example.test/page", "987654321", "link caption");
  assert.deepEqual(sent[0].message, { location: { latitude: 23.8, longitude: 90.4 } });
  assert.deepEqual(sent[1].message, { body: "caption", attachment: Buffer.from("image") });
  assert.deepEqual(sent[2].message, { body: "gif caption", url: "https://media.example.test/clip.gif" });
  assert.deepEqual(sent[3].message, { body: "link caption", url: "https://example.test/page" });
  await client.logout();
});

test("FCA API exposes logout with Promise and callback forms", async () => {
  let disconnected = 0;
  const client = createClient({
    requireLicense: false,
    authenticate: async () => ({
      getCurrentUserID: () => "123456",
      listen: () => () => {},
      disconnect: async () => { disconnected++; }
    })
  });
  const api = await client.login({ mode: "appstate", appState: [
    { key: "c_user", value: "123456", domain: "facebook.com" },
    { key: "xs", value: "synthetic-session-value", domain: "facebook.com" }
  ] });
  assert.equal(typeof api.logout, "function");
  await new Promise((resolve, reject) => {
    const returned = api.logout(error => error ? reject(error) : resolve());
    assert.equal(returned, undefined);
  });
  assert.equal(disconnected, 1);
  assert.equal(client.getConnectionState().state, "idle");
});

test("FCA API exposes E2EE namespace and legacy group creation alias", async () => {
  const calls = [];
  let connected = false;
  const client = createClient({
    requireLicense: false,
    authenticate: async () => ({
      getCurrentUserID: () => "123456",
      getE2EEStatus: () => ({ connected, deviceId: 1, persistentStorage: false, storageEncrypted: false }),
      connectE2EE: async () => { connected = true; return { userId: "123456", deviceId: 1 }; },
      disconnectE2EE: () => { connected = false; return true; },
      isE2EEThread: id => id === "987654321",
      sendE2EEMessage: async (...args) => { calls.push(["send", ...args]); return "encrypted"; },
      createNewGroup: async (...args) => { calls.push(["group", ...args]); return "555555555"; },
      listen: () => () => {},
      disconnect: async () => {}
    })
  });
  const api = await client.login({ mode: "appstate", appState: [
    { key: "c_user", value: "123456", domain: "facebook.com" },
    { key: "xs", value: "synthetic-session-value", domain: "facebook.com" }
  ] });
  assert.equal(api.e2ee.isConnected(), false);
  await api.e2ee.connect();
  assert.equal(api.e2ee.isConnected(), true);
  assert.equal(api.e2ee.isThread("987654321"), true);
  assert.equal(await api.e2ee.sendMessage("987654321", "secret"), "encrypted");
  assert.equal(await api.createGroup("Test Group", ["111111111", "222222222"]), "555555555");
  assert.deepEqual(calls[0], ["send", "987654321", "secret"]);
  assert.deepEqual(calls[1], ["group", ["111111111", "222222222"], "Test Group", undefined]);
  assert.equal(api.e2ee.disconnect(), true);
  assert.equal(api.e2ee.isConnected(), false);
  await client.logout();
});

test("addExternalModule safely registers non-conflicting bound API extensions", async () => {
  const client = createClient({
    requireLicense: false,
    authenticate: async () => ({
      getCurrentUserID: () => "123456",
      listen: () => () => {},
      disconnect: async () => {}
    })
  });
  const api = await client.login({ mode: "appstate", appState: [
    { key: "c_user", value: "123456", domain: "facebook.com" },
    { key: "xs", value: "synthetic-session-value", domain: "facebook.com" }
  ] });
  assert.deepEqual(api.addExternalModule({
    customIdentity() { return this.getCurrentUserID(); },
    customValue() { return 42; }
  }), ["customIdentity", "customValue"]);
  assert.equal(api.customIdentity(), "123456");
  assert.equal(api.customValue(), 42);
  assert.throws(() => api.addExternalModule({ sendMessage() {} }), /invalid, duplicate, or reserved/);
  assert.throws(() => api.addExternalModule({ bad: "not a function" }), /invalid, duplicate, or reserved/);
  await client.logout();
});

test("FCA facade exposes profile, public-data and avatar compatibility helpers", async () => {
  const client = createClient({
    requireLicense: false,
    authenticate: async () => ({
      getCurrentUserID: () => "123456",
      getUserInfo: async ids => Object.fromEntries((Array.isArray(ids) ? ids : [ids]).map(id => [
        String(id), { name: "Example User", thumbSrc: "https://scontent.xx.fbcdn.net/avatar.jpg" }
      ])),
      listen: () => () => {},
      disconnect: async () => {}
    })
  });
  const api = await client.login({ mode: "appstate", appState: [
    { key: "c_user", value: "123456", domain: "facebook.com" },
    { key: "xs", value: "synthetic-session-value", domain: "facebook.com" }
  ] });
  assert.equal((await api.getProfileInfo("987654321"))["987654321"].name, "Example User");
  assert.equal((await api.getPublicData("987654321"))["987654321"].name, "Example User");
  assert.equal(await api.getAvatarUser("987654321"), "https://scontent.xx.fbcdn.net/avatar.jpg");
  await new Promise((resolve, reject) => {
    api.getAvatarUser("987654321", (error, value) => error ? reject(error) : resolve(value));
  });
  await client.logout();
});


test("client supports EryXen addExternalModule(name, factory) and preserves object form", async () => {
  const client = createClient({
    authenticate: async () => ({
      getCurrentUserID: () => "123456",
      listen: () => () => {},
      disconnect: async () => {}
    })
  });
  const api = await client.login({ mode: "appstate", appState: [
    { key: "c_user", value: "123456", domain: "facebook.com" },
    { key: "xs", value: "synthetic-session-value", domain: "facebook.com" }
  ] });
  let received;
  assert.equal(api.addExternalModule("hello", (defaultFuncs, suppliedApi, context) => {
    received = { defaultFuncs, suppliedApi, context };
    return function (suffix) { return suppliedApi.getCurrentUserID() + suffix; };
  }), "hello");
  assert.equal(api.hello("!"), "123456!");
  assert.equal(received.suppliedApi, api);
  assert.deepEqual(received.context, { userID: "123456" });
  assert.deepEqual(Object.keys(received.defaultFuncs).sort(), ["httpGet", "httpPost", "httpPostFormData"]);
  assert.deepEqual(api.addExternalModule({ omegaHelper: () => "ok" }), ["omegaHelper"]);
  assert.equal(api.omegaHelper(), "ok");
  assert.throws(() => api.addExternalModule("invalid", () => ({})), /must return a function/);
  await client.logout();
});
