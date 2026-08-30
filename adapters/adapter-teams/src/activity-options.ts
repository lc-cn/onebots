import { TeamsApiError } from "./errors.js";
import type {
    TeamsActivity,
    TeamsEntity,
    TeamsOutboundActivity,
    TeamsSuggestedActions,
} from "./types.js";

/** 应用受支持的 Teams 原生活动字段；会话身份与路由字段不在这个边界内。 */
export function applyTeamsActivityOptions(
    output: TeamsOutboundActivity,
    data: Record<string, unknown>,
): void {
    output.summary = optionalString(data.summary);
    output.importance = optionalEnum(data.importance, "importance", ["low", "normal", "high"]);
    output.textFormat =
        optionalEnum(data.text_format, "text_format", [
            "markdown",
            "plain",
            "xml",
            "extendedmarkdown",
        ]) || output.textFormat;
    output.locale = optionalString(data.locale);
    output.inputHint = optionalEnum(data.input_hint, "input_hint", [
        "acceptingInput",
        "ignoringInput",
        "expectingInput",
    ]);
    output.deliveryMode = optionalEnum(data.delivery_mode, "delivery_mode", [
        "normal",
        "notification",
    ]);
    output.attachmentLayout = optionalEnum(data.attachment_layout, "attachment_layout", [
        "list",
        "carousel",
    ]);
    if (data.channel_data !== undefined) {
        const channelData = objectInput(data.channel_data, "channel_data");
        validateFeedbackLoop(channelData.feedbackLoop);
        output.channelData = { ...output.channelData, ...channelData };
    }
    if (data.entities !== undefined) {
        const nativeEntities = entityArray(data.entities);
        validateMessageEntities([...(output.entities || []), ...nativeEntities]);
        output.entities = [...(output.entities || []), ...nativeEntities];
    }
    if (data.suggested_actions !== undefined) {
        output.suggestedActions = suggestedActionsValue(data.suggested_actions);
    }
    if ("value" in data) output.value = data.value;
}

/** 把非通用字段集中投影为一个可逆 teams_activity 段。 */
export function projectTeamsActivityOptions(
    activity: TeamsActivity,
): Record<string, unknown> | undefined {
    const hasQuotePlaceholder = /<quoted messageId="[^"]+"\s*\/>/iu.test(activity.text || "");
    const entities = activity.entities?.filter(
        entity =>
            entity.type !== "mention" && (entity.type !== "quotedReply" || !hasQuotePlaceholder),
    );
    const data: Record<string, unknown> = {};
    if (activity.summary) data.summary = activity.summary;
    if (activity.importance) data.importance = activity.importance;
    if (activity.textFormat) data.text_format = activity.textFormat;
    if (activity.locale) data.locale = activity.locale;
    if (activity.inputHint) data.input_hint = activity.inputHint;
    if (activity.deliveryMode) data.delivery_mode = activity.deliveryMode;
    if (activity.attachmentLayout) data.attachment_layout = activity.attachmentLayout;
    if (activity.suggestedActions) data.suggested_actions = activity.suggestedActions;
    if (activity.channelData) data.channel_data = activity.channelData;
    if (entities?.length) data.entities = entities;
    if (activity.value != null) data.value = activity.value;
    return Object.keys(data).length > 0 ? data : undefined;
}

function entityArray(value: unknown): TeamsEntity[] {
    if (!Array.isArray(value)) {
        throw invalid("Teams entities 必须是数组", "entities");
    }
    return value.map((item, index) => {
        const entity = objectInput(item, `entities[${index}]`);
        return { ...entity, type: requiredString(entity.type, `entities[${index}].type`) };
    });
}

function validateMessageEntities(entities: TeamsEntity[]): void {
    const roots = entities.filter(entity => entity.type === "https://schema.org/Message");
    if (roots.length > 1) {
        throw invalid("Teams AI 消息只能包含一个根 Message entity", "entities");
    }
    const citations = roots.flatMap(entity =>
        Array.isArray(entity.citation) ? entity.citation : [],
    );
    if (citations.length > 20) {
        throw invalid("Teams 单条消息最多显示 20 条引用", "entities.citation");
    }
}

function validateFeedbackLoop(value: unknown): void {
    if (value === undefined) return;
    const feedback = objectInput(value, "channel_data.feedbackLoop");
    optionalEnum(feedback.type, "channel_data.feedbackLoop.type", ["default", "custom"], true);
}

function suggestedActionsValue(value: unknown): TeamsSuggestedActions {
    const input = objectInput(value, "suggested_actions");
    if (!Array.isArray(input.actions) || input.actions.length === 0 || input.actions.length > 3) {
        throw invalid(
            "Teams suggested_actions.actions 必须包含 1 到 3 个操作",
            "suggested_actions.actions",
        );
    }
    const actions = input.actions.map((item, index) => {
        const action = objectInput(item, `suggested_actions.actions[${index}]`);
        return {
            ...action,
            type: requiredString(action.type, `suggested_actions.actions[${index}].type`),
            title: requiredString(action.title, `suggested_actions.actions[${index}].title`),
        };
    });
    const to = input.to === undefined ? [] : stringArray(input.to, "suggested_actions.to");
    return { to, actions };
}

function objectInput(value: unknown, name: string): Record<string, unknown> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        throw invalid(`Teams ${name} 必须是对象`, name);
    }
    return value as Record<string, unknown>;
}

function stringArray(value: unknown, name: string): string[] {
    if (!Array.isArray(value)) throw invalid(`Teams ${name} 必须是字符串数组`, name);
    return value.map((item, index) => requiredString(item, `${name}[${index}]`));
}

function optionalEnum(
    value: unknown,
    name: string,
    allowed: readonly string[],
    required = false,
): string | undefined {
    if (value === undefined && !required) return undefined;
    const result = requiredString(value, name);
    if (!allowed.includes(result)) {
        throw invalid(`Teams ${name} 仅支持 ${allowed.join("、")}`, name, result);
    }
    return result;
}

function optionalString(value: unknown): string | undefined {
    if (value === undefined) return undefined;
    return requiredString(value, "可选字符串");
}

function requiredString(value: unknown, name: string): string {
    if (typeof value !== "string" || !value.trim()) {
        throw invalid(`Teams ${name} 必须为非空字符串`, name);
    }
    return value.trim();
}

function invalid(message: string, name: string, value?: unknown): TeamsApiError {
    return TeamsApiError.invalid(message, "TEAMS_PARAM_INVALID", { name, value });
}
