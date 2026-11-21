"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseAccountText, loadAccountConfig } = require("../src/auth/accountConfig");

function withRoot(run) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "omega-fca-account-"));
  try { run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

const cookie = "c_user=123456789; xs=session-cookie-value";

test("account.txt contains only a raw cookie header", () => {
  const parsed = parseAccountText(cookie);
  assert.equal(parsed.find(item => item.key === "c_user").value, "123456789");
  assert.throws(() => parseAccountText("fb_email=a@example.test\nfb_password=secret"), new RegExp("account.txt is AppState/cookie-only"));
});

test("account.txt takes precedence and credentials are never loaded in AppState-only mode", () => withRoot(root => {
  fs.writeFileSync(path.join(root, "account.txt"), cookie);
  fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ facebookAccount: { fb_email: "owner@example.test", password: "secret" } }));
  const config = loadAccountConfig({ cwd: root, env: { FB_EMAIL: "env@example.test", FB_PASSWORD: "env-secret" } });
  assert.equal(config.mode, "appstate");
  assert.equal(config.source, "account.txt");
  assert.equal(config.appState.length, 2);
}));

test("rejects credentials-only configuration while AppState login is the active mode", () => withRoot(root => {
  fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ facebookAccount: { fb_email: "owner@example.test", password: "secret" } }));
  assert.throws(() => loadAccountConfig({ cwd: root, env: { FB_EMAIL: "env@example.test", FB_PASSWORD: "env-secret" } }), error => error.code === "FCA_ACCOUNT_CONFIG_MISSING");
}));

test("loads AppState JSON as backward-compatible fallback", () => withRoot(root => {
  const state = [{ key: "c_user", value: "123456789", domain: "facebook.com" }, { key: "xs", value: "session-cookie-value", domain: "facebook.com" }];
  fs.writeFileSync(path.join(root, "appstate.json"), JSON.stringify(state));
  const config = loadAccountConfig({ cwd: root, env: {} });
  assert.equal(config.mode, "appstate");
  assert.deepEqual(config.appState, state.map(cookie => ({ ...cookie, path: "/", hostOnly: false, secure: false, httpOnly: false })));
}));

test("does not read credential config while loading AppState", () => withRoot(root => {
  const state = [{ key: "c_user", value: "123456789", domain: "facebook.com" }, { key: "xs", value: "session-cookie-value", domain: "facebook.com" }];
  fs.writeFileSync(path.join(root, "appstate.json"), JSON.stringify(state));
  fs.writeFileSync(path.join(root, "config.json"), "{ invalid credential config");
  const config = loadAccountConfig({ cwd: root, env: {} });
  assert.equal(config.mode, "appstate");
  assert.equal(config.source, "appstate.json");
}));

test("ignores credential configuration during AppState-only phase and rejects paths outside project root", () => withRoot(root => {
  fs.writeFileSync(path.join(root, "config.json"), JSON.stringify({ facebookAccount: { email: "owner@example.test" } }));
  assert.throws(
    () => loadAccountConfig({ cwd: root, env: { FB_EMAIL: "env@example.test", FB_PASSWORD: "secret" } }),
    error => error.code === "FCA_ACCOUNT_CONFIG_MISSING"
  );
  assert.throws(() => loadAccountConfig({ cwd: root, accountFile: "../outside.txt", env: {} }), /inside the project root/);
}));

test("rejects account symlinks that escape project root", () => withRoot(root => {
  const outside = path.join(os.tmpdir(), "omega-fca-outside-" + process.pid + ".txt");
  fs.writeFileSync(outside, cookie);
  try {
    fs.symlinkSync(outside, path.join(root, "account.txt"));
    assert.throws(() => loadAccountConfig({ cwd: root, env: {} }), /resolve inside the project root/);
  } finally { fs.rmSync(outside, { force: true }); }
}));

test("rejects credential-style account.txt keys with whitespace around equals", () => {
  for (const line of [
    "fb_email = owner@example.test",
    "email=owner@example.test",
    "fb_username = owner",
    "username=owner",
    "fb_password = secret",
    "password=secret",
    "2FASecret = synthetic"
  ]) {
    assert.throws(() => parseAccountText(line), new RegExp("account.txt is AppState/cookie-only"));
  }
});


test("account.txt recognizes EAAAA access tokens without treating them as cookies", () => withRoot(root => {
  const token = "EAAAA" + "A".repeat(64);
  fs.writeFileSync(path.join(root, "account.txt"), token);
  const config = loadAccountConfig({ cwd: root, env: {} });
  assert.deepEqual(config, { mode: "token", accessToken: token, source: "account.txt" });
  assert.throws(() => parseAccountText(token), /exchanged asynchronously/);
}));
