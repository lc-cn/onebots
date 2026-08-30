import type { WechatClient } from "./client.js";
import type { WechatActionHandler, WechatActionParams } from "./platform-action-context.js";
import {
    openidList,
    optionalString,
    post,
    requireNumber,
    requireString,
    requireStringArray,
    tagUsers,
} from "./platform-action-params.js";

/** 关注用户、标签和黑名单动作；标签不伪装成通用群聊。 */
export const WECHAT_AUDIENCE_ACTIONS = {
    get_user_list: async (client: WechatClient, params: WechatActionParams) =>
        client.getUserList(optionalString(params, "next_openid")),
    get_wechat_user_info: async (client: WechatClient, params: WechatActionParams) =>
        client.getUserInfo(
            requireString(params, "openid"),
            optionalString(params, "lang") || "zh_CN",
        ),
    batch_get_user_info: async (client: WechatClient, params: WechatActionParams) =>
        client.batchGetUserInfo(requireStringArray(params, "openids")),
    set_user_remark: async (client: WechatClient, params: WechatActionParams) =>
        client.updateUserRemark(
            requireString(params, "openid"),
            requireString(params, "remark", true),
        ),
    get_tags: async (client: WechatClient) => client.getTags(),
    create_tag: async (client: WechatClient, params: WechatActionParams) =>
        post(client, "/cgi-bin/tags/create", {
            tag: { name: requireString(params, "name") },
        }),
    update_tag: async (client: WechatClient, params: WechatActionParams) =>
        post(client, "/cgi-bin/tags/update", {
            tag: { id: requireNumber(params, "tag_id"), name: requireString(params, "name") },
        }),
    delete_tag: async (client: WechatClient, params: WechatActionParams) =>
        post(client, "/cgi-bin/tags/delete", {
            tag: { id: requireNumber(params, "tag_id") },
        }),
    tag_users: audienceTagAction("/cgi-bin/tags/members/batchtagging"),
    untag_users: audienceTagAction("/cgi-bin/tags/members/batchuntagging"),
    get_user_tags: async (client: WechatClient, params: WechatActionParams) =>
        post(client, "/cgi-bin/tags/getidlist", {
            openid: requireString(params, "openid"),
        }),
    get_tag_users: async (client: WechatClient, params: WechatActionParams) =>
        post(client, "/cgi-bin/user/tag/get", {
            tagid: requireNumber(params, "tag_id"),
            next_openid: optionalString(params, "next_openid") || "",
        }),
    get_blacklist: async (client: WechatClient, params: WechatActionParams) =>
        post(client, "/cgi-bin/tags/members/getblacklist", {
            begin_openid: optionalString(params, "begin_openid") || "",
        }),
    block_users: openidListAction("/cgi-bin/tags/members/batchblacklist"),
    unblock_users: openidListAction("/cgi-bin/tags/members/batchunblacklist"),
} satisfies Readonly<Record<string, WechatActionHandler>>;

function audienceTagAction(path: string): WechatActionHandler {
    return async (client, params) => tagUsers(client, path, params);
}

function openidListAction(path: string): WechatActionHandler {
    return async (client, params) => openidList(client, path, params);
}
