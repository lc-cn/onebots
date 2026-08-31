import { GoogleChatError } from "./errors.js";
import { sha256Json } from "onebots";
import {
    GOOGLE_CHAT_INTERACTION_TYPE_SET,
    GOOGLE_CHAT_WORKSPACE_EVENT_TYPE_SET,
    type GoogleChatInteractionType,
} from "./event-types.js";
import type {
    GoogleChatAttachment,
    GoogleChatCloudEvent,
    GoogleChatEventEnvelope,
    GoogleChatInteractionEvent,
    GoogleChatMessage,
    GoogleChatMembership,
    GoogleChatPubSubEnvelope,
    GoogleChatReaction,
    GoogleChatSpace,
    GoogleChatUser,
} from "./types.js";
import { isRecord, requireRecord, requireString } from "./validation.js";

const MAX_PUBSUB_DATA_BYTES = 10 * 1024 * 1024;
const BATCH_ACTIONS: Readonly<Record<string, string>> = {
    batchCreated: "created",
    batchUpdated: "updated",
    batchDeleted: "deleted",
};

export function parseInteractionEvent(value: unknown): GoogleChatInteractionEvent {
    const event = requireRecord(value, "Google Chat interaction event");
    const type = requireString(event.type, "interaction.type");
    if (!GOOGLE_CHAT_INTERACTION_TYPE_SET.has(type)) {
        throw GoogleChatError.invalid(`不支持的稳定 Google Chat Interaction type: ${type}`);
    }
    const permitsCompactPayload = type === "APP_HOME" || type === "SUBMIT_FORM";
    const eventTime = permitsCompactPayload
        ? optionalTimestamp(event.eventTime, "interaction.eventTime")
        : parseTimestamp(event.eventTime, "interaction.eventTime");
    const result: GoogleChatInteractionEvent = {
        ...event,
        type: type as GoogleChatInteractionType,
        eventTime,
    };
    if (event.user !== undefined) result.user = parseUser(event.user, "interaction.user");
    if (event.space !== undefined) result.space = parseSpace(event.space, "interaction.space");
    if (event.message !== undefined)
        result.message = parseMessage(event.message, "interaction.message");
    if (type === "MESSAGE" && (!result.message || !result.user || !result.space)) {
        throw GoogleChatError.invalid("MESSAGE interaction 必须包含 message、user 与 space");
    }
    if (
        ["ADDED_TO_SPACE", "REMOVED_FROM_SPACE"].includes(type) &&
        (!result.user || !result.space)
    ) {
        throw GoogleChatError.invalid(`${type} interaction 必须包含 user 与 space`);
    }
    if (["APP_HOME", "SUBMIT_FORM"].includes(type) && (!result.user || !result.space)) {
        throw GoogleChatError.invalid(`${type} interaction 必须包含 user 与 space`);
    }
    for (const field of ["action", "common"] as const) {
        if (event[field] !== undefined && !isRecord(event[field])) {
            throw GoogleChatError.invalid(`interaction.${field} 必须是对象`);
        }
    }
    return result;
}

export function parseCloudEvent(value: unknown): GoogleChatCloudEvent[] {
    const raw = requireRecord(value, "Google Workspace CloudEvent");
    if (raw.specversion !== "1.0")
        throw GoogleChatError.invalid("CloudEvent specversion 必须是 1.0");
    const event: GoogleChatCloudEvent = {
        ...raw,
        specversion: "1.0",
        id: requireString(raw.id, "cloudevent.id"),
        source: requireString(raw.source, "cloudevent.source"),
        type: requireString(raw.type, "cloudevent.type"),
        data: requireRecord(raw.data, "cloudevent.data"),
    };
    if (!event.type.startsWith("google.workspace.chat.")) {
        throw GoogleChatError.invalid("CloudEvent type 不是 Google Chat 事件");
    }
    if (raw.time !== undefined) event.time = parseTimestamp(raw.time, "cloudevent.time");
    if (raw.subject !== undefined) event.subject = requireString(raw.subject, "cloudevent.subject");
    const batch = event.type.match(
        /^(google\.workspace\.chat\.(?:message|reaction|membership|space|spaceReadState|threadReadState|availability)\.v1)\.(batchCreated|batchUpdated|batchDeleted)$/u,
    );
    if (!batch) {
        if (!GOOGLE_CHAT_WORKSPACE_EVENT_TYPE_SET.has(event.type)) {
            throw GoogleChatError.invalid(
                `不支持的稳定 Google Chat CloudEvent type: ${event.type}`,
            );
        }
        event.data = normalizeCloudData(event.type, event.data);
        return [event];
    }
    const resource = batch[1].split(".").at(-2) || "";
    const plural =
        resource === "membership"
            ? "memberships"
            : resource === "availability"
              ? "availabilities"
              : `${resource}s`;
    const entries = event.data[plural];
    if (!Array.isArray(entries))
        throw GoogleChatError.invalid(`batch event data.${plural} 必须是数组`);
    return entries.map((entry, index) => {
        const data = requireRecord(entry, `${plural}[${index}]`);
        const derived: GoogleChatCloudEvent = {
            ...event,
            id: `${event.id}:${index}`,
            type: `${batch[1]}.${BATCH_ACTIONS[batch[2]]}`,
            data,
        };
        if (!GOOGLE_CHAT_WORKSPACE_EVENT_TYPE_SET.has(derived.type)) {
            throw GoogleChatError.invalid(`无效的 Google Chat batch action: ${event.type}`);
        }
        derived.data = normalizeCloudData(derived.type, derived.data);
        return derived;
    });
}

