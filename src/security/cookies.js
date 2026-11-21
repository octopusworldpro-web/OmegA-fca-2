"use strict";

const MAX_COOKIE_COUNT = 500;
const MAX_COOKIE_VALUE_LENGTH = 16_000;
const FACEBOOK_DOMAINS = new Set(["facebook.com", "www.facebook.com", "m.facebook.com", "messenger.com"]);

function normalizeDomain(domain) {
  if (typeof domain !== "string" || !domain.trim()) throw new TypeError("Cookie domain is required");
  const value = domain.trim().toLowerCase().replace(/^\./, "");
  if (!FACEBOOK_DOMAINS.has(value) && !value.endsWith(".facebook.com") && !value.endsWith(".messenger.com")) {
    throw new TypeError("Only Facebook/Messenger cookie domains are accepted");
  }
  return value;
}

function normalizeCookies(input) {
  if (!Array.isArray(input) || input.length < 1 || input.length > MAX_COOKIE_COUNT) {
    throw new TypeError("Cookies must be a non-empty array (maximum 500 entries)");
  }
  const seen = new Set();
  const result = input.map((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) throw new TypeError("Invalid cookie entry");
    const key = typeof item.key === "string" ? item.key : item.name;
    if (typeof key !== "string" || !/^[A-Za-z0-9_-]{1,80}$/.test(key)) throw new TypeError("Invalid cookie name");
    if (typeof item.value !== "string" || !item.value || item.value.length > MAX_COOKIE_VALUE_LENGTH || !/^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]+$/.test(item.value)) throw new TypeError("Invalid cookie value");
    const rawDomain = item.domain || "facebook.com";
    const domain = normalizeDomain(rawDomain);
    const path = item.path === undefined ? "/" : item.path;
    if (typeof path !== "string" || !path.startsWith("/") || path.length > 1024) throw new TypeError("Invalid cookie path");
    // EryXen/tough-cookie AppState exports Date objects and the string
    // "Infinity" for session cookies. Browser exports commonly use
    // expirationDate in seconds or milliseconds. Normalize all supported
    // forms to Unix seconds; session cookies omit expiry metadata.
    const expiryInput = item.expires !== undefined ? item.expires : item.expirationDate;
    let expires = null;
    if (expiryInput !== undefined && expiryInput !== null && expiryInput !== 0 &&
        expiryInput !== "Infinity" && expiryInput !== "Session") {
      if (expiryInput instanceof Date) {
        const timestamp = expiryInput.getTime();
        if (!Number.isFinite(timestamp) || timestamp < 0) throw new TypeError("Invalid cookie expiry");
        expires = Math.floor(timestamp / 1000);
      } else if (typeof expiryInput === "number" && Number.isFinite(expiryInput) && expiryInput >= 0) {
        expires = Math.floor(expiryInput >= 1e12 ? expiryInput / 1000 : expiryInput);
      } else if (typeof expiryInput === "string" && /^\\d+$/.test(expiryInput)) {
        const timestamp = Number(expiryInput);
        if (!Number.isSafeInteger(timestamp)) throw new TypeError("Invalid cookie expiry");
        expires = Math.floor(timestamp >= 1e12 ? timestamp / 1000 : timestamp);
      } else {
        throw new TypeError("Invalid cookie expiry");
      }
      if (!Number.isSafeInteger(expires) || expires < 0) throw new TypeError("Invalid cookie expiry");
    }
    const identity = [domain, path, key].join("\n");
    if (seen.has(identity)) throw new TypeError("Duplicate cookie entry");
    seen.add(identity);
    return {
      key,
      value: item.value,
      domain,
      path,
      hostOnly: item.hostOnly === undefined ? false : Boolean(item.hostOnly),
      secure: Boolean(item.secure),
      httpOnly: Boolean(item.httpOnly),
      ...(typeof item.sameSite === "string" ? { sameSite: item.sameSite } : {}),
      ...(expires !== null ? { expires } : {})
    };
  });
  return result;
}

function validateSessionCookies(input) {
  const cookies = normalizeCookies(input);
  const values = new Map(cookies.map(cookie => [cookie.key, cookie.value]));
  if (!/^\d{5,30}$/.test(values.get("c_user") || "") || !values.get("xs")) {
    throw new TypeError("Facebook session requires valid c_user and xs cookies");
  }
  return cookies;
}

function parseCookieHeader(header) {
  if (typeof header !== "string" || !header.trim() || header.length > 64 * 1024) {
    throw new TypeError("Cookie header must be non-empty text up to 64 KiB");
  }
  const entries = header.split(";").map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf("=");
    if (index <= 0) throw new TypeError("Malformed cookie header");
    return { key: part.slice(0, index).trim(), value: part.slice(index + 1).trim(), domain: "facebook.com", path: "/", hostOnly: true };
  });
  // A raw Cookie header has no host-only metadata. Treat imported Facebook cookies as domain-scoped so they reach www.facebook.com as expected.
  return normalizeCookies(entries.map(cookie => ({ ...cookie, hostOnly: false })));
}

function parseNetscapeCookies(text) {
  if (typeof text !== "string" || !text.trim() || text.length > 256 * 1024) throw new TypeError("Netscape cookie file must be non-empty text up to 256 KiB");
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trimStart();
    if (!trimmed) continue;

    // Netscape cookie files use a special comment-like domain prefix for
    // HttpOnly cookies. It is data, not a comment: dropping it silently
    // removes session cookies exported by browsers and cookie managers.
    const httpOnly = trimmed.startsWith("#HttpOnly_");
    if (trimmed.startsWith("#") && !httpOnly) continue;

    const fields = (httpOnly ? trimmed.slice("#HttpOnly_".length) : trimmed).split("\t");
    if (fields.length < 7) throw new TypeError("Malformed Netscape cookie row");
    const [domain, includeSubdomains, path, secure, expires, key, ...valueParts] = fields;
    rows.push({
      key,
      value: valueParts.join("\t"),
      domain,
      path,
      hostOnly: includeSubdomains.toUpperCase() !== "TRUE",
      secure: secure.toUpperCase() === "TRUE",
      httpOnly,
      expires: Number(expires)
    });
  }
  return normalizeCookies(rows);
}

module.exports = { normalizeCookies, validateSessionCookies, parseCookieHeader, parseNetscapeCookies };
