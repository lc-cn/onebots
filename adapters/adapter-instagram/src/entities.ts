import { InstagramError } from "./errors.js";
import type {
    InstagramApiMessage,
    InstagramBusinessProfile,
    InstagramConversation,
    InstagramList,
    InstagramPaging,
    InstagramSendResponse,
    InstagramUserProfile,
} from "./types.js";
import {
    assertNumericMetaId,
    optionalString,
    requireArray,
    requireNumber,
    requireRecord,
    requireString,
} from "./validation.js";

export function parseBusinessProfile(value: unknown): InstagramBusinessProfile {
    const root = requireRecord(value, "Instagram business profile");
    return {
        id: assertNumericMetaId(root.id, "profile.id"),
        user_id: optionalNumericId(root.user_id, "profile.user_id"),
        username: optionalString(root.username, "profile.username"),
        name: optionalString(root.name, "profile.name"),
        profile_picture_url: optionalString(
            root.profile_picture_url,
            "profile.profile_picture_url",
        ),
        account_type: optionalString(root.account_type, "profile.account_type"),
    };
}

export function parseUserProfile(value: unknown): InstagramUserProfile {
    const root = requireRecord(value, "Instagram user profile");
    return {
        id: assertNumericMetaId(root.id, "user.id"),
        name: optionalString(root.name, "user.name"),
        username: optionalString(root.username, "user.username"),
        profile_pic: optionalString(root.profile_pic, "user.profile_pic"),
        follower_count: optionalNonNegativeInteger(root.follower_count, "user.follower_count"),
        is_user_follow_business: optionalBoolean(
            root.is_user_follow_business,
            "user.is_user_follow_business",
        ),
        is_business_follow_user: optionalBoolean(
            root.is_business_follow_user,
            "user.is_business_follow_user",
        ),
        is_verified_user: optionalBoolean(root.is_verified_user, "user.is_verified_user"),
    };
}

export function parseSendResponse(value: unknown): InstagramSendResponse {
    const root = requireRecord(value, "Instagram send response");
    return {
        recipient_id: assertNumericMetaId(root.recipient_id, "send.recipient_id"),
        message_id: requireString(root.message_id, "send.message_id"),
    };
}

export function parseConversationList(value: unknown): InstagramList<InstagramConversation> {
    const root = requireRecord(value, "Instagram conversations response");
    return {
        data: requireArray(root.data, "conversations.data").map((item, index) =>
            parseConversation(item, `conversations.data[${index}]`),
        ),
        paging: parsePaging(root.paging, "conversations.paging"),
    };
}

export function parseConversation(value: unknown, field = "conversation"): InstagramConversation {
    const root = requireRecord(value, field);
    const participants = root.participants;
    const messages = root.messages;
    return {
        id: requireString(root.id, `${field}.id`),
        updated_time: optionalString(root.updated_time, `${field}.updated_time`),
        participants:
            participants === undefined
                ? undefined
                : {
                      data: requireArray(
                          requireRecord(participants, `${field}.participants`).data,
                          `${field}.participants.data`,
                      ).map((item, index) =>
                          parsePerson(item, `${field}.participants.data[${index}]`),
                      ),
                  },
        messages:
            messages === undefined
                ? undefined
                : parseMessageConnection(messages, `${field}.messages`),
    };
}

export function parseApiMessage(value: unknown, field = "message"): InstagramApiMessage {
    const root = requireRecord(value, field);
    const from = root.from;
    const to = root.to;
    return {
        id: requireString(root.id, `${field}.id`),
        created_time: requireString(root.created_time, `${field}.created_time`),
        from: from === undefined ? undefined : parsePerson(from, `${field}.from`),
        to:
            to === undefined
                ? undefined
                : {
                      data: requireArray(
                          requireRecord(to, `${field}.to`).data,
                          `${field}.to.data`,
                      ).map((item, index) => parsePerson(item, `${field}.to.data[${index}]`)),
                  },
        message: optionalString(root.message, `${field}.message`),
    };
}

export function parseAttachmentId(value: unknown): string {
    return requireString(
        requireRecord(value, "Instagram attachment response").attachment_id,
        "attachment_id",
    );
}

export function parseSuccess(value: unknown, field: string): true {
    const root = requireRecord(value, field);
    if (root.success !== true) {
        throw new InstagramError(`${field} 未返回 success`, {
            code: "INSTAGRAM_INVALID_RESPONSE",
            details: { response: root },
        });
    }
    return true;
}

function parseMessageConnection(
    value: unknown,
    field: string,
): NonNullable<InstagramConversation["messages"]> {
    const root = requireRecord(value, field);
    return {
        data: requireArray(root.data, `${field}.data`).map((item, index) =>
            parseApiMessage(item, `${field}.data[${index}]`),
        ),
        paging: parsePaging(root.paging, `${field}.paging`),
    };
}

function parsePaging(value: unknown, field: string): InstagramPaging | undefined {
    if (value === undefined) return undefined;
    const root = requireRecord(value, field);
    if (root.cursors === undefined) return {};
    const cursors = requireRecord(root.cursors, `${field}.cursors`);
    return {
        cursors: {
            before: optionalString(cursors.before, `${field}.cursors.before`),
            after: optionalString(cursors.after, `${field}.cursors.after`),
        },
    };
}

function parsePerson(value: unknown, field: string): { id: string; username?: string } {
    const root = requireRecord(value, field);
    return {
        id: assertNumericMetaId(root.id, `${field}.id`),
        username: optionalString(root.username ?? root.name, `${field}.username`),
    };
}

function optionalNumericId(value: unknown, field: string): string | undefined {
    return value === undefined ? undefined : assertNumericMetaId(value, field);
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") throw InstagramError.invalid(`${field} 必须是 boolean`);
    return value;
}

function optionalNonNegativeInteger(value: unknown, field: string): number | undefined {
    if (value === undefined) return undefined;
    const number = requireNumber(value, field);
    if (!Number.isSafeInteger(number) || number < 0) {
        throw InstagramError.invalid(`${field} 必须是非负安全整数`);
    }
    return number;
}
