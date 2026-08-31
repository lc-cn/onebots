export type GoogleChatReceiveMode = "interaction-http" | "pubsub-push" | "manual";
export type GoogleChatAuthMode = "service-account" | "access-token";
export type GoogleChatVerificationMode = "endpoint-url" | "project-number" | "pubsub";

export interface GoogleChatConfig {
    account_id: string;
    auth_mode?: GoogleChatAuthMode;
    service_account_email?: string;
    service_account_private_key?: string;
    access_token?: string;
    oauth_scopes?: string[];
    principal_name?: string;
    app_display_name?: string;
    receive_mode?: GoogleChatReceiveMode;
    http_path?: string;
    verification_mode?: GoogleChatVerificationMode;
    verification_audience?: string;
    pubsub_service_account_email?: string;
    api_base_url?: string;
    event_types?: string[];
}

export interface GoogleChatUser extends Record<string, unknown> {
    name: string;
    displayName?: string;
    avatarUrl?: string;
    email?: string;
    type?: "TYPE_UNSPECIFIED" | "HUMAN" | "BOT";
    domainId?: string;
    isAnonymous?: boolean;
}

export interface GoogleChatSpace extends Record<string, unknown> {
    name: string;
    type?: "TYPE_UNSPECIFIED" | "ROOM" | "DM";
    spaceType?: "SPACE_TYPE_UNSPECIFIED" | "SPACE" | "GROUP_CHAT" | "DIRECT_MESSAGE";
    displayName?: string;
    spaceThreadingState?: string;
    spaceHistoryState?: string;
    singleUserBotDm?: boolean;
    externalUserAllowed?: boolean;
    membershipCount?: { joinedDirectHumanUserCount?: number; joinedGroupCount?: number };
}

export interface GoogleChatThread extends Record<string, unknown> {
    name: string;
    threadKey?: string;
}

export interface GoogleChatAttachment extends Record<string, unknown> {
    name: string;
    contentName: string;
    contentType: string;
    downloadUri?: string;
    source?: "SOURCE_UNSPECIFIED" | "UPLOADED_CONTENT" | "DRIVE_FILE";
    attachmentDataRef?: { resourceName?: string; attachmentUploadToken?: string };
    driveDataRef?: { driveFileId?: string };
}

export interface GoogleChatMessage extends Record<string, unknown> {
    name: string;
    sender?: GoogleChatUser;
    createTime?: string;
    lastUpdateTime?: string;
    deleteTime?: string;
    text?: string;
    formattedText?: string;
    argumentText?: string;
    thread?: GoogleChatThread;
    space?: GoogleChatSpace;
    attachment?: GoogleChatAttachment[];
    annotations?: Record<string, unknown>[];
    cardsV2?: Record<string, unknown>[];
    accessoryWidgets?: Record<string, unknown>[];
    slashCommand?: { commandId?: string };
    appCommandMetadata?: Record<string, unknown>;
}

export interface GoogleChatMembership extends Record<string, unknown> {
    name: string;
    member?: GoogleChatUser;
    groupMember?: { name: string; displayName?: string };
    state?: "MEMBERSHIP_STATE_UNSPECIFIED" | "JOINED" | "INVITED" | "NOT_A_MEMBER";
    role?:
        | "MEMBERSHIP_ROLE_UNSPECIFIED"
        | "ROLE_MEMBER"
        | "ROLE_MANAGER"
        | "ROLE_ASSISTANT_MANAGER";
    createTime?: string;
    deleteTime?: string;
}

export interface GoogleChatReaction extends Record<string, unknown> {
    name: string;
    user?: GoogleChatUser;
    emoji?: { unicode?: string; customEmoji?: { uid?: string } };
}

export interface GoogleChatInteractionEvent extends Record<string, unknown> {
    type: GoogleChatInteractionType;
    /** APP_HOME 与 SUBMIT_FORM 的官方精简载荷不包含 eventTime。 */
    eventTime?: string;
    message?: GoogleChatMessage;
    user?: GoogleChatUser;
    space?: GoogleChatSpace;
    action?: Record<string, unknown>;
    common?: Record<string, unknown>;
    dialogEventType?: string;
    isDialogEvent?: boolean;
}

export interface GoogleChatCloudEvent extends Record<string, unknown> {
    specversion: "1.0";
    id: string;
    source: string;
    type: string;
    time?: string;
    subject?: string;
    data: Record<string, unknown>;
}

export interface GoogleChatPubSubEnvelope extends Record<string, unknown> {
    message: {
        data: string;
        messageId: string;
        publishTime?: string;
        attributes?: Record<string, string>;
        orderingKey?: string;
    };
    subscription: string;
}

export interface GoogleChatEventEnvelope {
    source: "interaction" | "workspace-event" | "manual";
    event: GoogleChatInteractionEvent | GoogleChatCloudEvent;
    raw_event: unknown;
    delivery_id: string;
    /** Client 通过事件或 spaces.get 闭合的场景，避免把未知 DM 猜成群聊。 */
    space?: GoogleChatSpace;
}

export interface GoogleChatCallOptions {
    query?: Readonly<Record<string, string | number | boolean | readonly string[] | undefined>>;
    body?: unknown;
    signal?: AbortSignal;
    upload?: Blob | Uint8Array;
    /** Google media multipart upload 的 JSON metadata。 */
    uploadMetadata?: Record<string, unknown>;
    contentType?: string;
}

export interface GoogleChatMediaResponse {
    data: Uint8Array;
    contentType?: string;
    contentRange?: string;
}

export interface GoogleChatHttpRequest {
    method: string;
    url: string;
    headers?: Readonly<Record<string, string | undefined>>;
    body?: unknown;
}

export interface GoogleChatHttpResponse {
    status: number;
    headers: Readonly<Record<string, string>>;
    body: Record<string, unknown>;
}

export interface GoogleChatIngestResult {
    accepted: boolean;
    duplicate: boolean;
    envelope: GoogleChatEventEnvelope;
}

export interface GoogleChatListResponse<T> extends Record<string, unknown> {
    nextPageToken?: string;
    items: T[];
}

export interface GoogleChatClientEvents {
    event: [envelope: GoogleChatEventEnvelope];
    ready: [];
    error: [error: Error];
    stop: [];
}
import type { GoogleChatInteractionType } from "./event-types.js";
