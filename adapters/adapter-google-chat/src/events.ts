import { sha256Json, type CommonEvent, type CommonTypes } from "onebots";
import { projectGoogleChatMessage } from "./messages.js";
import type {
    GoogleChatCloudEvent,
    GoogleChatEventEnvelope,
    GoogleChatInteractionEvent,
    GoogleChatMembership,
    GoogleChatMessage,
    GoogleChatReaction,
    GoogleChatSpace,
} from "./types.js";
import { isRecord } from "./validation.js";

export interface GoogleChatProjectionContext {
    botId: CommonTypes.Id;
    principalName: string;
    createId(value: string | number): CommonTypes.Id;
}

export function projectGoogleChatEvent(
    envelope: GoogleChatEventEnvelope,
    context: GoogleChatProjectionContext,
): CommonEvent.Event<unknown>[] {
    return envelope.event.specversion === "1.0"
        ? projectCloudEvent(envelope, envelope.event as GoogleChatCloudEvent, context)
        : projectInteraction(envelope, envelope.event as GoogleChatInteractionEvent, context);
}

function projectInteraction(
    envelope: GoogleChatEventEnvelope,
    event: GoogleChatInteractionEvent,
    context: GoogleChatProjectionContext,
): CommonEvent.Event<unknown>[] {
    if (event.type === "MESSAGE" && event.message)
        return [messageEvent(envelope, event.message, context, event.user)];
    if ((event.type === "ADDED_TO_SPACE" || event.type === "REMOVED_FROM_SPACE") && event.space) {
        return [
            {
                ...base(envelope, context),
                type: "notice",
                notice_type: event.type === "ADDED_TO_SPACE" ? "member_joined" : "member_left",
                sub_type: "bot",
                user: { id: context.createId(context.principalName) },
                operator: event.user
                    ? { id: context.createId(event.user.name), name: event.user.displayName }
                    : undefined,
                group: group(event.space, context),
            },
        ];
    }
    return [custom(envelope, event.type, context, { interaction: event })];
}

function projectCloudEvent(
    envelope: GoogleChatEventEnvelope,
    event: GoogleChatCloudEvent,
    context: GoogleChatProjectionContext,
): CommonEvent.Event<unknown>[] {
    const action = event.type.split(".").at(-1);
    if (event.type.includes(".message.")) {
        const message = event.data.message as GoogleChatMessage;
        if (action === "created") {
            if (!message.sender) {
                return [custom(envelope, "message_created_resource_only", context, { message })];
            }
            return [messageEvent(envelope, message, context)];
        }
        return [
            {
                ...base(envelope, context),
                type: "notice",
                notice_type: action === "updated" ? "message_updated" : "message_deleted",
                message_id: context.createId(message.name),
                user: message.sender
                    ? {
                          id: context.createId(message.sender.name),
                          name: message.sender.displayName,
                      }
                    : undefined,
                group: message.space
                    ? group(message.space, context)
                    : groupFromResource(message.name, context),
                message: action === "updated" ? projectGoogleChatMessage(message) : undefined,
            },
        ];
    }
    if (event.type.includes(".reaction."))
        return [
            reactionEvent(
                envelope,
                event.data.reaction as GoogleChatReaction,
                action === "created",
                context,
            ),
        ];
    if (event.type.includes(".membership."))
        return [
            membershipEvent(
                envelope,
                event.data.membership as GoogleChatMembership,
                action || "updated",
                context,
            ),
        ];
    if (event.type.includes(".space.")) {
        const space = event.data.space as GoogleChatSpace;
        return [
            {
                ...base(envelope, context),
                type: "notice",
                notice_type: "channel_updated",
                sub_type: action,
                group: group(space, context),
                extensions: { google_chat: { space, deleted: action === "deleted" } },
            },
        ];
    }
    if (event.type.includes(".availability.")) {
        const availability = event.data.availability;
        const name =
            isRecord(availability) && typeof availability.name === "string"
                ? availability.name.replace(/\/availability$/u, "")
                : undefined;
        return [
            {
                ...base(envelope, context),
                type: "notice",
                notice_type: "user_updated",
                sub_type: "availability",
                user: name ? { id: context.createId(name) } : undefined,
                extensions: { google_chat: { availability } },
            },
        ];
    }
    if (event.type.includes("ReadState.")) {
        return [
            {
                ...base(envelope, context),
                type: "notice",
                notice_type: "message_status",
                sub_type: event.type.includes("threadReadState") ? "thread_read" : "space_read",
                extensions: { google_chat: event.data },
            },
        ];
    }
    return [custom(envelope, event.type, context, { cloud_event: event })];
}

