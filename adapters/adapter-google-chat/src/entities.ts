import { GoogleChatError } from "./errors.js";
import { parseMembership, parseMessage, parseReaction, parseSpace } from "./event-validation.js";
import type {
    GoogleChatListResponse,
    GoogleChatMembership,
    GoogleChatMessage,
    GoogleChatReaction,
    GoogleChatSpace,
} from "./types.js";
import { requireRecord, requireString } from "./validation.js";

export function parseMessageResponse(
    value: unknown,
    field = "messages response",
): GoogleChatMessage {
    return parseMessage(value, field);
}

export function parseSpaceResponse(value: unknown, field = "spaces response"): GoogleChatSpace {
    return parseSpace(value, field);
}

export function parseMembershipResponse(value: unknown): GoogleChatMembership {
    return parseMembership(value);
}

export function parseReactionResponse(value: unknown): GoogleChatReaction {
    return parseReaction(value);
}

export function parseMessageList(value: unknown): GoogleChatListResponse<GoogleChatMessage> {
    return parseList(value, "messages", (item, index) => parseMessage(item, `messages[${index}]`));
}

export function parseSpaceList(value: unknown): GoogleChatListResponse<GoogleChatSpace> {
    return parseList(value, "spaces", (item, index) => parseSpace(item, `spaces[${index}]`));
}

export function parseMembershipList(value: unknown): GoogleChatListResponse<GoogleChatMembership> {
    return parseList(value, "memberships", item => parseMembership(item));
}

export function parseReactionList(value: unknown): GoogleChatListResponse<GoogleChatReaction> {
    return parseList(value, "reactions", item => parseReaction(item));
}

export function parseCreatedMessageName(value: unknown): string {
    return parseMessage(value, "messages.create response").name;
}

export function parseAttachmentUpload(value: unknown): Record<string, unknown> {
    const body = requireRecord(value, "attachments.upload response");
    const reference = requireRecord(body.attachmentDataRef, "attachmentDataRef");
    const resourceName = requireString(reference.resourceName, "attachmentDataRef.resourceName");
    if (!/^spaces\/[^/]+\/attachments\/[^/]+$/u.test(resourceName)) {
        throw GoogleChatError.invalid("attachmentDataRef.resourceName 无效");
    }
    if (reference.attachmentUploadToken !== undefined) {
        requireString(reference.attachmentUploadToken, "attachmentDataRef.attachmentUploadToken");
    }
    return { ...reference };
}

function parseList<T>(
    value: unknown,
    key: string,
    parse: (item: unknown, index: number) => T,
): GoogleChatListResponse<T> {
    const body = requireRecord(value, `${key}.list response`);
    const rawItems = body[key] === undefined ? [] : body[key];
    if (!Array.isArray(rawItems)) throw GoogleChatError.invalid(`${key} 必须是数组`);
    const nextPageToken =
        body.nextPageToken === undefined
            ? undefined
            : requireString(body.nextPageToken, "nextPageToken");
    return { ...body, items: rawItems.map(parse), nextPageToken };
}
