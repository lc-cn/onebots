import type { WechatClient } from "./client.js";
import { WechatApiError } from "./errors.js";
import type {
    WechatApiCallOptions,
    WechatOutboundMessage,
    WechatTemplateMessage,
} from "./types.js";

export const WECHAT_PLATFORM_ACTIONS = new Set([
    "wechat_call",
    "send_custom_message",
    "send_template_message",
    "send_typing",
    "get_access_token",
    "get_user_list",
    "get_user_info",
    "batch_get_user_info",
    "set_user_remark",
    "get_tags",
    "create_tag",
    "update_tag",
    "delete_tag",
    "tag_users",
    "untag_users",
    "get_user_tags",
    "get_tag_users",
    "get_blacklist",
    "block_users",
    "unblock_users",
    "upload_temporary_media",
    "get_temporary_media",
    "add_material",
    "add_news_material",
    "upload_news_image",
    "update_news_material",
    "create_menu",
    "get_menu",
    "get_current_menu",
    "delete_menu",
    "create_conditional_menu",
    "delete_conditional_menu",
    "trymatch_menu",
    "create_qrcode",
    "set_template_industry",
    "get_template_industry",
    "add_template",
    "get_template_list",
    "delete_template",
    "get_material_count",
    "get_material_batch",
    "get_material",
    "delete_material",
    "add_draft",
    "update_draft",
    "get_draft",
    "delete_draft",
    "get_draft_count",
    "get_draft_batch",
    "publish_draft",
    "get_publish_status",
    "get_published_articles",
    "delete_published_article",
    "mass_send_by_tag",
    "mass_send_by_openids",
    "mass_preview",
    "delete_mass_message",
    "get_mass_status",
    "set_mass_speed",
    "get_mass_speed",
    "clear_api_quota",
]);

