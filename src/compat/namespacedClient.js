"use strict";

function bindIfAvailable(api, name, alias) {
  const method = api[name];
  return typeof method === "function" ? [alias || name, method.bind(api)] : null;
}

function group(api, entries) {
  const result = {};
  for (const [name, alias] of entries) {
    const bound = bindIfAvailable(api, name, alias);
    if (bound) result[bound[0]] = bound[1];
  }
  return Object.freeze(result);
}

/**
 * Builds the domain-grouped API facade documented by EryXen's createFcaClient.
 * Only methods actually provided by the supplied FCA client are exposed.
 */
function createFcaClient(api) {
  if (!api || typeof api !== "object") throw new TypeError("createFcaClient requires an FCA API object");

  const messages = group(api, [
    ["sendMessage", "send"], ["sendBroadcast", "broadcast"],
    ["sendImage"], ["sendVideo"], ["sendAudio"], ["sendFile"], ["sendGif"],
    ["sendLocation"], ["shareLink"], ["shareContact"],
    ["editMessage", "edit"], ["unsendMessage", "unsend"], ["deleteMessage", "delete"],
    ["setMessageReaction", "react"], ["setPostReaction", "reactToPost"], ["reactToComment"], ["getMessage", "get"],
    ["uploadAttachment", "upload"], ["downloadAttachment", "download"],
    ["forwardAttachment", "forward"], ["sendTypingIndicator", "typing"],
    ["markAsRead"], ["markAsReadAll"], ["markAsDelivered"], ["markAsSeen"]
  ]);
  const threads = group(api, [
    ["getThreadInfo", "getInfo"], ["getThreadList", "getList"],
    ["getThreadHistory", "getHistory"], ["deleteThread", "delete"],
    ["muteThread", "mute"], ["changeArchivedStatus", "archive"],
    ["handleMessageRequest", "handleRequest"], ["searchForThread", "search"],
    ["getThreadPictures", "getPictures"], ["createGroup", "createGroup"],
    ["setTitle"], ["changeThreadColor", "changeColor"],
    ["changeThreadEmoji", "changeEmoji"], ["changeNickname"],
    ["changeGroupImage", "changeImage"], ["changeAdminStatus"], ["createPoll"], ["pinMessage", "pin"], ["unpinMessage", "unpin"]
  ]);
  const users = group(api, [
    ["getUserInfo", "getInfo"], ["getUserID", "getId"], ["getUID", "getUid"],
    ["getFriendsList", "getFriends"], ["getAvatarUser", "getAvatar"],
    ["getProfileInfo"], ["getPublicData"], ["changeBlockedStatus", "block"],
    ["sendFriendRequest"], ["handleFriendRequest"], ["followUser"],
    ["unfollowUser"], ["unfriend"]
  ]);
  const posts = group(api, [
    ["setPostReaction", "react"], ["reactToPost"], ["reactToComment"],
    ["postComment", "comment"], ["sharePost", "share"]
  ]);
  const media = group(api, [["uploadImageToImgbb", "uploadToImgbb"]]);
  const account = group(api, [
    ["getCurrentUserID", "getCurrentUserId"], ["getAppState"],
    ["getCookies"], ["refreshFb_dtsg", "refreshDtsg"],
    ["setOptions"], ["logout"], ["saveSession"], ["restoreSessionBackup"],
    ["stopSessionGuard"], ["addExternalModule"]
  ]);

  return Object.freeze({ messages, threads, users, posts, media, account });
}

module.exports = { createFcaClient };
