import type { EventEmitter } from "node:events";

export type LoginMode = "appstate" | "cookie" | "session";
export type AuthenticationAttemptState = "idle" | "authenticating" | "challenge_required" | "verifying_challenge" | "authenticated" | "failed" | "closed";
export interface AuthenticationChallenge { readonly type: string; readonly message: string | null; readonly methods: readonly string[]; }
export interface AuthenticationAttemptSnapshot { readonly state: AuthenticationAttemptState; readonly challenge: AuthenticationChallenge | null; readonly challengeRounds: number; readonly authenticated: boolean; readonly error: Readonly<{ name: string; code: string | null; message: string }> | null; }
export interface AuthenticationAttemptSession { close?(): void | Promise<void>; [key: string]: unknown; }
export type AuthenticationAttemptProviderResult = { status: "authenticated"; session: AuthenticationAttemptSession; } | { status: "challenge_required"; challenge: { type?: string; message?: string; methods?: string[] }; resume(answer: string | Record<string, unknown>): Promise<AuthenticationAttemptProviderResult> | AuthenticationAttemptProviderResult; cancel?(): void | Promise<void>; }
export function createAuthenticationAttempt(options: { authenticate(input: { credentials: Record<string, unknown>; options: Record<string, unknown> }): Promise<AuthenticationAttemptProviderResult> | AuthenticationAttemptProviderResult; maxChallengeRounds?: number }): Readonly<{ begin(credentials: Record<string, unknown>, options?: Record<string, unknown>): Promise<AuthenticationAttemptSession | null>; submitChallenge(answer: string | Record<string, unknown>): Promise<AuthenticationAttemptSession | null>; close(): Promise<void>; snapshot(): AuthenticationAttemptSnapshot }>;
export const AUTHENTICATION_ATTEMPT_STATES: readonly AuthenticationAttemptState[];
export interface Cookie {
  key: string; value: string; domain?: string; path?: string; hostOnly?: boolean;
  secure?: boolean; httpOnly?: boolean; sameSite?: string; expires?: number | null;
}
export interface Credentials {
  mode: LoginMode; appState?: Cookie[]; cookie?: string;
}
export interface PersonalSessionOptions {
  appState: Cookie[];
  fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>;
  userAgent?: string;
  timeoutMs?: number;
  onDiagnostic?: (event: SafeDiagnosticEvent) => void;
}
export interface PersonalSession {
  readonly userId: string;
  readonly state: "active";
  readonly validatedAt: number;
  getTokens(): FacebookRequestTokens;
  refreshTokens(): Promise<Readonly<{ refreshedAt: number; tokenNames: readonly string[] }>>;
  getCookieHeader(url?: string | URL): string;
  request(input: string | URL, options?: RequestInit): Promise<Response>;
  getAppState(): Cookie[];
  close(): void;
}
export interface SafeDiagnosticEvent { readonly at: string; readonly phase: "request" | "response" | "error"; readonly method: string; readonly url: Readonly<{ origin: string | null; path: string | null; queryParameterNames: readonly string[] }>; readonly requestHeaders: readonly string[]; readonly requestBodyBytes: number; readonly requestFieldNames: readonly string[]; readonly sensitiveFieldCount: number; readonly fieldsTruncated: boolean; readonly status?: number; readonly contentType?: string; readonly responseBodyBytes?: number; readonly errorCode?: string; readonly durationMs?: number; }
export interface DiagnosticRecorder { record(input?: Record<string, unknown>): SafeDiagnosticEvent; snapshot(): Readonly<{ version: number; generatedAt: string; events: readonly SafeDiagnosticEvent[] }>; toJSON(): string; clear(): void; }
export function createDiagnosticRecorder(options?: { maxEvents?: number; clock?: () => number }): DiagnosticRecorder;
export function createPersonalSession(options: PersonalSessionOptions): Promise<PersonalSession>;
export function detectSessionChallenge(response: Response, html: string): "active" | "checkpoint" | "logged_out";
export function extractIdentity(html: string): string | null;
export interface FacebookRequestTokens {
  fbDtsg: string | null; lsd: string | null; jazoest: string | null;
  hsi: string | null; spinR: string | null; spinB: string | null; spinT: string | null;
}
export function extractFacebookTokens(html: string): FacebookRequestTokens;
export interface FacebookWebRequestResult {
  status: number; headers: Headers; payload: unknown; raw: string;
}
export interface FacebookWebClient {
  request(input: string | URL, options?: {
    method?: "GET" | "HEAD" | "POST"; query?: Record<string, string | number | boolean>;
    body?: Record<string, unknown> | URLSearchParams | string | Uint8Array;
    headers?: HeadersInit; signal?: AbortSignal;
  }): Promise<FacebookWebRequestResult>;
  get(input: string | URL, options?: { query?: Record<string, string | number | boolean>; headers?: HeadersInit; signal?: AbortSignal }): Promise<FacebookWebRequestResult>;
  post(input: string | URL, body?: Record<string, unknown> | URLSearchParams | string | Uint8Array, options?: { headers?: HeadersInit; signal?: AbortSignal }): Promise<FacebookWebRequestResult>;
}
export function createFacebookWebClient(options: {
  session: PersonalSession;
  normalizeResponse?: typeof normalizeFacebookResponse;
}): FacebookWebClient;
export function assertFacebookUrl(input: string | URL): URL;
export function toFormBody(data: Record<string, unknown>, tokens: FacebookRequestTokens, userId: string): URLSearchParams;
export interface FacebookResponseError extends Error {
  code: string; status: number | null;
  sessionState: "checkpoint" | "logged_out" | "error";
  retryable: boolean;
}
export function normalizeFacebookResponse(body: string, options?: { status?: number; contentType?: string }): unknown;
export function stripFacebookJsonPrefix(body: string): string;
export function createFacebookError(message: string, options?: {
  code?: string; status?: number; sessionState?: "checkpoint" | "logged_out" | "error"; retryable?: boolean;
}): FacebookResponseError;
export interface ConnectionContext { attempt: number; generation: number; signal: AbortSignal; }
export interface E2EEStatus {
  connected: boolean;
  deviceId: number | null;
  persistentStorage: boolean;
  storageEncrypted: boolean;
}
export interface E2EELoginOptions {
  /** Enable encrypted device persistence with an explicit 32-byte key (Buffer/Uint8Array) or 64-character hex string. */
  e2eeStorageKey?: string | Buffer | Uint8Array;
  /** Optional encrypted E2EE device-store path. Defaults to ~/.omega-fca/e2ee/<userId>.json when a key is supplied. */
  e2eeDevicePath?: string;
  e2eeDeviceListCacheMs?: number;
  e2eeFrameLog?: string;
  e2ee?: boolean;
}
export interface TransportDriver {
  connectE2EE?(callback?: (error: Error | null, result?: { userId: string; deviceId: number }) => void): Promise<{ userId: string; deviceId: number }> | void;
  listenE2EE?(callback: (error: Error | null, event?: unknown) => void): () => void;
  sendE2EEReaction?(threadID: string | number, messageID: string, reaction: string, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  editE2EEMessage?(threadID: string | number, messageID: string, newText: string, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  unsendE2EEMessage?(threadID: string | number, messageID: string, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  sendE2EETyping?(threadID: string | number, isTyping?: boolean, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  _connectE2EEAndMerge?(callback?: (error: Error | null, result?: { userId: string; deviceId: number }) => void): Promise<{ userId: string; deviceId: number }> | void;
  sendE2EEMessage?(threadID: string | number, message: string | { body?: string; attachment?: AttachmentInput }, options?: { replyToMessageID?: string | number } | ((error: Error | null, result?: unknown) => void), callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  sendE2EEAttachment?(threadID: string | number, attachment: AttachmentInput, caption?: string, options?: { replyToMessageID?: string | number } | ((error: Error | null, result?: unknown) => void), callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  downloadE2EEAttachment?(attachment: Record<string, unknown>, callback?: (error: Error | null, buffer?: Buffer) => void): Promise<Buffer> | void;
  isE2EEThread?(threadID: string | number): boolean; disconnectE2EE?(): boolean;
  getE2EEStatus?(): E2EEStatus;
  listen(callback: (error: Error | null, event?: unknown) => void): (() => void) | void;
  disconnect?(): void | Promise<void>; getCurrentUserID?(): string | number | null | Promise<string | number | null>; getAppState?(): Cookie[] | Promise<Cookie[]>; saveSession?(): Promise<string>; restoreSessionBackup?(): Promise<{ restored: true; userId: string; cookieCount: number }>; getCookies?(): string | Promise<string>; getHumanizer?(): { enabled: boolean; setOptions(options: Record<string, unknown>): unknown; getOptions?(): Record<string, unknown> } | null; refreshFb_dtsg?(): Promise<Readonly<{ refreshedAt: number; tokenNames: readonly string[] }>>;
  changeAvatar?(image: Uint8Array | Blob | AsyncIterable<Uint8Array>, caption?: string | number | ((error: Error | null, result?: Record<string, unknown>) => void), timestamp?: number | ((error: Error | null, result?: Record<string, unknown>) => void), callback?: (error: Error | null, result?: Record<string, unknown>) => void): Promise<Record<string, unknown>> | void;
  changeGroupImage?(image: Uint8Array | Blob | AsyncIterable<Uint8Array>, threadID: string | number, callback?: (error: Error | null, result?: Record<string, unknown>) => void): Promise<Record<string, unknown>> | void;
  sendMessage?(...args: unknown[]): unknown; sendBroadcast?(message: string | Record<string, unknown>, threadIDs: string | number | Array<string | number>, options?: { delay?: number; parallel?: number; onEach?: (error: Error | null, result: unknown, threadID: string) => void } | ((error: Error | null, result?: { total: number; sent: Array<{ threadID: string; result: unknown }>; failed: Array<{ threadID: string; error: Error }> }) => void), callback?: (error: Error | null, result?: { total: number; sent: Array<{ threadID: string; result: unknown }>; failed: Array<{ threadID: string; error: Error }> }) => void): Promise<{ total: number; sent: Array<{ threadID: string; result: unknown }>; failed: Array<{ threadID: string; error: Error }> }> | void;  uploadAttachment?(input: AttachmentInput | AttachmentInput[]): Promise<UploadedAttachment[]>; downloadAttachment?(url: string, options?: { maxBytes?: number; timeoutMs?: number }): Promise<DownloadedAttachment>; forwardAttachment?(attachmentID: string | number, recipients: string | number | Array<string | number>, callback?: (error?: Error | null) => void): Promise<{ success: true; attachmentID: string; recipients: string[] }> | void; editMessage?(text: string, messageID: string, callback?: (error: Error | null, result?: { body: string; messageID: string }) => void): Promise<{ body: string; messageID: string }> | void; shareContact?(text: string | null | undefined, senderID: string | number, threadID: string | number, callbackOrMessageID?: string | ((error: Error | null, result?: unknown) => void), callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void; httpGet?(url: string, query?: Record<string, unknown>, callback?: (error: Error | null, result?: string) => void): Promise<string> | void; httpPost?(url: string, form: Record<string, unknown>, callback?: (error: Error | null, result?: string) => void): Promise<string> | void; httpPostFormData?(url: string, formData: FormData, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void; getUserInfo?(...args: unknown[]): unknown;
  getThreadInfo?(...args: unknown[]): unknown; getThreadList?(...args: unknown[]): unknown;
  markAsRead?(threadID: string | number, read?: boolean | ((error: Error | null, result?: unknown) => void), callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void; markAsReadAll?(callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void; markAsSeen?(timestamp?: number | ((error: Error | null, result?: unknown) => void), callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void; deleteMessage?(messageIDs: string | Array<string>, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void; deleteThread?(threadIDs: string | number | Array<string | number>, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void; muteThread?(threadID: string | number, muteSeconds: number, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void; changeArchivedStatus?(threadIDs: string | number | Array<string | number>, archive: boolean, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void; markAsDelivered?(threadID: string | number, messageID: string, callback?: (error?: Error | null) => void): Promise<unknown> | void; setMessageReaction?(...args: unknown[]): unknown;   setPostReaction?(postID: string | number, type: string | number | ((error: Error | null, result?: unknown) => void), callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  reactToPost?(postID: string | number, type: string | number, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  reactToComment?(commentID: string | number, type: string | number, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  handleFriendRequest?(userID: string | number, accept: boolean, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  sendTypingIndicator?(...args: unknown[]): unknown; unsendMessage?(messageID: string, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  changeNickname?(...args: unknown[]): unknown; changeBlockedStatus?(userID: string | number, block: boolean, callback?: (error?: Error | null) => void): Promise<unknown> | void; changeBio?(bio: string, publish?: boolean | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): Promise<unknown> | void; unfriend?(userID: string | number, callback?: (error?: Error | null) => void): Promise<unknown> | void; getEmojiUrl?(character: string, size?: 32 | 64 | 128, pixelRatio?: "1.0" | "1.5"): string; changeAdminStatus?(threadID: string | number, adminIDs: string | number | Array<string | number>, adminStatus: boolean, callback?: (error?: Error | null) => void): Promise<unknown> | void; createPoll?(title: string, threadID: string | number, options?: Record<string, boolean> | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): Promise<unknown> | void; handleMessageRequest?(threadIDs: string | number | Array<string | number>, accept: boolean, callback?: (error?: Error | null) => void): Promise<unknown> | void; searchForThread?(name: string, callback?: (error: Error | null, result?: Array<Record<string, unknown>>) => void): Promise<Array<Record<string, unknown>>> | void; getThreadPictures?(threadID: string | number, offset?: number, limit?: number, callback?: (error: Error | null, result?: Array<Record<string, unknown>>) => void): Promise<Array<Record<string, unknown>>> | void; changeThreadColor?(color: string, threadID: string | number, callback?: (error?: Error | null) => void): Promise<unknown> | void; changeThreadEmoji?(emoji: string, threadID: string | number, callback?: (error?: Error | null) => void): Promise<unknown> | void; setTitle?(title: string, threadID: string | number, callback?: (error?: Error | null, result?: unknown) => void): Promise<unknown> | void; addUserToGroup?(...args: unknown[]): unknown;
  removeUserFromGroup?(...args: unknown[]): unknown; createNewGroup?(...args: unknown[]): unknown;
  sharePost?(postID: string | number, message?: string, callback?: (error: Error | null, result?: Record<string, unknown>) => void): Promise<Record<string, unknown>> | void; sendFriendRequest?(userID: string | number, callback?: (error: Error | null, result?: Record<string, unknown>) => void): Promise<Record<string, unknown>> | void; followUser?(userID: string | number, callback?: (error: Error | null, result?: boolean) => void): Promise<boolean> | void; unfollowUser?(userID: string | number, callback?: (error: Error | null, result?: boolean) => void): Promise<boolean> | void; postComment?(message: string, postID: string | number, replyCommentID?: string | number | ((error: Error | null, result?: Record<string, unknown>) => void), callback?: (error: Error | null, result?: Record<string, unknown>) => void): Promise<Record<string, unknown>> | void; pinMessage?(messageID: string, threadID: string | number, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void; unpinMessage?(messageID: string, threadID: string | number, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void; getThreadHistory?(...args: unknown[]): unknown; getMessage?(...args: unknown[]): unknown;
  getFriendsList?(...args: unknown[]): unknown; getUserID?(...args: unknown[]): unknown; getUID?(...args: unknown[]): unknown; resolvePhotoUrl?(...args: unknown[]): unknown;
  sessionGuard?(...args: unknown[]): unknown; stopSessionGuard?(): unknown;
  setOptions?(options: Record<string, unknown>): unknown;
}
export interface ClientOptions {
  authenticate(context: { mode: LoginMode; credentials: Cookie[];
    options: Record<string, unknown>; context: ConnectionContext; license: VerifiedLicense | null;
  }): Promise<TransportDriver> | TransportDriver;
  options?: Record<string, unknown>;
  reconnect?: { minDelayMs?: number; maxDelayMs?: number; factor?: number; jitter?: number; maxAttempts?: number };
  license?: LicenseOptions; requireLicense?: boolean; onLicenseError?: (error: Error) => void;
}
export interface VerifiedLicense { licenseId: string; ownerId: string; installationId: string; features: string[]; [key: string]: unknown; }
export interface LicenseOptions {
  token?: string; publicKey?: string; installationId?: string; ownerId?: string;
  checkIntervalMs?: number; refresh?: () => string | Promise<string>;
}
export interface ClientApi {
  connectE2EE?(callback?: (error: Error | null, result?: { userId: string; deviceId: number }) => void): Promise<{ userId: string; deviceId: number }> | void;
  listenE2EE?(callback: (error: Error | null, event?: unknown) => void): () => void;
  sendE2EEReaction?(threadID: string | number, messageID: string, reaction: string, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  editE2EEMessage?(threadID: string | number, messageID: string, newText: string, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  unsendE2EEMessage?(threadID: string | number, messageID: string, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  sendE2EETyping?(threadID: string | number, isTyping?: boolean, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  _connectE2EEAndMerge?(callback?: (error: Error | null, result?: { userId: string; deviceId: number }) => void): Promise<{ userId: string; deviceId: number }> | void;
  sendE2EEMessage?(threadID: string | number, message: string | { body?: string; attachment?: AttachmentInput }, options?: { replyToMessageID?: string | number } | ((error: Error | null, result?: unknown) => void), callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  sendE2EEAttachment?(threadID: string | number, attachment: AttachmentInput, caption?: string, options?: { replyToMessageID?: string | number } | ((error: Error | null, result?: unknown) => void), callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  downloadE2EEAttachment?(attachment: Record<string, unknown>, callback?: (error: Error | null, buffer?: Buffer) => void): Promise<Buffer> | void;
  isE2EEThread?(threadID: string | number): boolean;
  getE2EEStatus?(): E2EEStatus;
  sendFriendRequest?(userID: string | number, callback?: (error: Error | null, result?: Record<string, unknown>) => void): Promise<Record<string, unknown>> | void; followUser?(userID: string | number, callback?: (error: Error | null, result?: boolean) => void): Promise<boolean> | void; unfollowUser?(userID: string | number, callback?: (error: Error | null, result?: boolean) => void): Promise<boolean> | void; postComment?(message: string, postID: string | number, replyCommentID?: string | number | ((error: Error | null, result?: Record<string, unknown>) => void), callback?: (error: Error | null, result?: Record<string, unknown>) => void): Promise<Record<string, unknown>> | void; pinMessage?(messageID: string, threadID: string | number, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void; unpinMessage?(messageID: string, threadID: string | number, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void; getCurrentUserID(): string | null; getCookies?(): string; getHumanizer?(): { enabled: boolean; setOptions(options: Record<string, unknown>): unknown; getOptions?(): Record<string, unknown> } | null; getAppState?(): Cookie[]; saveSession?(): Promise<string>; restoreSessionBackup?(): Promise<{ restored: true; userId: string; cookieCount: number }>; getUserID?(): string | null; getUserID?(name: string, callback?: (error: Error | null, result?: Array<Record<string, unknown>>) => void): Promise<Array<Record<string, unknown>>> | void; getUID?(input: string | number, callback?: (error: Error | null, result?: string) => void): Promise<string> | void; resolvePhotoUrl?(photoID: string | number, callback?: (error: Error | null, result?: string) => void): Promise<string> | void; getFriendsList?(callback?: (error: Error | null, result?: Array<Record<string, unknown>>) => void): Promise<Array<Record<string, unknown>>> | void; createNewGroup?(participantIDs: Array<string | number>, groupTitle?: string | ((error: Error | null, result?: string) => void) | null, callback?: (error: Error | null, result?: string) => void): Promise<string> | void; getConnectionState(): ConnectionSnapshot; getLicense(): VerifiedLicense | null;
  getCapabilities(): Readonly<{ methods: readonly string[]; events: boolean; sessionGuard: boolean; e2ee: boolean }>;
  getAvatarUser?(userID: string | number, callback?: (error: Error | null, avatarUrl?: string | null) => void): Promise<string | null> | void;
  getProfileInfo?(userID: string | number, callback?: (error: Error | null, result?: Record<string, unknown>) => void): Promise<Record<string, unknown>> | void;
  getPublicData?(userID: string | number, callback?: (error: Error | null, result?: Record<string, unknown>) => void): Promise<Record<string, unknown>> | void;
  logout?(callback?: (error?: Error | null) => void): Promise<void> | void;
  createGroup?(groupTitle: string | null, participantIDs: Array<string | number>, callback?: (error: Error | null, threadID?: string) => void): Promise<string> | void;
  e2ee?: Readonly<{ connect?: (...args: any[]) => any; disconnect?: () => boolean; isConnected(): boolean; getStatus(): E2EEStatus; isThread?: (threadID: string | number) => boolean; listen?: (callback: (error: Error | null, event?: unknown) => void) => () => void; sendMessage?: (...args: any[]) => any; sendAttachment?: (...args: any[]) => any; downloadAttachment?: (...args: any[]) => any; sendReaction?: (...args: any[]) => any; editMessage?: (...args: any[]) => any; unsendMessage?: (...args: any[]) => any; sendTyping?: (...args: any[]) => any }>;
  listen(callback: (event: unknown) => void): () => void;
  listenMqtt(callback: (error: Error | null, event?: unknown) => void): () => void;
  stopListening(callback?: () => void): boolean;
  changeAvatar?: (image: Uint8Array | Blob | AsyncIterable<Uint8Array>, caption?: string | number | ((error: Error | null, result?: Record<string, unknown>) => void), timestamp?: number | ((error: Error | null, result?: Record<string, unknown>) => void), callback?: (error: Error | null, result?: Record<string, unknown>) => void) => Promise<Record<string, unknown>> | void;
  changeGroupImage?: (image: Uint8Array | Blob | AsyncIterable<Uint8Array>, threadID: string | number, callback?: (error: Error | null, result?: Record<string, unknown>) => void) => Promise<Record<string, unknown>> | void;
  sendRequest?: (payload: Record<string, unknown>, options?: { timeoutMs?: number }) => Promise<unknown>; uploadAttachment?: (input: AttachmentInput | AttachmentInput[]) => Promise<UploadedAttachment[]>; downloadAttachment?: (url: string, options?: { maxBytes?: number; timeoutMs?: number }) => Promise<DownloadedAttachment>; forwardAttachment?: (attachmentID: string | number, recipients: string | number | Array<string | number>, callback?: (error?: Error | null) => void) => Promise<{ success: true; attachmentID: string; recipients: string[] }> | void; sendMessage?: { (input: { threadID: string | number; message: string | { body?: string; sticker?: string | number; emoji?: string; emojiSize?: number | "small" | "medium" | "large"; location?: { latitude: number; longitude: number; current?: boolean; live?: boolean }; attachment?: AttachmentInput | AttachmentInput[]; url?: string; mentions?: Array<{ tag: string; id?: string | number; fromIndex?: number }> }; replyToMessageID?: string | number }, options?: { timeoutMs?: number; e2ee?: boolean | "required" | "disabled" }): Promise<unknown>; (message: string | { body?: string; sticker?: string | number; emoji?: string; emojiSize?: number | "small" | "medium" | "large"; location?: { latitude: number; longitude: number; current?: boolean; live?: boolean }; attachment?: AttachmentInput | AttachmentInput[]; url?: string; mentions?: Array<{ tag: string; id?: string | number; fromIndex?: number }> }, threadID: string | number, callback?: (error: Error | null, result?: unknown) => void, replyToMessageID?: string | number): Promise<unknown> | void; (message: string | { body?: string; sticker?: string | number; attachment?: AttachmentInput | AttachmentInput[]; url?: string }, threadID: string | number, replyToMessageID: string | number): Promise<unknown>; }; sendImage?(image: AttachmentInput, threadID: string | number, caption?: string | ((error: Error | null, result?: unknown) => void), callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  sendVideo?(video: AttachmentInput, threadID: string | number, caption?: string | ((error: Error | null, result?: unknown) => void), callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  sendAudio?(audio: AttachmentInput, threadID: string | number, caption?: string | ((error: Error | null, result?: unknown) => void), callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  sendFile?(file: AttachmentInput, threadID: string | number, caption?: string | ((error: Error | null, result?: unknown) => void), callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  sendGif?(gif: AttachmentInput, threadID: string | number, caption?: string | ((error: Error | null, result?: unknown) => void), callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  shareLink?(url: string, threadID: string | number, caption?: string | ((error: Error | null, result?: unknown) => void), callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  sendLocation?(latitude: number | { latitude: number; longitude: number; current?: boolean; live?: boolean }, longitude: number | string | number, threadID?: string | number | ((error: Error | null, result?: unknown) => void), callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  getUserInfo?: (...args: any[]) => any;
  getThreadInfo?: (...args: any[]) => any; getThreadList?: (...args: any[]) => any;   setPostReaction?(postID: string | number, type: string | number | ((error: Error | null, result?: unknown) => void), callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  reactToPost?(postID: string | number, type: string | number, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  reactToComment?(commentID: string | number, type: string | number, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  handleFriendRequest?(userID: string | number, accept: boolean, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  editMessage?(text: string, messageID: string, callback?: (error: Error | null, result?: { body: string; messageID: string }) => void): Promise<{ body: string; messageID: string }> | void;
  unsendMessage?(messageID: string, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  markAsRead?(threadID: string | number, read?: boolean | ((error: Error | null, result?: unknown) => void), callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  markAsReadAll?(callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  markAsSeen?(timestamp?: number | ((error: Error | null, result?: unknown) => void), callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  markAsDelivered?(threadID: string | number, messageID: string, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  setMessageReaction?: (...args: any[]) => any;
  sendTypingIndicator?: (...args: any[]) => any;
  changeNickname?: (...args: any[]) => any; addUserToGroup?: (...args: any[]) => any;
  removeUserFromGroup?: (...args: any[]) => any; createNewGroup?: (...args: any[]) => any;
  getThreadHistory?: (...args: any[]) => any; getMessage?: (...args: any[]) => any;
  getFriendsList?: (...args: any[]) => any; getUserID?: (...args: any[]) => any; getUID?: (...args: any[]) => any; resolvePhotoUrl?: (...args: any[]) => any;
  sessionGuard?: (...args: any[]) => any; stopSessionGuard?: () => any;
  setOptions?: (options: Record<string, unknown>) => any;
}
export interface AuthenticationError extends Error {
  code?: string; sessionState?: "checkpoint" | "logged_out" | "error" | "unknown"; retryable?: boolean;
}
export interface ConnectionSnapshot {
  state: "idle" | "connecting" | "reconnecting" | "connected" | "disconnected" | "failed" | "stopped";
  connected: boolean; generation: number;
}
export interface ConnectionSupervisorOptions {
  connect(context: ConnectionContext): Promise<TransportDriver> | TransportDriver;
  disconnect?(driver: TransportDriver): void | Promise<void>;
  options?: { minDelayMs?: number; maxDelayMs?: number; factor?: number; jitter?: number; maxAttempts?: number };
  random?: () => number; sleep?: (milliseconds: number) => Promise<void>;
}
export class ConnectionSupervisor {
  constructor(options: ConnectionSupervisorOptions); start(): Promise<TransportDriver | null>; stop(): Promise<void>;
  listen(callback: (event: unknown) => void): () => void; snapshot(): ConnectionSnapshot;
  on(event: string, listener: (...args: any[]) => void): this; off(event: string, listener: (...args: any[]) => void): this;
}
export class EventDispatcher {
  constructor(options?: { maxSeen?: number; ttlMs?: number; now?: () => number });
  dispatch<T>(event: unknown, handler: (event: any) => T | Promise<T>): Promise<{ duplicate: boolean; result?: T } | { duplicate: true }>;
  clear(): void;
}
export class CookieJar {
  constructor(cookies?: Cookie[], options?: { now?: () => number }); setCookies(cookies: Cookie[]): this; deleteCookies(cookies: Array<{ key: string; domain: string; path: string }>): this;
  getCookieHeader(inputUrl: string | URL): string; clear(): void; readonly size: number;
}
export function createClient(options: ClientOptions): {
  login(credentials: Credentials, options?: Record<string, unknown>): Promise<ClientApi>;
  logout(): Promise<void>; getConnectionState(): ConnectionSnapshot; getLicense(): VerifiedLicense | null;
};
export function createGoatBotLogin(client: ReturnType<typeof createClient>, accountConfigOptions?: AccountConfigOptions): {
  (credentials: Record<string, unknown>, callback: (error: Error | null, api?: ClientApi | null) => void): Promise<ClientApi | null>;
  (credentials: Record<string, unknown>, options: Record<string, unknown>, callback: (error: Error | null, api?: ClientApi | null) => void): Promise<ClientApi | null>;
};
export interface LegacyFcaProviderOptions {
  login(input: Record<string, unknown>, options: Record<string, unknown>, callback: (error: Error | null, api?: any) => void): void;
  options?: Record<string, unknown>; timeoutMs?: number;
}
/** Bridges an existing personal-account FCA login implementation; does not implement Facebook's private wire protocol. */
export function createLegacyFcaProvider(options: LegacyFcaProviderOptions): (context: {
  mode: LoginMode; credentials: Cookie[]; options?: Record<string, unknown>;
}) => Promise<TransportDriver>;
export function normalizeCookies(input: Cookie[]): Cookie[];
export function validateSessionCookies(input: Cookie[]): Cookie[];
export function parseCookieHeader(header: string): Cookie[];
export function parseNetscapeCookies(text: string): Cookie[];
export function redactSecrets<T>(value: T): T;
export function classifySessionState(input: unknown): string;
export function describeError(error: unknown): string;
export function encryptSession(session: unknown, key: string | Uint8Array): Record<string, unknown>;
export function decryptSession(envelope: Record<string, unknown>, key: string | Uint8Array): unknown;
export function saveSession(filePath: string, session: unknown, key: string | Uint8Array): string;
export function loadSession(filePath: string, key: string | Uint8Array): unknown;
export function deleteSession(filePath: string): void;
export function createRequestClient(options?: Record<string, unknown>): (input: string | URL, options?: Record<string, unknown> & { retryable?: boolean }) => Promise<any>;
export function retryAfterMs(value: string | null, now?: number): number | null;
export function isRetryableStatus(status: number): boolean;
export function verifyLicenseToken(token: string, publicKey: string, options?: Record<string, unknown>): VerifiedLicense;
export interface LicenseProviderOptions {
  backendUrl: string; licenseId: string; installationId: string; licenseKey: string; publicKey: string;
  fetchImpl?: (...args: any[]) => Promise<any>;
}
export function createLicenseProvider(options: LicenseProviderOptions): () => Promise<string>;
export function validateTransportDriver(driver: TransportDriver): TransportDriver;
export function createTransportFactory(provider: (context: ConnectionContext) => Promise<TransportDriver> | TransportDriver): (context: ConnectionContext) => Promise<TransportDriver>;
export interface MetaMessengerTransportOptions {
  pageAccessToken: string; pageId: string; apiVersion: string; appSecret?: string;
  fetchImpl?: (...args: any[]) => Promise<any>; timeoutMs?: number;
}
export interface MetaMessengerTransport {
  getCurrentUserID(): string;
  sendMessage(recipientId: string, message: Record<string, unknown>): Promise<Record<string, unknown>>;
  getUserInfo(userId: string, fields?: Array<"first_name" | "last_name" | "profile_pic" | "locale" | "timezone" | "gender">): Promise<Record<string, unknown>>;
  getThreadList(limit?: number, after?: string): Promise<Record<string, unknown>>;
  getThreadInfo(threadId: string): Promise<Record<string, unknown>>;
  getThreadHistory(threadId: string, limit?: number, after?: string): Promise<Record<string, unknown>>;
  getMessage(messageId: string): Promise<Record<string, unknown>>;
  sendTypingIndicator(recipientId: string, typing?: boolean): Promise<Record<string, unknown>>;
  markAsRead(recipientId: string): Promise<Record<string, unknown>>;
  listen(callback: (error: Error | null, event?: MetaWebhookEvent) => void): () => void;
  publishWebhook(rawBody: Uint8Array, signature: string): number; disconnect(): Promise<void>;
  getCapabilities(): Readonly<Record<string, string | boolean>>;
}
export interface MetaWebhookEvent {
  object: "page"; pageID: string; senderID: string | null; recipientID: string | null;
  timestamp: number | null; type: "message" | "postback" | "delivery" | "read" | "account_linking" | "referral";
  [key: string]: unknown;
}
export function createMetaMessengerTransport(options: MetaMessengerTransportOptions): MetaMessengerTransport;
export function normalizeWebhookPayload(payload: unknown): MetaWebhookEvent[];
export function verifyWebhookSignature(rawBody: Uint8Array, signature: string, appSecret: string): boolean;
export function verifyWebhookChallenge(query: Record<string, unknown>, verifyToken: string): string | null;
export interface ParsedVersion { major: number; minor: number; patch: number; prerelease: string; }
export function parseVersion(value: string): ParsedVersion;
export function compareVersions(left: string, right: string): number;
export interface VerifiedUpdateManifest {
  product: string; version: string; channel: "stable" | "beta"; minNode: string;
  issuedAt: number; expiresAt: number; releaseNotes: string;
  artifact: Readonly<{ url: string; sha256: string }>; updateAvailable: boolean; isDowngrade: boolean;
}
export function verifyUpdateManifest(manifest: unknown, options?: Record<string, unknown>): VerifiedUpdateManifest;
export function verifyArtifactDigest(data: string | Uint8Array, digest: string): boolean;
/** Broker-agnostic MQTT 3.1/3.1.1 packet codec primitives. */
export const mqtt311Codec: {
  readonly MAX_REMAINING_LENGTH: number;
  encodeRemainingLength(value: number): Buffer;
  decodeRemainingLength(buffer: Buffer, offset?: number): Readonly<{ value: number; bytes: number; offset: number }> | null;
  encodeConnect(options: { clientId: string; keepAlive?: number; cleanSession?: boolean; username?: string; password?: Buffer | Uint8Array | string; protocolId?: "MQIsdp" | "MQTT"; protocolVersion?: 3 | 4 }): Buffer;
  encodePublish(options: { topic: string; payload?: Buffer | Uint8Array | string; qos?: 0 | 1 | 2; retain?: boolean; dup?: boolean; packetId?: number }): Buffer;
  encodeSubscribe(packetId: number, subscriptions: Array<{ topic: string; qos?: 0 | 1 | 2 }>): Buffer;
  encodePacketId(type: "puback" | "pubrec" | "pubrel" | "pubcomp", packetId: number): Buffer;
  encodeUnsubscribe(packetId: number, topics: string[]): Buffer;
  encodePingReq(): Buffer;
  encodeDisconnect(): Buffer;
  decodePacket(buffer: Buffer | Uint8Array, options?: { maxPacketBytes?: number }): Readonly<Record<string, unknown>> | null;
};
export interface Mqtt311StreamDecoder {
  push(chunk: Buffer | Uint8Array | ArrayBuffer): Array<Readonly<Record<string, unknown>>>;
  reset(): void;
  close(): void;
  readonly bufferedBytes: number;
  readonly closed: boolean;
}
export function createMqtt311StreamDecoder(options?: { maxPacketBytes?: number; maxBufferedBytes?: number }): Mqtt311StreamDecoder;
export interface NativeRealtimeSocket {
  readyState?: number;
  send(data: string | Buffer | Uint8Array | ArrayBuffer, callback?: (error?: Error) => void): void;
  close?(): void;
  on?(event: string, listener: (...args: any[]) => void): unknown;
  off?(event: string, listener: (...args: any[]) => void): unknown;
  removeListener?(event: string, listener: (...args: any[]) => void): unknown;
  addEventListener?(event: string, listener: (event: any) => void): unknown;
  removeEventListener?(event: string, listener: (event: any) => void): unknown;
}
export interface NativeRealtimeProtocolAdapter {
  authenticate(socket: NativeRealtimeSocket, context: Record<string, unknown>): void | Promise<void>;
  subscribe(socket: NativeRealtimeSocket, context: Record<string, unknown>): void | Promise<void>;
  decodeFrame(frame: unknown, options: { isBinary: boolean; maxFrameBytes: number }): { events: unknown[] } | unknown[];
  encodeAction(action: unknown): string | Buffer | Uint8Array | ArrayBuffer | Promise<string | Buffer | Uint8Array | ArrayBuffer>;
}
export interface NativeRealtimeTransportOptions {
  /** Must be a verified wss:// endpoint; no Facebook endpoint is bundled. */
  url: string;
  socketFactory(input: { url: string; protocols?: string | string[]; headers?: Record<string, string>; signal?: AbortSignal }): NativeRealtimeSocket | Promise<NativeRealtimeSocket>;
  protocol: NativeRealtimeProtocolAdapter;
  protocols?: string | string[];
  headers?: Record<string, string>;
  connectTimeoutMs?: number;
  closeTimeoutMs?: number;
  protocolSetupTimeoutMs?: number;
  maxFrameBytes?: number;
  onDiagnostic?: (event: Readonly<Record<string, unknown>>) => void;
}
export interface NativeRealtimeTransport {
  connect(context?: Partial<ConnectionContext>): Promise<TransportDriver & { sendAction(action: unknown): Promise<{ sent: true }>; getConnectionState(): ConnectionSnapshot }>;
  disconnect(): Promise<void>;
  getDriver(): (TransportDriver & { sendAction(action: unknown): Promise<{ sent: true }>; getConnectionState(): ConnectionSnapshot });
  snapshot(): ConnectionSnapshot;
  on(event: string, callback: (...args: any[]) => void): () => void;
}
export const DEFAULT_CONNECT_TIMEOUT_MS: number;
export const DEFAULT_CLOSE_TIMEOUT_MS: number;
export const DEFAULT_PROTOCOL_SETUP_TIMEOUT_MS: number;
/**
 * Protocol-neutral WebSocket runtime. A separately verified adapter must supply
 * Facebook-specific authentication, subscriptions, decoding and action encoding.
 */
export function createNativeRealtimeTransport(options: NativeRealtimeTransportOptions): NativeRealtimeTransport;
export interface DecodedRealtimeEvent { readonly name: string; readonly args: unknown | null; }
export interface DecodedRealtimeFrame { readonly envelope: Readonly<Record<string, unknown>>; readonly events: readonly DecodedRealtimeEvent[]; }
export interface RealtimeFrameSummary { readonly eventCount: number; readonly eventNames: readonly string[]; }
export const DEFAULT_MAX_FRAME_BYTES: number;
/** Extracts an observed JSON events envelope from a bounded binary frame; does not implement the Messenger wire protocol. */
export function decodeRealtimeFrame(frame: Buffer | Uint8Array, options?: { maxFrameBytes?: number }): DecodedRealtimeFrame;
/** Returns event names/count only, omitting event argument values. */
export function summarizeRealtimeFrame(frame: Buffer | Uint8Array, options?: { maxFrameBytes?: number }): RealtimeFrameSummary;
export interface RealtimeBinaryPayloadSummary {
  readonly envelopeKind: "payload" | "events"; readonly requestIdPresent: boolean;
  readonly payloadEncoding: "non-string" | "non-base64-string" | "base64-binary-unclassified" | "protobuf-wire-compatible" | "base64-json";
  readonly payloadBytes: number | null;
  readonly wireFields: readonly Readonly<{ number: number; wireType: number; byteLength: number | null }>[];
}
export const DEFAULT_MAX_BINARY_PAYLOAD_BYTES: number;
/** Inspects only bounded outer-envelope/Base64 structure and protobuf-wire-compatible field boundaries; never returns payload values. */
export function inspectRealtimeBinaryPayload(frame: Buffer | Uint8Array, options?: { maxFrameBytes?: number; maxPayloadBytes?: number }): RealtimeBinaryPayloadSummary;
export const version: string;

export interface AccountConfigOptions { cwd?: string; accountFile?: string; configFile?: string; appStateFile?: string | null; env?: NodeJS.ProcessEnv; }
export type LoadedAccountConfig = { mode: "appstate"; appState: Cookie[]; source: "account.txt" | "appstate.json" };
export function parseAccountText(text: string): Cookie[];
export function generateTotp(secret: string, options?: { digits?: number; period?: number; algorithm?: "sha1" | "sha256" | "sha512"; timestamp?: number }): string;
/** Reads cookie-only account.txt first, then appstate.json. Credential configuration is not loaded in the AppState-only phase. */
export function loadAccountConfig(options?: AccountConfigOptions): LoadedAccountConfig;

export interface RealtimeSyncEnvelope {
  readonly appId: string;
  readonly requestId: number;
  readonly type: number;
  readonly payload: Readonly<Record<string, unknown>>;
}
/** Inspects the observed JSON sync envelope without interpreting the undocumented binary prefix. */
export function inspectRealtimeSyncEnvelope(frame: Buffer | Uint8Array, options?: { maxFrameBytes?: number }): RealtimeSyncEnvelope;
export const DEFAULT_MAX_SYNC_FRAME_BYTES: number;


/** Facebook web realtime notification/presence gateway; not Messenger message sync. */
export const DEFAULT_GATEWAY_URL: string;
export const DEFAULT_APP_ID: string;
export const FACEBOOK_GATEWAY_SUBSCRIPTIONS: readonly string[];
export function encodeGatewaySubscription(payload: string, index: number): Buffer;
export function decodeGatewayFrame(frame: string | Buffer | Uint8Array | ArrayBuffer, options?: { maxFrameBytes?: number }): { events: unknown[] };
export interface FacebookGatewayProtocolOptions {
  userId: string | number;
  deviceId?: string;
  appId?: string;
  url?: string;
  userAgent?: string;
  cookie?: string;
  subscriptions?: readonly string[];
}
export interface FacebookGatewayProtocolConfig {
  url: string;
  headers: Readonly<Record<string, string>>;
  protocol: NativeRealtimeProtocolAdapter;
}
export function createFacebookGatewayProtocol(options: FacebookGatewayProtocolOptions): FacebookGatewayProtocolConfig;


/** Unofficial Facebook Messenger MQTT 3.1 adapter based on public FCA protocol observations. */
export const DEFAULT_MQTT_URL: string;
export const DEFAULT_MQTT_APP_ID: string;
export const DEFAULT_MQTT_TOPICS: readonly string[];
export interface FacebookMqttProtocolOptions {
  userId: string | number; clientId?: string; sessionId?: number; deviceId?: string;
  appId?: string; url?: string; region?: string; userAgent?: string; cookie?: string;
  online?: boolean; keepAlive?: number; topics?: readonly string[];
  syncToken?: string; lastSeqId?: string | number | null; syncCursorStore?: MessengerSyncCursorStore; onSyncCursor?: (cursor: MessengerSyncCursor) => void; requestTimeoutMs?: number; maxPendingRequests?: number;
}
export interface FacebookMqttProtocolConfig {
  url: string; headers: Readonly<Record<string, string>>;
  session: Readonly<{ userId: string; clientId: string; sessionId: number; deviceId: string; appId: string }>;
  protocol: NativeRealtimeProtocolAdapter;
}
export function createFacebookMqttProtocol(options: FacebookMqttProtocolOptions): FacebookMqttProtocolConfig;

export interface MessengerSyncCursor { syncToken: string | null; lastSeqId: string | number | null; }
export interface MessengerSyncParseResult { events: ReadonlyArray<Record<string, unknown>>; envelope: unknown; cursor: MessengerSyncCursor | null; }
/** Parses known Messenger sync delta envelopes conservatively. */
export function parseMessengerSyncPayload(input: unknown): MessengerSyncParseResult;
export function normalizeMessengerDelta(delta: unknown): Record<string, unknown> | null;
/** Normalizes a Messenger attachment into legacy FCA type/url/id fields. */
export function normalizeMessengerAttachment(attachment: unknown): Record<string, unknown> | null;

export type AttachmentInput = string | Buffer | Uint8Array | Blob | AsyncIterable<Uint8Array>;
export interface UploadedAttachment {
  attachmentID: string; id: string; idKey: "image_id" | "video_id" | "audio_id" | "file_id" | "gif_id";
  type: "image" | "video" | "audio" | "file" | "gif"; fileName: string; mimeType: string; size: number;
  attachmentUrl: string | null; metadata: Record<string, unknown>;
}
export interface DownloadedAttachment {
  buffer: Buffer; size: number; mimeType: string; fileName: string | null; url: string;
}
export const MAX_IMAGE_UPLOAD_BYTES: number;
export function readImageInput(input: AttachmentInput, options?: { maxBytes?: number }): Promise<Readonly<{ buffer: Buffer; mimeType: string; fileName: string; size: number }>>;
export function readAttachmentInput(input: AttachmentInput, options?: { maxBytes?: number }): Promise<Readonly<{ buffer: Buffer; mimeType: string; fileName: string; size: number; kind: "image" | "video" | "audio" | "file" }>>;
export function downloadAttachment(url: string, options?: { fetchImpl?: (input: string | URL, init?: RequestInit) => Promise<Response>; maxBytes?: number; timeoutMs?: number }): Promise<DownloadedAttachment>;
export function safeDownloadUrl(url: string): URL;
export const MAX_ATTACHMENT_UPLOAD_BYTES: number;
export const MAX_ATTACHMENT_DOWNLOAD_BYTES: number;
export const MAX_ATTACHMENT_COUNT: number;

export interface MqttRequestTracker { allocateId(): number; track(requestId: string | number, timeoutMs?: number): Promise<unknown>; resolve(response: unknown): boolean; rejectAll(reason?: unknown): void; readonly pendingCount: number; }
export function createMqttRequestTracker(options?: { timeoutMs?: number; maxPending?: number; initialRequestId?: number }): MqttRequestTracker;

export const MESSENGER_MQTT_APP_ID: string;
export const SEND_MESSAGE_VERSION_ID: string;
export function offlineThreadingId(now?: number, random?: number): string;
export function createMessengerSendMessageRequest(input: { threadID: string | number; message: string | { body?: string; sticker?: string | number }; replyToMessageID?: string | number; timestamp?: number; otid?: string; epochId?: string; requestId?: number }): Readonly<{ app_id: string; payload: string; request_id: number | null; type: 3 }>;
export function createMessengerPinMessageRequest(input: { threadID: string | number; messageID: string; pin?: boolean; timestamp?: number; taskId?: number; epochId?: string | number; requestId?: number }): Readonly<{ app_id: string; payload: string; request_id: number; type: 3 }>;

export interface MessengerSyncCursorStore { load(): MessengerSyncCursor | null; save(cursor: MessengerSyncCursor): MessengerSyncCursor; clear(): void; readonly current: MessengerSyncCursor | null; }
export function createMessengerSyncCursorStore(options: { filePath: string; key: string | Buffer | Uint8Array; userId: string | number }): MessengerSyncCursorStore;

export interface FacebookMqttDriverOptions extends Omit<PersonalSessionOptions, "appState"> { appState?: Cookie[]; options?: E2EELoginOptions & Record<string, unknown>; e2eeStorageKey?: string | Buffer | Uint8Array; e2eeDevicePath?: string; e2eeDeviceListCacheMs?: number; e2eeFrameLog?: string; e2ee?: boolean; sessionGuard?: NativeDriverSessionGuardOptions; socketFactory(options: { url: string; protocols?: string | string[]; headers?: Record<string, string>; signal: AbortSignal }): unknown | Promise<unknown>; connectTimeoutMs?: number; closeTimeoutMs?: number; protocolSetupTimeoutMs?: number; maxFrameBytes?: number; syncCursorStore?: MessengerSyncCursorStore; onSyncCursor?: (cursor: MessengerSyncCursor) => void; requestTimeoutMs?: number; maxPendingRequests?: number; mqtt?: Record<string, unknown>; }
export interface NativeDriverSessionGuardOptions extends Omit<SessionGuardOptions, "getSession"> { intervalMs?: number; }
export function createFacebookMqttDriver(options: FacebookMqttDriverOptions): Promise<TransportDriver & { getCurrentUserID(): string; getAppState(): Cookie[]; getCookies(): string; refreshFb_dtsg(): Promise<Readonly<{ refreshedAt: number; tokenNames: readonly string[] }>>; getSessionState(): "active"; sendRequest(payload: Record<string, unknown>, options?: { timeoutMs?: number }): Promise<unknown>; sendMessage(input: { threadID: string | number; message: string | { body?: string; sticker?: string | number; emoji?: string; emojiSize?: number | "small" | "medium" | "large"; location?: { latitude: number; longitude: number; current?: boolean; live?: boolean }; attachment?: AttachmentInput | AttachmentInput[]; url?: string; mentions?: Array<{ tag: string; id?: string | number; fromIndex?: number }> }; replyToMessageID?: string | number }, options?: { timeoutMs?: number }): Promise<unknown>; uploadAttachment(input: AttachmentInput | AttachmentInput[]): Promise<UploadedAttachment[]>; downloadAttachment(url: string, options?: { maxBytes?: number; timeoutMs?: number }): Promise<DownloadedAttachment>; forwardAttachment(attachmentID: string | number, recipients: string | number | Array<string | number>, callback?: (error?: Error | null) => void): Promise<{ success: true; attachmentID: string; recipients: string[] }> | void; sessionGuard(requestedPath?: string, options?: { interval?: number; debounce?: number }): Readonly<{ filePath: string; backupPath: string; saveNow(): Promise<string> }>; stopSessionGuard(): Promise<boolean>; disconnect(): Promise<void>; }>;
export interface MessengerSyncCursor { syncToken: string | null; lastSeqId: string | number | null; }

/** Creates the native AppState/SessionGuard personal Messenger client; caller supplies WebSocket implementation. */
export interface FacebookMqttClientOptions extends Omit<FacebookMqttDriverOptions, "appState"> {
  reconnect?: { minDelayMs?: number; maxDelayMs?: number; factor?: number; jitter?: number; maxAttempts?: number };
  license?: LicenseOptions;
  requireLicense?: boolean;
  onLicenseError?: (error: Error) => void;
}
export function createFacebookMqttClient(options: FacebookMqttClientOptions): ReturnType<typeof createClient>;


/** Encrypted session snapshots with verified backup preservation and corruption recovery. */
export interface SessionGuardOptions {
  filePath: string;
  key: string | Buffer | Uint8Array;
  getSession(): Record<string, unknown> | Promise<Record<string, unknown>>;
  backupPath?: string;
  onRecovery?: (event: Readonly<{ source: "backup" | "save"; restored: boolean; errorCode?: string }>) => void;
}
export interface SessionGuard {
  saveNow(): Promise<string>;
  load(): Record<string, unknown>;
  start(intervalMs?: number): () => void;
  stop(): void;
  close(): void;
  getPaths(): Readonly<{ filePath: string; backupPath: string }>;
}
export function createSessionGuard(options: SessionGuardOptions): SessionGuard;

/** Personal-account thread and group actions following public FCA web request conventions. */
export interface FacebookThreadApi {
  httpGet(url: string, query?: Record<string, unknown>, callback?: (error: Error | null, result?: string) => void): Promise<string> | void;
  httpPost(url: string, form: Record<string, unknown>, callback?: (error: Error | null, result?: string) => void): Promise<string> | void;
  getThreadList(limit: number, timestamp?: number | null, tags?: string[] | ((error: Error | null, result?: unknown[]) => void), callback?: (error: Error | null, result?: unknown[]) => void): Promise<unknown[]> | void;
  getThreadInfo(threadID: string | number, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  getThreadHistory(threadID: string | number, amount: number, timestamp?: number | null, callback?: (error: Error | null, result?: unknown[]) => void): Promise<unknown[]> | void;
  getUserInfo(ids: string | number | Array<string | number>, callback?: (error: Error | null, result?: Record<string, unknown>) => void): Promise<Record<string, unknown>> | void;
  addUserToGroup(userIDs: string | number | Array<string | number>, threadID: string | number, callback?: (error?: Error | null) => void): Promise<unknown> | void;
  removeUserFromGroup(userID: string | number, threadID: string | number, callback?: (error?: Error | null) => void): Promise<unknown> | void;
  changeNickname(nickname: string, threadID: string | number, participantID: string | number, callback?: (error?: Error | null) => void): Promise<unknown> | void;
  setMessageReaction(reaction: string, messageID: string, callback?: (error?: Error | null) => void): Promise<unknown> | void;
    setPostReaction(postID: string | number, type: string | number | ((error: Error | null, result: unknown) => void), callback: (error: Error | null, result: unknown) => void): Promise<unknown> | void;
  reactToPost(postID: string | number, type: string | number, callback: (error: Error | null, result: unknown) => void): Promise<unknown> | void;
  reactToComment(commentID: string | number, type: string | number, callback: (error: Error | null, result: unknown) => void): Promise<unknown> | void;
  handleFriendRequest(userID: string | number, accept: boolean, callback: (error: Error | null, result: unknown) => void): Promise<unknown> | void;
  markAsRead(threadID: string | number, read?: boolean | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): Promise<unknown> | void;
  markAsDelivered(threadID: string | number, messageID: string | number, callback?: (error?: Error | null) => void): Promise<unknown> | void;
  unsendMessage(messageID: string, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  changeThreadColor(color: string, threadID: string | number, callback?: (error?: Error | null) => void): Promise<unknown> | void;
  changeThreadEmoji(emoji: string, threadID: string | number, callback?: (error?: Error | null) => void): Promise<unknown> | void;
  setTitle(title: string, threadID: string | number, callback?: (error?: Error | null, result?: unknown) => void): Promise<unknown> | void;
  sendTypingIndicator(threadID: string | number, typing?: boolean | ((error?: Error | null) => void), callback?: (error?: Error | null) => void): Promise<unknown> | void;
  sendTypingIndicator(typ: 0 | 1, threadID: string | number, callback?: (error?: Error | null) => void, isGroup?: boolean): Promise<unknown> | void;
}
export const FACEBOOK_THREAD_DOC_IDS: Readonly<{ threadList: string; threadInfo: string; threadHistory: string; reaction: string }>;
export function createFacebookThreadApi(options: { session: PersonalSession; webClient?: FacebookWebClient }): FacebookThreadApi;

/** Creates a domain-grouped facade over the methods available on an FCA API object. */
export function createFcaClient(api: object): Readonly<{
  messages: Readonly<Record<string, (...args: any[]) => any>>;
  threads: Readonly<Record<string, (...args: any[]) => any>>;
  users: Readonly<Record<string, (...args: any[]) => any>>;
  account: Readonly<Record<string, (...args: any[]) => any>>;
}>;

export interface MessengerBotClient {
  login(credentials: { mode: "appstate"; appState: Cookie[] } | { mode: "session" }, options?: Record<string, unknown>): Promise<ClientApi>;
  logout(): Promise<void>;
}
export interface MessengerBot extends EventEmitter {
  readonly api: ClientApi;
  readonly client: MessengerBotClient;
  readonly commandPrefix: string;
  command(names: string | string[], handler: (context: MessengerBotContext) => unknown | Promise<unknown>): this;
  hears(pattern: string | RegExp, handler: (context: MessengerBotContext) => unknown | Promise<unknown>): this;
  launch(options?: { stopOnSignals?: boolean }): this;
  stop(): Promise<void>;
  on(event: string, listener: (...args: any[]) => void): this;
}
export const MessengerBot: { new(client: MessengerBotClient, api: ClientApi, options?: { commandPrefix?: string; stopOnSignals?: boolean }): MessengerBot; };
export interface MessengerBotContext {
  readonly event: unknown; readonly api: ClientApi; readonly threadID: string | number;
  readonly senderID?: string | number; readonly body: string; readonly message: string;
  readonly args: readonly string[]; readonly match: RegExpExecArray | string | null;
  replyAsync(message: string | Record<string, unknown>, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  reply(message: string | Record<string, unknown>, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
  send(message: string | Record<string, unknown>, callback?: (error: Error | null, result?: unknown) => void): Promise<unknown> | void;
}
export function createMessengerBot(credentials: { appState: Cookie[] } | { mode: "appstate"; appState: Cookie[] } | { mode: "session" }, options?: Record<string, unknown>): Promise<MessengerBot>;


/** Error-first callback used by the EryXen-compatible package-level login API. */
export type FcaLoginCallback = (error: Error | null, api?: FcaApi) => void;
export type FcaLoginCredentials = { appState: Cookie[] } | { mode: "session" } | Record<string, never>;
export interface FcaApi extends TransportDriver {
  getCurrentUserID(): string | number | null;
  listenMqtt(callback: (error: Error | null, event?: unknown) => void): (() => void) | void;
  stopListening?(callback?: () => void): boolean | void;
  sessionGuard?(path?: string, options?: { interval?: number; debounce?: number }): unknown;
  stopSessionGuard?(): Promise<boolean> | boolean;
}
export interface FcaLoginController {
  /** Supports login({ appState }, options, callback), login({ appState }, callback), and Promise use. */
  login(credentials?: FcaLoginCredentials, options?: Record<string, unknown>, callback?: FcaLoginCallback): Promise<FcaApi | null>;
  logout(callback?: (error?: Error | null) => void): Promise<void> | void;
  getConnectionState(): ConnectionSnapshot;
  getLicense(): VerifiedLicense | null;
}
/** Creates an isolated EryXen-style FCA login controller; client may be injected for adapters/tests. */
export function createFcaLogin(options?: FacebookMqttClientOptions & { client?: ReturnType<typeof createClient> }): FcaLoginController;
/** Default package-level FCA login entry point, compatible with login({ appState }, options, callback). */
export function login(credentials?: FcaLoginCredentials, options?: Record<string, unknown>, callback?: FcaLoginCallback): Promise<FcaApi | null>;
export function logout(callback?: (error?: Error | null) => void): Promise<void> | void;
export function getConnectionState(): ConnectionSnapshot;
export function getLicense(): VerifiedLicense | null;
