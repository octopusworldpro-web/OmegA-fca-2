"use strict";

const path = require("node:path");
const fs = require("node:fs");
const os = require("node:os");
const { createPersonalSession } = require("../auth/personalSession");
const { createSessionGuard } = require("../security/sessionGuard");
const { createFacebookMqttProtocol } = require("./facebookMqttProtocol");
const { createNativeRealtimeTransport } = require("./nativeRealtimeTransport");
const { createFacebookThreadApi } = require("./facebookThreadApi");
const { createFacebookWebClient } = require("../auth/facebookWebClient");
const { readImageInput, readAttachmentInput, downloadAttachment: downloadAttachmentFile, MAX_ATTACHMENT_COUNT } = require("../compat/imageUpload");
const { offlineThreadingId, createMessengerEditMessageRequest, createMessengerShareContactRequest, createMessengerChangeGroupImageRequest, createMessengerPinMessageRequest } = require("./messengerActions");
const { createHumanizer } = require("../compat/humanizer");
const { createBroadcastSender } = require("../compat/broadcast");
const { E2EEClient } = require("../e2ee/client");
const { createE2EEHttpAdapter } = require("../e2ee/httpAdapter");

/**
 * Builds an owner-authorized personal Messenger MQTT driver.
 * Thread and group methods use the same authenticated Facebook web session
 * and public FCA request conventions; their private endpoints can change.
 */
function extractEditMessageResult(response) {
  const step = response?.payload?.step;
  const candidate = step?.[1]?.[2]?.[2]?.[1];
  const messageID = String(candidate?.[2] || "");
  const body = String(candidate?.[4] || "");
  if (!messageID || !body) {
    const error = new Error("Facebook returned an invalid edit-message response");
    error.code = "FCA_RESPONSE_SHAPE_INVALID";
    throw error;
  }
  return { body, messageID };
}

function callbackResult(operation, callback) {
  if (typeof callback !== "function") return operation;
  operation.then(value => callback(null, value), error => callback(error));
  return undefined;
}

function assertMessengerAccepted(response, action) {
  const payload = response?.payload?.payload ?? response?.payload;
  const facebookError = response?.error ?? payload?.error;
  const errors = payload?.errors;
  if (facebookError != null || (Array.isArray(errors) && errors.length > 0)) {
    const error = new Error("Facebook rejected the Messenger " + action + " request");
    error.code = "FCA_FACEBOOK_REQUEST_REJECTED";
    error.retryable = false;
    error.facebookError = facebookError ?? errors;
    throw error;
  }
  return response;
}

