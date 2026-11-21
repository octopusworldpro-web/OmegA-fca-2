"use strict";

const { validateSessionCookies, parseCookieHeader } = require("../security/cookies");
const { ConnectionSupervisor } = require("../runtime/connection");
const { verifyLicenseToken } = require("../license/verify");
const { validateTransportDriver } = require("../transport/contract");
const { classifySessionState } = require("../security/sessionState");

const METHOD_FEATURES = Object.freeze({
  sendRequest: "messaging", sendMessage: "messaging", sendBroadcast: "messaging", connectE2EE: "e2ee", _connectE2EEAndMerge: "e2ee", disconnectE2EE: "e2ee", listenE2EE: "e2ee", sendE2EEMessage: "e2ee", sendE2EEReaction: "e2ee", editE2EEMessage: "e2ee", unsendE2EEMessage: "e2ee", sendE2EETyping: "e2ee", sendE2EEAttachment: "e2ee", downloadE2EEAttachment: "e2ee", isE2EEThread: "e2ee", getE2EEStatus: "e2ee", editMessage: "messaging",
  shareContact: "messaging", uploadAttachment: "messaging", downloadAttachment: "messaging", forwardAttachment: "messaging", unsendMessage: "messaging", markAsRead: "messaging",
  markAsDelivered: "messaging", markAsReadAll: "messaging", markAsSeen: "messaging", deleteMessage: "messaging", deleteThread: "threads", muteThread: "threads", changeArchivedStatus: "threads", sendTypingIndicator: "messaging",
  getUserInfo: "threads", getThreadInfo: "threads", getThreadList: "threads",
  getThreadHistory: "threads", getMessage: "threads", getFriendsList: "threads", getThreadPictures: "threads", searchForThread: "threads", handleMessageRequest: "threads", changeAdminStatus: "groups", createPoll: "groups",
  getUserID: "threads", getUID: "threads", resolvePhotoUrl: "threads",
  createNewGroup: "groups", addUserToGroup: "groups", removeUserFromGroup: "groups",
  changeNickname: "groups", changeAdminStatus: "groups", createPoll: "groups", changeGroupImage: "groups", changeAvatar: "groups", changeBlockedStatus: "users", changeBio: "users", unfriend: "users",
  changeThreadColor: "groups", changeThreadEmoji: "groups", setTitle: "groups",
  pinMessage: "groups", unpinMessage: "groups", sendFriendRequest: "users", followUser: "users", unfollowUser: "users", postComment: "users", sharePost: "posts",
  setMessageReaction: "reactions", setPostReaction: "reactions", reactToPost: "reactions", reactToComment: "reactions", handleFriendRequest: "users"
});

const DRIVER_METHODS = [
  "sendRequest", "sendMessage", "sendBroadcast", "connectE2EE", "_connectE2EEAndMerge", "disconnectE2EE", "listenE2EE", "sendE2EEMessage", "sendE2EEReaction", "editE2EEMessage", "unsendE2EEMessage", "sendE2EETyping", "sendE2EEAttachment", "downloadE2EEAttachment", "isE2EEThread", "getE2EEStatus", "editMessage", "shareContact", "uploadAttachment", "downloadAttachment", "forwardAttachment", "httpGet", "httpPost", "httpPostFormData", "getUserInfo", "getThreadInfo", "getThreadList", "getCurrentUserID", "getAppState", "getCookies", "getHumanizer", "refreshFb_dtsg", "saveSession", "restoreSessionBackup", "setOptions",
  "markAsRead", "markAsReadAll", "markAsSeen", "markAsDelivered", "setPostReaction", "reactToPost", "reactToComment", "handleFriendRequest", "deleteMessage", "deleteThread", "muteThread", "changeArchivedStatus", "setMessageReaction", "sendTypingIndicator", "unsendMessage",
  "changeNickname", "changeAdminStatus", "createPoll", "handleMessageRequest", "searchForThread", "getThreadPictures", "changeBlockedStatus", "changeBio", "unfriend", "getEmojiUrl", "changeGroupImage", "changeAvatar", "changeThreadColor", "changeThreadEmoji", "setTitle", "addUserToGroup", "removeUserFromGroup", "createNewGroup",
  "getThreadHistory", "getMessage", "getFriendsList", "getUserID", "getUID", "resolvePhotoUrl", "pinMessage", "unpinMessage", "sendFriendRequest", "followUser", "unfollowUser", "postComment", "sharePost"
];

