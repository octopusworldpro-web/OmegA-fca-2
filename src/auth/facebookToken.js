"use strict";

const { normalizeCookies } = require("../security/cookies");

const APP_INFO_URL = "https://graph.facebook.com/app";
const SESSION_URL = "https://api.facebook.com/method/auth.getSessionforApp";
const TIMEOUT_MS = 15_000;

async function readJson(response) {
  if (!response || typeof response.json !== "function") throw new TypeError("Facebook token endpoint returned an invalid response");
  if (response.ok === false) throw new Error("Facebook token exchange request failed");
  return response.json();
}

async function exchangeFacebookAccessToken(accessToken, {
  fetchImpl = globalThis.fetch,
  timeoutMs = TIMEOUT_MS
} = {}) {
  if (typeof accessToken !== "string" || !/^EAAAA[A-Za-z0-9_-]{20,}$/.test(accessToken.trim())) {
    throw new TypeError("Facebook access token must be a non-empty EAAAA token");
  }
  if (typeof fetchImpl !== "function") throw new TypeError("A Fetch-compatible implementation is required for token login");
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1000 || timeoutMs > 60_000) {
    throw new TypeError("Token exchange timeout must be between 1000 and 60000 ms");
  }

  const token = accessToken.trim();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  if (typeof timer.unref === "function") timer.unref();
  try {
    const appUrl = new URL(APP_INFO_URL);
    appUrl.searchParams.set("access_token", token);
    const appResponse = await fetchImpl(appUrl, {
      method: "GET", headers: { accept: "application/json" }, signal: controller.signal
    });
    const appData = await readJson(appResponse);
    if (!appData || appData.error || !/^[0-9]+$/.test(String(appData.id || ""))) {
      throw new Error("Facebook rejected the supplied access token");
    }

    const sessionUrl = new URL(SESSION_URL);
    sessionUrl.searchParams.set("access_token", token);
    sessionUrl.searchParams.set("format", "json");
    sessionUrl.searchParams.set("new_app_id", String(appData.id));
    sessionUrl.searchParams.set("generate_session_cookies", "1");
    const sessionResponse = await fetchImpl(sessionUrl, {
      method: "GET", headers: { accept: "application/json" }, signal: controller.signal
    });
    const sessionData = await readJson(sessionResponse);
    if (!sessionData || sessionData.error_code || !Array.isArray(sessionData.session_cookies) || sessionData.session_cookies.length === 0) {
      throw new Error("Facebook did not return session cookies for the supplied access token");
    }
    return normalizeCookies(sessionData.session_cookies.map(cookie => ({
      ...cookie,
      key: typeof cookie.key === "string" ? cookie.key : cookie.name,
      domain: cookie.domain || "facebook.com",
      path: cookie.path || "/"
    })));
  } catch (error) {
    if (error && error.name === "AbortError") {
      const timeout = new Error("Facebook access-token exchange timed out");
      timeout.code = "FCA_TOKEN_EXCHANGE_TIMEOUT";
      timeout.retryable = true;
      throw timeout;
    }
    if (error && /rejected the supplied|did not return session cookies|Fetch-compatible|timeout must|token must/.test(error.message || "")) throw error;
    const safe = new Error("Facebook access-token exchange failed; verify the token and retry");
    safe.code = "FCA_TOKEN_EXCHANGE_FAILED";
    safe.retryable = true;
    throw safe;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = { exchangeFacebookAccessToken };
