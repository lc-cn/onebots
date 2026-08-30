import { definePlatformActions } from "onebots";
import type { WeComClient } from "./client.js";
import { WECOM_COLLABORATION_ACTIONS } from "./collaboration-actions.js";
import { WECOM_CUSTOMER_ENGAGEMENT_ACTIONS } from "./customer-engagement-actions.js";
import { WeComApiError } from "./errors.js";
import { WECOM_EXTERNAL_CONTACT_ACTIONS } from "./external-contact-actions.js";
import type { WeComActionHandler, WeComActionParams } from "./platform-action-context.js";
import {
    callOptions,
    invalid,
    numberArray,
    numberQueryAction,
    optionalBoolean,
    optionalNumber,
    optionalString,
    post,
    requireNumber,
    requireRecord,
    requireString,
    requireStringArray,
    staticCall,
    stringArray,
    stringQueryAction,
} from "./platform-action-params.js";

const PLATFORM_ACTIONS = definePlatformActions(
    {
        wecom_call: async (client: WeComClient, params: WeComActionParams) =>
            client.call(callOptions(params)),
        send_native_message: async (client: WeComClient, params: WeComActionParams) =>
            client.sendApplicationMessage(requireRecord(params, "message")),
        send_appchat_message: async (client: WeComClient, params: WeComActionParams) =>
            client.sendAppChatMessage(
                requireString(params, "chat_id"),
                requireRecord(params, "message"),
            ),
        recall_message: async (client: WeComClient, params: WeComActionParams) =>
            client.recallMessage(requireString(params, "message_id")),
        update_template_card: postAction("/cgi-bin/message/update_template_card", "request", true),
        get_agent: async (client: WeComClient) => client.getAgent(),
        set_agent: postAction("/cgi-bin/agent/set", "agent", true),
        list_agents: staticCall("/cgi-bin/agent/list"),
        upload_temporary_media: uploadMedia,
        get_temporary_media: async (client: WeComClient, params: WeComActionParams) =>
            client.call({
                path: "/cgi-bin/media/get",
                query: { media_id: requireString(params, "media_id") },
                response_type: "buffer",
            }),
        create_appchat: postAction("/cgi-bin/appchat/create", "chat"),
        update_appchat: postAction("/cgi-bin/appchat/update", "chat"),
        get_appchat: async (client: WeComClient, params: WeComActionParams) =>
            client.getAppChat(requireString(params, "chat_id")),
        create_department: postAction("/cgi-bin/department/create", "department"),
        update_department: postAction("/cgi-bin/department/update", "department"),
        delete_department: numberQueryAction("/cgi-bin/department/delete", "department_id", "id"),
        list_departments: async (client: WeComClient, params: WeComActionParams) =>
            client.call({
                path: "/cgi-bin/department/list",
                query: { id: optionalNumber(params, "department_id") },
            }),
        create_user: postAction("/cgi-bin/user/create", "user"),
        update_user: postAction("/cgi-bin/user/update", "user"),
        delete_user: stringQueryAction("/cgi-bin/user/delete", "user_id", "userid"),
        batch_delete_users: async (client: WeComClient, params: WeComActionParams) =>
            post(client, "/cgi-bin/user/batchdelete", {
                useridlist: requireStringArray(params, "user_ids"),
            }),
        list_department_users: async (client: WeComClient, params: WeComActionParams) =>
            client.listDepartmentUsers(
                requireNumber(params, "department_id"),
                optionalBoolean(params, "fetch_child") || false,
            ),
        list_department_user_ids: async (client: WeComClient, params: WeComActionParams) =>
            client.call({
                path: "/cgi-bin/user/simplelist",
                query: {
                    department_id: requireNumber(params, "department_id"),
                    fetch_child: optionalBoolean(params, "fetch_child") ? 1 : 0,
                },
            }),
        create_tag: postAction("/cgi-bin/tag/create", "tag"),
        update_tag: postAction("/cgi-bin/tag/update", "tag"),
        delete_tag: numberQueryAction("/cgi-bin/tag/delete", "tag_id", "tagid"),
        get_tag: numberQueryAction("/cgi-bin/tag/get", "tag_id", "tagid"),
        list_tags: staticCall("/cgi-bin/tag/list"),
        add_tag_users: tagAction("/cgi-bin/tag/addtagusers"),
        delete_tag_users: tagAction("/cgi-bin/tag/deltagusers"),
        invite_users: postAction("/cgi-bin/batch/invite", "invitation"),
        get_join_qrcode: async (client: WeComClient, params: WeComActionParams) =>
            client.call({
                path: "/cgi-bin/corp/get_join_qrcode",
                query: { size_type: optionalNumber(params, "size_type") },
            }),
        get_api_domain_ips: staticCall("/cgi-bin/get_api_domain_ip"),
        get_callback_ips: staticCall("/cgi-bin/getcallbackip"),
        ...WECOM_COLLABORATION_ACTIONS,
        ...WECOM_EXTERNAL_CONTACT_ACTIONS,
        ...WECOM_CUSTOMER_ENGAGEMENT_ACTIONS,
    },
    action =>
        new WeComApiError(`未知企业微信平台动作: ${action}`, {
            code: "WECOM_UNKNOWN_ACTION",
        }),
);

export const WECOM_PLATFORM_ACTIONS = PLATFORM_ACTIONS.actions;
export type WeComPlatformAction =
    typeof WECOM_PLATFORM_ACTIONS extends ReadonlySet<infer T> ? T : never;

/** 常用自建应用 API 的稳定动作入口；wecom_call 覆盖新增接口。 */
export function executeWeComPlatformAction(
    client: WeComClient,
    action: string,
    params: WeComActionParams,
): Promise<unknown> {
    return PLATFORM_ACTIONS.execute(client, action, params);
}

function postAction(path: string, parameter: string, agent = false): WeComActionHandler {
    return async (client, params) => {
        const body = requireRecord(params, parameter);
        return post(client, path, agent ? withAgent(client, body) : body);
    };
}

function tagAction(path: string): WeComActionHandler {
    return async (client, params) => tagUsers(client, path, params);
}

function withAgent(client: WeComClient, value: Record<string, unknown>): Record<string, unknown> {
    return { ...value, agentid: Number(client.config.agent_id) };
}

function tagUsers(client: WeComClient, path: string, params: WeComActionParams): Promise<unknown> {
    return post(client, path, {
        tagid: requireNumber(params, "tag_id"),
        userlist: stringArray(params, "user_ids"),
        partylist: numberArray(params, "department_ids"),
    });
}

async function uploadMedia(client: WeComClient, params: WeComActionParams): Promise<unknown> {
    const type = requireString(params, "type");
    if (!["image", "voice", "video", "file"].includes(type))
        invalid("type 必须是 image/voice/video/file");
    const data = requireString(params, "data");
    if (!/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u.test(data))
        invalid("data 必须是有效 Base64");
    const bytes = Buffer.from(data, "base64");
    return client.uploadTemporaryMedia(
        type as "image" | "voice" | "video" | "file",
        new Blob([Uint8Array.from(bytes)], {
            type: optionalString(params, "mime_type") || "application/octet-stream",
        }),
        optionalString(params, "filename") || "upload",
    );
}
