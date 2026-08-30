import type { WhatsAppGroupWebhookEntry } from "./types.js";

/** 验证 Meta Groups webhook 的判别字段，避免强类型投影消费畸形外部数据。 */
export function isWhatsAppGroupWebhookEntry(value: unknown): value is WhatsAppGroupWebhookEntry {
    if (!isRecord(value) || !isString(value.timestamp) || !isString(value.group_id)) return false;
    switch (value.type) {
        case "group_create":
        case "group_delete":
            return isString(value.request_id);
        case "group_add_participants":
            return (
                isString(value.request_id) && participantChanges(value.added_participants, "wa_id")
            );
        case "group_remove_participants":
            return (
                isString(value.request_id) &&
                participantChanges(value.removed_participants, "input")
            );
        case "group_join_request_created":
        case "group_join_request_revoked":
            return isString(value.join_request_id) && isString(value.wa_id);
        case "group_settings_update":
            return isString(value.request_id);
        case "group_suspend":
        case "group_suspend_cleared":
            return true;
        default:
            return false;
    }
}

function participantChanges(value: unknown, identity: "wa_id" | "input"): boolean {
    return (
        Array.isArray(value) &&
        value.every(item => isRecord(item) && isString(Reflect.get(item, identity)))
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return !!value && typeof value === "object" && !Array.isArray(value);
}

function isString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}