export function parsePubSubEnvelope(value: unknown): {
    envelope: GoogleChatPubSubEnvelope;
    event: unknown;
} {
    const raw = requireRecord(value, "Pub/Sub push envelope");
    const message = requireRecord(raw.message, "pubsub.message");
    const data = requireString(message.data, "pubsub.message.data");
    if (data.length > Math.ceil((MAX_PUBSUB_DATA_BYTES * 4) / 3) + 4) {
        throw GoogleChatError.invalid("Pub/Sub message.data 超过 10 MiB 限制");
    }
    if (!/^[A-Za-z0-9+/_-]*={0,2}$/u.test(data)) {
        throw GoogleChatError.invalid("Pub/Sub message.data 不是有效 base64");
    }
    let decoded: unknown;
    try {
        decoded = JSON.parse(Buffer.from(data, "base64").toString("utf8"));
    } catch (error) {
        throw GoogleChatError.invalid("Pub/Sub message.data 不是有效 JSON", {
            cause: String(error),
        });
    }
    const envelope: GoogleChatPubSubEnvelope = {
        ...raw,
        subscription: requireString(raw.subscription, "pubsub.subscription"),
        message: {
            ...message,
            data,
            messageId: requireString(message.messageId, "pubsub.message.messageId"),
            publishTime: optionalTimestamp(message.publishTime, "pubsub.message.publishTime"),
            attributes: parseStringMap(message.attributes, "pubsub.message.attributes"),
            orderingKey: optionalString(message.orderingKey, "pubsub.message.orderingKey"),
        },
    };
    return { envelope, event: decoded };
}

export function parseManualEvent(value: unknown): GoogleChatEventEnvelope[] {
    if (isRecord(value) && value.specversion !== undefined) {
        return parseCloudEvent(value).map(event => ({
            source: "manual",
            event,
            raw_event: value,
            delivery_id: event.id,
        }));
    }
    const event = parseInteractionEvent(value);
    return [
        {
            source: "manual",
            event,
            raw_event: value,
            delivery_id: interactionIdentity(event),
        },
    ];
}

export function interactionIdentity(event: GoogleChatInteractionEvent): string {
    if (!event.eventTime) return sha256Json(event);
    return [
        event.type,
        event.eventTime || "",
        event.message?.name || "",
        event.user?.name || "",
        event.space?.name || "",
    ].join("\u0000");
}

function normalizeCloudData(type: string, data: Record<string, unknown>): Record<string, unknown> {
    if (type.includes(".message."))
        return { ...data, message: parseMessage(data.message, "cloudevent.data.message") };
    if (type.includes(".reaction.")) return { ...data, reaction: parseReaction(data.reaction) };
    if (type.includes(".membership."))
        return { ...data, membership: parseMembership(data.membership) };
    if (type.includes(".space."))
        return { ...data, space: parseSpace(data.space, "cloudevent.data.space") };
    if (type.includes(".availability.")) {
        validateNamedResource(data.availability, "availability", /^users\/[^/]+\/availability$/u);
        return data;
    }
    if (type.includes(".spaceReadState.")) {
        validateNamedResource(
            data.spaceReadState,
            "spaceReadState",
            /^users\/[^/]+\/spaces\/[^/]+\/spaceReadState$/u,
        );
        return data;
    }
    if (type.includes(".threadReadState.")) {
        validateNamedResource(
            data.threadReadState,
            "threadReadState",
            /^users\/[^/]+\/spaces\/[^/]+\/threads\/[^/]+\/threadReadState$/u,
        );
        return data;
    }
    throw GoogleChatError.invalid(`不支持的稳定 Google Chat CloudEvent type: ${type}`);
}

