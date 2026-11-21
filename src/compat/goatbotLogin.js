"use strict";

const { loadAccountConfig } = require("../auth/accountConfig");
const { parseNetscapeCookies } = require("../security/cookies");
const { exchangeFacebookAccessToken } = require("../auth/facebookToken");

async function resolveLoginInput(input, accountConfigOptions) {
  if (input.mode === "session") return { mode: "session" };
  if (Array.isArray(input.appState)) return { mode: "appstate", appState: input.appState };
  if (Array.isArray(input.cookies)) return { mode: "appstate", appState: input.cookies };
  if (input.mode === "cookie" || typeof input.cookie === "string") {
    if (typeof input.cookie !== "string" || !input.cookie.trim()) throw new TypeError("Cookie login requires a non-empty Cookie header");
    return { mode: "cookie", cookie: input.cookie };
  }
  if (typeof input.cookieHeader === "string") return { mode: "cookie", cookie: input.cookieHeader };
  if (input.headers && typeof input.headers.Cookie === "string") return { mode: "cookie", cookie: input.headers.Cookie };
  if (input.mode === "netscape" || typeof input.netscape === "string" || typeof input.netscapeCookies === "string") {
    const netscapeText = typeof input.netscape === "string" ? input.netscape : input.netscapeCookies;
    return { mode: "appstate", appState: parseNetscapeCookies(netscapeText) };
  }
  const token = typeof input.accessToken === "string" ? input.accessToken : typeof input.token === "string" ? input.token : null;
  if (token) return { mode: "appstate", appState: await exchangeFacebookAccessToken(token, accountConfigOptions) };
  if ((typeof input.username === "string" || typeof input.email === "string") && typeof (input.password || input.pass) === "string") {
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
