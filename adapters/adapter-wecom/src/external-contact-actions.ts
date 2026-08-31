import type { WeComClient } from "./client.js";
import type { WeComActionParams } from "./platform-action-context.js";
import {
    boundedInteger,
    invalid,
    optionalBoolean,
    optionalString,
    post,
    postRecordAction,
    requireRecord,
    requireString,
    requireStringArray,
    staticCall,
    stringQueryAction,
} from "./platform-action-params.js";

/** 客户联系、客户群与欢迎语。独立成域，避免核心动作表随平台能力增长失控。 */
export const WECOM_EXTERNAL_CONTACT_ACTIONS = {
    list_follow_users: staticCall("/cgi-bin/externalcontact/get_follow_user_list"),
    list_external_contacts: stringQueryAction("/cgi-bin/externalcontact/list", "user_id", "userid"),
    get_external_contact: async (client: WeComClient, params: WeComActionParams) =>
        client.call({
            path: "/cgi-bin/externalcontact/get",
            query: {
                external_userid: requireString(params, "external_user_id"),
                cursor: optionalString(params, "cursor"),
            },
        }),
    batch_get_external_contacts: async (client: WeComClient, params: WeComActionParams) =>
        post(client, "/cgi-bin/externalcontact/batch/get_by_user", {
            userid_list: requireStringArray(params, "user_ids"),
            cursor: optionalString(params, "cursor"),
            limit: boundedInteger(params, "limit", 1, 100, 100),
        }),
    remark_external_contact: postRecordAction("/cgi-bin/externalcontact/remark", "remark"),
    list_external_contact_groups: async (client: WeComClient, params: WeComActionParams) => {
        const request = requireRecord(params, "request");
        const limit = request.limit ?? 100;
        if (!Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > 1000) {
            invalid("request.limit 必须是 1 到 1000 的整数");
        }
        return post(client, "/cgi-bin/externalcontact/groupchat/list", {
            ...request,
            limit,
        });
    },
    get_external_contact_group: async (client: WeComClient, params: WeComActionParams) =>
        post(client, "/cgi-bin/externalcontact/groupchat/get", {
            chat_id: requireString(params, "chat_id"),
            need_name: optionalBoolean(params, "need_name") === false ? 0 : 1,
        }),
    transfer_external_contacts: async (client: WeComClient, params: WeComActionParams) =>
        post(client, "/cgi-bin/externalcontact/transfer_customer", {
            handover_userid: requireString(params, "handover_user_id"),
            takeover_userid: requireString(params, "takeover_user_id"),
            external_userid: requireStringArray(params, "external_user_ids"),
            transfer_success_msg: optionalString(params, "success_message"),
        }),
    transfer_external_contact_groups: async (client: WeComClient, params: WeComActionParams) =>
        post(client, "/cgi-bin/externalcontact/groupchat/transfer", {
            chat_id_list: requireStringArray(params, "chat_ids"),
            new_owner: requireString(params, "new_owner_id"),
        }),
    list_unassigned_external_contacts: async (client: WeComClient, params: WeComActionParams) =>
        post(client, "/cgi-bin/externalcontact/get_unassigned_list", {
            page_id: boundedInteger(params, "page_id", 0, Number.MAX_SAFE_INTEGER, 0),
            page_size: boundedInteger(params, "page_size", 1, 1000, 1000),
            cursor: optionalString(params, "cursor"),
        }),
    add_contact_way: postRecordAction("/cgi-bin/externalcontact/add_contact_way", "contact_way"),
    get_contact_way: idBodyAction("/cgi-bin/externalcontact/get_contact_way", "config_id"),
    update_contact_way: postRecordAction(
        "/cgi-bin/externalcontact/update_contact_way",
        "contact_way",
    ),
    delete_contact_way: idBodyAction("/cgi-bin/externalcontact/del_contact_way", "config_id"),
    list_contact_ways: postRecordAction("/cgi-bin/externalcontact/list_contact_way", "request"),
    close_temporary_contact: postRecordAction(
        "/cgi-bin/externalcontact/close_temp_chat",
        "request",
    ),
    send_external_contact_welcome: postRecordAction(
        "/cgi-bin/externalcontact/send_welcome_msg",
        "message",
    ),
    add_group_welcome_template: postRecordAction(
        "/cgi-bin/externalcontact/group_welcome_template/add",
        "template",
    ),
    update_group_welcome_template: postRecordAction(
        "/cgi-bin/externalcontact/group_welcome_template/edit",
        "template",
    ),
    get_group_welcome_template: idBodyAction(
        "/cgi-bin/externalcontact/group_welcome_template/get",
        "template_id",
    ),
    delete_group_welcome_template: idBodyAction(
        "/cgi-bin/externalcontact/group_welcome_template/del",
        "template_id",
    ),
} as const;

function idBodyAction(path: string, parameter: string) {
    return async (client: WeComClient, params: WeComActionParams) =>
        post(client, path, { [parameter]: requireString(params, parameter) });
}