export function parseMessage(value: unknown, field = "message"): GoogleChatMessage {
    const raw = requireRecord(value, field);
    const message: GoogleChatMessage = {
        ...raw,
        name: requireResource(raw.name, field, /^spaces\/[^/]+\/messages\/[^/]+$/u),
    };
    if (raw.sender !== undefined) message.sender = parseUser(raw.sender, `${field}.sender`);
    if (raw.space !== undefined) message.space = parseSpace(raw.space, `${field}.space`);
    if (raw.thread !== undefined) {
        const thread = requireRecord(raw.thread, `${field}.thread`);
        message.thread = {
            ...thread,
            name: requireResource(
                thread.name,
                `${field}.thread`,
                /^spaces\/[^/]+\/threads\/[^/]+$/u,
            ),
        };
    }
    for (const key of ["text", "formattedText", "argumentText"] as const) {
        if (raw[key] !== undefined && typeof raw[key] !== "string")
            throw GoogleChatError.invalid(`${field}.${key} 必须是字符串`);
    }
    for (const key of ["createTime", "lastUpdateTime", "deleteTime"] as const) {
        if (raw[key] !== undefined) message[key] = parseTimestamp(raw[key], `${field}.${key}`);
    }
    if (raw.attachment !== undefined && !Array.isArray(raw.attachment))
        throw GoogleChatError.invalid(`${field}.attachment 必须是数组`);
    if (Array.isArray(raw.attachment)) {
        message.attachment = raw.attachment.map((item, index) =>
            parseAttachment(item, `${field}.attachment[${index}]`),
        );
    }
    return message;
}

export function parseSpace(value: unknown, field = "space"): GoogleChatSpace {
    const raw = requireRecord(value, field);
    if (
        raw.spaceType !== undefined &&
        !["SPACE_TYPE_UNSPECIFIED", "SPACE", "GROUP_CHAT", "DIRECT_MESSAGE"].includes(
            String(raw.spaceType),
        )
    ) {
        throw GoogleChatError.invalid(`${field}.spaceType 无效`);
    }
    if (raw.type !== undefined && !["TYPE_UNSPECIFIED", "ROOM", "DM"].includes(String(raw.type))) {
        throw GoogleChatError.invalid(`${field}.type 无效`);
    }
    return { ...raw, name: requireResource(raw.name, field, /^spaces\/[^/]+$/u) };
}

export function parseUser(value: unknown, field = "user"): GoogleChatUser {
    const raw = requireRecord(value, field);
    if (
        raw.type !== undefined &&
        !["TYPE_UNSPECIFIED", "HUMAN", "BOT"].includes(String(raw.type))
    ) {
        throw GoogleChatError.invalid(`${field}.type 无效`);
    }
    return { ...raw, name: requireResource(raw.name, field, /^users\/(?:app|[^/]+)$/u) };
}

export function parseReaction(value: unknown): GoogleChatReaction {
    const raw = requireRecord(value, "cloudevent.data.reaction");
    const reaction: GoogleChatReaction = {
        ...raw,
        name: requireResource(
            raw.name,
            "reaction",
            /^spaces\/[^/]+\/messages\/[^/]+\/reactions\/[^/]+$/u,
        ),
    };
    if (raw.user !== undefined) reaction.user = parseUser(raw.user, "reaction.user");
    if (raw.emoji !== undefined) {
        const emoji = requireRecord(raw.emoji, "reaction.emoji");
        if (emoji.unicode !== undefined && typeof emoji.unicode !== "string") {
            throw GoogleChatError.invalid("reaction.emoji.unicode 必须是字符串");
        }
        if (emoji.customEmoji !== undefined && !isRecord(emoji.customEmoji)) {
            throw GoogleChatError.invalid("reaction.emoji.customEmoji 必须是对象");
        }
        reaction.emoji = emoji;
    }
    return reaction;
}

