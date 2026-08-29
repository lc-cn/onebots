import type { WechatIlinkBot } from "./bot.js";

type ActionHandler = (
    client: WechatIlinkBot,
    params: Readonly<Record<string, unknown>>,
) => Promise<unknown>;

const ACTION_HANDLERS: Readonly<Record<string, ActionHandler>> = {
    send_typing: (client, params) =>
        client.sendTypingToUser(requireString(params.user_id, "user_id"), {
            contextToken: optionalString(params.context_token, "context_token"),
            status: typingStatus(params.status),
        }),
    download_media: async (client, params) => {
        const result = await client.downloadRecentMedia(
            requireString(params.message_id, "message_id"),
            optionalInteger(params.item_index, "item_index"),
        );
        return {
            base64: result.buffer.toString("base64"),
            mime_type: result.mimeType,
            file_name: result.fileName,
        };
    },
};

export const WECHAT_CLAWBOT_PLATFORM_ACTIONS: ReadonlySet<string> = new Set(
    Object.keys(ACTION_HANDLERS),
);

export function executeWechatClawbotPlatformAction(
    client: WechatIlinkBot,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    const handler = ACTION_HANDLERS[action];
    if (!handler) throw new Error(`未实现微信 ClawBot 平台动作: ${action}`);
    return handler(client, params);
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim())
        throw new TypeError(`${field} 必须是非空字符串`);
    return value;
}

function optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined) return undefined;
    return requireString(value, field);
}

function typingStatus(value: unknown): "active" | "idle" | undefined {
    if (value === undefined) return undefined;
    if (value === "active" || value === "idle") return value;
    throw new TypeError("status 必须是 active 或 idle");
}

function optionalInteger(value: unknown, field: string): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isInteger(value) || Number(value) < 0) {
        throw new TypeError(`${field} 必须是非负整数`);
    }
    return Number(value);
}
