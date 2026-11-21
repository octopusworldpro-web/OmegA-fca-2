"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createClient } = require("../src/api/client");

test("AppState and cookie login remain the only enabled login modes", async () => {
  let received;
  const client = createClient({
    authenticate: async context => {
      received = context;
      return { listen: () => () => {}, disconnect: async () => {} };
    }
  });
  const appState = [
    { key: "c_user", value: "123456", domain: "facebook.com" },
    { key: "xs", value: "synthetic-session-value", domain: "facebook.com" }
  ];
  await client.login({ mode: "appstate", appState });
  assert.equal(received.mode, "appstate");
  await client.logout();
});

test("username/password and email/password login are explicitly deferred", async () => {
  let authenticationCalls = 0;
  const client = createClient({
    authenticate: async () => {
      authenticationCalls++;
      return { listen: () => () => {}, disconnect: async () => {} };
    }
  });
  await assert.rejects(
    client.login({ mode: "credentials", username: "owner_handle", password: "synthetic-password" }),
    /login is deferred/
  );
  await assert.rejects(
    client.login({ mode: "credentials", email: "owner@example.test", password: "synthetic-password" }),
    /login is deferred/
  );
  assert.equal(authenticationCalls, 0);
});

test("client rejects credential login even when only a password is supplied", async () => {
  const client = createClient({ authenticate: async () => ({}) });
  await assert.rejects(
    client.login({ mode: "credentials", password: "synthetic-password" }),
    /login is deferred/
  );
});


test("autoReconnect false makes one connection attempt and rejects invalid option types", async () => {
  let attempts = 0;
  const client = createClient({
    authenticate: async () => {
      attempts++;
      const error = new Error("temporary synthetic transport failure");
      error.retryable = true;
      throw error;
    }
  });
  const appState = [
    { key: "c_user", value: "123456", domain: "facebook.com" },
    { key: "xs", value: "synthetic-session-value", domain: "facebook.com" }
  ];
  await assert.rejects(client.login({ mode: "appstate", appState }, { autoReconnect: false }), /Authentication failed/);
  assert.equal(attempts, 1);
  await assert.rejects(client.login({ mode: "appstate", appState }, { autoReconnect: "false" }), /autoReconnect must be a boolean/);
});
