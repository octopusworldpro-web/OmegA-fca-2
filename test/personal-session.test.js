"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createPersonalSession, detectSessionChallenge, extractIdentity, extractFacebookTokens } = require("../src/auth/personalSession");

const appState = [
  { key: "c_user", value: "123456789012345", domain: ".facebook.com", path: "/", secure: true, httpOnly: true },
  { key: "xs", value: "session-token", domain: ".facebook.com", path: "/", secure: true, httpOnly: true }
];

function response({ status = 200, location = null, html = '<html><script>{"USER_ID":"123456789012345"}</script><body>Home</body></html>', setCookies = [] } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: {
      get(name) {
        if (name.toLowerCase() === "location") return location;
        if (name.toLowerCase() === "content-length") return String(Buffer.byteLength(html));
        if (name.toLowerCase() === "set-cookie") return setCookies.join(", ");
        return null;
      },
      getSetCookie() { return setCookies; }
    },
    async text() { return html; }
  };
}

test("personal session validates owner-supplied AppState and scopes cookies to Facebook HTTPS", async () => {
  let request;
  let calls = 0;
  const session = await createPersonalSession({
    appState,
    fetchImpl: async (url, options) => {
      request = { url, options };
      calls++;
      return calls === 1 ? response() : response({
        setCookies: ["sid=refreshed; Domain=.facebook.com; Path=/; Secure; HttpOnly"]
      });
    }
  });
  assert.equal(session.userId, "123456789012345");
  assert.equal(session.state, "active");
  assert.match(request.options.headers.cookie, /c_user=123456789012345/);
  assert.match(request.options.headers.cookie, /xs=session-token/);
  assert.equal(session.getCookieHeader("https://www.facebook.com/").includes("xs=session-token"), true);
  assert.throws(() => session.getCookieHeader("https://example.com/"), /Facebook\/Messenger HTTPS hosts/);
  await session.request("https://www.facebook.com/messages/", { method: "GET" });
  assert.match(session.getCookieHeader(), /sid=refreshed/);
  await session.request("https://www.facebook.com/messages/", { method: "GET" });
  // The second request response below is configured by a dedicated test for deletion semantics.
  await assert.rejects(session.request("https://example.com/"), /Facebook\/Messenger HTTPS hosts/);
  session.close();
  assert.throws(() => session.getAppState(), /closed/);
});


test("personal session emits sanitized request diagnostics without cookie values", async () => {
  const { createDiagnosticRecorder } = require("../src/security/diagnostics");
  const diagnostics = createDiagnosticRecorder();
  const session = await createPersonalSession({
    appState,
    onDiagnostic: event => diagnostics.record(event),
    fetchImpl: async () => response()
  });
  await session.request("https://www.facebook.com/messages/?access_token=must-not-appear&view=inbox");
  const report = diagnostics.toJSON();
  assert.equal(report.includes("session-token"), false);
  assert.equal(report.includes("123456789012345"), false);
  assert.equal(report.includes("must-not-appear"), false);
  assert.equal(report.includes("inbox"), false);
  assert.match(report, /"method": "GET"/);
  assert.match(report, /"status": 200/);
  session.close();
});

test("initial AppState validation applies rotated and deleted cookies", async () => {
  const session = await createPersonalSession({
    appState,
    fetchImpl: async () => response({ setCookies: [
      "sid=bootstrap-value; Domain=.facebook.com; Path=/; Secure; HttpOnly",
      "old_session=; Domain=.facebook.com; Path=/; Max-Age=0"
    ] })
  });
  const header = session.getCookieHeader();
  assert.match(header, /sid=bootstrap-value/);
  assert.doesNotMatch(header, /old_session=/);
  session.close();
});

