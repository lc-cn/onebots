import { isControlSendContext, type ControlSendContext } from "./control-send.js";

export type ControlAccountItemKind = "friend" | "group" | "guild" | "channel" | "member";
export const CONTROL_ACCOUNT_EXPLORE_ITEM_LIMIT = 500;
export const CONTROL_ACCOUNT_EXPLORE_RESULT_LENGTH_LIMIT = 262_144;
export type ControlAccountExploreAction =
    | "friends"
    | "groups"
    | "guilds"
    | "channels"
    | "detail"
    | "members";

export interface ControlAccountExploreRequest {
    expected: ControlSendContext;
    account: string;
    action: ControlAccountExploreAction;
    kind: ControlAccountItemKind;
    id?: string;
    guildId?: string;
}

export interface ControlAccountItem {
    kind: ControlAccountItemKind;
    id: string;
    name: string;
    subtitle?: string;
    parentId?: string;
    role?: string;
    memberCount?: number;
}

export interface ControlAccountExploreResult {
    expected: ControlSendContext;
    account: string;
    action: ControlAccountExploreAction;
    supported: boolean;
    items: ControlAccountItem[];
    /** 当前在线账号按真实场景区分的发送能力。 */
    sendScenes: Record<"private" | "direct" | "group" | "channel", boolean>;
    /** 平台返回的列表超出单次展示上限；不表示平台支持分页。 */
    truncated: boolean;
}

const identifier = (value: unknown): value is string =>
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    !/[\u0000-\u001f\u007f]/.test(value);
const kinds = ["friend", "group", "guild", "channel", "member"];
const actions = ["friends", "groups", "guilds", "channels", "detail", "members"];

export function isControlAccountExploreRequest(
    value: unknown,
): value is ControlAccountExploreRequest {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const input = value as Record<string, unknown>;
    if (
        Object.keys(input).some(
            key => !["expected", "account", "action", "kind", "id", "guildId"].includes(key),
        )
    )
        return false;
    if (
        !isControlSendContext(input.expected) ||
        !identifier(input.account) ||
        input.account.indexOf("/") < 1 ||
        !actions.includes(String(input.action)) ||
        !kinds.includes(String(input.kind)) ||
        (input.id !== undefined && !identifier(input.id)) ||
        (input.guildId !== undefined && !identifier(input.guildId))
    )
        return false;
    const expectedKind = {
        friends: "friend",
        groups: "group",
        guilds: "guild",
        channels: "channel",
    }[String(input.action) as "friends" | "groups" | "guilds" | "channels"];
    if (expectedKind && input.kind !== expectedKind) return false;
    if (input.action === "members" && !["group", "guild", "channel"].includes(String(input.kind)))
        return false;
    if (input.action === "detail" && input.kind === "member") return false;
    if ((input.action === "detail" || input.action === "members") && !input.id) return false;
    return JSON.stringify(input).length <= 4096;
}

export function isControlAccountExploreResult(
    value: unknown,
): value is ControlAccountExploreResult {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const result = value as Record<string, unknown>;
    if (
        Object.keys(result).some(
            key =>
                ![
                    "expected",
                    "account",
                    "action",
                    "supported",
                    "items",
                    "sendScenes",
                    "truncated",
                ].includes(key),
        ) ||
        !isControlSendContext(result.expected) ||
        !identifier(result.account) ||
        !actions.includes(String(result.action)) ||
        typeof result.supported !== "boolean" ||
        !Array.isArray(result.items) ||
        result.items.length > CONTROL_ACCOUNT_EXPLORE_ITEM_LIMIT ||
        typeof result.truncated !== "boolean" ||
        !result.sendScenes ||
        typeof result.sendScenes !== "object" ||
        Object.keys(result.sendScenes).sort().join(",") !== "channel,direct,group,private" ||
        !["private", "direct", "group", "channel"].every(
            scene => typeof (result.sendScenes as Record<string, unknown>)[scene] === "boolean",
        )
    )
        return false;
    return (
        result.items.every((item: unknown) => {
            if (!item || typeof item !== "object" || Array.isArray(item)) return false;
            const entry = item as Record<string, unknown>;
            return (
                Object.keys(entry).every(key =>
                    ["kind", "id", "name", "subtitle", "parentId", "role", "memberCount"].includes(
                        key,
                    ),
                ) &&
                kinds.includes(String(entry.kind)) &&
                identifier(entry.id) &&
                typeof entry.name === "string" &&
                entry.name.length <= 256 &&
                ["subtitle", "parentId", "role"].every(
                    key => entry[key] === undefined || identifier(entry[key]),
                ) &&
                (entry.memberCount === undefined ||
                    (Number.isSafeInteger(entry.memberCount) && Number(entry.memberCount) >= 0))
            );
        }) && JSON.stringify(result).length <= CONTROL_ACCOUNT_EXPLORE_RESULT_LENGTH_LIMIT
    );
}
