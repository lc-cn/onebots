import { FacebookMessengerError } from "./errors.js";
import type {
    MessengerApiMessage,
    MessengerConversation,
    MessengerList,
    MessengerPageProfile,
    MessengerPaging,
    MessengerSendResponse,
    MessengerUserProfile,
} from "./types.js";
import {
    assertNumericMetaId,
    optionalString,
    requireArray,
    requireNumber,
    requireRecord,
    requireString,
} from "./validation.js";

export function parsePageProfile(value: unknown): MessengerPageProfile {
    const root = requireRecord(value, "Page profile");
    const picture = root.picture;
    let pictureUrl: string | undefined;
    if (picture !== undefined) {
        const data = requireRecord(requireRecord(picture, "picture").data, "picture.data");
        pictureUrl = optionalString(data.url, "picture.data.url");
    }
    return {
        id: assertNumericMetaId(root.id, "Page.id"),
        name: requireString(root.name, "Page.name"),
        picture: pictureUrl,
    };
}

export function parseUserProfile(value: unknown): MessengerUserProfile {
    const root = requireRecord(value, "Messenger user profile");
    return {
        id: assertNumericMetaId(root.id, "user.id"),
        first_name: optionalString(root.first_name, "user.first_name"),
        last_name: optionalString(root.last_name, "user.last_name"),
        name: optionalString(root.name, "user.name"),
        profile_pic: optionalString(root.profile_pic, "user.profile_pic"),
        locale: optionalString(root.locale, "user.locale"),
        timezone:
            root.timezone === undefined ? undefined : requireNumber(root.timezone, "user.timezone"),
        gender: optionalString(root.gender, "user.gender"),
    };
}

export function parseSendResponse(value: unknown): MessengerSendResponse {
    const root = requireRecord(value, "Messenger send response");
    return {
        recipient_id: assertNumericMetaId(root.recipient_id, "send.recipient_id"),
        message_id: optionalString(root.message_id, "send.message_id"),
    };
}

export function parseConversationList(value: unknown): MessengerList<MessengerConversation> {
    const root = requireRecord(value, "Messenger conversations response");
    return {
        data: requireArray(root.data, "conversations.data").map((item, index) =>
            parseConversation(item, `conversations.data[${index}]`),
        ),
        paging: parsePaging(root.paging, "conversations.paging"),
    };
}

export function parseConversation(value: unknown, field = "conversation"): MessengerConversation {
    const root = requireRecord(value, field);
    const participants = root.participants;
    const messages = root.messages;
    return {
        id: requireString(root.id, `${field}.id`),
        link: optionalString(root.link, `${field}.link`),
        updated_time: optionalString(root.updated_time, `${field}.updated_time`),
        message_count:
            root.message_count === undefined
                ? undefined
                : requireNumber(root.message_count, `${field}.message_count`),
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

export function parseApiMessage(value: unknown, field = "message"): MessengerApiMessage {
    const root = requireRecord(value, field);
    const from = root.from;
    const to = root.to;
    const attachments = root.attachments;
    const replyTo = root.reply_to;
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
        attachments:
            attachments === undefined
                ? undefined
                : {
                      data: requireArray(
                          requireRecord(attachments, `${field}.attachments`).data,
                          `${field}.attachments.data`,
                      ).map((item, index) =>
                          structuredClone(
                              requireRecord(item, `${field}.attachments.data[${index}]`),
                          ),
                      ),
                  },
        reply_to:
            replyTo === undefined
                ? undefined
                : {
                      mid: requireString(
                          requireRecord(replyTo, `${field}.reply_to`).mid,
                          `${field}.reply_to.mid`,
                      ),
                      is_self_reply: optionalBoolean(
                          requireRecord(replyTo, `${field}.reply_to`).is_self_reply,
                          `${field}.reply_to.is_self_reply`,
                      ),
                  },
    };
}

export function parseAttachmentId(value: unknown): string {
    return requireString(
        requireRecord(value, "attachment upload response").attachment_id,
        "attachment_id",
    );
}

export function parseSuccess(value: unknown, field: string): true {
    const root = requireRecord(value, field);
    if (root.success !== true) {
        throw new FacebookMessengerError(`${field} 未返回 success`, {
            code: "FACEBOOK_MESSENGER_INVALID_RESPONSE",
            details: { response: root },
        });
    }
    return true;
}

function parseMessageConnection(
    value: unknown,
    field: string,
): NonNullable<MessengerConversation["messages"]> {
    const root = requireRecord(value, field);
    return {
        data: requireArray(root.data, `${field}.data`).map((item, index) =>
            parseApiMessage(item, `${field}.data[${index}]`),
        ),
        paging: parsePaging(root.paging, `${field}.paging`),
    };
}

function parsePaging(value: unknown, field: string): MessengerPaging | undefined {
    if (value === undefined) return undefined;
    const root = requireRecord(value, field);
    const cursors = root.cursors;
    return {
        cursors:
            cursors === undefined
                ? undefined
                : {
                      before: optionalString(
                          requireRecord(cursors, `${field}.cursors`).before,
                          `${field}.cursors.before`,
                      ),
                      after: optionalString(
                          requireRecord(cursors, `${field}.cursors`).after,
                          `${field}.cursors.after`,
                      ),
                  },
    };
}

function parsePerson(value: unknown, field: string): { id: string; name?: string } {
    const root = requireRecord(value, field);
    return {
        id: assertNumericMetaId(root.id, `${field}.id`),
        name: optionalString(root.name ?? root.username, `${field}.name`),
    };
}

function optionalBoolean(value: unknown, field: string): boolean | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "boolean") {
        throw FacebookMessengerError.invalid(`${field} 必须是 boolean`);
    }
    return value;
}
