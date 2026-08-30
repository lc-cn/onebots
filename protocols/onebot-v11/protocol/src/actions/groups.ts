import {
    requireBooleanParam,
    requireNonEmptyStringParam,
    requirePositiveIntegerParam,
} from "onebots";
import type { OneBotV11ActionContext, OneBotV11ActionHandler, OneBotV11Params } from "./types.js";

export function createGroupActions(
    context: OneBotV11ActionContext,
): Record<string, OneBotV11ActionHandler> {
    const handleFriendRequest = async (
        params: OneBotV11Params,
        forcedApprove?: boolean,
    ): Promise<Record<string, never>> => {
        const flag = requireNonEmptyStringParam(params, "flag");
        const approve = forcedApprove ?? params.approve ?? true;
        if (typeof approve !== "boolean") throw new TypeError("approve 必须是布尔值");
        await context.adapter.handleFriendRequest(context.accountId, {
            flag,
            approve,
            remark: typeof params.remark === "string" ? params.remark : undefined,
            block: params.block === undefined ? undefined : requireBooleanParam(params, "block"),
        });
        return {};
    };

    return {
        set_group_kick: async params => {
            await context.adapter.kickGroupMember(context.accountId, {
                group_id: context.adapter.resolveId(
                    requirePositiveIntegerParam(params, "group_id"),
                ),
                user_id: context.adapter.resolveId(requirePositiveIntegerParam(params, "user_id")),
                reject_add_request:
                    params.reject_add_request === undefined
                        ? false
                        : requireBooleanParam(params, "reject_add_request"),
            });
        },
        invite_friend_to_group: async params => {
            await context.adapter.inviteGroupMember(context.accountId, {
                group_id: context.adapter.resolveId(
                    requirePositiveIntegerParam(params, "group_id"),
                ),
                user_id: context.adapter.resolveId(requirePositiveIntegerParam(params, "user_id")),
            });
            return {};
        },
        set_group_ban: async params => {
            const duration = params.duration === undefined ? 1800 : Number(params.duration);
            if (!Number.isSafeInteger(duration) || duration < 0) {
                throw new TypeError("duration 必须是非负整数");
            }
            await context.adapter.muteGroupMember(context.accountId, {
                group_id: context.adapter.resolveId(
                    requirePositiveIntegerParam(params, "group_id"),
                ),
                user_id: context.adapter.resolveId(requirePositiveIntegerParam(params, "user_id")),
                duration,
            });
        },
        set_group_anonymous_ban: async params => {
            const anonymous = params.anonymous;
            const flag =
                typeof params.anonymous_flag === "string"
                    ? params.anonymous_flag
                    : anonymous && typeof anonymous === "object" && "flag" in anonymous
                      ? String(anonymous.flag)
                      : "";
            if (!flag) {
                throw new TypeError("anonymous_flag 或 anonymous.flag 必须是非空字符串");
            }
            const duration = params.duration === undefined ? 1800 : Number(params.duration);
            if (!Number.isSafeInteger(duration) || duration < 0) {
                throw new TypeError("duration 必须是非负整数");
            }
            await context.adapter.muteGroupAnonymous(context.accountId, {
                group_id: context.adapter.resolveId(
                    requirePositiveIntegerParam(params, "group_id"),
                ),
                flag,
                duration,
            });
        },
        set_group_whole_ban: async params => {
            await context.adapter.muteGroupAll(context.accountId, {
                group_id: context.adapter.resolveId(
                    requirePositiveIntegerParam(params, "group_id"),
                ),
                enable: params.enable === undefined ? true : requireBooleanParam(params, "enable"),
            });
        },
        set_group_admin: async params => {
            await context.adapter.setGroupAdmin(context.accountId, {
                group_id: context.adapter.resolveId(
                    requirePositiveIntegerParam(params, "group_id"),
                ),
                user_id: context.adapter.resolveId(requirePositiveIntegerParam(params, "user_id")),
                enable: params.enable === undefined ? true : requireBooleanParam(params, "enable"),
            });
        },
        set_group_anonymous: async params => {
            await context.adapter.setGroupAnonymous(context.accountId, {
                group_id: context.adapter.resolveId(
                    requirePositiveIntegerParam(params, "group_id"),
                ),
                enable: params.enable === undefined ? true : requireBooleanParam(params, "enable"),
            });
        },
        set_group_card: async params => {
            await context.adapter.setGroupCard(context.accountId, {
                group_id: context.adapter.resolveId(
                    requirePositiveIntegerParam(params, "group_id"),
                ),
                user_id: context.adapter.resolveId(requirePositiveIntegerParam(params, "user_id")),
                card: typeof params.card === "string" ? params.card : "",
            });
        },
        set_group_name: async params => {
            await context.adapter.setGroupName(context.accountId, {
                group_id: context.adapter.resolveId(
                    requirePositiveIntegerParam(params, "group_id"),
                ),
                group_name: requireNonEmptyStringParam(params, "group_name"),
            });
        },
        set_group_leave: async params => {
            await context.adapter.leaveGroup(context.accountId, {
                group_id: context.adapter.resolveId(
                    requirePositiveIntegerParam(params, "group_id"),
                ),
                is_dismiss:
                    params.is_dismiss === undefined
                        ? false
                        : requireBooleanParam(params, "is_dismiss"),
            });
        },
        set_group_special_title: async params => {
            const duration = params.duration === undefined ? -1 : Number(params.duration);
            if (!Number.isSafeInteger(duration) || duration < -1) {
                throw new TypeError("duration 必须是 -1 或非负整数");
            }
            await context.adapter.setGroupSpecialTitle(context.accountId, {
                group_id: context.adapter.resolveId(
                    requirePositiveIntegerParam(params, "group_id"),
                ),
                user_id: context.adapter.resolveId(requirePositiveIntegerParam(params, "user_id")),
                special_title: typeof params.special_title === "string" ? params.special_title : "",
                duration,
            });
        },
        set_friend_add_request: params => handleFriendRequest(params),
        accept_friend_request: params => handleFriendRequest(params, true),
        set_group_add_request: async params => {
            const subType = params.sub_type === "invite" ? "invite" : "add";
            const approve = params.approve === undefined ? true : params.approve;
            if (typeof approve !== "boolean") throw new TypeError("approve 必须是布尔值");
            await context.adapter.handleGroupRequest(context.accountId, {
                flag: requireNonEmptyStringParam(params, "flag"),
                type: subType === "invite" ? "invitation" : "request",
                sub_type: subType,
                approve,
                reason: typeof params.reason === "string" ? params.reason : undefined,
                block:
                    params.block === undefined ? undefined : requireBooleanParam(params, "block"),
            });
        },
    };
}
