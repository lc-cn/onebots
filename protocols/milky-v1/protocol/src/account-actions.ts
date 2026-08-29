import { type Adapter, requireNonEmptyStringParam, requirePositiveIntegerParam } from "onebots";
import { projectMilkyFriend } from "./friend-entities.js";
import { projectMilkyGroup } from "./group-entities.js";

export const MILKY_ACCOUNT_ACTIONS = new Set([
    "delete_friend",
    "set_avatar",
    "set_nickname",
    "set_bio",
    "get_custom_face_url_list",
    "get_peer_pins",
    "set_peer_pin",
]);

/** 将 Milky 账号资料动作翻译到通用 Adapter seam。 */
export async function executeMilkyAccountAction(
    adapter: Adapter,
    accountId: string,
    action: string,
    params: Record<string, unknown>,
): Promise<unknown> {
    switch (action) {
        case "delete_friend":
            await adapter.deleteFriend(accountId, {
                user_id: adapter.resolveId(requirePositiveIntegerParam(params, "user_id")),
            });
            return {};
        case "set_avatar":
            await adapter.setAvatar(accountId, {
                source: requireNonEmptyStringParam(params, "uri"),
            });
            return {};
        case "set_nickname":
            await adapter.setNickname(accountId, {
                nickname: requireNonEmptyStringParam(params, "new_nickname"),
            });
            return {};
        case "set_bio":
            await adapter.setBio(accountId, {
                bio: requireStringParam(params, "new_bio"),
            });
            return {};
        case "get_custom_face_url_list":
            return { urls: await adapter.getCustomFaceUrlList(accountId) };
        case "get_peer_pins": {
            const pins = await adapter.getPeerPins(accountId);
            return {
                friends: pins.friends.map(projectMilkyFriend),
                groups: pins.groups.map(projectMilkyGroup),
            };
        }
        case "set_peer_pin":
            await adapter.setPeerPin(accountId, {
                scene_type: messageScene(params.message_scene),
                peer_id: adapter.resolveId(requirePositiveIntegerParam(params, "peer_id")),
                is_pinned: params.is_pinned === undefined ? true : booleanParam(params.is_pinned),
            });
            return {};
        default:
            throw new TypeError(`未知 Milky 账号动作: ${action}`);
    }
}

function messageScene(value: unknown): "private" | "group" | "temp" {
    if (value === "friend") return "private";
    if (value === "group" || value === "temp") return value;
    throw new TypeError("message_scene 必须是 friend、group 或 temp");
}

function booleanParam(value: unknown): boolean {
    if (typeof value !== "boolean") throw new TypeError("is_pinned 必须是布尔值");
    return value;
}

/** 个性签名允许空字符串，以便调用方显式清空。 */
function requireStringParam(params: Record<string, unknown>, key: string): string {
    const value = params[key];
    if (typeof value !== "string") throw new TypeError(`${key} 必须是字符串`);
    return value;
}
