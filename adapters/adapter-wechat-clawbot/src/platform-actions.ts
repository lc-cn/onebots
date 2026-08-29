import { definePlatformActions, type PlatformActionHandler } from "onebots";
import type { WechatIlinkBot } from "./bot.js";
import { GatewayFault } from "./sdk/internal/errors.js";

const ACTION_HANDLERS = {
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
} satisfies Readonly<Record<string, PlatformActionHandler<WechatIlinkBot>>>;

const PLATFORM_ACTIONS = definePlatformActions(
    ACTION_HANDLERS,
    action => new GatewayFault("ACTION_NOT_IMPLEMENTED", `未实现微信 ClawBot 平台动作: ${action}`),
);

export const WECHAT_CLAWBOT_PLATFORM_ACTIONS = PLATFORM_ACTIONS.actions;
export type WechatClawBotPlatformAction =
    typeof WECHAT_CLAWBOT_PLATFORM_ACTIONS extends ReadonlySet<infer T> ? T : never;

export function executeWechatClawbotPlatformAction(
    client: WechatIlinkBot,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return PLATFORM_ACTIONS.execute(client, action, params);
}

function requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) invalid(`${field} 必须是非空字符串`);
    return value;
}

function optionalString(value: unknown, field: string): string | undefined {
    if (value === undefined) return undefined;
    return requireString(value, field);
}

function typingStatus(value: unknown): "active" | "idle" | undefined {
    if (value === undefined) return undefined;
    if (value === "active" || value === "idle") return value;
    return invalid("status 必须是 active 或 idle");
}

function optionalInteger(value: unknown, field: string): number | undefined {
    if (value === undefined) return undefined;
    if (!Number.isInteger(value) || Number(value) < 0) {
        invalid(`${field} 必须是非负整数`);
    }
    return Number(value);
}

function invalid(message: string): never {
    throw new GatewayFault("INVALID_ACTION_PARAMS", `微信 ClawBot ${message}`);
}