function messageEvent(
    envelope: GoogleChatEventEnvelope,
    message: GoogleChatMessage,
    context: GoogleChatProjectionContext,
    fallbackSender?: GoogleChatInteractionEvent["user"],
): CommonEvent.Message<unknown> {
    const space = envelope.space || message.space || spaceFromMessageName(message.name);
    const direct =
        space.spaceType === "DIRECT_MESSAGE" ||
        space.type === "DM" ||
        space.singleUserBotDm === true;
    const sender = message.sender || fallbackSender;
    if (!sender) throw new Error("Google Chat message event 缺少已校验 sender");
    return {
        ...base(envelope, context),
        type: "message",
        message_type: direct ? "direct" : "group",
        message_id: context.createId(message.name),
        sender: {
            id: context.createId(sender.name),
            name: sender.displayName,
        },
        group: direct ? undefined : group(space, context),
        message: projectGoogleChatMessage(message),
        raw_message: message.text,
        extensions: {
            google_chat: { space, thread: message.thread, annotations: message.annotations },
        },
    };
}

function reactionEvent(
    envelope: GoogleChatEventEnvelope,
    reaction: GoogleChatReaction,
    added: boolean,
    context: GoogleChatProjectionContext,
): CommonEvent.Notice<unknown> {
    const messageName = reaction.name.replace(/\/reactions\/[^/]+$/u, "");
    return {
        ...base(envelope, context),
        type: "notice",
        notice_type: added ? "reaction_added" : "reaction_removed",
        message_id: context.createId(messageName),
        user: reaction.user
            ? { id: context.createId(reaction.user.name), name: reaction.user.displayName }
            : undefined,
        group: groupFromResource(reaction.name, context),
        extensions: { google_chat: { reaction_name: reaction.name, emoji: reaction.emoji } },
    };
}

function membershipEvent(
    envelope: GoogleChatEventEnvelope,
    membership: GoogleChatMembership,
    action: string,
    context: GoogleChatProjectionContext,
): CommonEvent.Event<unknown> {
    if (membership.groupMember) {
        return custom(envelope, `google_group_membership_${action}`, context, {
            membership,
            action,
        });
    }
    if (!membership.member) {
        return custom(envelope, `membership_${action}_resource_only`, context, {
            membership,
            action,
        });
    }
    if (membership.state === "INVITED") {
        return custom(envelope, "membership_invited", context, { membership, action });
    }
    const joined = membership.state === "JOINED" || action === "created";
    return {
        ...base(envelope, context),
        type: "notice",
        notice_type: joined ? "member_joined" : "member_left",
        sub_type: membership.role,
        user: {
            id: context.createId(membership.member.name),
            name: membership.member.displayName,
        },
        group: groupFromResource(membership.name, context),
        extensions: { google_chat: { membership, action } },
    };
}

function custom(
    envelope: GoogleChatEventEnvelope,
    subtype: string,
    context: GoogleChatProjectionContext,
    extension: Record<string, unknown>,
): CommonEvent.Notice<unknown> {
    return {
        ...base(envelope, context),
        type: "notice",
        notice_type: "custom",
        sub_type: subtype,
        extensions: { google_chat: extension },
    };
}

function base(
    envelope: GoogleChatEventEnvelope,
    context: GoogleChatProjectionContext,
): CommonEvent.Base<unknown> {
    const timestamp =
        envelope.event.specversion === "1.0"
            ? (envelope.event as GoogleChatCloudEvent).time
            : (envelope.event as GoogleChatInteractionEvent).eventTime;
    return {
        id: context.createId(`event:${envelope.delivery_id || sha256Json(envelope)}`),
        timestamp: timestamp ? Date.parse(timestamp) : Date.now(),
        type: "custom",
        platform: "google-chat",
        bot_id: context.botId,
        raw_event: envelope.raw_event,
    };
}

function group(space: GoogleChatSpace, context: GoogleChatProjectionContext): CommonTypes.Group {
    return {
        id: context.createId(space.name),
        channel_id: context.createId(space.name),
        name: space.displayName,
    };
}

function groupFromResource(name: string, context: GoogleChatProjectionContext): CommonTypes.Group {
    return group({ name: name.split("/messages/")[0].split("/members/")[0] }, context);
}

function spaceFromMessageName(name: string): GoogleChatSpace {
    return { name: name.split("/messages/")[0] };
}
