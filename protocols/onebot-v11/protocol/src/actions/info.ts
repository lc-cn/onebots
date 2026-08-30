import type { OneBotV11ActionContext, OneBotV11ActionHandler } from "./types.js";

export function createInfoActions(
    context: OneBotV11ActionContext,
): Record<string, OneBotV11ActionHandler> {
    const platformAction =
        (action: string): OneBotV11ActionHandler =>
        async params => {
            if (context.adapter.describeCapabilities(context.accountId).actions[action]) {
                return context.adapter.callAction(context.accountId, action, params);
            }
            throw new Error(`${action} not implemented`);
        };
    return {
        get_login_info: async () => ({
            user_id: context.adapter.resolveId(context.accountId).number,
            nickname: context.accountId,
        }),
        get_stranger_info: async params => {
            const { user_id } = params as { user_id: string | number; no_cache?: boolean };
            const user = await context.adapter.getUserInfo(context.accountId, {
                user_id: context.resolveId(user_id),
            });
            return { user_id, nickname: user.user_name, sex: "unknown", age: 0 };
        },
        get_friend_list: async () => {
            const friends = await context.adapter.getFriendList(context.accountId);
            return friends.map(friend => ({
                user_id: friend.user_id.number,
                nickname: friend.user_name,
                remark: friend.remark || "",
            }));
        },
        get_group_info: async params => {
            const { group_id } = params as { group_id: string | number; no_cache?: boolean };
            const group = await context.adapter.getGroupInfo(context.accountId, {
                group_id: context.resolveId(group_id),
            });
            return {
                group_id,
                group_name: group.group_name,
                member_count: group.member_count || 0,
                max_member_count: group.max_member_count || 0,
            };
        },
        get_group_list: async () => {
            const groups = await context.adapter.getGroupList(context.accountId);
            return groups.map(group => ({
                group_id: group.group_id.number,
                group_name: group.group_name,
                member_count: group.member_count || 0,
                max_member_count: group.max_member_count || 0,
            }));
        },
        get_group_member_info: async params => {
            const { group_id, user_id } = params as {
                group_id: string | number;
                user_id: string | number;
            };
            const member = await context.adapter.getGroupMemberInfo(context.accountId, {
                group_id: context.resolveId(group_id),
                user_id: context.resolveId(user_id),
            });
            return {
                group_id,
                user_id,
                nickname: member.user_name,
                card: member.card || "",
                sex: "unknown",
                age: 0,
                area: "",
                join_time: 0,
                last_sent_time: 0,
                level: "",
                role: member.role || "member",
                unfriendly: false,
                title: "",
                title_expire_time: 0,
                card_changeable: false,
            };
        },
        get_group_member_list: async params => {
            const { group_id } = params as { group_id: string | number };
            const members = await context.adapter.getGroupMemberList(context.accountId, {
                group_id: context.resolveId(group_id),
            });
            return members.map(member => ({
                group_id,
                user_id: member.user_id.number,
                nickname: member.user_name,
                card: member.card || "",
                sex: "unknown",
                age: 0,
                area: "",
                join_time: 0,
                last_sent_time: 0,
                level: "",
                role: member.role || "member",
                unfriendly: false,
                title: "",
                title_expire_time: 0,
                card_changeable: false,
            }));
        },
        get_group_honor_info: platformAction("get_group_honor_info"),
        get_cookies: async params => ({
            cookies: await context.adapter.getCookies(context.accountId, {
                domain: typeof params.domain === "string" ? params.domain : undefined,
            }),
        }),
        get_csrf_token: async () => ({
            token: await context.adapter.getCsrfToken(context.accountId),
        }),
        get_credentials: async params =>
            context.adapter.getCredentials(context.accountId, {
                domain: typeof params.domain === "string" ? params.domain : undefined,
            }),
        get_record: platformAction("get_record"),
        get_image: platformAction("get_image"),
        can_send_image: async () => ({
            yes: await context.adapter.canSendImage(context.accountId),
        }),
        can_send_record: async () => ({
            yes: await context.adapter.canSendRecord(context.accountId),
        }),
        get_status: async () => {
            const status = await context.adapter.getStatus(context.accountId);
            return { online: status.online ?? status.good, good: status.good };
        },
        get_version_info: async () => {
            const version = await context.adapter.getVersion(context.accountId);
            return {
                app_name: version.app_name ?? version.impl ?? "onebots",
                app_version: version.app_version ?? version.version ?? "unknown",
                protocol_version: "v11",
            };
        },
        set_restart: platformAction("set_restart"),
        clean_cache: async () => {
            await context.adapter.cleanCache(context.accountId);
            context.clearMessageIds();
        },
    };
}