/** 显式覆盖常用公众号接口，并以 wechat_call 承接微信新增 API。 */
export function executeWechatPlatformAction(
    client: WechatClient,
    action: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    switch (action) {
        case "wechat_call":
            return client.call(callOptions(params));
        case "send_custom_message":
            return client.sendCustomMessage(
                requireString(params, "openid"),
                requireMessage(params, "message"),
            );
        case "send_template_message":
            return client.sendTemplate(requireTemplate(params, "message"));
        case "send_typing":
            return client.sendTyping(
                requireString(params, "openid"),
                optionalBoolean(params, "typing") ?? true,
            );
        case "get_access_token":
            return client.getAccessToken(optionalBoolean(params, "force") || false);
        case "get_user_list":
            return client.getUserList(optionalString(params, "next_openid"));
        case "get_user_info":
            return client.getUserInfo(
                requireString(params, "openid"),
                optionalString(params, "lang") || "zh_CN",
            );
        case "batch_get_user_info":
            return client.batchGetUserInfo(requireStringArray(params, "openids"));
        case "set_user_remark":
            return client.updateUserRemark(
                requireString(params, "openid"),
                requireString(params, "remark", true),
            );
        case "get_tags":
            return client.getTags();
        case "create_tag":
            return post(client, "/cgi-bin/tags/create", {
                tag: { name: requireString(params, "name") },
            });
        case "update_tag":
            return post(client, "/cgi-bin/tags/update", {
                tag: { id: requireNumber(params, "tag_id"), name: requireString(params, "name") },
            });
        case "delete_tag":
            return post(client, "/cgi-bin/tags/delete", {
                tag: { id: requireNumber(params, "tag_id") },
            });
        case "tag_users":
            return tagUsers(client, "/cgi-bin/tags/members/batchtagging", params);
        case "untag_users":
            return tagUsers(client, "/cgi-bin/tags/members/batchuntagging", params);
        case "get_user_tags":
            return post(client, "/cgi-bin/tags/getidlist", {
                openid: requireString(params, "openid"),
            });
        case "get_tag_users":
            return post(client, "/cgi-bin/user/tag/get", {
                tagid: requireNumber(params, "tag_id"),
                next_openid: optionalString(params, "next_openid") || "",
            });
        case "get_blacklist":
            return post(client, "/cgi-bin/tags/members/getblacklist", {
                begin_openid: optionalString(params, "begin_openid") || "",
            });
        case "block_users":
            return openidList(client, "/cgi-bin/tags/members/batchblacklist", params);
        case "unblock_users":
            return openidList(client, "/cgi-bin/tags/members/batchunblacklist", params);
        case "upload_temporary_media":
            return uploadMedia(client, params);
        case "get_temporary_media":
            return client.call({
                path: "/cgi-bin/media/get",
                query: { media_id: requireString(params, "media_id") },
                responseType: "buffer",
            });
        case "add_material":
            return uploadMedia(client, params, "/cgi-bin/material/add_material");
        case "add_news_material":
            return post(client, "/cgi-bin/material/add_news", requireRecord(params, "news"));
        case "upload_news_image":
            return uploadMedia(client, params, "/cgi-bin/media/uploadimg", false);
        case "update_news_material":
            return post(client, "/cgi-bin/material/update_news", requireRecord(params, "article"));
        case "create_menu":
            return post(client, "/cgi-bin/menu/create", requireRecord(params, "menu"));
        case "get_menu":
            return client.call({ path: "/cgi-bin/menu/get" });
        case "get_current_menu":
            return client.call({ path: "/cgi-bin/get_current_selfmenu_info" });
        case "delete_menu":
            return client.call({ path: "/cgi-bin/menu/delete" });
        case "create_conditional_menu":
            return post(client, "/cgi-bin/menu/addconditional", requireRecord(params, "menu"));
        case "delete_conditional_menu":
            return post(client, "/cgi-bin/menu/delconditional", {
                menuid: requireString(params, "menu_id"),
            });
        case "trymatch_menu":
            return post(client, "/cgi-bin/menu/trymatch", {
                user_id: requireString(params, "user_id"),
            });
        case "create_qrcode":
            return post(client, "/cgi-bin/qrcode/create", requireRecord(params, "qrcode"));
        case "set_template_industry":
            return post(client, "/cgi-bin/template/api_set_industry", {
                industry_id1: requireString(params, "primary_industry_id"),
                industry_id2: requireString(params, "secondary_industry_id"),
            });
        case "get_template_industry":
            return client.call({ path: "/cgi-bin/template/get_industry" });
        case "add_template":
            return post(client, "/cgi-bin/template/api_add_template", {
                template_id_short: requireString(params, "template_id_short"),
                keyword_name_list: params.keyword_name_list,
            });
        case "get_template_list":
            return client.call({ path: "/cgi-bin/template/get_all_private_template" });
        case "delete_template":
            return post(client, "/cgi-bin/template/del_private_template", {
                template_id: requireString(params, "template_id"),
            });
        case "get_material_count":
            return client.call({ path: "/cgi-bin/material/get_materialcount" });
        case "get_material_batch":
            return post(
                client,
                "/cgi-bin/material/batchget_material",
                requireRecord(params, "request"),
            );
        case "get_material":
            return client.call({
                method: "POST",
                path: "/cgi-bin/material/get_material",
                body: { media_id: requireString(params, "media_id") },
                responseType: optionalBoolean(params, "binary") ? "buffer" : "json",
            });
        case "delete_material":
            return post(client, "/cgi-bin/material/del_material", {
                media_id: requireString(params, "media_id"),
            });
        case "add_draft":
            return post(client, "/cgi-bin/draft/add", requireRecord(params, "draft"));
        case "update_draft":
            return post(client, "/cgi-bin/draft/update", requireRecord(params, "draft"));
        case "get_draft":
            return post(client, "/cgi-bin/draft/get", {
                media_id: requireString(params, "media_id"),
            });
        case "delete_draft":
            return post(client, "/cgi-bin/draft/delete", {
                media_id: requireString(params, "media_id"),
            });
        case "get_draft_count":
            return client.call({ path: "/cgi-bin/draft/count" });
        case "get_draft_batch":
            return post(client, "/cgi-bin/draft/batchget", requireRecord(params, "request"));
        case "publish_draft":
            return post(client, "/cgi-bin/freepublish/submit", {
                media_id: requireString(params, "media_id"),
            });
        case "get_publish_status":
            return post(client, "/cgi-bin/freepublish/get", {
                publish_id: requireString(params, "publish_id"),
            });
        case "get_published_articles":
            return post(client, "/cgi-bin/freepublish/batchget", requireRecord(params, "request"));
        case "delete_published_article":
            return post(client, "/cgi-bin/freepublish/delete", {
                article_id: requireString(params, "article_id"),
                index: optionalNumber(params, "index"),
            });
        case "mass_send_by_tag":
            return post(client, "/cgi-bin/message/mass/sendall", requireRecord(params, "message"));
        case "mass_send_by_openids":
            return post(client, "/cgi-bin/message/mass/send", requireRecord(params, "message"));
        case "mass_preview":
            return post(client, "/cgi-bin/message/mass/preview", requireRecord(params, "message"));
        case "delete_mass_message":
            return post(client, "/cgi-bin/message/mass/delete", requireRecord(params, "request"));
        case "get_mass_status":
            return post(client, "/cgi-bin/message/mass/get", {
                msg_id: requireString(params, "message_id"),
            });
        case "set_mass_speed":
            return post(client, "/cgi-bin/message/mass/speed/set", {
                speed: requireNumber(params, "speed"),
            });
        case "get_mass_speed":
            return client.call({ path: "/cgi-bin/message/mass/speed/get" });
        case "clear_api_quota":
            return post(client, "/cgi-bin/clear_quota", { appid: client.config.app_id });
        default:
            throw new WechatApiError(`未知微信公众号平台动作: ${action}`, {
                code: "WECHAT_UNKNOWN_ACTION",
            });
    }
}

