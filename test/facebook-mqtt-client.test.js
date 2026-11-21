"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { EventEmitter } = require("node:events");
const { createFacebookMqttClient } = require("../src/compat/facebookMqttClient");
const mqtt = require("../src/transport/mqtt311Codec");

const appState = [
  { key: "c_user", value: "123456789012345", domain: ".facebook.com", path: "/", secure: true, httpOnly: true },
  { key: "xs", value: "synthetic-session", domain: ".facebook.com", path: "/", secure: true, httpOnly: true }
];

function response() {
  const html = '<html><script>{"USER_ID":"123456789012345"}</script></html>';
  return {
    status: 200, ok: true,
    headers: {
      get: name => name.toLowerCase() === "content-length" ? String(Buffer.byteLength(html)) :
        name.toLowerCase() === "content-type" ? "text/html" : null,
      getSetCookie: () => []
    },
    text: async () => html
  };
}

class FakeSocket extends EventEmitter {
  constructor() {
    super();
    this.readyState = 0;
    setImmediate(() => { this.readyState = 1; this.emit("open"); });
  }
  send(frame) {
    const bytes = Buffer.from(frame);
    const type = bytes[0] >> 4;
    if (type === 1) setImmediate(() => this.emit("message", Buffer.from([0x20, 0x02, 0, 0])));
    if (type === 8) {
      const remaining = mqtt.decodeRemainingLength(bytes);
      const id = bytes.readUInt16BE(remaining.offset);
      setImmediate(() => this.emit("message", Buffer.from([0x90, 0x03, id >> 8, id & 255, 1])));
    }
  }
  close() {
    this.readyState = 3;
    setImmediate(() => this.emit("close", 1000));
  }
}

test("first-party client logs in with AppState and exposes callback-compatible MQTT lifecycle", async () => {
  const client = createFacebookMqttClient({
    socketFactory: () => new FakeSocket(),
    fetchImpl: async () => response(),
    mqtt: { keepAlive: 0 }
  });
  const api = await client.login({ mode: "appstate", appState });
  assert.equal(api.getCurrentUserID(), "123456789012345");
  assert.equal(typeof api.listenMqtt, "function");
  assert.equal(typeof api.sendMessage, "function");
  assert.equal(typeof api.getThreadList, "function");
  assert.equal(typeof api.getThreadInfo, "function");
  assert.equal(typeof api.getThreadHistory, "function");
  assert.equal(typeof api.getUserInfo, "function");
  assert.equal(typeof api.addUserToGroup, "function");
  assert.equal(typeof api.removeUserFromGroup, "function");
  assert.equal(typeof api.changeNickname, "function");
  assert.equal(typeof api.setMessageReaction, "function");
  assert.equal(typeof api.markAsRead, "function");
  for (const method of ["editMessage", "unsendMessage", "markAsReadAll", "markAsSeen", "markAsDelivered"]) {
    assert.equal(typeof api[method], "function", method);
  }
  let readyEvent = null;
  const stop = api.listenMqtt((error, event) => {
    if (!error && event?.type === "ready") readyEvent = event;
  });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(readyEvent?.source, "omega-fca");
  assert.equal(readyEvent?.connectionState?.connected, true);
  stop();
  await client.logout();
});

test("first-party client supplies its package-managed WebSocket implementation by default", () => {
  assert.doesNotThrow(() => createFacebookMqttClient());
});


test("forwards login-time listener options into the native MQTT driver", async () => {
  const socket = new FakeSocket();
  const client = createFacebookMqttClient({
    socketFactory: () => socket,
    fetchImpl: async () => response(),
    mqtt: { keepAlive: 0 }
  });
  const api = await client.login({ mode: "appstate", appState }, {
    listenTyping: true,
    listenEvents: true,
    updatePresence: true,
    selfListen: false
  });
  const received = [];
  const detach = api.listenMqtt((error, event) => {
    if (error) throw error;
    if (event?.type === "typ") received.push(event);
  });
  await new Promise(resolve => setImmediate(resolve));
  socket.emit("message", mqtt.encodePublish({
    topic: "/t_ms",
    payload: JSON.stringify({ deltas: [{
      class: "TypingNotification",
      messageMetadata: {
        threadKey: { threadFbId: "987654321" },
        actorFbId: "111111111111111"
      },
      isTyping: true
    }] }),
    qos: 1, packetId: 11
  }));
  assert.equal(received.length, 1);
  assert.equal(received[0].type, "typ");
  detach();
  await client.logout();
});
