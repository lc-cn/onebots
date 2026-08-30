import type { WechatClient } from "./client.js";
import { defineWechatActionContract } from "./platform-action-contract.js";
import type { WechatActionHandler, WechatActionParams } from "./platform-action-context.js";
import {
    callOptions,
    invalid,
    optionalBoolean,
    post,
    postRecordAction,
    requireMessage,
    requireInteger,
    requireString,
    requireTemplate,
    staticCall,
} from "./platform-action-params.js";

/** 客服消息、自定义菜单、模板、群发及配额动作。 */
export const WECHAT_MESSAGING_ACTIONS = defineWechatActionContract(
    {
        wechat_call: async (client: WechatClient, params: WechatActionParams) =>
            client.call(callOptions(params)),
        send_custom_message: async (client: WechatClient, params: WechatActionParams) =>
            client.sendCustomMessage(
                requireString(params, "openid"),
                requireMessage(params, "message"),
            ),
        send_template_message: async (client: WechatClient, params: WechatActionParams) =>
            client.sendTemplate(requireTemplate(params, "message")),
        send_typing: async (client: WechatClient, params: WechatActionParams) =>
            client.sendTyping(
                requireString(params, "openid"),
                optionalBoolean(params, "typing") ?? true,
            ),
        get_access_token: async (client: WechatClient, params: WechatActionParams) =>
            client.getAccessToken(optionalBoolean(params, "force") || false),
        create_menu: postRecordAction("/cgi-bin/menu/create", "menu"),
        get_menu: staticCall("/cgi-bin/menu/get"),
        get_current_menu: staticCall("/cgi-bin/get_current_selfmenu_info"),
        delete_menu: staticCall("/cgi-bin/menu/delete"),
        create_conditional_menu: postRecordAction("/cgi-bin/menu/addconditional", "menu"),
        delete_conditional_menu: async (client: WechatClient, params: WechatActionParams) =>
            post(client, "/cgi-bin/menu/delconditional", {
                menuid: requireString(params, "menu_id"),
            }),
        trymatch_menu: async (client: WechatClient, params: WechatActionParams) =>
            post(client, "/cgi-bin/menu/trymatch", {
                user_id: requireString(params, "user_id"),
            }),
        create_qrcode: postRecordAction("/cgi-bin/qrcode/create", "qrcode"),
        set_template_industry: async (client: WechatClient, params: WechatActionParams) =>
            post(client, "/cgi-bin/template/api_set_industry", {
                industry_id1: requireString(params, "primary_industry_id"),
                industry_id2: requireString(params, "secondary_industry_id"),
            }),
        get_template_industry: staticCall("/cgi-bin/template/get_industry"),
        add_template: async (client: WechatClient, params: WechatActionParams) =>
            post(client, "/cgi-bin/template/api_add_template", {
                template_id_short: requireString(params, "template_id_short"),
                keyword_name_list: params.keyword_name_list,
            }),
        get_template_list: staticCall("/cgi-bin/template/get_all_private_template"),
        delete_template: async (client: WechatClient, params: WechatActionParams) =>
            post(client, "/cgi-bin/template/del_private_template", {
                template_id: requireString(params, "template_id"),
            }),
        mass_send_by_tag: postRecordAction("/cgi-bin/message/mass/sendall", "message"),
        mass_send_by_openids: postRecordAction("/cgi-bin/message/mass/send", "message"),
        mass_preview: postRecordAction("/cgi-bin/message/mass/preview", "message"),
        delete_mass_message: postRecordAction("/cgi-bin/message/mass/delete", "request"),
        get_mass_status: async (client: WechatClient, params: WechatActionParams) =>
            post(client, "/cgi-bin/message/mass/get", {
                msg_id: requireString(params, "message_id"),
            }),
        set_mass_speed: async (client: WechatClient, params: WechatActionParams) =>
            post(client, "/cgi-bin/message/mass/speed/set", {
                speed: requireInteger(params, "speed"),
            }),
        get_mass_speed: staticCall("/cgi-bin/message/mass/speed/get"),
        clear_api_quota: async (client: WechatClient) =>
            post(client, "/cgi-bin/clear_quota", { appid: client.config.app_id }),
        get_api_quota: async (client: WechatClient, params: WechatActionParams) => {
            const path = requireString(params, "path");
            if (!/^\/(?!\/)[^?#\u0000-\u001f\u007f]+$/u.test(path)) {
                invalid("path 必须是无 query/fragment 的绝对 API 路径");
            }
            return post(client, "/cgi-bin/openapi/quota/get", { cgi_path: path });
        },
        get_api_request_details: async (client: WechatClient, params: WechatActionParams) =>
            post(client, "/cgi-bin/openapi/rid/get", {
                rid: requireString(params, "rid"),
            }),
        clear_api_quota_by_app_secret: async (client: WechatClient) =>
            client.call({
                method: "POST",
                path: "/cgi-bin/clear_quota/v2",
                query: { appid: client.config.app_id, appsecret: client.config.app_secret },
                token: false,
            }),
        get_api_domain_ips: staticCall("/cgi-bin/get_api_domain_ip"),
        get_callback_ips: staticCall("/cgi-bin/getcallbackip"),
    } satisfies Readonly<Record<string, WechatActionHandler>>,
    {
        wechat_call: ["method", "path", "query", "body", "token", "response_type"],
        send_custom_message: ["openid", "message"],
        send_template_message: ["message"],
        send_typing: ["openid", "typing"],
        get_access_token: ["force"],
        create_menu: ["menu"],
        get_menu: [],
        get_current_menu: [],
        delete_menu: [],
        create_conditional_menu: ["menu"],
        delete_conditional_menu: ["menu_id"],
        trymatch_menu: ["user_id"],
        create_qrcode: ["qrcode"],
        set_template_industry: ["primary_industry_id", "secondary_industry_id"],
        get_template_industry: [],
        add_template: ["template_id_short", "keyword_name_list"],
        get_template_list: [],
        delete_template: ["template_id"],
        mass_send_by_tag: ["message"],
        mass_send_by_openids: ["message"],
        mass_preview: ["message"],
        delete_mass_message: ["request"],
        get_mass_status: ["message_id"],
        set_mass_speed: ["speed"],
        get_mass_speed: [],
        clear_api_quota: [],
        get_api_quota: ["path"],
        get_api_request_details: ["rid"],
        clear_api_quota_by_app_secret: [],
        get_api_domain_ips: [],
        get_callback_ips: [],
    },
);
