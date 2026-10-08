import type { BaseApp, Adapter } from "@onebots/core";
import { supportsSendScene } from "./send-scene-capability.js";
import { AccountExploreError } from "./account-explore-errors.js";
import {
    CONTROL_ACCOUNT_EXPLORE_ITEM_LIMIT,
    CONTROL_ACCOUNT_EXPLORE_RESULT_LENGTH_LIMIT,
    isControlAccountExploreRequest,
    type ControlAccountExploreRequest,
    type ControlAccountExploreResult,
    type ControlAccountItem,
    type ControlAccountItemKind,
    type ControlSendContext,
} from "@onebots/core/control";

const displayText = (value: string): string =>
    value
        .replace(/[\u0000-\u001f\u007f]/g, " ")
        .replace(/\s+/gu, " ")
        .trim()
        .slice(0, 256);
const safe = (value: unknown, fallback = ""): string =>
    (typeof value === "string" ? displayText(value) : "") || displayText(fallback);
const key = (value: unknown): string => {
    if (!value || typeof value !== "object") return "";
    const candidate = (value as { string?: unknown }).string;
    return typeof candidate === "string" &&
        candidate.length > 0 &&
        candidate.length <= 512 &&
        candidate.trim() &&
        !/[\u0000-\u001f\u007f]/.test(candidate)
        ? candidate
        : "";
};
const count = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : undefined;

function item(
    kind: ControlAccountItemKind,
    value: unknown,
    parentId?: string,
): ControlAccountItem | undefined {
    if (!value || typeof value !== "object") return undefined;
    const entry = value as Record<string, unknown>;
    const identity = key(
        kind === "friend" || kind === "member"
            ? entry.user_id
            : kind === "group"
              ? entry.group_id
              : kind === "guild"
                ? entry.guild_id
                : entry.channel_id,
    );
    if (!identity) return undefined;
    const name = safe(
        kind === "friend" || kind === "member"
            ? entry.user_name
            : kind === "group"
              ? entry.group_name
              : kind === "guild"
                ? (entry.guild_display_name ?? entry.guild_name)
                : entry.channel_name,
        identity,
    );
    const subtitle = safe(
        kind === "friend"
            ? entry.remark
            : kind === "group"
              ? (entry.description ?? entry.remark)
              : undefined,
    );
    const role = safe(entry.role);
    return {
        kind,
        id: identity,
        name,
        ...(subtitle ? { subtitle } : {}),
        ...(parentId ? { parentId } : {}),
        ...(role ? { role } : {}),
        ...(count(entry.member_count) !== undefined
            ? { memberCount: count(entry.member_count) }
            : {}),
    };
}

/** 网关内读取在线适配器能力；不允许管理服务进程加载平台密钥或 SDK。 */
export class GatewayAccountExploreExecutor {
    private active = 0;
    private closed = false;
    constructor(
        private readonly app: Pick<BaseApp, "adapters">,
        private readonly context: ControlSendContext,
    ) {}

