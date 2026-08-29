import { compileTeamsActivity } from "./activity.js";
import { Activity, ActivityTypes } from "@microsoft/agents-activity";
import type { TeamsBot } from "./bot.js";
import { TeamsApiError } from "./errors.js";
import type { TeamsConversationReference } from "./types.js";

export const TEAMS_PLATFORM_ACTIONS = new Set([
    "get_conversation_reference",
    "list_conversation_references",
    "register_conversation_reference",
    "create_personal_conversation",
    "send_adaptive_card",
    "send_targeted_message",
    "send_typing",
    "send_file_consent_card",
    "send_file_info_card",
    "complete_file_consent_upload",
    "get_team_details",
    "list_team_channels",
    "get_conversation_member",
    "list_conversation_members",
    "list_conversation_members_paged",
    "add_message_reaction",
    "remove_message_reaction",
    "get_meeting_info",
    "get_meeting_participant",
    "send_meeting_notification",
    "call_graph_api",
]);

/** 执行 Microsoft Teams Connector 与 Graph 的显式平台动作。 */
export async function executeTeamsPlatformAction(
    bot: TeamsBot,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    if (action === "get_conversation_reference") {
        return bot.getConversationReference(
            requireString(params.conversation_id, "conversation_id"),
        );
    }
    if (action === "list_conversation_references") return bot.listConversationReferences();
    if (action === "register_conversation_reference") {
        const reference = conversationReferenceValue(params.reference);
        bot.registerConversationReference(reference);
        return reference;
    }
    if (action === "create_personal_conversation") {
        const activity = compileTeamsActivity(messageValue(params.message), {
            resolveUserId: String,
        });
        return bot.createPersonalConversation({
            service_url: requireHttpsUrl(params.service_url, "service_url"),
            tenant_id: requireString(params.tenant_id, "tenant_id"),
            aad_object_id: requireString(params.aad_object_id, "aad_object_id"),
            activity,
        });
    }
    if (action === "call_graph_api") return callGraph(bot, params);

    const conversationId = requireString(params.conversation_id, "conversation_id");
    if (action === "send_adaptive_card") {
        const activity = compileTeamsActivity(
            [{ type: "adaptive_card", data: { content: objectValue(params.card, "card") } }],
            { resolveUserId: String },
        );
        return bot.sendActivity(conversationId, activity);
    }
    if (action === "send_targeted_message") {
        const activity = compileTeamsActivity(messageValue(params.message), {
            resolveUserId: String,
        });
        activity.entities = [
            ...(activity.entities || []),
            { type: "activityTreatment", treatment: "targeted" },
        ];
        const userId = optionalString(params.user_id);
        if (userId) activity.recipient = { id: userId };
        return bot.sendActivity(conversationId, activity);
    }
    if (action === "send_typing") {
        return bot.sendActivity(conversationId, new Activity(ActivityTypes.Typing));
    }
    if (action === "send_file_consent_card") {
        return bot.sendActivity(
            conversationId,
            teamsCard(
                "application/vnd.microsoft.teams.card.file.consent",
                {
                    description: optionalString(params.description) || "",
                    sizeInBytes: requireNumber(params.size_in_bytes, "size_in_bytes"),
                    acceptContext: params.accept_context,
                    declineContext: params.decline_context,
                },
                requireString(params.file_name, "file_name"),
            ),
        );
    }
    if (action === "send_file_info_card") {
        return bot.sendActivity(conversationId, fileInfoActivity(params));
    }
    if (action === "complete_file_consent_upload") {
        const upload = await bot.uploadFileConsentContent(
            requireHttpsUrl(params.upload_url, "upload_url"),
            {
                source: requireString(params.source, "source"),
                filename: optionalString(params.file_name),
                contentType: optionalString(params.content_type),
            },
        );
        const message = await bot.sendActivity(conversationId, fileInfoActivity(params));
        return { upload, message };
    }

    return bot.withConversation(conversationId, async context => {
        if (action === "get_team_details") {
            return context.client.teams.getById(requireString(params.team_id, "team_id"));
        }
        if (action === "list_team_channels") {
            return context.client.teams.getConversations(requireString(params.team_id, "team_id"));
        }
        if (action === "get_conversation_member") {
            return context.client.conversations.getMemberById(
                conversationId,
                requireString(params.user_id, "user_id"),
            );
        }
        if (action === "list_conversation_members") {
            return context.client.conversations.getMembers(conversationId);
        }
        if (action === "list_conversation_members_paged") {
            return context.client.conversations.getPagedMembers(
                conversationId,
                optionalNumber(params.page_size),
                optionalString(params.continuation_token),
            );
        }
        if (action === "add_message_reaction" || action === "remove_message_reaction") {
            const operation =
                action === "add_message_reaction"
                    ? context.client.conversations.addReaction.bind(context.client.conversations)
                    : context.client.conversations.deleteReaction.bind(
                          context.client.conversations,
                      );
            const reaction = requireString(params.reaction, "reaction") as Parameters<
                typeof operation
            >[2];
            await operation(
                conversationId,
                requireString(params.message_id, "message_id"),
                reaction,
            );
            return undefined;
        }
        if (action === "get_meeting_info") {
            return context.client.meetings.getById(requireString(params.meeting_id, "meeting_id"));
        }
        if (action === "get_meeting_participant") {
            return context.client.meetings.getParticipant(
                requireString(params.meeting_id, "meeting_id"),
                requireString(params.aad_object_id, "aad_object_id"),
                requireString(params.tenant_id, "tenant_id"),
            );
        }
        if (action === "send_meeting_notification") {
            const send = context.client.meetings.sendNotification.bind(context.client.meetings);
            return send(
                requireString(params.meeting_id, "meeting_id"),
                objectValue(params.notification, "notification") as Parameters<typeof send>[1],
            );
        }
        throw TeamsApiError.invalid(`未实现 Teams 平台动作: ${action}`, "TEAMS_ACTION_UNSUPPORTED");
    });
}