function createClient({ authenticate, options = {}, reconnect = {}, license = {}, requireLicense = false, onLicenseError = () => {} } = {}) {
  if (typeof authenticate !== "function") throw new TypeError("authenticate transport factory is required");
  let supervisor = null;
  let api = null;
  let userId = null;
  let verifiedLicense = null;
  let detachMqtt = null;
  let mqttErrorHandler = null;
  let licenseTimer = null;
  let licenseCheckPromise = null;
  let loginPromise = null;
  let logoutPromise = null;

  async function checkLicense() {
    if (!requireLicense) return null;
    if (licenseCheckPromise) return licenseCheckPromise;
    licenseCheckPromise = (async () => {
      const token = typeof license.refresh === "function" ? await license.refresh() : license.token;
      verifiedLicense = verifyLicenseToken(token, license.publicKey, {
        installationId: license.installationId,
        ownerId: license.ownerId
      });
      return verifiedLicense;
    })().finally(() => { licenseCheckPromise = null; });
    return licenseCheckPromise;
  }

  function startLicenseMonitor() {
    if (!requireLicense || licenseTimer) return;
    const interval = Number.isInteger(license.checkIntervalMs) && license.checkIntervalMs >= 30_000
      ? license.checkIntervalMs : 5 * 60 * 1000;
    licenseTimer = setInterval(async () => {
      try {
        await checkLicense();
      } catch (error) {
        clearInterval(licenseTimer);
        licenseTimer = null;
        try { if (supervisor) await supervisor.stop(); } catch {}
        supervisor = null;
        api = null;
        userId = null;
        try { onLicenseError(error); } catch {}
      }
    }, interval);
    if (typeof licenseTimer.unref === "function") licenseTimer.unref();
  }

  function stopLicenseMonitor() {
    if (licenseTimer) clearInterval(licenseTimer);
    licenseTimer = null;
  }

  async function performLogin(credentials = {}, loginOptions = options) {
    if (supervisor && supervisor.snapshot().connected) return api;
    if (supervisor && ["connecting", "reconnecting"].includes(supervisor.snapshot().state)) {
      throw new Error("A login attempt is already in progress");
    }
    if (supervisor && ["failed", "stopped"].includes(supervisor.snapshot().state)) {
      await supervisor.stop();
      supervisor = null;
    }
    await checkLicense();
    const mode = credentials.mode;
    let normalized;
    if (mode === "appstate") {
      normalized = validateSessionCookies(credentials.appState);
    } else if (mode === "cookie") {
      normalized = validateSessionCookies(parseCookieHeader(credentials.cookie));
    } else if (mode === "session") {
      normalized = null;
    } else if (mode === "credentials") {
      throw new TypeError("Facebook email/username and password login is deferred; use an authorized AppState or encrypted session");
    } else {
      throw new TypeError("Login mode must be appstate, cookie, or session");
    }

    let lastConnectError = null;
    supervisor = new ConnectionSupervisor({
      connect: async context => {
        let result;
        try {
          result = await authenticate({ mode, credentials: normalized, options: loginOptions || {}, context, license: verifiedLicense });
        } catch (caught) {
          // Provider-controlled messages and causes may echo credentials,
          // cookies, challenge answers, or tokens. Classify privately, then
          // expose only a fixed safe error to the application.
          const sessionState = classifySessionState(caught);
          // Keep authentication failures distinct from failures that occur
          // after AppState validation (for example MQTT CONNACK/SUBACK or
          // WebSocket setup). Only allowlist stable, non-secret FCA codes;
          // never forward provider messages or arbitrary error properties.
          const safeProviderCode = typeof caught?.code === "string" &&
            /^FCA_(?:MQTT_[A-Z0-9_]+|WS_[A-Z0-9_]+|SESSION_[A-Z0-9_]+|CHALLENGE_LIMIT|UPSTREAM_UNAVAILABLE|RESPONSE_TOO_LARGE)$/.test(caught.code)
            ? caught.code : null;
          const isRealtimeFailure = safeProviderCode &&
            (safeProviderCode.startsWith("FCA_MQTT_") || safeProviderCode.startsWith("FCA_WS_"));
          const error = new Error(sessionState === "checkpoint"
            ? "Facebook requires the account owner to complete a checkpoint"
            : sessionState === "logged_out"
              ? "The Facebook session has expired; supply a fresh authorized AppState"
              : isRealtimeFailure
                ? "Facebook session was accepted, but Messenger realtime setup failed (" + safeProviderCode + ")"
                : safeProviderCode === "FCA_SESSION_GUARD_MISSING" || safeProviderCode === "FCA_SESSION_SNAPSHOT_MISSING" || safeProviderCode === "FCA_SESSION_RESTORE_FAILED"
                  ? "No usable encrypted saved Facebook session is available; supply AppState or configure SessionGuard"
                  : "Authentication failed; inspect provider diagnostics securely");
          if (sessionState === "checkpoint") {
            error.code = "FCA_CHECKPOINT_REQUIRED";
            error.sessionState = sessionState;
            error.retryable = false;
          } else if (sessionState === "logged_out") {
            error.code = "FCA_SESSION_EXPIRED";
            error.sessionState = sessionState;
            error.retryable = false;
          } else {
            error.code = safeProviderCode || "FCA_AUTHENTICATION_FAILED";
            error.retryable = typeof caught?.retryable === "boolean" ? caught.retryable : true;
          }
          lastConnectError = error;
          throw error;
        }
        try {
          return validateTransportDriver(result);
        } catch (error) {
          // Preserve the local contract error for the caller, while disposing
          // any provider resource allocated before the invalid result.
          lastConnectError = error;
          if (result && typeof result.disconnect === "function") {
            try { await result.disconnect(); }
            catch (cleanupError) { error.cleanupError = cleanupError; }
          }
          throw error;
        }
      },
      disconnect: async driver => {
        if (typeof driver.disconnect === "function") await driver.disconnect();
      },
      options: reconnect
    });
    const driver = await supervisor.start();
    if (!driver) throw lastConnectError || new Error("Connection stopped before authentication completed");
    let currentUserId;
    try {
      currentUserId = typeof driver.getCurrentUserID === "function" ? await driver.getCurrentUserID() : null;
    } catch (error) {
      // A driver that connects but cannot complete identity initialization must
      // not leave an unreachable live session behind.
      try { await supervisor.stop(); }
      catch (cleanupError) { error.cleanupError = cleanupError; }
      finally { supervisor = null; }
      throw error;
    }
    userId = currentUserId == null ? null : String(currentUserId);
    const facade = {};
    for (const method of DRIVER_METHODS) {
      if (typeof driver[method] === "function") {
        facade[method] = (...args) => {
          const feature = METHOD_FEATURES[method];
          if (requireLicense && feature && !verifiedLicense.features.includes(feature)) {
            const error = new Error("License does not include the " + feature + " feature");
            error.code = "FCA_LICENSE_FEATURE_DENIED";
            return Promise.reject(error);
          }
          return driver[method](...args);
        };
      }
    }
    if (typeof driver.sendMessage === "function") {
      facade.sendMessage = (message, threadID, callback, replyToMessageID) => {
        let input;
        let done;
        let requestOptions;
        if (typeof threadID === "string" || typeof threadID === "number") {
          input = { threadID, message };
          done = typeof callback === "function" ? callback : null;
          // Some legacy FCA call sites pass the reply ID as argument three,
          // omitting the optional callback. Preserve that overload.
          const replyID = replyToMessageID != null
            ? replyToMessageID
            : (typeof callback === "string" || typeof callback === "number" ? callback : null);
          if (replyID != null) input.replyToMessageID = replyID;
        } else {
          input = message;
          done = typeof threadID === "function" ? threadID : null;
          requestOptions = threadID && typeof threadID === "object" ? threadID : undefined;
        }
        const operation = Promise.resolve().then(() => driver.sendMessage(input, requestOptions));
        if (done) {
          operation.then(value => done(null, value), error => done(error));
          return undefined;
        }
        return operation;
      };
    }
    if (typeof driver.sendMessage === "function") {
      const sendCompatibilityPayload = (message, threadID, callback) => {
        const operation = Promise.resolve().then(() => facade.sendMessage({ threadID, message }));
        if (typeof callback === "function") {
          operation.then(value => callback(null, value), error => callback(error));
          return undefined;
        }
        return operation;
      };
      const mediaPayload = (attachment, caption) => ({
        body: caption == null ? "" : String(caption),
        attachment
      });
      const parseCaptionCallback = (caption, callback) =>
        typeof caption === "function" ? { caption: "", callback: caption } : { caption: caption ?? "", callback };

      facade.sendImage = (image, threadID, caption, callback) => {
        const parsed = parseCaptionCallback(caption, callback);
        const message = typeof image === "string" && (image.startsWith("https://") || image.startsWith("http://"))
          ? { body: String(parsed.caption), url: image }
          : mediaPayload(image, parsed.caption);
        return sendCompatibilityPayload(message, threadID, parsed.callback);
      };
      facade.sendVideo = (video, threadID, caption, callback) => {
        const parsed = parseCaptionCallback(caption, callback);
        return sendCompatibilityPayload(mediaPayload(video, parsed.caption), threadID, parsed.callback);
      };
      facade.sendAudio = (audio, threadID, caption, callback) => {
        const parsed = parseCaptionCallback(caption, callback);
        return sendCompatibilityPayload(mediaPayload(audio, parsed.caption), threadID, parsed.callback);
      };
      facade.sendFile = (file, threadID, caption, callback) => {
        const parsed = parseCaptionCallback(caption, callback);
        return sendCompatibilityPayload(mediaPayload(file, parsed.caption), threadID, parsed.callback);
      };
      facade.sendGif = (gif, threadID, caption, callback) => {
        const parsed = parseCaptionCallback(caption, callback);
        const message = typeof gif === "string" && (gif.startsWith("https://") || gif.startsWith("http://"))
          ? { body: String(parsed.caption), url: gif }
          : mediaPayload(gif, parsed.caption);
        return sendCompatibilityPayload(message, threadID, parsed.callback);
      };
      facade.shareLink = (url, threadID, caption, callback) => {
        const parsed = parseCaptionCallback(caption, callback);
        if (typeof url !== "string" || !(url.startsWith("https://") || url.startsWith("http://"))) throw new TypeError("shareLink URL must use HTTP or HTTPS");
        return sendCompatibilityPayload({ body: String(parsed.caption), url }, threadID, parsed.callback);
      };
      facade.sendLocation = (latitude, longitude, threadID, callback) => {
        if (latitude && typeof latitude === "object") {
          const location = latitude;
          const target = longitude;
          const done = typeof threadID === "function" ? threadID : callback;
          return sendCompatibilityPayload({ location }, target, done);
        }
        return sendCompatibilityPayload({ location: { latitude, longitude } }, threadID, callback);
      };
    }
    if (typeof driver.getUserID !== "function") {
      facade.getUserID = () => userId;
    }
    facade.getCurrentUserID = () => userId;
    facade.listen = callback => {
      if (requireLicense && !verifiedLicense.features.includes("events")) throw new Error("License does not include the events feature");
      return supervisor.listen(callback);
    };
    facade.listenMqtt = callback => {
      if (requireLicense && !verifiedLicense.features.includes("events")) throw new Error("License does not include the events feature");
      if (typeof callback !== "function") throw new TypeError("MQTT callback is required");
      if (detachMqtt) throw new Error("MQTT listener is already active");
      mqttErrorHandler = error => callback(error, null);
      supervisor.on("listenerError", mqttErrorHandler);
      try {
        const detach = supervisor.listen(event => callback(null, event));
        detachMqtt = () => {
          supervisor.off("listenerError", mqttErrorHandler);
          mqttErrorHandler = null;
          detach();
          detachMqtt = null;
        };
        // FCA-compatible readiness signal: the native driver has already
        // completed AppState validation, MQTT CONNACK and topic subscription
        // before the client is exposed. This lets GoatBot gate startup/recovery
        // on an explicit ready event instead of guessing from socket creation.
        queueMicrotask(() => {
          if (detachMqtt) {
            try {
              callback(null, Object.freeze({
                type: "ready",
                source: "omega-fca",
                connectionState: supervisor.snapshot()
              }));
            } catch (error) {
              try { supervisor.emit("listenerCallbackError", error); } catch {}
            }
          }
        });
        return detachMqtt;
      } catch (error) {
        // Roll back the error subscription if listener attachment fails.
        supervisor.off("listenerError", mqttErrorHandler);
        mqttErrorHandler = null;
        throw error;
      }
    };
    facade.stopListening = callback => {
      if (detachMqtt) detachMqtt();
      if (typeof callback === "function") callback();
      return true;
    };
    facade.stopSessionGuard = typeof driver.stopSessionGuard === "function" ? driver.stopSessionGuard.bind(driver) : undefined;
    facade.sessionGuard = typeof driver.sessionGuard === "function" ? driver.sessionGuard.bind(driver) : undefined;
    facade.setOptions = typeof driver.setOptions === "function" ? driver.setOptions.bind(driver) : undefined;
    facade.getCapabilities = () => Object.freeze({
      methods: Object.freeze(DRIVER_METHODS.filter(method => typeof driver[method] === "function")),
      events: typeof driver.listen === "function",
      sessionGuard: typeof driver.sessionGuard === "function",
      e2ee: typeof driver.connectE2EE === "function" && typeof driver.sendE2EEMessage === "function"
    });
    if (typeof driver.createNewGroup === "function") {
      facade.createGroup = (groupTitle, participantIDs, callback) =>
        facade.createNewGroup(participantIDs, groupTitle, callback);
    }
    if (typeof facade.getUserInfo === "function") {
      facade.getProfileInfo = (userID, callback) => facade.getUserInfo(userID, callback);
      facade.getPublicData = (userID, callback) => facade.getUserInfo(userID, callback);
      facade.getAvatarUser = (userID, callback) => {
        const operation = Promise.resolve().then(() => facade.getUserInfo(userID)).then(profiles => {
          const profile = profiles && (profiles[String(userID)] || Object.values(profiles)[0]);
          return profile?.thumbSrc ?? null;
        });
        if (typeof callback === "function") {
          operation.then(value => callback(null, value), error => callback(error));
          return undefined;
        }
        return operation;
      };
    }
    if (typeof driver.getE2EEStatus === "function") {
      facade.e2ee = Object.freeze({
        connect: typeof facade.connectE2EE === "function" ? facade.connectE2EE : undefined,
        disconnect: typeof facade.disconnectE2EE === "function" ? facade.disconnectE2EE : undefined,
        isConnected: () => Boolean(driver.getE2EEStatus().connected),
        getStatus: () => driver.getE2EEStatus(),
        isThread: typeof facade.isE2EEThread === "function" ? facade.isE2EEThread : undefined,
        sendMessage: typeof facade.sendE2EEMessage === "function" ? facade.sendE2EEMessage : undefined,
        sendAttachment: typeof facade.sendE2EEAttachment === "function" ? facade.sendE2EEAttachment : undefined,
        downloadAttachment: typeof facade.downloadE2EEAttachment === "function" ? facade.downloadE2EEAttachment : undefined,
        listen: typeof facade.listenE2EE === "function" ? facade.listenE2EE : undefined,
        sendReaction: typeof facade.sendE2EEReaction === "function" ? facade.sendE2EEReaction : undefined,
        editMessage: typeof facade.editE2EEMessage === "function" ? facade.editE2EEMessage : undefined,
        unsendMessage: typeof facade.unsendE2EEMessage === "function" ? facade.unsendE2EEMessage : undefined,
        sendTyping: typeof facade.sendE2EETyping === "function" ? facade.sendE2EETyping : undefined
      });
    }
    const externalMethods = new Map();
    facade.addExternalModule = module => {
      if (!module || typeof module !== "object" || Array.isArray(module)) {
        throw new TypeError("addExternalModule requires an object of named functions");
      }
      const names = [];
      for (const [name, method] of Object.entries(module)) {
        if (!/^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/.test(name) ||
            ["__proto__", "prototype", "constructor", "addExternalModule"].includes(name) ||
            Object.prototype.hasOwnProperty.call(facade, name) ||
            DRIVER_METHODS.includes(name) || externalMethods.has(name) || typeof method !== "function") {
          throw new TypeError("External FCA module contains an invalid, duplicate, or reserved method: " + name);
        }
        externalMethods.set(name, method.bind(facade));
        names.push(name);
      }
      return Object.freeze(names);
    };
    facade.logout = callback => logout(callback);
    facade.getConnectionState = () => supervisor.snapshot();
    facade.getLicense = () => verifiedLicense;
    api = new Proxy(Object.freeze(facade), {
      get(target, property, receiver) {
        if (typeof property === "string" && externalMethods.has(property)) return externalMethods.get(property);
        return Reflect.get(target, property, receiver);
      }
    });
    startLicenseMonitor();
    return api;
  }

  function login(credentials = {}, loginOptions = options) {
    if (logoutPromise) {
      return Promise.reject(new Error("Logout is already in progress"));
    }
    if (loginPromise) {
      return Promise.reject(new Error("A login attempt is already in progress"));
    }
    // Reserve the login slot synchronously, before performLogin reaches its
    // first await, so concurrent callers cannot create two live supervisors.
    loginPromise = performLogin(credentials, loginOptions).finally(() => {
      loginPromise = null;
    });
    return loginPromise;
  }

  function logout(callback) {
    stopLicenseMonitor();
    const pendingLogin = loginPromise;
    if (!logoutPromise) {
      logoutPromise = (async () => {
        // If logout races authentication, wait for that attempt to settle and
        // then dispose any session it managed to establish.
        if (pendingLogin) {
          try { await pendingLogin; } catch {}
        }
        if (detachMqtt) detachMqtt();
        if (supervisor) await supervisor.stop();
        supervisor = null;
        api = null;
        userId = null;
        verifiedLicense = null;
      })().finally(() => {
        logoutPromise = null;
      });
    }
    const operation = logoutPromise;
    if (typeof callback === "function") {
      operation.then(() => callback(null), error => callback(error));
      return undefined;
    }
    return operation;
  }

  return Object.freeze({
    login,
    logout,
    getConnectionState: () => supervisor ? supervisor.snapshot() : Object.freeze({ state: "idle", connected: false, generation: 0 }),
    getLicense: () => verifiedLicense
  });
}

module.exports = { createClient };
