"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { createImgbbUploader } = require("../src/compat/imgbb");
test("ImgBB uploader posts HTTPS source URL and returns hosted URL", async () => {
  let request;
  const upload = createImgbbUploader({ apiKey: "test-key", fetchImpl: async (url, options) => { request = { url: String(url), options }; return { ok: true, status: 200, json: async () => ({ success: true, data: { url: "https://i.ibb.co/example.png" } }) }; } });
  assert.equal(await upload("https://example.com/photo.png"), "https://i.ibb.co/example.png");
  assert.match(request.url, /api\.imgbb\.com\/1\/upload\?key=test-key/);
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.body.get("image"), "https://example.com/photo.png");
});
test("ImgBB uploader validates URLs and does not reveal API keys", async () => {
  const upload = createImgbbUploader({ apiKey: "secret-key", fetchImpl: async () => ({ ok: false, status: 400, json: async () => ({ success: false }) }) });
  await assert.rejects(upload("http://example.com/image.png"), /HTTPS URL/);
  await assert.rejects(upload("https://example.com/image.png"), error => error.code === "FCA_IMGBB_UPLOAD_REJECTED" && !error.message.includes("secret-key"));
});
test("ImgBB uploader supports error-first callbacks", async () => {
  const upload = createImgbbUploader({ apiKey: "test-key", fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ success: true, data: { url: "https://i.ibb.co/callback.png" } }) }) });
  const result = await new Promise((resolve, reject) => upload("https://example.com/image.png", (error, url) => error ? reject(error) : resolve(url)));
  assert.equal(result, "https://i.ibb.co/callback.png");
});
