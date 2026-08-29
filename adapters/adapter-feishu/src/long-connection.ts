import { randomUUID } from "node:crypto";
import type { FeishuEvent, FeishuWebhookBody } from "./types.js";

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
    const eventId = take("event_id") || `${headerEventType}:${randomUUID()}`;
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