    async explore(
        request: ControlAccountExploreRequest,
    ): Promise<ControlAccountExploreResult | undefined> {
        if (
            this.closed ||
            !isControlAccountExploreRequest(request) ||
            request.expected.gatewayInstanceId !== this.context.gatewayInstanceId ||
            request.expected.configVersion !== this.context.configVersion
        )
            return undefined;
        if (this.active >= 8) throw new AccountExploreError("query_busy");
        const separator = request.account.indexOf("/");
        const platform = request.account.slice(0, separator);
        const accountId = request.account.slice(separator + 1);
        const adapter = [...this.app.adapters].find(([name]) => String(name) === platform)?.[1];
        if (!adapter || adapter.accounts.get(accountId)?.status !== "online")
            throw new AccountExploreError("account_unavailable");
        const capability = {
            friends: "get_friend_list",
            groups: "get_group_list",
            guilds: "get_guild_list",
            channels: "get_channel_list",
            detail: `get_${request.kind}_info`,
            members: `get_${request.kind}_member_list`,
        }[request.action];
        const actions = adapter.describeCapabilities(accountId).actions;
        const declared = actions[capability];
        const send = actions.send_message;
        const available = (scene: "private" | "direct" | "group" | "channel") =>
            supportsSendScene(send, scene);
        const sendScenes = {
            private: available("private"),
            direct: available("direct"),
            group: available("group"),
            channel: available("channel"),
        };
        if (!declared || declared.support === "unsupported") {
            return {
                expected: request.expected,
                account: request.account,
                action: request.action,
                supported: false,
                items: [],
                sendScenes,
                truncated: false,
            };
        }
        this.active++;
        try {
            const values = await this.query(adapter, accountId, request);
            const kind: ControlAccountItemKind =
                request.action === "friends"
                    ? "friend"
                    : request.action === "groups"
                      ? "group"
                      : request.action === "guilds"
                        ? "guild"
                        : request.action === "channels"
                          ? "channel"
                          : request.action === "members"
                            ? "member"
                            : request.kind;
            const result: ControlAccountExploreResult = {
                expected: request.expected,
                account: request.account,
                action: request.action,
                supported: true,
                items: [],
                sendScenes,
                truncated: false,
            };
            let resultLength = JSON.stringify(result).length;
            for (const value of values) {
                const projected = item(
                    kind,
                    value,
                    request.action === "channels" ? request.guildId : undefined,
                );
                if (!projected) continue;
                const itemLength = JSON.stringify(projected).length + (result.items.length ? 1 : 0);
                if (
                    result.items.length >= CONTROL_ACCOUNT_EXPLORE_ITEM_LIMIT ||
                    resultLength + itemLength > CONTROL_ACCOUNT_EXPLORE_RESULT_LENGTH_LIMIT
                ) {
                    result.truncated = true;
                    break;
                }
                result.items.push(projected);
                resultLength += itemLength;
            }
            return result;
        } catch (error) {
            // 只记录错误分类，第三方异常正文可能含 Cookie、Token 或聊天资料。
            adapter.logger.error("账号资料查询失败", {
                account: request.account,
                action: request.action,
                errorType:
                    error instanceof TypeError
                        ? "TypeError"
                        : error instanceof RangeError
                          ? "RangeError"
                          : "Error",
            });
            throw new AccountExploreError("platform_query_failed");
        } finally {
            this.active--;
        }
    }

    close(): void {
        this.closed = true;
    }

    private async query(
        adapter: Adapter,
        accountId: string,
        request: ControlAccountExploreRequest,
    ): Promise<unknown[]> {
        const target = request.id ? adapter.resolveId(request.id) : undefined;
        const guild = request.guildId ? adapter.resolveId(request.guildId) : undefined;
        switch (request.action) {
            case "friends":
                return adapter.getFriendList(accountId);
            case "groups":
                return adapter.getGroupList(accountId);
            case "guilds":
                return adapter.getGuildList(accountId);
            case "channels":
                return adapter.getChannelList(accountId, guild ? { guild_id: guild } : undefined);
            case "detail": {
                if (request.kind === "friend")
                    return [await adapter.getFriendInfo(accountId, { user_id: target! })];
                if (request.kind === "group")
                    return [await adapter.getGroupInfo(accountId, { group_id: target! })];
                if (request.kind === "guild")
                    return [await adapter.getGuildInfo(accountId, { guild_id: target! })];
                return [
                    await adapter.getChannelInfo(accountId, {
                        channel_id: target!,
                        ...(guild ? { guild_id: guild } : {}),
                    }),
                ];
            }
            case "members": {
                if (request.kind === "group")
                    return adapter.getGroupMemberList(accountId, { group_id: target! });
                if (request.kind === "guild")
                    return adapter.getGuildMemberList(accountId, { guild_id: target! });
                if (request.kind === "channel")
                    return adapter.getChannelMemberList(accountId, { channel_id: target! });
                return [];
            }
        }
    }
}