async function callGraph(
    bot: TeamsBot,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    const path = requireGraphPath(params.path);
    const method = (optionalString(params.method)?.toUpperCase() || "GET") as
        | "GET"
        | "POST"
        | "PATCH"
        | "PUT"
        | "DELETE";
    if (!["GET", "POST", "PATCH", "PUT", "DELETE"].includes(method)) {
        throw TeamsApiError.invalid(
            `Teams Graph method 不受支持: ${method}`,
            "TEAMS_GRAPH_METHOD_INVALID",
        );
    }
    const query = params.query == null ? undefined : scalarObject(params.query, "query");
    const body = ["POST", "PATCH", "PUT"].includes(method)
        ? params.body == null
            ? undefined
            : objectValue(params.body, "body")
        : undefined;
    return bot.callGraphApi(path, { method, query, body });
}

function messageValue(value: unknown): Array<{ type: string; data: Record<string, unknown> }> {
    if (typeof value === "string") return [{ type: "text", data: { text: value } }];
    if (!Array.isArray(value)) {
        throw TeamsApiError.invalid(
            "Teams 参数 message 必须是字符串或消息段数组",
            "TEAMS_MESSAGE_INVALID",
        );
    }
    return value.map((item, index) => {
        const segment = objectValue(item, `message[${index}]`);
        return {
            type: requireString(segment.type, `message[${index}].type`),
            data: objectValue(segment.data, `message[${index}].data`),
        };
    });
}

function requireGraphPath(value: unknown): string {
    const path = requireString(value, "path");
    if (!path.startsWith("/") || path.startsWith("//") || path.includes("..")) {
        throw TeamsApiError.invalid(
            "Teams Graph path 必须是安全的 API 相对路径",
            "TEAMS_GRAPH_PATH_INVALID",
        );
    }
    return path;
}

