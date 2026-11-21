"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { createFcaClient } = require("../src/compat/namespacedClient");

test("createFcaClient groups and binds only methods present on the source API", () => {
  const calls = [];
  const api = {
    sendMessage(message, threadID) { calls.push(["send", message, threadID, this === api]); return "sent"; },
    getThreadInfo(threadID) { calls.push(["thread", threadID, this === api]); return { threadID }; },
    getUserInfo(userID) { calls.push(["user", userID, this === api]); return { userID }; },
    refreshFb_dtsg() { return "refreshed"; }
  };
  const client = createFcaClient(api);
  assert.equal(client.messages.send("hello", "123456789"), "sent");
  assert.deepEqual(client.threads.getInfo("123456789"), { threadID: "123456789" });
  assert.deepEqual(client.users.getInfo("987654321"), { userID: "987654321" });
  assert.equal(client.account.refreshDtsg(), "refreshed");
  assert.equal(client.messages.edit, undefined);
  assert.deepEqual(calls, [
    ["send", "hello", "123456789", true],
    ["thread", "123456789", true],
    ["user", "987654321", true]
  ]);
  assert.throws(() => createFcaClient(null), /FCA API object/);
});

test("createFcaClient exposes pin and social methods in their namespaces", () => {
  const api = {
    pinMessage: (...args) => ["pin", ...args],
    unpinMessage: (...args) => ["unpin", ...args],
    sendFriendRequest: (...args) => ["request", ...args],
    followUser: (...args) => ["follow", ...args],
    unfollowUser: (...args) => ["unfollow", ...args],
    postComment: (...args) => ["comment", ...args],
    sharePost: (...args) => ["share", ...args]
  };
  const client = createFcaClient(api);
  assert.deepEqual(client.threads.pin("m1", "t1"), ["pin", "m1", "t1"]);
  assert.deepEqual(client.threads.unpin("m1", "t1"), ["unpin", "m1", "t1"]);
  assert.deepEqual(client.users.sendFriendRequest("u1"), ["request", "u1"]);
  assert.deepEqual(client.users.followUser("u1"), ["follow", "u1"]);
  assert.deepEqual(client.users.unfollowUser("u1"), ["unfollow", "u1"]);
  assert.deepEqual(client.posts.comment("Nice", "p1"), ["comment", "Nice", "p1"]);
  assert.deepEqual(client.posts.share("p1"), ["share", "p1"]);
});

test("createFcaClient exposes ImgBB upload in the media namespace", () => {
  const api = { uploadImageToImgbb: url => "hosted:" + url };
  const client = createFcaClient(api);
  assert.equal(client.media.uploadToImgbb("https://example.com/a.png"), "hosted:https://example.com/a.png");
});