function callOptions(params: Readonly<Record<string, unknown>>): WechatApiCallOptions {
    const method = optionalString(params, "method")?.toUpperCase() || undefined;
    if (method && method !== "GET" && method !== "POST") invalid("method 必须是 GET 或 POST");
    const responseType = optionalString(params, "response_type");
    if (responseType && responseType !== "json" && responseType !== "buffer") {
        invalid("response_type 必须是 json 或 buffer");
    }
    return {
        method: method as WechatApiCallOptions["method"],
        path: requireString(params, "path"),
        query: scalarRecord(params, "query"),
        body: params.body,
        token: optionalBoolean(params, "token"),
        responseType: responseType as WechatApiCallOptions["responseType"],
    };
}

function post(client: WechatClient, path: string, body: unknown): Promise<unknown> {
    return client.call({ method: "POST", path, body });
}

function tagUsers(
    client: WechatClient,
    path: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return post(client, path, {
        openid_list: requireStringArray(params, "openids"),
        tagid: requireNumber(params, "tag_id"),
    });
}

function openidList(
    client: WechatClient,
    path: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return post(client, path, { openid_list: requireStringArray(params, "openids") });
}

async function uploadMedia(
    client: WechatClient,
    params: Readonly<Record<string, unknown>>,
    path = "/cgi-bin/media/upload",
    includeType = true,
): Promise<unknown> {
    const data = requireString(params, "data");
    if (!/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u.test(data))
        invalid("data 必须是有效 Base64");
    const type = includeType ? requireString(params, "type") : "image";
    if (!["image", "voice", "video", "thumb"].includes(type))
        invalid("type 必须是 image/voice/video/thumb");
    const bytes = Buffer.from(data, "base64");
    const form = new FormData();
    form.set(
        "media",
        new Blob([Uint8Array.from(bytes)], {
            type: optionalString(params, "mime_type") || "application/octet-stream",
        }),
        optionalString(params, "filename") || "upload",
    );
    const description = params.description;
    if (typeof description === "string") form.set("description", description);
    else if (isRecord(description)) form.set("description", JSON.stringify(description));
    return client.call({
        method: "POST",
        path,
        query: includeType ? { type } : undefined,
        body: form,
    });
}

function requireMessage(
    params: Readonly<Record<string, unknown>>,
    name: string,
): WechatOutboundMessage {
    const value = requireRecord(params, name);
    if (typeof value.msgtype !== "string" || !value.msgtype) invalid(`${name}.msgtype 不能为空`);
    return structuredClone(value) as WechatOutboundMessage;
}

function requireTemplate(
    params: Readonly<Record<string, unknown>>,
    name: string,
): WechatTemplateMessage {
    const value = requireRecord(params, name);
    if (
        typeof value.touser !== "string" ||
        typeof value.template_id !== "string" ||
        !isRecord(value.data)
    ) {
        invalid(`${name} 必须包含 touser、template_id 和 data`);
    }
    return structuredClone(value) as WechatTemplateMessage;
}

function requireString(
    params: Readonly<Record<string, unknown>>,
    name: string,
    allowEmpty = false,
): string {
    const value = params[name];
    if (typeof value !== "string" || (!allowEmpty && !value))
        invalid(`${name} 必须是${allowEmpty ? "" : "非空"}字符串`);
    return value;
}

function optionalString(
    params: Readonly<Record<string, unknown>>,
    name: string,
): string | undefined {
    const value = params[name];
    return typeof value === "string" && value ? value : undefined;
}

function requireNumber(params: Readonly<Record<string, unknown>>, name: string): number {
    const value = params[name];
    if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${name} 必须是数字`);
    return value;
}

function optionalBoolean(
    params: Readonly<Record<string, unknown>>,
    name: string,
): boolean | undefined {
    return typeof params[name] === "boolean" ? params[name] : undefined;
}

function optionalNumber(
    params: Readonly<Record<string, unknown>>,
    name: string,
): number | undefined {
    const value = params[name];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function requireStringArray(params: Readonly<Record<string, unknown>>, name: string): string[] {
    const value = params[name];
    if (
        !Array.isArray(value) ||
        value.length === 0 ||
        value.some(item => typeof item !== "string" || !item)
    )
        invalid(`${name} 必须是非空字符串数组`);
    return [...value] as string[];
}

function requireRecord(
    params: Readonly<Record<string, unknown>>,
    name: string,
): Record<string, unknown> {
    const value = params[name];
    if (!isRecord(value)) invalid(`${name} 必须是对象`);
    return structuredClone(value);
}

function scalarRecord(
    params: Readonly<Record<string, unknown>>,
    name: string,
): Record<string, string | number | boolean | undefined> | undefined {
    const value = params[name];
    if (value === undefined) return undefined;
    if (!isRecord(value)) invalid(`${name} 必须是对象`);
    const result: Record<string, string | number | boolean | undefined> = {};
    for (const [key, item] of Object.entries(value)) {
        if (
            item !== undefined &&
            typeof item !== "string" &&
            typeof item !== "number" &&
            typeof item !== "boolean"
        )
            invalid(`${name}.${key} 必须是标量`);
        result[key] = item as string | number | boolean | undefined;
    }
    return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function invalid(message: string): never {
    throw new WechatApiError(`微信公众号 ${message}`, { code: "WECHAT_INVALID_PARAMETER" });
}
