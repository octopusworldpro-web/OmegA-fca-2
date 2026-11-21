"use strict";

const { loadAccountConfig } = require("../auth/accountConfig");
const { parseNetscapeCookies } = require("../security/cookies");
const { generateTotp } = require("../auth/totp");

function fromAccountConfig(config) {
  if (config.mode === "appstate") return { mode: "appstate", appState: config.appState };
  return {
    mode: "credentials",
    ...(config.username ? { username: config.username } : { email: config.email }),
    password: config.password,
    twoFactorSecret: config.twoFactorSecret || null,
    twoFactorCode: config.twoFactorSecret ? generateTotp(config.twoFactorSecret) : null,
    userAgent: config.userAgent || null,
    proxy: config.proxy || null
  };
}

function createGoatBotLogin(client, accountConfigOptions = {}) {
  if (!client || typeof client.login !== "function") throw new TypeError("OmegA-FCA client is required");

  return function goatBotLogin(credentials, options, callback) {
    if (typeof options === "function") {
      callback = options;
      options = {};
    }
    if (typeof callback !== "function") throw new TypeError("GoatBot login callback is required");
    const input = credentials && typeof credentials === "object" ? credentials : {};
    let loginInput;
    try {
      if (input.mode === "session") {
        loginInput = { mode: "session" };
      } else if (Array.isArray(input.appState)) {
        loginInput = { mode: "appstate", appState: input.appState };
      } else if (Array.isArray(input.cookies)) {
        // EryXen/GoatBot integrations commonly name the same cookie array
        // "cookies" rather than "appState". Preserve it as AppState input.
        loginInput = { mode: "appstate", appState: input.cookies };
      } else if (input.mode === "cookie" || typeof input.cookie === "string") {
        if (typeof input.cookie !== "string" || !input.cookie.trim()) {
          throw new TypeError("Cookie login requires a non-empty Cookie header");
        }
        loginInput = { mode: "cookie", cookie: input.cookie };
      } else if (input.mode === "netscape" ||
          typeof input.netscape === "string" ||
          typeof input.netscapeCookies === "string") {
        const netscapeText = typeof input.netscape === "string" ? input.netscape : input.netscapeCookies;
        loginInput = { mode: "appstate", appState: parseNetscapeCookies(netscapeText) };
      } else if ((typeof input.username === "string" || typeof input.email === "string") &&
          typeof (input.password || input.pass) === "string") {
        loginInput = {
          mode: "credentials",
          ...(typeof input.username === "string" && input.username.trim()
            ? { username: input.username.trim() }
            : { email: input.email }),
          password: input.password || input.pass,
          twoFactorSecret: input.twoFactorSecret || input["2FASecret"] || null,
          twoFactorCode: input.twoFactorCode || input.twoFactorCodeOrCode || input.twoFactorSecretOrCode || input["2FACode"] || ((input.twoFactorSecret || input["2FASecret"]) ? generateTotp(input.twoFactorSecret || input["2FASecret"]) : null),
          userAgent: input.userAgent || null,
          proxy: input.proxy || null
        };
      } else if (Object.keys(input).length === 0) {
        // account.txt/appstate.json are parsed by the same compatibility loader.
        // account.txt supports cookie headers, Netscape exports and JSON arrays.
        loginInput = fromAccountConfig(loadAccountConfig(accountConfigOptions));
      } else {
        const error = new TypeError("GoatBot login requires AppState, cookies, a Cookie header, Netscape cookies, or an empty input to load account.txt/appstate.json");
        error.retryable = false;
        callback(error);
        return Promise.resolve(null);
      }
    } catch (error) {
      callback(error);
      return Promise.resolve(null);
    }

    return client.login(loginInput, options || {}).then(
      api => { callback(null, api); return api; },
      error => { callback(error); return null; }
    );
  };
}

module.exports = { createGoatBotLogin };