function conversationReferenceValue(value: unknown): TeamsConversationReference {
    const input = objectValue(value, "reference");
    const conversation = objectValue(input.conversation, "reference.conversation");
    const user = optionalUser(input.user, "reference.user");
    const agent = input.agent === null ? null : optionalUser(input.agent, "reference.agent");
    return {
        activityId: optionalString(input.activityId),
        user,
        locale: optionalString(input.locale),
        agent,
        conversation: {
            id: requireString(conversation.id, "reference.conversation.id"),
            name: optionalString(conversation.name),
            isGroup: typeof conversation.isGroup === "boolean" ? conversation.isGroup : undefined,
            conversationType: optionalString(conversation.conversationType),
            tenantId: optionalString(conversation.tenantId),
        },
        channelId: requireString(input.channelId, "reference.channelId"),
        serviceUrl: requireHttpsUrl(input.serviceUrl, "reference.serviceUrl"),
    };
}

function optionalUser(value: unknown, name: string): TeamsConversationReference["user"] {
    if (value == null) return undefined;
    const input = objectValue(value, name);
    return {
        id: requireString(input.id, `${name}.id`),
        name: optionalString(input.name) || "",
        aadObjectId: optionalString(input.aadObjectId),
        tenantId: optionalString(input.tenantId),
        role: optionalString(input.role),
    };
}

function requireHttpsUrl(value: unknown, name: string): string {
    const result = requireString(value, name);
    if (!URL.canParse(result)) {
        throw TeamsApiError.invalid(
            `Teams 参数 ${name} 必须使用 HTTPS`,
            "TEAMS_HTTPS_URL_REQUIRED",
            { name },
        );
    }
    const url = new URL(result);
    if (url.protocol !== "https:" || url.username || url.password) {
        throw TeamsApiError.invalid(
            `Teams 参数 ${name} 必须使用 HTTPS`,
            "TEAMS_HTTPS_URL_REQUIRED",
            { name },
        );
    }
    return result;
}

function objectValue(value: unknown, name: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw TeamsApiError.invalid(`Teams 参数 ${name} 必须是对象`, "TEAMS_PARAM_INVALID", {
            name,
        });
    }
    return value as Record<string, unknown>;
}

function requireString(value: unknown, name: string): string {
    const result = optionalString(value);
    if (!result) {
        throw TeamsApiError.invalid(`Teams 参数 ${name} 不能为空`, "TEAMS_PARAM_REQUIRED", {
            name,
        });
    }
    return result;
}

function optionalString(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function requireNumber(value: unknown, name: string): number {
    const result = optionalNumber(value);
    if (result === undefined || result < 0) {
        throw TeamsApiError.invalid(`Teams 参数 ${name} 必须是非负数字`, "TEAMS_PARAM_INVALID", {
            name,
        });
    }
    return result;
}

function teamsCard(
    contentType: string,
    content: Record<string, unknown>,
    name: string,
    contentUrl?: string,
): Activity {
    const activity = new Activity(ActivityTypes.Message);
    activity.attachments = [{ contentType, content, name, contentUrl }];
    return activity;
}

function fileInfoActivity(params: Readonly<Record<string, unknown>>): Activity {
    return teamsCard(
        "application/vnd.microsoft.teams.card.file.info",
        {
            uniqueId: requireString(params.unique_id, "unique_id"),
            fileType: requireString(params.file_type, "file_type"),
        },
        requireString(params.file_name, "file_name"),
        requireHttpsUrl(params.content_url, "content_url"),
    );
}

function scalarObject(value: unknown, name: string): Record<string, string | number | boolean> {
    const input = objectValue(value, name);
    const result: Record<string, string | number | boolean> = {};
    for (const [key, item] of Object.entries(input)) {
        if (!["string", "number", "boolean"].includes(typeof item)) {
            throw TeamsApiError.invalid(
                `Teams 参数 ${name}.${key} 必须是标量`,
                "TEAMS_PARAM_INVALID",
                { name: `${name}.${key}` },
            );
        }
        result[key] = item as string | number | boolean;
    }
    return result;
}
