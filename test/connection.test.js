"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { ConnectionSupervisor } = require("../src/runtime/connection");

test("connection supervisor prevents duplicate listeners", async () => {
  let registered = 0;
  let callback;
  const supervisor = new ConnectionSupervisor({
    connect: async () => ({ listen(fn) { registered++; callback = fn; return () => { registered--; }; } }),
    disconnect: async () => {}
  });
  await supervisor.start();
  const received = [];
  const detach = supervisor.listen(event => received.push(event));
  assert.equal(registered, 1);
  assert.throws(() => supervisor.listen(() => {}), /already attached/);
  callback(null, { type: "message", messageID: "m1" });
  assert.equal(received.length, 1);
  detach();
  assert.equal(registered, 0);
  await supervisor.stop();
  assert.equal(supervisor.snapshot().state, "stopped");
});

test("stop invalidates stale listener callbacks", async () => {
  let callback;
  const supervisor = new ConnectionSupervisor({ connect: async () => ({ listen(fn) { callback = fn; } }) });
  await supervisor.start();
  const received = [];
  supervisor.listen(event => received.push(event));
  await supervisor.stop();
  callback(null, { type: "message" });
  assert.equal(received.length, 0);
});

test("listener transport failure reconnects and restores exactly one listener", async () => {
  let connects = 0;
  let firstCallback;
  let secondCallback;
  let active = 0;
  const supervisor = new ConnectionSupervisor({
    connect: async () => {
      connects++;
      const number = connects;
      return {
        listen(fn) {
          active++;
          if (number === 1) firstCallback = fn;
          else secondCallback = fn;
          return () => { active--; };
        },
        disconnect: async () => {}
      };
    },
    options: { minDelayMs: 0, maxDelayMs: 0, jitter: 0 },
    sleep: async () => {}
  });
  await supervisor.start();
  const received = [];
  supervisor.listen(event => received.push(event));
  firstCallback(new Error("transport dropped"));
  for (let i = 0; i < 20 && connects < 2; i++) await new Promise(resolve => setImmediate(resolve));
  assert.equal(connects, 2);
  assert.equal(active, 1);
  secondCallback(null, { type: "message", messageID: "after-reconnect" });
  assert.equal(received.length, 1);
  await supervisor.stop();
});

test("does not retry permanent authentication failures", async () => {
  let attempts = 0;
  const supervisor = new ConnectionSupervisor({
    connect: async () => { attempts++; const error = new Error("invalid credentials"); error.retryable = false; throw error; },
    sleep: async () => {}
  });
  assert.equal(await supervisor.start(), null);
  assert.equal(attempts, 1);
  assert.equal(supervisor.snapshot().state, "failed");
});
