"use strict";
function createImgbbUploader({ apiKey, fetchImpl } = {}) {
  const request = fetchImpl || globalThis.fetch;
  return function uploadImageToImgbb(imageUrl, callback) {
    if (typeof imageUrl !== "string" || !imageUrl.trim() || imageUrl.length > 8192) throw new TypeError("imageUrl must be a valid HTTPS URL");
    let parsed; try { parsed = new URL(imageUrl); } catch { throw new TypeError("imageUrl must be a valid HTTPS URL"); }
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new TypeError("imageUrl must be a valid HTTPS URL without embedded credentials");
    const operation = Promise.resolve().then(async () => {
      const key = typeof apiKey === "string" && apiKey.trim() ? apiKey.trim() : (process.env.FCA_IMGBB_API_KEY || process.env.IMGBB_API_KEY || "");
      if (!key) { const error = new Error("ImgBB API key is not configured"); error.code = "FCA_IMGBB_API_KEY_MISSING"; throw error; }
      if (typeof request !== "function") { const error = new Error("A Fetch-compatible implementation is required for ImgBB uploads"); error.code = "FCA_IMGBB_FETCH_UNAVAILABLE"; throw error; }
      const endpoint = new URL("https://api.imgbb.com/1/upload"); endpoint.searchParams.set("key", key);
      let response;
      try { response = await request(endpoint, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ image: parsed.toString() }) }); }
      catch { const error = new Error("ImgBB upload request failed"); error.code = "FCA_IMGBB_REQUEST_FAILED"; throw error; }
      let payload; try { payload = await response.json(); } catch { const error = new Error("ImgBB returned an invalid response"); error.code = "FCA_IMGBB_RESPONSE_INVALID"; throw error; }
      if (!response.ok || payload?.success !== true || typeof payload?.data?.url !== "string") { const error = new Error("ImgBB rejected the image upload"); error.code = "FCA_IMGBB_UPLOAD_REJECTED"; error.retryable = response.status === 429 || response.status >= 500; throw error; }
      return payload.data.url;
    });
    if (typeof callback === "function") { operation.then(url => callback(null, url), error => callback(error)); return undefined; }
    return operation;
  };
}
module.exports = { createImgbbUploader };
