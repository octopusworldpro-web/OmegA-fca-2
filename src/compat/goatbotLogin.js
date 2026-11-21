"use strict";

const { loadAccountConfig } = require("../auth/accountConfig");
const { parseNetscapeCookies, parseCookieHeader } = require("../security/cookies");
const { exchangeFacebookAccessToken } = require("../auth/facebookToken");

function parseAppStateInput(value) {
  if (Array.isArray(value)) return { mode: "appstate", appState: value };
  if (typeof value !== "string" || !value.trim()) {
    throw new TypeError("AppState must be a cookie array, JSON cookie array, or Cookie header");
  }
  const source = value.trim();
  if (source.startsWith("[") || source.startsWith("{")) {
    let parsed;
    try { parsed = JSON.parse(source); }
    catch { throw new TypeError("AppState JSON is malformed"); }
    const cookies = Array.isArray(parsed) ? parsed : parsed && (parsed.appState || parsed.cookies);
    if (!Array.isArray(cookies)) throw new TypeError("AppState JSON must contain a cookie array");
    return { mode: "appstate", appState: cookies };
  }
  return { mode: "appstate", appState: parseCookieHeader(source.replace(/^cookie\s*:/i, "").trim()) };
}

function parseCookieInput(value) {
  if (typeof value === "string") {
    const source = value.trim().replace(/^cookie\s*:/i, "").trim();
    return { mode: "appstate", appState: parseCookieHeader(source) };
  }
  if (Array.isArray(value)) {
    if (value.length && value.every(item => typeof item === "string")) {
      return { mode: "appstate", appState: parseCookieHeader(value.join("; ")) };
    }
    return { mode: "appstate", appState: value };
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length || entries.some(([, item]) => typeof item !== "string")) {
      throw new TypeError("Cookie object must contain string values");
    }
    return { mode: "appstate", appState: parseCookieHeader(entries.map(([key, item]) => key + "=" + item).join("; ")) };
  }
  throw new TypeError("Cookie login requires a non-empty Cookie header, cookie array, or cookie object");
}

async function resolveLoginInput(input, accountConfigOptions) {
  if (input.mode === "session") return { mode: "session" };

  if (input.appState !== undefined) return parseAppStateInput(input.appState);
  if (Array.isArray(input.cookies)) return { mode: "appstate", appState: input.cookies };

  const cookieInput = input.cookie !== undefined ? input.cookie
    : input.Cookie !== undefined ? input.Cookie
    : input.cookieHeader !== undefined ? input.cookieHeader
    : input.headers && input.headers.Cookie !== undefined ? input.headers.Cookie
    : undefined;
  if (input.mode === "cookie" || cookieInput !== undefined) return parseCookieInput(cookieInput);

  if (input.mode === "netscape" || typeof input.netscape === "string" || typeof input.netscapeCookies === "string") {
    const netscapeText = typeof input.netscape === "string" ? input.netscape : input.netscapeCookies;
    return { mode: "appstate", appState: parseNetscapeCookies(netscapeText) };
  }

  const token = typeof input.accessToken === "string" ? input.accessToken
    : typeof input.token === "string" ? input.token : null;
  if (token && /^EAAAA[A-Za-z0-9_-]{20,}$/.test(token.trim())) {
    return { mode: "appstate", appState: await exchangeFacebookAccessToken(token, accountConfigOptions) };
  }

  if ((typeof input.username === "string" || typeof input.email === "string" ||
      typeof input.fb_username === "string" || typeof input.fb_email === "string") &&
      typeof (input.password || input.pass || input.fb_password) === "string") {
    const error = new TypeError("Facebook username/password and automated 2FA login are not enabled; supply an authorized AppState, Cookie header, Netscape export, EAAAA access token, or encrypted session");
    error.code = "FCA_CREDENTIAL_LOGIN_UNSUPPORTED";
    error.retryable = false;
    throw error;
  }

  if (Object.keys(input).length === 0) {
    const config = loadAccountConfig(accountConfigOptions);
    if (config.mode === "token") return { mode: "appstate", appState: await exchangeFacebookAccessToken(config.accessToken, accountConfigOptions) };
    return { mode: "appstate", appState: config.appState };
  }

  const error = new TypeError("GoatBot login requires AppState, cookies, a Cookie header, Netscape cookies, an EAAAA access token, or empty input to load account.txt/appstate.json");
  error.code = "FCA_LOGIN_INPUT_UNSUPPORTED";
  error.retryable = false;
  throw error;
}
function createGoatBotLogin(client, accountConfigOptions = {}) {
  if (!client || typeof client.login !== "function") throw new TypeError("OmegA-FCA client is required");
  return function goatBotLogin(credentials, options, callback) {
    if (typeof options === "function") { callback = options; options = {}; }
    if (typeof callback !== "function") throw new TypeError("GoatBot login callback is required");
    const input = credentials && typeof credentials === "object" ? credentials : {};
    return resolveLoginInput(input, accountConfigOptions).then(
      loginInput => client.login(loginInput, options || {}).then(
        api => { callback(null, api); return api; },
        error => { callback(error); return null; }
      ),
      error => { callback(error); return null; }
    );
  };
}

module.exports = { createGoatBotLogin, resolveLoginInput };