export function parseMembership(value: unknown): GoogleChatMembership {
    const raw = requireRecord(value, "cloudevent.data.membership");
    const membership: GoogleChatMembership = {
        ...raw,
        name: requireResource(raw.name, "membership", /^spaces\/[^/]+\/members\/[^/]+$/u),
    };
    if (raw.member !== undefined) membership.member = parseUser(raw.member, "membership.member");
    if (raw.groupMember !== undefined) {
        const group = requireRecord(raw.groupMember, "membership.groupMember");
        const name = requireString(group.name, "membership.groupMember.name");
        if (!/^groups\/[^/]+$/u.test(name)) {
            throw GoogleChatError.invalid("membership.groupMember.name 无效");
        }
        if (group.displayName !== undefined && typeof group.displayName !== "string") {
            throw GoogleChatError.invalid("membership.groupMember.displayName 必须是字符串");
        }
        membership.groupMember = {
            ...group,
            name,
            displayName: typeof group.displayName === "string" ? group.displayName : undefined,
        };
    }
    if (membership.member && membership.groupMember) {
        throw GoogleChatError.invalid("membership 不能同时包含 member 与 groupMember");
    }
    if (
        raw.state !== undefined &&
        !["MEMBERSHIP_STATE_UNSPECIFIED", "JOINED", "INVITED", "NOT_A_MEMBER"].includes(
            String(raw.state),
        )
    ) {
        throw GoogleChatError.invalid("membership.state 无效");
    }
    if (raw.state !== undefined) membership.state = raw.state as GoogleChatMembership["state"];
    if (
        raw.role !== undefined &&
        ![
            "MEMBERSHIP_ROLE_UNSPECIFIED",
            "ROLE_MEMBER",
            "ROLE_MANAGER",
            "ROLE_ASSISTANT_MANAGER",
        ].includes(String(raw.role))
    ) {
        throw GoogleChatError.invalid("membership.role 无效");
    }
    if (raw.role !== undefined) membership.role = raw.role as GoogleChatMembership["role"];
    return membership;
}

function parseAttachment(value: unknown, field: string): GoogleChatAttachment {
    const raw = requireRecord(value, field);
    const attachment: GoogleChatAttachment = {
        ...raw,
        name: requireString(raw.name, `${field}.name`),
        contentName: requireString(raw.contentName, `${field}.contentName`),
        contentType: requireString(raw.contentType, `${field}.contentType`),
    };
    if (!/^spaces\/[^/]+\/messages\/[^/]+\/attachments\/[^/]+$/u.test(attachment.name)) {
        throw GoogleChatError.invalid(`${field}.name 无效`);
    }
    if (raw.attachmentDataRef !== undefined) {
        attachment.attachmentDataRef = requireRecord(
            raw.attachmentDataRef,
            `${field}.attachmentDataRef`,
        );
    }
    if (raw.driveDataRef !== undefined) {
        attachment.driveDataRef = requireRecord(raw.driveDataRef, `${field}.driveDataRef`);
    }
    return attachment;
}

function validateNamedResource(value: unknown, field: string, pattern: RegExp): void {
    const name = requireString(
        requireRecord(value, `cloudevent.data.${field}`).name,
        `${field}.name`,
    );
    if (!pattern.test(name)) throw GoogleChatError.invalid(`${field}.name 无效`);
}

function requireResource(value: unknown, field: string, pattern: RegExp): string {
    const resource = requireString(value, `${field}.name`);
    if (!pattern.test(resource))
        throw GoogleChatError.invalid(`${field}.name 不是有效 Google Chat resource name`);
    return resource;
}

function parseTimestamp(value: unknown, field: string): string {
    const timestamp = requireString(value, field);
    if (!Number.isFinite(Date.parse(timestamp)))
        throw GoogleChatError.invalid(`${field} 不是有效 RFC 3339 时间`);
    return timestamp;
}

function optionalTimestamp(value: unknown, field: string): string | undefined {
    return value === undefined ? undefined : parseTimestamp(value, field);
}

function optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined) return undefined;
    return requireString(value, field);
}

function parseStringMap(value: unknown, field: string): Record<string, string> | undefined {
    if (value === undefined) return undefined;
    const record = requireRecord(value, field);
    if (Object.values(record).some(item => typeof item !== "string"))
        throw GoogleChatError.invalid(`${field} 必须只包含字符串值`);
    return record as Record<string, string>;
}
