"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { Readable } = require("node:stream");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createFacebookMqttClient } = require("../src/compat/facebookMqttClient");
const { createFacebookMqttDriver } = require("../src/transport/facebookMqttDriver");
const mqtt = require("../src/transport/mqtt311Codec");

const appState = [
  { key: "c_user", value: "123456789012345", domain: ".facebook.com", path: "/", secure: true, httpOnly: true },
  { key: "xs", value: "session-token", domain: ".facebook.com", path: "/", secure: true, httpOnly: true }
];

function htmlResponse() {
  const html = '<html><input type="hidden" name="fb_dtsg" value="fresh-token"><script>{"USER_ID":"123456789012345"}</script></html>';
  return {
    status: 200, ok: true,
    headers: { get: name => name.toLowerCase() === "content-length" ? String(Buffer.byteLength(html)) : name.toLowerCase() === "content-type" ? "text/html" : null, getSetCookie: () => [] },
    text: async () => html
  };
}

class FakeWebSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 0;
    setImmediate(() => { this.readyState = 1; this.emit("open"); });
  }
  send(frame) {
    const bytes = Buffer.from(frame);
    const type = bytes[0] >> 4;
    if (type === 1) setImmediate(() => this.emit("message", Buffer.from([0x20, 0x02, 0x00, 0x00])));
    if (type === 8) {
      const remaining = mqtt.decodeRemainingLength(bytes);
      const packetId = bytes.readUInt16BE(remaining.offset);
      setImmediate(() => this.emit("message", Buffer.from([0x90, 0x03, packetId >> 8, packetId & 0xff, 0x01])));
    }
  }
  close() {
    this.readyState = 3;
    setImmediate(() => this.emit("close", 1000));
  }
}

test("integrated driver validates AppState, authenticates MQTT and exposes an FCA driver", async () => {
  const driver = await createFacebookMqttDriver({
    appState,
    fetchImpl: async () => htmlResponse(),
    socketFactory: () => new FakeWebSocket(),
    mqtt: { keepAlive: 0 }
  });
  assert.equal(driver.getCurrentUserID(), "123456789012345");
  assert.equal(driver.getSessionState(), "active");
  assert.deepEqual(driver.getAppState().map(({ key, value }) => ({ key, value })), appState.map(({ key, value }) => ({ key, value })));
  assert.match(driver.getCookies(), /c_user=123456789012345/);
  assert.match(driver.getCookies(), /xs=session-token/);
  assert.equal(typeof driver.listen, "function");
  assert.equal(typeof driver.sendMessage, "function");
  await driver.disconnect();
});

test("integrated driver requires an injected WebSocket implementation", async () => {
  await assert.rejects(createFacebookMqttDriver({ appState }), /socketFactory is required/);
});

