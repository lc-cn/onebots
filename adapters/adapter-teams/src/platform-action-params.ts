import { Activity, ActivityTypes } from "@microsoft/agents-activity";
import type { TeamsBot, TeamsContext } from "./bot.js";
import { TeamsApiError } from "./errors.js";
import type { TeamsConversationReference } from "./types.js";

export type TeamsActionParams = Readonly<Record<string, unknown>>;

export function conversationId(params: TeamsActionParams): string {
    return requireString(params.conversation_id, "conversation_id");
}

export function withConversation<T>(
    bot: TeamsBot,
    params: TeamsActionParams,
    logic: (context: TeamsContext) => Promise<T>,
): Promise<T> {
    return bot.withConversation(conversationId(params), logic);
}

export function messageValue(
    value: unknown,
): Array<{ type: string; data: Record<string, unknown> }> {
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

export function conversationReferenceValue(value: unknown): TeamsConversationReference {
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

export function requireHttpsUrl(value: unknown, name: string): string {
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

export function objectValue(value: unknown, name: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw TeamsApiError.invalid(`Teams 参数 ${name} 必须是对象`, "TEAMS_PARAM_INVALID", {
            name,
        });
    }
    return structuredClone(value as Record<string, unknown>);
}

/** Connector ActivityParams 的最小稳定判别字段；其余字段由官方客户端校验。 */
export function activityValue(value: unknown, name = "activity"): Record<string, unknown> {
    const activity = objectValue(value, name);
    requireString(activity.type, `${name}.type`);
    return activity;
}

export function requireString(value: unknown, name: string): string {
    const result = optionalString(value);
    if (!result) {
        throw TeamsApiError.invalid(`Teams 参数 ${name} 不能为空`, "TEAMS_PARAM_REQUIRED", {
            name,
        });
    }
    return result;
}

export function optionalString(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "string" || !value.trim()) {
        throw TeamsApiError.invalid("Teams 可选字符串参数必须是非空字符串", "TEAMS_PARAM_INVALID");
    }
    return value.trim();
}

export function optionalNumber(value: unknown): number | undefined {
    if (value === undefined) return undefined;
    if (typeof value !== "number" || !Number.isFinite(value)) {
        throw TeamsApiError.invalid("Teams 可选数字参数必须是有限数字", "TEAMS_PARAM_INVALID");
    }
    return value;
}

export function requireNumber(value: unknown, name: string): number {
    const result = optionalNumber(value);
    if (result === undefined || result < 0) {
        throw TeamsApiError.invalid(`Teams 参数 ${name} 必须是非负数字`, "TEAMS_PARAM_INVALID", {
            name,
        });
    }
    return result;
}

export function stringArray(value: unknown, name: string): string[] {
    if (!Array.isArray(value) || value.length === 0) {
        throw TeamsApiError.invalid(
            `Teams 参数 ${name} 必须是非空字符串数组`,
            "TEAMS_PARAM_INVALID",
            { name },
        );
    }
    return value.map((item, index) => requireString(item, `${name}[${index}]`));
}

export function teamsCard(
    contentType: string,
    content: Record<string, unknown>,
    name: string,
    contentUrl?: string,
): Activity {
    const activity = new Activity(ActivityTypes.Message);
    activity.attachments = [{ contentType, content, name, contentUrl }];
    return activity;
}

export function fileInfoActivity(params: TeamsActionParams): Activity {
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

export function scalarObject(
    value: unknown,
    name: string,
): Record<string, string | number | boolean> {
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