async function createFacebookMqttDriver({
  appState, socketFactory, fetchImpl, userAgent, timeoutMs = 20000,
  connectTimeoutMs = 15000, closeTimeoutMs = 3000, protocolSetupTimeoutMs = 15000,
  maxFrameBytes, syncCursorStore, onSyncCursor, requestTimeoutMs, maxPendingRequests,
  mqtt = {}, onDiagnostic, sessionGuard: sessionGuardOptions, options: loginOptions = {}
} = {}) {
  if (typeof socketFactory !== "function") throw new TypeError("socketFactory is required");
  let session = null;
  let closed = false;
  let transport;
  let guard = null;
  if (!loginOptions || typeof loginOptions !== "object" || Array.isArray(loginOptions)) {
    throw new TypeError("login options must be an object");
  }
  const effectiveUserAgent = userAgent || loginOptions.userAgent || undefined;
  const runtimeOptions = {
    logLevel: loginOptions.logLevel || "warn",
    selfListen: loginOptions.selfListen === true,
    selfListenEvent: loginOptions.selfListenEvent === true,
    listenEvents: loginOptions.listenEvents === true,
    listenTyping: loginOptions.listenTyping === true,
    updatePresence: loginOptions.updatePresence === true,
    autoMarkDelivery: loginOptions.autoMarkDelivery === true,
    autoMarkRead: loginOptions.autoMarkRead === true
  };
  let humanizer = null;
  for (const key of ["selfListen", "selfListenEvent", "listenEvents", "listenTyping", "updatePresence", "autoMarkDelivery", "autoMarkRead"]) {
    if (loginOptions[key] !== undefined && typeof loginOptions[key] !== "boolean") {
      throw new TypeError(key + " must be a boolean");
    }
  }
  if (loginOptions.proxy) {
    const error = new TypeError("Native Messenger transport does not support proxy login options yet");
    error.code = "FCA_OPTION_UNSUPPORTED";
    throw error;
  }
  try {
    if (sessionGuardOptions != null) {
      if (!sessionGuardOptions || typeof sessionGuardOptions !== "object" ||
          typeof sessionGuardOptions.filePath !== "string" || !sessionGuardOptions.filePath.trim() ||
          !(typeof sessionGuardOptions.key === "string" || Buffer.isBuffer(sessionGuardOptions.key) || sessionGuardOptions.key instanceof Uint8Array)) {
        throw new TypeError("sessionGuard requires filePath and an explicit 32-byte/64-hex encryption key");
      }
      const keyIsValid = typeof sessionGuardOptions.key === "string"
        ? /^[a-f0-9]{64}$/i.test(sessionGuardOptions.key)
        : sessionGuardOptions.key.byteLength === 32;
      if (!keyIsValid) throw new TypeError("Session encryption key must be 32 bytes or exactly 64 hexadecimal characters");
      const protectedFiles = new Set(
        ["account.txt", "appstate.json", "config.json"].map(name => path.resolve(process.cwd(), name))
      );
      const encryptedFile = path.resolve(sessionGuardOptions.filePath);
      const backupFile = path.resolve(sessionGuardOptions.backupPath || encryptedFile + ".bak");
      if (protectedFiles.has(encryptedFile) || protectedFiles.has(backupFile)) {
        throw new TypeError("Encrypted SessionGuard files must be separate from account.txt, appstate.json, and config.json");
      }
      guard = createSessionGuard({
        filePath: sessionGuardOptions.filePath,
        backupPath: sessionGuardOptions.backupPath,
        key: sessionGuardOptions.key,
        onRecovery: sessionGuardOptions.onRecovery,
        getSession: () => {
          if (!session) throw new Error("Facebook session is not initialized");
          return { version: 1, userId: session.userId, appState: session.getAppState(), savedAt: Date.now() };
        }
      });
    }
    let activeAppState = appState;
    let restoredSnapshot = null;
    if (!Array.isArray(activeAppState) || activeAppState.length === 0) {
      if (!guard) {
        const error = new Error("No encrypted saved session is configured; supply AppState or configure SessionGuard");
        error.code = "FCA_SESSION_GUARD_MISSING";
        error.retryable = false;
        throw error;
      }
      try { restoredSnapshot = guard.load(); }
      catch (cause) {
        const error = new Error("No usable encrypted saved session was found; supply a fresh AppState or repair the SessionGuard snapshot");
        error.code = cause?.code === "ENOENT" ? "FCA_SESSION_SNAPSHOT_MISSING" : "FCA_SESSION_RESTORE_FAILED";
        error.retryable = false;
        throw error;
      }
      if (!Array.isArray(restoredSnapshot.appState) || restoredSnapshot.appState.length === 0) {
        const error = new Error("Encrypted SessionGuard snapshot does not contain an AppState cookie array");
        error.code = "FCA_SESSION_RESTORE_FAILED";
        error.retryable = false;
        throw error;
      }
      activeAppState = restoredSnapshot.appState;
    }
    session = await createPersonalSession({ appState: activeAppState, fetchImpl, userAgent: effectiveUserAgent, timeoutMs, onDiagnostic });
    if (restoredSnapshot?.userId != null && String(restoredSnapshot.userId) !== session.userId) {
      const error = new Error("Restored Facebook session identity does not match the encrypted snapshot");
      error.code = "FCA_SESSION_IDENTITY_MISMATCH";
      error.retryable = false;
      throw error;
    }
    const webClient = createFacebookWebClient({ session });
    const protocolConfig = createFacebookMqttProtocol({
      ...mqtt, userId: session.userId,
      url: mqtt.url || session.realtime.endpoint || undefined,
      region: mqtt.region || session.realtime.region || undefined,
      lastSeqId: mqtt.lastSeqId || session.realtime.lastSeqId || undefined,
      cookie: session.getCookieHeader("https://edge-chat.facebook.com/chat"),
      userAgent: effectiveUserAgent, syncCursorStore, onSyncCursor, requestTimeoutMs, maxPendingRequests,
      online: loginOptions.online ?? mqtt.online
    });
    transport = createNativeRealtimeTransport({
      url: protocolConfig.url, headers: protocolConfig.headers, socketFactory,
      protocol: protocolConfig.protocol, connectTimeoutMs, closeTimeoutMs,
      protocolSetupTimeoutMs,
      ...(maxFrameBytes === undefined ? {} : { maxFrameBytes }), onDiagnostic
    });
    await transport.connect();
    const driver = transport.getDriver();
    if (guard) {
      await guard.saveNow();
      guard.start(sessionGuardOptions.intervalMs === undefined ? 60_000 : sessionGuardOptions.intervalMs);
    }
    const threadApi = createFacebookThreadApi({ session, clientId: protocolConfig.session.clientId, webClient });
    let e2eeClient = null;
    const e2eeListeners = new Set();
    const e2eeStorageKey = loginOptions.e2eeStorageKey ?? sessionGuardOptions?.key ?? null;
    if (e2eeStorageKey != null) {
      if (typeof e2eeStorageKey === "string" ? !/^[a-f0-9]{64}$/i.test(e2eeStorageKey)
        : (!(Buffer.isBuffer(e2eeStorageKey) || e2eeStorageKey instanceof Uint8Array) || e2eeStorageKey.byteLength !== 32)) {
        throw new TypeError("e2eeStorageKey must be 32 bytes or exactly 64 hexadecimal characters");
      }
    }
    const e2eeDevicePath = loginOptions.e2eeDevicePath
      ? path.resolve(loginOptions.e2eeDevicePath)
      : e2eeStorageKey
        ? path.join(os.homedir(), ".omega-fca", "e2ee", session.userId + ".json")
        : "";
    if (loginOptions.e2eeDevicePath && !e2eeStorageKey) {
      const error = new Error("Persistent E2EE device storage requires e2eeStorageKey (32 bytes or 64 hex characters)");
      error.code = "FCA_E2EE_STORAGE_KEY_REQUIRED";
      throw error;
    }
    if (e2eeDevicePath) {
      const protectedPaths = [
        path.resolve(process.cwd(), "account.txt"),
        path.resolve(process.cwd(), "appstate.json"),
        sessionGuardOptions?.filePath ? path.resolve(sessionGuardOptions.filePath) : null,
        sessionGuardOptions?.backupPath ? path.resolve(sessionGuardOptions.backupPath) : null
      ].filter(Boolean);
      if (protectedPaths.includes(path.resolve(e2eeDevicePath))) {
        const error = new Error("E2EE device storage must not overwrite account.txt, appstate.json, or SessionGuard files");
        error.code = "FCA_E2EE_STORAGE_PATH_CONFLICT";
        throw error;
      }
    }
    function dispatchE2EEEvent(error, event) {
      if (event && typeof event === "object") {
        event.isE2EE = true;
        event.isEncrypted = true;
      }
      for (const listener of e2eeListeners) {
        if (event && typeof event === "object") {
          const senderID = event.senderID == null ? null : String(event.senderID);
          const isSelf = senderID !== null && senderID === session.userId;
          if ((event.type === "message" || event.type === "message_reply") && isSelf && !runtimeOptions.selfListen) continue;
          if (event.type !== "message" && event.type !== "message_reply" && !runtimeOptions.listenEvents) continue;
        }
        try { listener(error || null, event); } catch {}
      }
    }
    function getE2EEClient() {
      if (e2eeClient) return e2eeClient;
      const tokens = session.getTokens();
      const ctx = {
        userID: session.userId,
        fb_dtsg: tokens.fbDtsg,
        ttstamp: tokens.jazoest,
        lsd: tokens.lsd,
        clientRevision: tokens.spinR,
        jar: {
          getCookies(url) {
            const header = session.getCookieHeader(url);
            return header ? header.split(/;\s*/).filter(Boolean) : [];
          }
        },
        globalOptions: {
          ...runtimeOptions,
          e2eeDevicePath,
          e2eeStorageKey,
          e2eeDeviceListCacheMs: loginOptions.e2eeDeviceListCacheMs,
          e2eeFrameLog: loginOptions.e2eeFrameLog
        },
        globalCallback: dispatchE2EEEvent
      };
      const defaultFuncs = {
        async post(url, _jar, form) {
          const response = await webClient.post(url, form);
          return response.payload;
        }
      };
      const httpAdapter = createE2EEHttpAdapter({ session, fetchImpl, userAgent: effectiveUserAgent });
      e2eeClient = new E2EEClient(ctx, defaultFuncs, { httpRequest: httpAdapter.request });
      return e2eeClient;
    }
    async function connectE2EE() {
      return getE2EEClient().connect();
    }
    function callE2EE(method, args, callbackIndex = args.length) {
      return new Promise((resolve, reject) => {
        const values = args.slice();
        values.splice(callbackIndex, 0, (error, result) => error ? reject(error) : resolve(result));
        getE2EEClient()[method](...values);
      });
    }
    async function sendE2EEMessage(threadID, message, options = {}) {
      const threadInfo = await threadApi.getThreadInfo(threadID);
      if (!threadInfo || threadInfo.isGroup !== false) {
        const error = new Error("This E2EE implementation currently supports verified one-to-one threads only; group Sender Keys are not implemented");
        error.code = threadInfo?.isGroup === true ? "FCA_E2EE_GROUP_UNSUPPORTED" : "FCA_E2EE_THREAD_TYPE_UNKNOWN";
        error.retryable = false;
        throw error;
      }
      const value = typeof message === "string" ? { body: message } : message;
      if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw new TypeError("E2EE message must be a string or message object");
      }
      if (value.url != null) throw new TypeError("E2EE URL-share messages are not supported; send a text message or encrypted attachment");
      const reply = options.replyToMessageID != null
        ? { quotedId: String(options.replyToMessageID) }
        : null;
      if (value.attachment != null) {
        const file = await readAttachmentInput(value.attachment);
        const mime = file.mimeType.toLowerCase();
        const kind = mime === "image/gif" ? "gif" : mime.startsWith("image/") ? "image" :
          mime.startsWith("video/") ? "video" : mime.startsWith("audio/") ? "audio" : "document";
        const serverMediaType = kind === "document" ? "document" : kind;
        return callE2EE("sendAttachment", [String(threadID), {
          buffer: file.buffer, kind, serverMediaType, mimetype: file.mimeType,
          filename: file.fileName, caption: String(value.body || "")
        }, reply], 2);
      }
      return callE2EE("sendText", [String(threadID), String(value.body || ""), reply], 2);
    }
    async function downloadE2EEAttachment(attachment) {
      return callE2EE("downloadMedia", [attachment]);
    }

    async function assertE2EEOneToOneThread(threadID) {
      const info = await threadApi.getThreadInfo(threadID);
      if (!info || info.isGroup !== false) {
        const error = new Error("E2EE controls currently support verified one-to-one threads only; group Sender Keys are not implemented");
        error.code = info?.isGroup === true ? "FCA_E2EE_GROUP_UNSUPPORTED" : "FCA_E2EE_THREAD_TYPE_UNKNOWN";
        error.retryable = false;
        throw error;
      }
    }
    async function sendE2EEReaction(threadID, messageID, reaction) {
      await assertE2EEOneToOneThread(threadID);
      if (!String(messageID || "").trim()) throw new TypeError("E2EE reaction requires a message ID");
      return callE2EE("sendReaction", [String(threadID), String(messageID), String(reaction)], 3);
    }
    async function editE2EEMessage(threadID, messageID, newText) {
      await assertE2EEOneToOneThread(threadID);
      if (!String(messageID || "").trim()) throw new TypeError("E2EE edit requires a message ID");
      return callE2EE("editMessage", [String(threadID), String(messageID), String(newText)], 3);
    }
    async function unsendE2EEMessage(threadID, messageID) {
      await assertE2EEOneToOneThread(threadID);
      if (!String(messageID || "").trim()) throw new TypeError("E2EE unsend requires a message ID");
      return callE2EE("unsendMessage", [String(threadID), String(messageID)], 2);
    }
    async function sendE2EETyping(threadID, isTyping = true) {
      await assertE2EEOneToOneThread(threadID);
      return callE2EE("sendTyping", [String(threadID), isTyping !== false], 2);
    }

    const stopSessionGuard = async () => {
      if (!guard) return false;
      const active = guard;
      guard = null;
      active.stop();
      try {
        await active.saveNow();
        return true;
      } catch (error) {
        // GoatBot's historical caller does not await this method in every
        // shutdown/recovery path. Resolve safely rather than leaking an
        // unhandled rejection while still closing the guard deterministically.
        try {
          if (typeof sessionGuardOptions.onRecovery === "function") {
            sessionGuardOptions.onRecovery(Object.freeze({
              source: "save", restored: false,
              errorCode: error.code || "FCA_SESSION_GUARD_SAVE_FAILED"
            }));
          }
        } catch {}
        return false;
      } finally {
        active.close();
      }
    };
    async function uploadAttachments(input) {
      const items = Array.isArray(input) ? input : [input];
      if (!items.length || items.length > MAX_ATTACHMENT_COUNT) throw new RangeError("Attachment count must be between 1 and 10");
      const files = [];
      for (const item of items) files.push(await readAttachmentInput(item));
      const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
      if (totalBytes > 10 * 1024 * 1024) throw new RangeError("Combined attachment upload exceeds the 10 MiB safety limit");
      const form = new FormData();
      form.append("voice_clip", "false");
      files.forEach((file, index) => form.append("upload_" + index, new Blob([file.buffer], { type: file.mimeType }), file.fileName));
      const response = await webClient.postMultipart("https://upload.facebook.com/ajax/mercury/upload.php", form);
      const uploadPayload = response?.payload?.payload ?? response?.payload;
      const metadata = uploadPayload?.metadata;
      const entries = Array.isArray(metadata) ? metadata :
        (metadata && typeof metadata === "object" ? Object.keys(metadata).sort((a,b) => Number(a)-Number(b)).map(key => metadata[key]) : []);
      if (entries.length !== files.length) {
        const error = new Error("Facebook did not confirm every uploaded attachment");
        error.code = "FCA_ATTACHMENT_UPLOAD_INCOMPLETE";
        throw error;
      }
      return entries.map((entry, index) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
          const error = new Error("Facebook returned malformed attachment metadata");
          error.code = "FCA_RESPONSE_SHAPE_INVALID";
          throw error;
        }
        const idKey = ["image_id", "video_id", "audio_id", "file_id", "gif_id"].find(key => entry[key] != null);
        if (!idKey || !/^\d{1,40}$/.test(String(entry[idKey]))) {
          const error = new Error("Facebook did not return a supported attachment ID");
          error.code = "FCA_RESPONSE_SHAPE_INVALID";
          throw error;
        }
        const type = idKey === "image_id" ? "image" : idKey === "video_id" ? "video" :
          idKey === "audio_id" ? "audio" : idKey === "gif_id" ? "gif" : "file";
        return Object.freeze({
          attachmentID: String(entry[idKey]), id: String(entry[idKey]),
          idKey, type, fileName: files[index].fileName,
          mimeType: files[index].mimeType, size: files[index].size,
          attachmentUrl: typeof entry.attachmentUrl === "string" ? entry.attachmentUrl : null,
          metadata: entry
        });
      });
    }

    async function sendAttachmentMessage(input) {
      const threadID = String(input?.threadID ?? "");
      if (!/^\d{5,30}$/.test(threadID)) throw new TypeError("threadID must be a numeric Facebook ID");
      const message = typeof input.message === "string" ? { body: input.message } : input.message;
      if (!message || typeof message !== "object" || Array.isArray(message)) throw new TypeError("message must be a string or message object");
      const body = message.body == null ? "" : String(message.body);
      if (Buffer.byteLength(body, "utf8") > 20000) throw new RangeError("message body exceeds 20000 bytes");
      const hasFiles = message.attachment != null;
      const hasUrl = message.url != null;
      if (hasFiles && hasUrl) throw new TypeError("A message can contain attachments or a share URL, not both");
      if (!hasFiles && !hasUrl) throw new TypeError("Attachment message requires attachment or url");
      const offlineId = offlineThreadingId();
      const form = {
        client: "mercury", action_type: "ma-type:user-generated-message",
        author: "fbid:" + session.userId,
        timestamp: Date.now(), timestamp_absolute: "Today",
        timestamp_relative: "0 minutes ago", timestamp_time_passed: "0",
        is_unread: false, is_cleared: false, is_forward: false,
        is_filtered_content: false, is_filtered_content_bh: false,
        is_filtered_content_account: false, is_filtered_content_quasar: false,
        is_filtered_content_invalid_app: false, is_spoof_warning: false,
        source: "source:chat:web", "source_tags[0]": "source:chat",
        body, html_body: false, ui_push_phase: "V3", status: "0",
        offline_threading_id: offlineId, message_id: offlineId,
        threading_id: offlineThreadingId(), "ephemeral_ttl_mode:": "0",
        manual_retry_cnt: "0", has_attachment: true
      };
      if (threadID.length === 15) {
        form["specific_to_list[0]"] = "fbid:" + threadID;
        form["specific_to_list[1]"] = "fbid:" + session.userId;
        form.other_user_fbid = threadID;
      } else form.thread_fbid = threadID;
      if (input.replyToMessageID != null) form.replied_to_message_id = String(input.replyToMessageID);
      let uploadedAttachments = [];
      if (hasFiles) {
        uploadedAttachments = await uploadAttachments(message.attachment);
        const grouped = { image_id: "image_ids", gif_id: "gif_ids", video_id: "video_ids", audio_id: "audio_ids", file_id: "file_ids" };
        const positions = Object.create(null);
        for (const item of uploadedAttachments) {
          const key = grouped[item.idKey];
          const position = positions[key] || 0;
          form[key + "[" + position + "]"] = item.attachmentID;
          positions[key] = position + 1;
        }
      } else {
        const shareUrl = new URL(String(message.url));
        if (!["http:", "https:"].includes(shareUrl.protocol) || shareUrl.username || shareUrl.password) {
          throw new TypeError("Share URL must be a valid HTTP or HTTPS URL without credentials");
        }
        const shared = await webClient.post("https://www.facebook.com/message_share_attachment/fromURI/", {
          image_height: 960, image_width: 960, uri: shareUrl.toString()
        });
        const sharePayload = shared?.payload?.payload ?? shared?.payload;
        const params = sharePayload?.share_data?.share_params;
        if (sharePayload?.error || typeof params !== "string" || !params) {
          const error = new Error("Facebook could not prepare the shared URL");
          error.code = "FCA_ATTACHMENT_SHARE_FAILED";
          throw error;
        }
        form["shareable_attachment[share_type]"] = "100";
        form["shareable_attachment[share_params]"] = params;
      }
      if (Array.isArray(message.mentions)) {
        message.mentions.forEach((mention, index) => {
          if (!mention || typeof mention.tag !== "string") throw new TypeError("Mention tags must be strings");
          const offset = body.indexOf(mention.tag, mention.fromIndex || 0);
          form["profile_xmd[" + index + "][offset]"] = String(offset);
          form["profile_xmd[" + index + "][length]"] = String(mention.tag.length);
          form["profile_xmd[" + index + "][id]"] = String(mention.id ?? 0);
          form["profile_xmd[" + index + "][type]"] = "p";
        });
      }
      const result = await webClient.post("https://www.facebook.com/messaging/send/", form);
      const payload = result?.payload?.payload ?? result?.payload;
      if (!payload || payload.error || !Array.isArray(payload.actions)) {
        const error = new Error("Facebook rejected the attachment message or returned an invalid response");
        error.code = payload?.error ? "FCA_FACEBOOK_REQUEST_REJECTED" : "FCA_RESPONSE_SHAPE_INVALID";
        error.facebookError = payload?.error ?? null;
        throw error;
      }
      const action = payload.actions.find(item => item && (item.message_id || item.thread_fbid)) || payload.actions[0];
      if (!action || !action.message_id) {
        const error = new Error("Facebook did not confirm the sent attachment message");
        error.code = "FCA_RESPONSE_SHAPE_INVALID";
        throw error;
      }
      return {
        threadID: String(action.thread_fbid || threadID),
        messageID: String(action.message_id),
        timestamp: action.timestamp ?? null,
        attachments: uploadedAttachments.map(item => ({ attachmentID: item.attachmentID, type: item.type, fileName: item.fileName, mimeType: item.mimeType, size: item.size }))
      };
    }

    function forwardAttachment(attachmentID, recipients, callback) {
      const operation = (async () => {
        const id = String(attachmentID ?? "");
        if (!/^\d{1,40}$/.test(id)) throw new TypeError("attachmentID must be a numeric Facebook attachment ID");
        const targets = Array.isArray(recipients) ? recipients : [recipients];
        if (!targets.length || targets.length > 20) throw new RangeError("Recipient count must be between 1 and 20");
        const form = { attachment_id: id };
        const timestamp = Math.floor(Date.now() / 1000);
        targets.forEach((target, index) => {
          const recipient = String(target ?? "");
          if (!/^\d{5,30}$/.test(recipient)) throw new TypeError("Every recipient must be a numeric Facebook ID");
          form["recipient_map[" + (timestamp + index) + "]"] = recipient;
        });
        const result = await webClient.post("https://www.facebook.com/mercury/attachments/forward/", form);
        const payload = result?.payload?.payload ?? result?.payload;
        if (!payload || payload.error) {
          const error = new Error("Facebook rejected the attachment forward request");
          error.code = "FCA_FACEBOOK_REQUEST_REJECTED";
          throw error;
        }
        return { success: true, attachmentID: id, recipients: targets.map(String) };
      })();
      return callbackResult(operation, callback);
    }

    const sendBroadcast = createBroadcastSender({
      sendMessage: (message, threadID) => {
        if (message && typeof message === "object" &&
            (message.attachment != null || message.url != null)) {
          return sendAttachmentMessage({ threadID, message });
        }
        return driver.sendMessage({ threadID, message });
      }
    });

    return Object.freeze({
      ...driver,
      ...threadApi,
      sendBroadcast,
      listenE2EE: callback => {
        if (typeof callback !== "function") throw new TypeError("E2EE listener callback is required");
        e2eeListeners.add(callback);
        return () => e2eeListeners.delete(callback);
      },
      listen: callback => {
        if (typeof callback !== "function") throw new TypeError("listener callback is required");
        if (!humanizer) humanizer = createHumanizer({
          sendTypingIndicator: (threadID, isTyping) => threadApi.sendTypingIndicator(threadID, isTyping)
        });
        e2eeListeners.add(callback);
        const detach = driver.listen((error, event) => {
          if (error || !event || typeof event !== "object") {
            if (humanizer) humanizer.stop();
            callback(error || null, event);
            return;
          }
          const senderID = event.senderID == null ? null : String(event.senderID);
          const isSelf = senderID !== null && senderID === session.userId;
          if ((event.type === "message" || event.type === "message_reply") && isSelf && !runtimeOptions.selfListen) return;
          if (event.type === "event" && (isSelf ? !runtimeOptions.selfListenEvent : !runtimeOptions.listenEvents)) return;
          if (event.type === "typ" && !runtimeOptions.listenTyping) return;
          if (event.type === "presence" && !runtimeOptions.updatePresence) return;
          if ((event.type === "message" || event.type === "message_reply") && event.threadID && event.messageID) {
            if (runtimeOptions.autoMarkDelivery && typeof threadApi.markAsDelivered === "function") {
              Promise.resolve(threadApi.markAsDelivered(event.threadID, event.messageID)).catch(() => {});
            }
            if (runtimeOptions.autoMarkRead && typeof threadApi.markAsRead === "function") {
              Promise.resolve(threadApi.markAsRead(event.threadID)).catch(() => {});
            }
          }
          if ((event.type === "message" || event.type === "message_reply") && !isSelf && !event.isE2EE) {
            humanizer.processEvent(event, callback);
            return;
          }
          callback(null, event);
        });
        return () => {
          e2eeListeners.delete(callback);
          if (humanizer) humanizer.stop();
          return detach();
        };
      },
      getHumanizer: () => humanizer,
      uploadAttachment: uploadAttachments,
      downloadAttachment(url, options = {}) { return downloadAttachmentFile(url, { ...options, fetchImpl: options.fetchImpl || fetchImpl }); },
      forwardAttachment,
      connectE2EE(callback) { return callbackResult(connectE2EE(), callback); },
      _connectE2EEAndMerge(callback) { return callbackResult(connectE2EE(), callback); },
      sendE2EEMessage(threadID, message, options = {}, callback) {
        let settings = options;
        let done = callback;
        if (typeof settings === "function") { done = settings; settings = {}; }
        return callbackResult(sendE2EEMessage(threadID, message, settings || {}), done);
      },
      sendE2EEAttachment(threadID, attachment, caption = "", options = {}, callback) {
        let settings = options;
        let done = callback;
        if (typeof settings === "function") { done = settings; settings = {}; }
        return callbackResult(sendE2EEMessage(threadID, { body: caption, attachment }, settings || {}), done);
      },
      downloadE2EEAttachment(attachment, callback) {
        return callbackResult(downloadE2EEAttachment(attachment), callback);
      },
      sendE2EEReaction(threadID, messageID, reaction, callback) {
        return callbackResult(sendE2EEReaction(threadID, messageID, reaction), callback);
      },
      editE2EEMessage(threadID, messageID, newText, callback) {
        return callbackResult(editE2EEMessage(threadID, messageID, newText), callback);
      },
      unsendE2EEMessage(threadID, messageID, callback) {
        return callbackResult(unsendE2EEMessage(threadID, messageID), callback);
      },
      sendE2EETyping(threadID, isTyping = true, callback) {
        return callbackResult(sendE2EETyping(threadID, isTyping), callback);
      },
      isE2EEThread(threadID) {
        return e2eeClient ? e2eeClient.isKnownE2EEThread(String(threadID)) : false;
      },
      getE2EEStatus() {
        return Object.freeze({
          connected: Boolean(e2eeClient && e2eeClient.connected),
          deviceId: e2eeClient && e2eeClient.store ? e2eeClient.store.jidDevice : null,
          persistentStorage: Boolean(e2eeDevicePath),
          storageEncrypted: Boolean(e2eeDevicePath && e2eeStorageKey)
        });
      },
      sendMessage(input, options = {}) {
        const message = typeof input?.message === "string" ? input.message : input?.message;
        const threadID = String(input?.threadID ?? "");
        const requested = options.e2ee ?? (loginOptions.e2ee === true ? "required" : "auto");
        const forceE2EE = requested === true || requested === "required";
        const disableE2EE = requested === false || requested === "disabled";
        const hasSavedE2EEDevice = Boolean(!e2eeClient && e2eeDevicePath && e2eeStorageKey && fs.existsSync(e2eeDevicePath));
        const knownE2EE = !disableE2EE && (
          (e2eeClient && e2eeClient.isKnownE2EEThread(threadID)) ||
          (hasSavedE2EEDevice && getE2EEClient().isKnownE2EEThread(threadID))
        );
        if (forceE2EE || knownE2EE) {
          return sendE2EEMessage(threadID, message, {
            ...options,
            replyToMessageID: input?.replyToMessageID ?? options.replyToMessageID
          });
        }
        if (message && typeof message === "object" && (message.attachment != null || message.url != null)) return sendAttachmentMessage(input);
        return Promise.resolve(driver.sendMessage(input, options))
          .then(response => assertMessengerAccepted(response, "send-message"));
      },
      changeGroupImage(image, threadID, callback) {
        const operation = (async () => {
          const file = await readImageInput(image);
          const form = new FormData();
          form.append("images_only", "true");
          form.append("attachment[]", new Blob([file.buffer], { type: file.mimeType }), file.fileName);
          const uploaded = await webClient.postMultipart("https://www.facebook.com/ajax/mercury/upload.php", form);
          const imageID = uploaded?.payload?.metadata?.[0]?.image_id;
          if (!imageID) {
            const error = new Error("Facebook did not return an uploaded group image ID");
            error.code = "FCA_RESPONSE_SHAPE_INVALID";
            throw error;
          }
          const request = createMessengerChangeGroupImageRequest({ threadID, imageID });
          const response = await driver.sendRequest(request);
          return { success: true, response: response?.payload ?? response };
        })();
        return callbackResult(operation, callback);
      },
      changeAvatar(image, caption, timestamp, callback) {
        let captionText = "";
        let expirationTime = null;
        let done = callback;
        if (typeof caption === "function") done = caption;
        else if (typeof caption === "string") captionText = caption;
        else if (typeof caption === "number") expirationTime = caption;
        if (typeof timestamp === "function") done = timestamp;
        else if (timestamp !== undefined && timestamp !== null) {
          const parsed = Number(timestamp);
          if (!Number.isFinite(parsed) || parsed < 0) throw new TypeError("timestamp must be a non-negative number");
          expirationTime = parsed;
        }
        if (captionText.length > 2000) throw new RangeError("avatar caption exceeds 2000 characters");
        const operation = (async () => {
          const file = await readImageInput(image);
          const form = new FormData();
          form.append("profile_id", session.userId);
          form.append("photo_source", "57");
          form.append("av", session.userId);
          form.append("file", new Blob([file.buffer], { type: file.mimeType }), file.fileName);
          const uploaded = await webClient.postMultipart("https://www.facebook.com/profile/picture/upload/", form);
          const photoID = uploaded?.payload?.fbid;
          if (!photoID) {
            const error = new Error("Facebook did not return an uploaded profile photo ID");
            error.code = "FCA_RESPONSE_SHAPE_INVALID";
            throw error;
          }
          const variables = {
            input: {
              caption: captionText,
              existing_photo_id: String(photoID),
              expiration_time: expirationTime,
              profile_id: session.userId,
              profile_pic_method: "EXISTING",
              profile_pic_source: "TIMELINE",
              scaled_crop_rect: { height: 1, width: 1, x: 0, y: 0 },
              skip_cropping: true,
              actor_id: session.userId,
              client_mutation_id: String(Math.floor(Math.random() * 20))
            },
            isPage: false,
            isProfile: true,
            scale: 3
          };
          const updated = await webClient.post("https://www.facebook.com/api/graphql/", {
            av: session.userId,
            fb_api_req_friendly_name: "ProfileCometProfilePictureSetMutation",
            fb_api_caller_class: "RelayModern",
            doc_id: "5066134240065849",
            variables: JSON.stringify(variables)
          });
          if (updated?.payload?.errors?.length) {
            const error = new Error("Facebook rejected the profile picture update");
            error.code = "FCA_FACEBOOK_REQUEST_REJECTED";
            throw error;
          }
          const result = updated?.payload?.data?.profile_picture_set;
          if (!result) {
            const error = new Error("Facebook returned an invalid profile picture update response");
            error.code = "FCA_RESPONSE_SHAPE_INVALID";
            throw error;
          }
          return result;
        })();
        return callbackResult(operation, done);
      },
      editMessage(text, messageID, callback) {
        const request = createMessengerEditMessageRequest({ text, messageID });
        const operation = driver.sendRequest(request).then(response => {
          const result = extractEditMessageResult(response);
          if (result.body !== text) {
            const error = new Error("The message is too old or not from the authenticated account");
            error.code = "FCA_MESSAGE_EDIT_REJECTED";
            error.result = result;
            throw error;
          }
          return result;
        });
        return callbackResult(operation, callback);
      },
      pinMessage(messageID, threadID, callback) {
        const request = createMessengerPinMessageRequest({ messageID, threadID, pin: true });
        const operation = driver.sendRequest(request).then(response => {
          assertMessengerAccepted(response, "pin-message");
          return response?.payload?.payload ?? response?.payload ?? response;
        });
        return callbackResult(operation, callback);
      },
      unpinMessage(messageID, threadID, callback) {
        const request = createMessengerPinMessageRequest({ messageID, threadID, pin: false });
        const operation = driver.sendRequest(request).then(response => {
          assertMessengerAccepted(response, "unpin-message");
          return response?.payload?.payload ?? response?.payload ?? response;
        });
        return callbackResult(operation, callback);
      },
      shareContact(text, senderID, threadID, callbackOrMessageID, callback) {
        const done = typeof callbackOrMessageID === "function" ? callbackOrMessageID : callback;
        const request = createMessengerShareContactRequest({ text, senderID, threadID });
        const operation = driver.sendRequest(request).then(response => {
          assertMessengerAccepted(response, "share-contact");
          return response?.payload?.payload ?? response?.payload ?? response;
        });
        return callbackResult(operation, done);
      },
      getCurrentUserID: () => session.userId,
      getAppState: () => session.getAppState(),
      // Sensitive legacy FCA compatibility helper. Never log or expose this value to ordinary users.
      getCookies: () => session.getCookieHeader("https://www.facebook.com/"),
      refreshFb_dtsg: () => session.refreshTokens(),
      setOptions: options => {
        if (!options || typeof options !== "object" || Array.isArray(options)) {
          throw new TypeError("setOptions requires an options object");
        }
        const supported = ["logLevel", "selfListen", "selfListenEvent", "listenEvents", "listenTyping", "updatePresence", "autoMarkDelivery", "autoMarkRead"];
        const unsupported = Object.keys(options).filter(key => !supported.includes(key));
        if (unsupported.length) {
          const error = new TypeError("Unsupported native FCA options: " + unsupported.join(", "));
          error.code = "FCA_OPTION_UNSUPPORTED";
          throw error;
        }
        if (options.logLevel !== undefined) {
          if (!["silent", "error", "warn", "info", "debug"].includes(options.logLevel)) {
            throw new TypeError("logLevel must be silent, error, warn, info, or debug");
          }
          runtimeOptions.logLevel = options.logLevel;
        }
        for (const key of supported.slice(1)) {
          if (options[key] !== undefined) {
            if (typeof options[key] !== "boolean") throw new TypeError(key + " must be a boolean");
            runtimeOptions[key] = options[key];
          }
        }
        return Object.freeze({ ...runtimeOptions });
      },
      getSessionState: () => session.state,
      saveSession: callback => {
        if (!guard) {
          const error = new Error("Encrypted SessionGuard is not configured");
          error.code = "FCA_SESSION_GUARD_MISSING";
          throw error;
        }
        return callbackResult(guard.saveNow(), callback);
      },
      restoreSessionBackup: callback => {
        const operation = (async () => {
          if (!guard) {
            const error = new Error("Encrypted SessionGuard is not configured");
            error.code = "FCA_SESSION_GUARD_MISSING";
            throw error;
          }
          const snapshot = guard.restoreBackup();
          if (!snapshot || snapshot.version !== 1 || String(snapshot.userId) !== String(session.userId) ||
              !Array.isArray(snapshot.appState) || snapshot.appState.length === 0) {
            const error = new Error("Encrypted SessionGuard backup is invalid or belongs to another account");
            error.code = "FCA_SESSION_RESTORE_FAILED";
            throw error;
          }
          const previous = session.getAppState();
          try {
            await session.replaceAppState(snapshot.appState);
            await guard.saveNow();
            return Object.freeze({ restored: true, userId: session.userId, cookieCount: session.getAppState().length });
          } catch (error) {
            try { await session.replaceAppState(previous); } catch {}
            throw error;
          }
        })();
        return callbackResult(operation, callback);
      },
      httpPostFormData: (url, formData, callback) =>
        callbackResult(Promise.resolve().then(() => webClient.postMultipart(url, formData)), callback),
      sessionGuard: (requestedPath, legacyOptions = {}) => {
        if (!guard) throw new Error("Encrypted SessionGuard is not configured; set FCA_SESSION_FILE and FCA_SESSION_KEY or pass sessionGuard.filePath/key");
        const paths = guard.getPaths();
        if (requestedPath && path.resolve(requestedPath) !== paths.filePath) {
          if (path.basename(path.resolve(requestedPath)).toLowerCase() !== "account.txt") {
            throw new Error("SessionGuard uses its separately configured encrypted snapshot path");
          }
        }
        // Preserve GoatBot's historical interval option while keeping the
        // encrypted snapshot in its own file. Debounce is not needed because
        // the guard snapshots the current cookie jar on each scheduled save.
        if (legacyOptions && legacyOptions.interval !== undefined) {
          guard.stop();
          guard.start(legacyOptions.interval);
        }
        return Object.freeze({ ...paths, saveNow: guard.saveNow });
      },
      stopSessionGuard,
      disconnectE2EE: () => {
        if (!e2eeClient) return false;
        const client = e2eeClient;
        e2eeClient = null;
        client.disconnect();
        return true;
      },
      disconnect: async () => {
        if (closed) return;
        closed = true;
        if (humanizer) humanizer.stop();
        try {
          try { if (e2eeClient) e2eeClient.disconnect(); }
          finally {
            try { await stopSessionGuard(); }
            finally { await transport.disconnect(); }
          }
        } finally { session.close(); }
      }
    });
  } catch (error) {
    if (guard) { try { guard.close(); } catch {} }
    try { if (transport) await transport.disconnect(); } catch {}
    if (session) session.close();
    throw error;
  }
}

module.exports = { createFacebookMqttDriver };