test("diagnostic callback receives no raw request headers, body, or query string", async () => {
  const events = [];
  const session = await createPersonalSession({
    appState,
    onDiagnostic: event => events.push(event),
    fetchImpl: async () => response()
  });
  await session.request("https://www.facebook.com/messages/?access_token=private-query", {
    method: "POST",
    headers: { "x-private-header": "private-header" },
    body: "message=private-body"
  });
  const output = JSON.stringify(events);
  for (const secret of ["session-token", "123456789012345", "private-query", "private-header", "private-body"]) {
    assert.equal(output.includes(secret), false);
  }
  assert.equal(events.at(-1).request.url, "https://www.facebook.com/messages/");
  session.close();
});

test("personal session reports checkpoint without attempting a bypass", async () => {
  await assert.rejects(
    createPersonalSession({
      appState,
      fetchImpl: async () => response({ html: "<html>checkpoint_required</html>" })
    }),
    error => error.code === "FCA_CHECKPOINT_REQUIRED" && error.retryable === false
  );
});

test("personal session reports expired AppState on login redirect", async () => {
  await assert.rejects(
    createPersonalSession({
      appState,
      fetchImpl: async () => response({ status: 302, location: "https://www.facebook.com/login.php" })
    }),
    error => error.code === "FCA_SESSION_EXPIRED" && error.sessionState === "logged_out"
  );
});

test("personal session refuses HTTP 200 pages without a verifiable account identity", async () => {
  await assert.rejects(
    createPersonalSession({
      appState,
      fetchImpl: async () => response({ html: "<html><body>Generic success page</body></html>" })
    }),
    error => error.code === "FCA_SESSION_IDENTITY_UNVERIFIED" &&
      error.sessionState === "error" && error.retryable === false
  );
});

test("personal session rejects a different account identity even when HTTP 200", async () => {
  await assert.rejects(
    createPersonalSession({
      appState,
      fetchImpl: async () => response({ html: '<html><script>{"USER_ID":"999999999999999"}</script>Home</html>' })
    }),
    error => error.code === "FCA_SESSION_IDENTITY_MISMATCH" &&
      error.sessionState === "error" && error.retryable === false
  );
});

test("identity extraction is conservative and bounded to numeric Facebook IDs", () => {
  assert.equal(extractIdentity('{"USER_ID":"123456789012345"}'), "123456789012345");
  assert.equal(extractIdentity('{"USER_ID":"not-an-id"}'), null);
  assert.equal(detectSessionChallenge(response(), "<html>home</html>"), "active");
  assert.equal(detectSessionChallenge(response(), "<html>checkpoint_required</html>"), "checkpoint");
});

test("extracts Facebook web request tokens without exposing unrelated page data", () => {
  const html = `
    <input type="hidden" name="fb_dtsg" value="dtsg-token">
    <input type="hidden" name="lsd" value="lsd-token">
    <input type="hidden" name="jazoest" value="22000">
    <script>{"hsi":"987654321","__spin_r":123456,"__spin_b":"trunk","__spin_t":1700000000}</script>
  `;
  assert.deepEqual(extractFacebookTokens(html), {
    fbDtsg: "dtsg-token",
    lsd: "lsd-token",
    jazoest: "22000",
    hsi: "987654321",
    spinR: "123456",
    spinB: "trunk",
    spinT: "1700000000"
  });
  assert.throws(() => extractFacebookTokens("x".repeat(2 * 1024 * 1024 + 1)), /size limit/);
});

test("personal session applies Set-Cookie deletion and supports Messenger cookie domains", async () => {
  let calls = 0;
  const session = await createPersonalSession({
    appState,
    fetchImpl: async () => {
      calls++;
      if (calls === 1) return response();
      if (calls === 2) return response({ setCookies: ["sid=active; Domain=.facebook.com; Path=/; Secure"] });
      return response({ setCookies: ["sid=; Domain=.facebook.com; Path=/; Max-Age=0"] });
    }
  });
  await session.request("https://www.facebook.com/messages/");
  assert.match(session.getCookieHeader(), /sid=active/);
  await session.request("https://www.facebook.com/messages/");
  assert.doesNotMatch(session.getCookieHeader(), /sid=/);
  session.close();
});

