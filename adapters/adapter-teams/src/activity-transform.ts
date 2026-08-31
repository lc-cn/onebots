import type { Activity, ConversationReference } from "@microsoft/agents-activity";
import type {
    TeamsActivity,
    TeamsChannelData,
    TeamsConversationReference,
    TeamsEntity,
    TeamsUser,
} from "./types.js";

/** 将 Agents SDK Activity 转为稳定、可序列化且不丢协议关键字段的原始事件。 */
export function transformTeamsActivity(activity: Activity): TeamsActivity {
    const channelData = objectValue(activity.channelData) as TeamsChannelData | undefined;
    return {
        type: activity.type || "message",
        id: activity.id || "",
        timestamp: dateValue(activity.timestamp),
        localTimestamp: optionalDateValue(activity.localTimestamp),
        localTimezone: activity.localTimezone,
        serviceUrl: activity.serviceUrl,
        channelId: activity.channelId || "msteams",
        from: transformUser(activity.from, channelData?.tenant?.id),
        recipient: activity.recipient
            ? transformUser(activity.recipient, channelData?.tenant?.id)
            : undefined,
        conversation: {
            id: activity.conversation?.id || "",
            name: activity.conversation?.name,
            isGroup: activity.conversation?.isGroup,
            conversationType: activity.conversation?.conversationType,
            tenantId: activity.conversation?.tenantId || channelData?.tenant?.id,
        },
        replyToId: activity.replyToId,
        text: activity.text,
        textFormat: activity.textFormat,
        locale: activity.locale,
        importance: activity.importance,
        name: activity.name,
        action: activity.action,
        summary: activity.summary,
        channelData,
        entities: activity.entities?.map(entity => transformEntity(entity)),
        attachments: activity.attachments?.map(attachment => ({
            contentType: attachment.contentType,
            contentUrl: attachment.contentUrl,
            content: attachment.content,
            name: attachment.name,
            thumbnailUrl: attachment.thumbnailUrl,
        })),
        membersAdded: activity.membersAdded?.map(member =>
            transformUser(member, channelData?.tenant?.id),
        ),
        membersRemoved: activity.membersRemoved?.map(member =>
            transformUser(member, channelData?.tenant?.id),
        ),
        reactionsAdded: activity.reactionsAdded?.map(reaction => ({ type: reaction.type })),
        reactionsRemoved: activity.reactionsRemoved?.map(reaction => ({ type: reaction.type })),
        value: activity.value,
        relatesTo: activity.relatesTo,
    };
}

export function transformConversationReference(
    reference: ConversationReference,
): TeamsConversationReference {
    return {
        activityId: reference.activityId,
        user: reference.user ? transformUser(reference.user) : undefined,
        locale: reference.locale,
        agent:
            reference.agent === null
                ? null
                : reference.agent === undefined
                  ? undefined
                  : transformUser(reference.agent),
        conversation: {
            id: reference.conversation.id,
            name: reference.conversation.name,
            isGroup: reference.conversation.isGroup,
            conversationType: reference.conversation.conversationType,
            tenantId: reference.conversation.tenantId,
        },
        channelId: reference.channelId,
        serviceUrl: reference.serviceUrl,
    };
}

function transformUser(
    user:
        | { id?: string; name?: string; aadObjectId?: string; tenantId?: string; role?: string }
        | null
        | undefined,
    tenantId?: string,
): TeamsUser {
    return {
        id: user?.id || "",
        name: user?.name || "",
        aadObjectId: user?.aadObjectId,
        tenantId: user?.tenantId || tenantId,
        role: user?.role,
    };
}

function transformEntity(entity: object): TeamsEntity {
    const value = entity as Record<string, unknown>;
    const mentioned = objectValue(value.mentioned);
    return {
        ...value,
        type: typeof value.type === "string" ? value.type : "unknown",
        text: typeof value.text === "string" ? value.text : undefined,
        mentioned: mentioned
            ? transformUser(mentioned as Parameters<typeof transformUser>[0])
            : undefined,
    };
}

function objectValue(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : undefined;
}

function dateValue(value: Date | string | undefined): string {
    if (value instanceof Date) return value.toISOString();
    return typeof value === "string" ? value : new Date().toISOString();
}

function optionalDateValue(value: Date | string | undefined): string | undefined {
    if (value instanceof Date) return value.toISOString();
    return typeof value === "string" ? value : undefined;
}
