import type { Logger } from "@larksuiteoapi/node-sdk";
import { ErrorCategory, sha256Json } from "onebots";
import { FeishuError } from "./errors.js";
import type { FeishuEvent, FeishuWebhookBody } from "./types.js";
import type { FeishuConfig } from "./types.js";

/** 当前官方 SDK 声明的完整 IM v1 与机器人交互事件集合。 */
export const FEISHU_LONG_CONNECTION_EVENT_TYPES = [
    "im.chat.access_event.bot_p2p_chat_entered_v1",
    "im.chat.disbanded_v1",
    "im.chat.member.bot.added_v1",
    "im.chat.member.bot.deleted_v1",
    "im.chat.member.user.added_v1",
    "im.chat.member.user.deleted_v1",
    "im.chat.member.user.withdrawn_v1",
    "im.chat.updated_v1",
    "im.message.message_read_v1",
    "im.message.reaction.created_v1",
    "im.message.reaction.deleted_v1",
    "im.message.recalled_v1",
    "im.message.receive_v1",
    "application.bot.menu_v6",
] as const;

export function assertLongConnectionConfigured(config: FeishuConfig, logger?: Logger): void {
    if (config.receive_mode === "long_connection" && !logger) {
        throw new FeishuError("飞书长连接尚未配置 SDK logger", {
            code: "FEISHU_LONG_CONNECTION_NOT_CONFIGURED",
            category: ErrorCategory.CONFIG,
        });
    }
}

/** 将官方长连接 SDK 展平的数据恢复为与 Webhook 一致的 v2 envelope。 */
export function restoreLongConnectionEnvelope(
    registeredEventType: string,
    data: Record<string, unknown>,
    configuredAppId: string,
): FeishuEvent & FeishuWebhookBody {
    const event = { ...data };
    const take = (key: string): string => {
        const value = event[key];
        delete event[key];
        return typeof value === "string" ? value : "";
    };
    const schema = take("schema") || "2.0";
    const token = take("token") || undefined;
    const headerEventType = take("event_type") || registeredEventType;
    const eventId = take("event_id") || `${headerEventType}:sha256:${sha256Json(data)}`;
    const createTime = take("create_time") || String(Date.now());
    const appId = take("app_id") || configuredAppId;
    const tenantKey = take("tenant_key");

    return {
        schema,
        header: {
            event_id: eventId,
            event_type: headerEventType,
            create_time: createTime,
            app_id: appId,
            tenant_key: tenantKey,
            ...(token ? { token } : {}),
        },
        event,
    };
}