test("cookie normalization accepts Messenger subdomains", () => {
  const { normalizeCookies } = require("../src/security/cookies");
  assert.equal(normalizeCookies([{ key: "sid", value: "abc", domain: ".www.messenger.com" }])[0].domain, "www.messenger.com");
});


test("personal session follows safe same-site HTTP redirects and retains rotated cookies", async () => {
  const requests = [];
  const session = await createPersonalSession({
    appState,
    fetchImpl: async (url, options) => {
      requests.push({ url: String(url), cookie: options.headers.cookie });
      if (requests.length === 1) return response({
        status: 302,
        location: "https://m.facebook.com/",
        setCookies: ["route=one; Domain=.facebook.com; Path=/; Secure"]
      });
      return response({ html: '<html><script>{"USER_ID":"123456789012345"}</script>Home</html>' });
    }
  });
  assert.equal(requests.length, 2);
  assert.equal(new URL(requests[1].url).hostname, "m.facebook.com");
  assert.match(requests[1].cookie, /route=one/);
  assert.equal(session.userId, "123456789012345");
  session.close();
});

test("personal session follows safe Facebook meta-refresh redirects", async () => {
  const urls = [];
  const session = await createPersonalSession({
    appState,
    fetchImpl: async url => {
      urls.push(String(url));
      if (urls.length === 1) return response({
        html: '<html><meta http-equiv="refresh" content="0;url=https://www.facebook.com/home.php"></html>'
      });
      return response({ html: '<html><script>{"USER_ID":"123456789012345"}</script>Home</html>' });
    }
  });
  assert.equal(urls.length, 2);
  assert.equal(new URL(urls[1]).pathname, "/home.php");
  session.close();
});

test("personal session refuses redirects outside Facebook/Messenger HTTPS", async () => {
  await assert.rejects(
    createPersonalSession({
      appState,
      fetchImpl: async () => response({ status: 302, location: "https://evil.example/collect" })
    }),
    error => error.code === "FCA_UNEXPECTED_REDIRECT"
  );
});

test("personal session refreshes fb_dtsg and returns only non-secret token metadata", async () => {
  let calls = 0;
  const html = token => '<html><script>{"USER_ID":"123456789012345"}</script><input name="fb_dtsg" value="' + token + '"><input name="lsd" value="lsd-' + token + '"></html>';
  const session = await createPersonalSession({
    appState,
    fetchImpl: async () => {
      calls++;
      return response({ html: html(calls === 1 ? "old-token" : "new-token") });
    }
  });
  assert.equal(session.getTokens().fbDtsg, "old-token");
  const result = await session.refreshTokens();
  assert.equal(session.getTokens().fbDtsg, "new-token");
  assert.equal(result.tokenNames.includes("fbDtsg"), true);
  assert.equal(JSON.stringify(result).includes("new-token"), false);
  session.close();
});

test("personal session restores an account-bound AppState and rolls back a mismatched identity", async () => {
  const html = '<html><script>{"USER_ID":"123456789012345"}</script><input type="hidden" name="fb_dtsg" value="fresh-token"></html>';
  const session = await createPersonalSession({ appState, fetchImpl: async () => response({ html }) });
  const replacement = [
    ...appState,
    { key: "sid", value: "restored-session", domain: ".facebook.com", path: "/", secure: true }
  ];
  const result = await session.replaceAppState(replacement);
  assert.equal(result.userId, "123456789012345");
  assert.match(session.getCookieHeader(), /sid=restored-session/);
  await assert.rejects(session.replaceAppState([
    { key: "c_user", value: "999999999999999", domain: ".facebook.com", path: "/" },
    { key: "xs", value: "other-account", domain: ".facebook.com", path: "/" }
  ]), error => error.code === "FCA_SESSION_IDENTITY_MISMATCH");
  assert.match(session.getCookieHeader(), /sid=restored-session/);
  session.close();
});

