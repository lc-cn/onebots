import type { InboundWirePacket, WireFileSection, WireImageSection, WireVideoSection, WireVoiceSection } from "./wire-models.js";

export type InputFile =
    | string
    | URL
    | Buffer
    | Uint8Array
    | {
          source: Buffer | Uint8Array;
          filename?: string;
          contentType?: string;
      };

export interface CredentialBlob {
    token: string;
    accountId: string;
    userId?: string;
    baseUrl: string;
    cdnBaseUrl: string;
    routeTag?: string;
    syncBuffer?: string;
    contextTokens?: Record<string, string>;
    createdAt?: string;
    updatedAt?: string;
}

export interface SessionStore {
    load(): Promise<CredentialBlob | null>;
    save(session: CredentialBlob): Promise<void>;
    clear(): Promise<void>;
}

export interface ChatHandle {
    id: string;
    type: "private";
}

export interface PeerHandle {
    id: string;
}

export type NormalizedFacet = "text" | "photo" | "video" | "document" | "voice" | "unknown";

export interface MediaPhoto {
    kind: "photo";
    fileId: string;
    aesKey?: string;
    item: WireImageSection;
}

export interface MediaVideo {
    kind: "video";
    fileId: string;
    aesKey?: string;
    item: WireVideoSection;
}

export interface MediaDocument {
    kind: "document";
    fileId: string;
    aesKey?: string;
    fileName?: string;
    item: WireFileSection;
}

export interface MediaVoice {
    kind: "voice";
    fileId: string;
    aesKey?: string;
    transcript?: string;
    item: WireVoiceSection;
}

export type NormalizedMedia = MediaPhoto | MediaVideo | MediaDocument | MediaVoice;

/** 适配器消费的统一消息视图 */
export interface NormalizedChatEvent {
    id: number | undefined;
    seq: number | undefined;
    type: NormalizedFacet;
    chat: ChatHandle;
    from: PeerHandle;
    date: number | undefined;
    text?: string;
    caption?: string;
    contextToken?: string;
    media?: NormalizedMedia;
    raw: InboundWirePacket;
}

export interface SendCommonOptions {
    contextToken?: string;
}

export interface SendMediaOptions extends SendCommonOptions {
    caption?: string;
    filename?: string;
    contentType?: string;
}

export interface PollingOptions {
    timeoutMs?: number;
    retryDelayMs?: number;
}

export interface DownloadMediaResult {
    buffer: Buffer;
    mimeType: string;
    fileName?: string;
}

export interface DownloadMediaOptions {
    filePath?: string;
}

export interface LoginTicket {
    sessionKey: string;
    qrcode: string;
    qrCodeUrl: string;
    baseUrl: string;
    botType: string;
}

export interface WaitForLoginOptions {
    timeoutMs?: number;
    refreshExpiredQr?: boolean;
    signal?: AbortSignal;
}

export interface LoginOutcome {
    connected: boolean;
    message: string;
    session?: CredentialBlob;
}

export type OnTextListener = (message: NormalizedChatEvent, match: RegExpExecArray) => void | Promise<void>;