test("native driver automatically snapshots AppState when SessionGuard is configured", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omega-driver-guard-"));
  const filePath = path.join(directory, "session.enc");
  const key = "a".repeat(64);
  let driver;
  try {
    driver = await createFacebookMqttDriver({
      appState, fetchImpl: async () => htmlResponse(),
      socketFactory: () => new FakeWebSocket(), mqtt: { keepAlive: 0 },
      sessionGuard: { filePath, key, intervalMs: 60_000 }
    });
    assert.equal(driver.sessionGuard().filePath, filePath);
    const saved = require("../src/security/sessionStore").loadSession(filePath, key);
    assert.equal(saved.userId, "123456789012345");
    assert.deepEqual(saved.appState.map(({ key, value }) => ({ key, value })), appState.map(({ key, value }) => ({ key, value })));
    assert.equal(await driver.stopSessionGuard(), true);
    assert.throws(() => driver.sessionGuard(), /SessionGuard is not configured/);
  } finally {
    if (driver) await driver.disconnect();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("legacy GoatBot account.txt SessionGuard call never writes encrypted data into account.txt", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omega-driver-legacy-guard-"));
  const accountPath = path.join(directory, "account.txt");
  const encryptedPath = path.join(directory, "private", "facebook-session.enc");
  const originalAccount = JSON.stringify(appState);
  fs.writeFileSync(accountPath, originalAccount, "utf8");
  let driver;
  try {
    driver = await createFacebookMqttDriver({
      appState, fetchImpl: async () => htmlResponse(),
      socketFactory: () => new FakeWebSocket(), mqtt: { keepAlive: 0 },
      sessionGuard: { filePath: encryptedPath, key: "b".repeat(64), intervalMs: 60_000 }
    });
    const configured = driver.sessionGuard(accountPath, { interval: 180_000, debounce: 30_000 });
    assert.equal(configured.filePath, encryptedPath);
    assert.equal(fs.readFileSync(accountPath, "utf8"), originalAccount);
    assert.notEqual(fs.readFileSync(encryptedPath, "utf8"), originalAccount);
  } finally {
    if (driver) await driver.disconnect();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("deployment environment enables GoatBot-compatible encrypted SessionGuard", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omega-driver-env-guard-"));
  const accountPath = path.join(directory, "account.txt");
  const encryptedPath = path.join(directory, "private", "session.enc");
  const originalAccount = JSON.stringify(appState);
  fs.writeFileSync(accountPath, originalAccount, "utf8");
  const previous = { file: process.env.FCA_SESSION_FILE, key: process.env.FCA_SESSION_KEY, interval: process.env.FCA_SESSION_INTERVAL_MS };
  let client;
  try {
    process.env.FCA_SESSION_FILE = encryptedPath;
    process.env.FCA_SESSION_KEY = "c".repeat(64);
    process.env.FCA_SESSION_INTERVAL_MS = "180000";
    client = createFacebookMqttClient({
      socketFactory: () => new FakeWebSocket(),
      fetchImpl: async () => htmlResponse(), mqtt: { keepAlive: 0 }
    });
    const api = await client.login({ mode: "appstate", appState });
    assert.equal(typeof api.httpPost, "function");
    assert.equal(typeof api.getAppState, "function");
    assert.equal(typeof api.getCookies, "function");
    assert.match(api.getCookies(), /c_user=123456789012345/);
    for (const method of ["unsendMessage", "setTitle", "changeThreadColor", "changeThreadEmoji", "sendTypingIndicator", "markAsDelivered", "refreshFb_dtsg"]) assert.equal(typeof api[method], "function", method);
    assert.equal(api.sessionGuard(accountPath, { interval: 180_000, debounce: 30_000 }).filePath, encryptedPath);
    assert.equal(fs.existsSync(encryptedPath), true);
    assert.equal(fs.readFileSync(accountPath, "utf8"), originalAccount);
    await client.logout();
  } finally {
    if (client) await client.logout().catch(() => {});
    if (previous.file === undefined) delete process.env.FCA_SESSION_FILE; else process.env.FCA_SESSION_FILE = previous.file;
    if (previous.key === undefined) delete process.env.FCA_SESSION_KEY; else process.env.FCA_SESSION_KEY = previous.key;
    if (previous.interval === undefined) delete process.env.FCA_SESSION_INTERVAL_MS; else process.env.FCA_SESSION_INTERVAL_MS = previous.interval;
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("native driver rejects SessionGuard without an explicit encryption key", async () => {
  await assert.rejects(createFacebookMqttDriver({
    appState, fetchImpl: async () => htmlResponse(),
    socketFactory: () => new FakeWebSocket(), mqtt: { keepAlive: 0 },
    sessionGuard: { filePath: "/tmp/omega-session.enc" }
  }), error => error.message.includes("explicit 32-byte/64-hex encryption key"));
});

test("native driver rejects encrypted snapshot belonging to a different Facebook account", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omega-driver-identity-"));
  const filePath = path.join(directory, "session.enc");
  const key = "9".repeat(64);
  require("../src/security/sessionStore").saveSession(filePath, {
    version: 1, userId: "999999999999999", appState, savedAt: Date.now()
  }, key);
  try {
    await assert.rejects(createFacebookMqttDriver({
      fetchImpl: async () => htmlResponse(), socketFactory: () => new FakeWebSocket(),
      mqtt: { keepAlive: 0 }, sessionGuard: { filePath, key }
    }), error => error.code === "FCA_SESSION_IDENTITY_MISMATCH");
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("first-party client restores and reconnects using encrypted SessionGuard state", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omega-client-restore-"));
  const sessionGuard = { filePath: path.join(directory, "account.enc"), key: "d".repeat(64), intervalMs: 60_000 };
  const createClient = () => createFacebookMqttClient({
    socketFactory: () => new FakeWebSocket(), fetchImpl: async () => htmlResponse(),
    mqtt: { keepAlive: 0 }, sessionGuard
  });
  try {
    const first = createClient();
    const firstApi = await first.login({ mode: "appstate", appState });
    assert.equal(firstApi.getCurrentUserID(), "123456789012345");
    await first.logout();
    const second = createClient();
    const restoredApi = await second.login({ mode: "session" });
    assert.equal(restoredApi.getCurrentUserID(), "123456789012345");
    await second.logout();
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("SessionGuard refuses to use the GoatBot account.txt path for encrypted output", async () => {
  await assert.rejects(createFacebookMqttDriver({
    appState,
    socketFactory: () => new FakeWebSocket(),
    sessionGuard: { filePath: path.resolve(process.cwd(), "account.txt"), key: "e".repeat(64) }
  }), /separate from account\.txt, appstate\.json, and config\.json/);
});

test("SessionGuard protects account, AppState, and config files as both primary and backup paths", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omega-driver-protected-session-paths-"));
  const safeFile = path.join(directory, "session.enc");
  const protectedNames = ["account.txt", "appstate.json", "config.json"];
  try {
    for (const name of protectedNames) {
      const protectedPath = path.resolve(process.cwd(), name);
      await assert.rejects(createFacebookMqttDriver({
        appState, socketFactory: () => new FakeWebSocket(),
        sessionGuard: { filePath: protectedPath, key: "f".repeat(64) }
      }), /separate from account\.txt, appstate\.json, and config\.json/);
      await assert.rejects(createFacebookMqttDriver({
        appState, socketFactory: () => new FakeWebSocket(),
        sessionGuard: { filePath: safeFile, backupPath: protectedPath, key: "f".repeat(64) }
      }), /separate from account\.txt, appstate\.json, and config\.json/);
    }
    assert.equal(fs.existsSync(safeFile), false);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("SessionGuard rejects malformed encryption keys before network setup", async () => {
  await assert.rejects(createFacebookMqttDriver({
    appState,
    socketFactory: () => new FakeWebSocket(),
    sessionGuard: { filePath: path.join(os.tmpdir(), "omega-invalid-key.enc"), key: "not-a-key" }
  }), /32 bytes or exactly 64 hexadecimal/);
});


test("honors GoatBot listener options and filters self, event, typing and presence deltas", async () => {
  const socket = new FakeWebSocket();
  const driver = await createFacebookMqttDriver({
    appState, fetchImpl: async () => htmlResponse(), socketFactory: () => socket,
    mqtt: { keepAlive: 0 },
    options: {
      selfListen: false, selfListenEvent: true, listenEvents: true,
      listenTyping: true, updatePresence: true
    }
  });
  const received = [];
  const detach = driver.listen((error, event) => {
    if (error) throw error;
    received.push(event);
  });
  driver.getHumanizer().setOptions({ reactDelayMs: 0, cooldownMs: 0, maxPerMinute: 0 });
  const threadID = "987654321";
  const delta = (kind, senderID, messageID) => ({
    class: kind,
    messageMetadata: {
      threadKey: { threadFbId: threadID },
      messageId: messageID,
      actorFbId: senderID
    },
    body: "synthetic"
  });
  socket.emit("message", mqtt.encodePublish({
    topic: "/t_ms",
    payload: JSON.stringify({ deltas: [
      delta("NewMessage", "123456789012345", "self-message"),
      delta("NewMessage", "111111111111111", "other-message"),
      delta("ThreadEvent", "123456789012345", "self-event"),
      delta("ThreadEvent", "111111111111111", "other-event"),
      delta("TypingNotification", "111111111111111", "typing-event"),
      delta("PresenceUpdate", "111111111111111", "presence-event")
    ] }),
    qos: 1, packetId: 9
  }));
  assert.deepEqual(received.map(event => event.type), ["message", "event", "event", "typ", "presence"]);
  assert.equal(received[0].messageID, "other-message");
  assert.equal(received[1].senderID, "123456789012345");
  assert.equal(received[2].senderID, "111111111111111");

  driver.setOptions({ listenTyping: false, updatePresence: false });
  socket.emit("message", mqtt.encodePublish({
    topic: "/t_ms",
    payload: JSON.stringify({ deltas: [
      delta("TypingNotification", "111111111111111", "typing-disabled"),
      delta("PresenceUpdate", "111111111111111", "presence-disabled")
    ] }),
    qos: 1, packetId: 10
  }));
  assert.equal(received.length, 5);
  assert.throws(() => driver.setOptions({ proxy: "http://127.0.0.1:8080" }), error => error.code === "FCA_OPTION_UNSUPPORTED");
  detach();
  await driver.disconnect();
});


test("implements editMessage and shareContact with correlated MQTT requests", async () => {
  const socket = new FakeWebSocket();
  const driver = await createFacebookMqttDriver({
    appState, fetchImpl: async () => htmlResponse(), socketFactory: () => socket,
    mqtt: { keepAlive: 0 }
  });
  const originalSend = socket.send.bind(socket);
  socket.send = frame => {
    originalSend(frame);
    const packet = mqtt.decodePacket(Buffer.from(frame));
    if (packet.type !== "publish" || packet.topic !== "/ls_req") return;
    const request = JSON.parse(packet.payload.toString("utf8"));
    const envelope = JSON.parse(request.payload);
    const task = envelope.tasks[0];
    const taskPayload = JSON.parse(task.payload);
    let response;
    if (task.queue_name.startsWith("pin_msg_v2_") || task.queue_name.startsWith("unpin_msg_v2_")) {
      assert.equal(taskPayload.thread_key, "222222222222222");
      assert.equal(taskPayload.message_id, "mid-pin");
      assert.ok(["430", "431"].includes(task.label));
      response = { request_id: request.request_id, payload: { success: true } };
    } else if (task.queue_name === "edit_message") {
      assert.ok(["mid-edit", "mid-old"].includes(taskPayload.message_id));
      assert.equal(taskPayload.text, "edited text");
      const candidate = [null, null, taskPayload.message_id, null,
        taskPayload.message_id === "mid-old" ? "original text" : "edited text"];
      response = {
        request_id: request.request_id,
        payload: { step: [null, [null, null, [null, null, [null, candidate]]]] }
      };
    } else {
      assert.equal(task.queue_name, "messenger_contact_sharing");
      assert.deepEqual(taskPayload, {
        contact_id: "111111111111111",
        sync_group: 1,
        text: "contact",
        thread_id: "222222222222222"
      });
      response = { request_id: request.request_id, payload: { success: true } };
    }
    setImmediate(() => socket.emit("message", mqtt.encodePublish({
      topic: "/ls_resp", payload: JSON.stringify(response), qos: 1, packetId: 91
    })));
  };
  try {
    const edited = await driver.editMessage("edited text", "mid-edit");
    assert.deepEqual(edited, { body: "edited text", messageID: "mid-edit" });
    await assert.rejects(driver.editMessage("edited text", "mid-old"), error =>
      error.code === "FCA_MESSAGE_EDIT_REJECTED");
    const shared = await driver.shareContact("contact", "111111111111111", "222222222222222", "legacy-message-id");
    assert.equal(shared.success, true);
    assert.equal((await driver.pinMessage("mid-pin", "222222222222222")).success, true);
    assert.equal((await driver.unpinMessage("mid-pin", "222222222222222")).success, true);
  } finally {
    await driver.disconnect();
  }
});


test("creates the GoatBot humanizer when listen starts and exposes getHumanizer", async () => {
  const socket = new FakeWebSocket();
  const driver = await createFacebookMqttDriver({
    appState, fetchImpl: async () => htmlResponse(), socketFactory: () => socket,
    mqtt: { keepAlive: 0 }
  });
  try {
    assert.equal(driver.getHumanizer(), null);
    const detach = driver.listen(() => {});
    const humanizer = driver.getHumanizer();
    assert.ok(humanizer);
    assert.equal(typeof humanizer.setOptions, "function");
    humanizer.setOptions({ enabled: false, reactDelayMs: 0 });
    assert.equal(humanizer.getOptions().enabled, false);
    detach();
  } finally {
    await driver.disconnect();
  }
});


test("uploads, sends, downloads and forwards Messenger attachments through bounded native helpers", async () => {
  const socket = new FakeWebSocket();
  const seen = [];
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  const jsonResponse = value => new Response("for (;;);" + JSON.stringify(value), {
    status: 200, headers: { "content-type": "application/json" }
  });
  const fetchImpl = async (input, init = {}) => {
    const url = new URL(String(input));
    if (url.hostname === "www.facebook.com" && url.pathname === "/") return htmlResponse();
    if (url.hostname === "upload.facebook.com" && url.pathname.endsWith("/upload.php")) {
      const fields = Array.from(init.body.entries()).map(([name]) => name);
      seen.push({ kind: "upload", fields });
      const uploaded = fields.filter(name => name.startsWith("upload_")).map((_, index) => index === 0 ? { image_id: "987654321", filetype: "image/png" } : { file_id: "876543210", filetype: "application/pdf" });
      return jsonResponse({ payload: { metadata: uploaded } });
    }
    if (url.hostname === "www.facebook.com" && url.pathname === "/messaging/send/") {
      const form = new URLSearchParams(init.body);
      seen.push({ kind: "send", imageID: form.get("image_ids[0]"), fileID: form.get("file_ids[0]"), body: form.get("body"), reply: form.get("replied_to_message_id") });
      return jsonResponse({ payload: { actions: [{ thread_fbid: "123456789012345", message_id: "mid-attachment", timestamp: 1700000000000 }] } });
    }
    if (url.hostname === "www.facebook.com" && url.pathname === "/mercury/attachments/forward/") {
      const form = new URLSearchParams(init.body);
      seen.push({ kind: "forward", id: form.get("attachment_id"), recipients: [...form.entries()].filter(([key]) => key.startsWith("recipient_map[")) });
      return jsonResponse({ payload: { success: true } });
    }
    if (url.hostname === "scontent.xx.fbcdn.net") return new Response(Buffer.from("media-bytes"), { status: 200, headers: { "content-type": "image/png" } });
    throw new Error("Unexpected test URL: " + url.href);
  };
  const driver = await createFacebookMqttDriver({
    appState, fetchImpl, socketFactory: () => socket, mqtt: { keepAlive: 0 }
  });
  try {
    const sent = await driver.sendMessage({
      threadID: "123456789012345",
      message: { body: "photo caption", attachment: [png, Readable.from([Buffer.from("%PDF-1.7 "), Buffer.from("stream test")])] },
      replyToMessageID: "mid-reply"
    });
    assert.equal(sent.messageID, "mid-attachment");
    assert.equal(sent.attachments[0].attachmentID, "987654321");
    assert.equal(sent.attachments[1].attachmentID, "876543210");
    assert.equal(sent.attachments[1].type, "file");
    assert.deepEqual(seen.find(item => item.kind === "upload").fields.slice(0, 4), ["voice_clip", "upload_0", "upload_1", "av"]);
    assert.deepEqual(seen.find(item => item.kind === "send"), {
      kind: "send", imageID: "987654321", fileID: "876543210", body: "photo caption", reply: "mid-reply"
    });

    const uploaded = await driver.uploadAttachment(png);
    assert.equal(uploaded[0].type, "image");
    assert.equal(uploaded[0].attachmentID, "987654321");

    const downloaded = await driver.downloadAttachment("https://scontent.xx.fbcdn.net/photo.png");
    assert.equal(downloaded.buffer.toString(), "media-bytes");
    assert.equal(downloaded.mimeType, "image/png");

    const forwarded = await driver.forwardAttachment("987654321", ["111111111111111", "222222222222222"]);
    assert.equal(forwarded.success, true);
    assert.equal(seen.find(item => item.kind === "forward").id, "987654321");
    assert.equal(seen.find(item => item.kind === "forward").recipients.length, 2);
  } finally {
    await driver.disconnect();
  }
});

test("native driver exposes encrypted saveSession and account-bound restoreSessionBackup", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omega-driver-backup-"));
  const filePath = path.join(directory, "session.enc");
  const backupPath = filePath + ".bak";
  const key = "f".repeat(64);
  let driver;
  try {
    driver = await createFacebookMqttDriver({
      appState, fetchImpl: async () => htmlResponse(),
      socketFactory: () => new FakeWebSocket(), mqtt: { keepAlive: 0 },
      sessionGuard: { filePath, key, intervalMs: 60_000 }
    });
    await driver.saveSession();
    const store = require("../src/security/sessionStore");
    store.saveSession(backupPath, {
      version: 1, userId: "123456789012345",
      appState: [
        { key: "c_user", value: "123456789012345", domain: ".facebook.com", path: "/", secure: true, httpOnly: true },
        { key: "xs", value: "backup-session", domain: ".facebook.com", path: "/", secure: true, httpOnly: true }
      ],
      savedAt: Date.now()
    }, key);
    const restored = await driver.restoreSessionBackup();
    assert.equal(restored.restored, true);
    assert.equal(restored.userId, "123456789012345");
    assert.match(driver.getCookies(), /xs=backup-session/);
    const saved = store.loadSession(filePath, key);
    assert.equal(saved.appState.find(cookie => cookie.key === "xs").value, "backup-session");
  } finally {
    if (driver) await driver.disconnect();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("native driver exposes callback-compatible saveSession and bounded multipart HTTP", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omega-driver-multipart-"));
  const filePath = path.join(directory, "session.enc");
  let driver;
  try {
    driver = await createFacebookMqttDriver({
      appState,
      fetchImpl: async url => {
        if (String(url).includes("/ajax/mercury/upload.php")) {
          const raw = JSON.stringify({ payload: { success: true } });
          return {
            status: 200, ok: true,
            headers: { get: name => name.toLowerCase() === "content-type" ? "application/json" : name.toLowerCase() === "content-length" ? String(Buffer.byteLength(raw)) : null },
            text: async () => raw
          };
        }
        return htmlResponse();
      },
      socketFactory: () => new FakeWebSocket(), mqtt: { keepAlive: 0 },
      sessionGuard: { filePath, key: "1".repeat(64), intervalMs: 60_000 }
    });
    const savedPath = await new Promise((resolve, reject) => {
      driver.saveSession((error, value) => error ? reject(error) : resolve(value));
    });
    assert.equal(savedPath, filePath);
    const response = await driver.httpPostFormData(
      "https://www.facebook.com/ajax/mercury/upload.php",
      new FormData()
    );
    assert.equal(response.status, 200);
    await assert.rejects(driver.httpPostFormData("https://example.com/upload", new FormData()), /HTTPS Facebook\/Messenger/);
  } finally {
    if (driver) await driver.disconnect();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});



test("sendMessage reports explicit Messenger rejection instead of returning it as success", async () => {
  const socket = new FakeWebSocket();
  const driver = await createFacebookMqttDriver({
    appState, fetchImpl: async () => htmlResponse(), socketFactory: () => socket,
    mqtt: { keepAlive: 0 }
  });
  const originalSend = socket.send.bind(socket);
  let rejectNext = true;
  socket.send = frame => {
    originalSend(frame);
    const packet = mqtt.decodePacket(Buffer.from(frame));
    if (packet.type !== "publish" || packet.topic !== "/ls_req") return;
    const request = JSON.parse(packet.payload.toString("utf8"));
    const response = rejectNext
      ? { request_id: request.request_id, payload: { error: 1545012 } }
      : { request_id: request.request_id, payload: { accepted: true } };
    rejectNext = false;
    setImmediate(() => socket.emit("message", mqtt.encodePublish({
      topic: "/ls_resp", payload: JSON.stringify(response), qos: 1, packetId: 92
    })));
  };
  try {
    await assert.rejects(
      driver.sendMessage({ threadID: "987654321", message: "not sent" }),
      error => error.code === "FCA_FACEBOOK_REQUEST_REJECTED" && error.retryable === false
    );
    const accepted = await driver.sendMessage({ threadID: "987654321", message: "sent" });
    assert.deepEqual(accepted.payload, { accepted: true });
  } finally {
    await driver.disconnect();
  }
});
