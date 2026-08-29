import { definePlatformActions, type PlatformActionHandler } from "onebots";
import type { WeComClient } from "./client.js";
import { WeComApiError } from "./errors.js";
import type { WeComCallOptions } from "./types.js";

type Params = Readonly<Record<string, unknown>>;
type Handler = PlatformActionHandler<WeComClient>;

const PLATFORM_ACTIONS = definePlatformActions(
    {
        wecom_call: async (client: WeComClient, params: Params) => client.call(callOptions(params)),
        send_native_message: async (client: WeComClient, params: Params) =>
            client.sendApplicationMessage(requireRecord(params, "message")),
        send_appchat_message: async (client: WeComClient, params: Params) =>
            client.sendAppChatMessage(
                requireString(params, "chat_id"),
                requireRecord(params, "message"),
            ),
        recall_message: async (client: WeComClient, params: Params) =>
            client.recallMessage(requireString(params, "message_id")),
        update_template_card: postAction("/cgi-bin/message/update_template_card", "request", true),
        get_agent: async (client: WeComClient) => client.getAgent(),
        set_agent: postAction("/cgi-bin/agent/set", "agent", true),
        list_agents: staticCall("/cgi-bin/agent/list"),
        upload_temporary_media: uploadMedia,
        get_temporary_media: async (client: WeComClient, params: Params) =>
            client.call({
                path: "/cgi-bin/media/get",
                query: { media_id: requireString(params, "media_id") },
                response_type: "buffer",
            }),
        create_appchat: postAction("/cgi-bin/appchat/create", "chat"),
        update_appchat: postAction("/cgi-bin/appchat/update", "chat"),
        get_appchat: async (client: WeComClient, params: Params) =>
            client.getAppChat(requireString(params, "chat_id")),
        create_department: postAction("/cgi-bin/department/create", "department"),
        update_department: postAction("/cgi-bin/department/update", "department"),
        delete_department: numberQueryAction("/cgi-bin/department/delete", "department_id", "id"),
        list_departments: async (client: WeComClient, params: Params) =>
            client.call({
                path: "/cgi-bin/department/list",
                query: { id: optionalNumber(params, "department_id") },
            }),
        create_user: postAction("/cgi-bin/user/create", "user"),
        update_user: postAction("/cgi-bin/user/update", "user"),
        delete_user: stringQueryAction("/cgi-bin/user/delete", "user_id", "userid"),
        batch_delete_users: async (client: WeComClient, params: Params) =>
            post(client, "/cgi-bin/user/batchdelete", {
                useridlist: requireStringArray(params, "user_ids"),
            }),
        list_department_users: async (client: WeComClient, params: Params) =>
            client.listDepartmentUsers(
                requireNumber(params, "department_id"),
                optionalBoolean(params, "fetch_child") || false,
            ),
        list_department_user_ids: async (client: WeComClient, params: Params) =>
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
        get_join_qrcode: async (client: WeComClient, params: Params) =>
            client.call({
                path: "/cgi-bin/corp/get_join_qrcode",
                query: { size_type: optionalNumber(params, "size_type") },
            }),
        get_api_domain_ips: staticCall("/cgi-bin/get_api_domain_ip"),
        get_callback_ips: staticCall("/cgi-bin/getcallbackip"),
    },
    action =>
        new WeComApiError(`未知企业微信平台动作: ${action}`, {
            code: "WECOM_UNKNOWN_ACTION",
        }),
);

export const WECOM_PLATFORM_ACTIONS: ReadonlySet<string> = PLATFORM_ACTIONS.actions;

/** 常用自建应用 API 的稳定动作入口；wecom_call 覆盖新增接口。 */
export function executeWeComPlatformAction(
    client: WeComClient,
    action: string,
    params: Params,
): Promise<unknown> {
    return PLATFORM_ACTIONS.execute(client, action, params);
}

function staticCall(path: string): Handler {
    return async client => client.call({ path });
}

function postAction(path: string, parameter: string, agent = false): Handler {
    return async (client, params) => {
        const body = requireRecord(params, parameter);
        return post(client, path, agent ? withAgent(client, body) : body);
    };
}

function stringQueryAction(path: string, parameter: string, query: string): Handler {
    return async (client, params) =>
        client.call({ path, query: { [query]: requireString(params, parameter) } });
}

function numberQueryAction(path: string, parameter: string, query: string): Handler {
    return async (client, params) =>
        client.call({ path, query: { [query]: requireNumber(params, parameter) } });
}

function tagAction(path: string): Handler {
    return async (client, params) => tagUsers(client, path, params);
}

function callOptions(params: Readonly<Record<string, unknown>>): WeComCallOptions {
    const method = optionalString(params, "method")?.toUpperCase();
    if (method && method !== "GET" && method !== "POST") invalid("method 必须是 GET 或 POST");
    const responseType = optionalString(params, "response_type");
    if (responseType && responseType !== "json" && responseType !== "buffer")
        invalid("response_type 必须是 json 或 buffer");
    return {
        method: method as WeComCallOptions["method"],
        path: requireString(params, "path"),
        query: scalarRecord(params, "query"),
        body: params.body,
        token: optionalBoolean(params, "token"),
        response_type: responseType as WeComCallOptions["response_type"],
    };
}

function post(client: WeComClient, path: string, body: unknown): Promise<unknown> {
    return client.call({ method: "POST", path, body });
}

function withAgent(client: WeComClient, value: Record<string, unknown>): Record<string, unknown> {
    return { ...value, agentid: Number(client.config.agent_id) };
}

function tagUsers(
    client: WeComClient,
    path: string,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
    return post(client, path, {
        tagid: requireNumber(params, "tag_id"),
        userlist: stringArray(params, "user_ids"),
        partylist: numberArray(params, "department_ids"),
    });
}

async function uploadMedia(
    client: WeComClient,
    params: Readonly<Record<string, unknown>>,
): Promise<unknown> {
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

function requireString(params: Readonly<Record<string, unknown>>, name: string): string {
    const value = params[name];
    if (typeof value !== "string" || !value) invalid(`${name} 必须是非空字符串`);
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

function optionalNumber(
    params: Readonly<Record<string, unknown>>,
    name: string,
): number | undefined {
    const value = params[name];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function optionalBoolean(
    params: Readonly<Record<string, unknown>>,
    name: string,
): boolean | undefined {
    return typeof params[name] === "boolean" ? params[name] : undefined;
}

function requireRecord(
    params: Readonly<Record<string, unknown>>,
    name: string,
): Record<string, unknown> {
    const value = params[name];
    if (!isRecord(value)) invalid(`${name} 必须是对象`);
    return structuredClone(value);
}

function requireStringArray(params: Readonly<Record<string, unknown>>, name: string): string[] {
    const result = stringArray(params, name);
    if (!result.length) invalid(`${name} 必须是非空字符串数组`);
    return result;
}

function stringArray(params: Readonly<Record<string, unknown>>, name: string): string[] {
    const value = params[name];
    if (value === undefined) return [];
    if (!Array.isArray(value) || value.some(item => typeof item !== "string" || !item))
        invalid(`${name} 必须是字符串数组`);
    return [...value] as string[];
}

function numberArray(params: Readonly<Record<string, unknown>>, name: string): number[] {
    const value = params[name];
    if (value === undefined) return [];
    if (
        !Array.isArray(value) ||
        value.some(item => typeof item !== "number" || !Number.isFinite(item))
    )
        invalid(`${name} 必须是数字数组`);
    return [...value] as number[];
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
    throw new WeComApiError(`企业微信 ${message}`, { code: "WECOM_INVALID_PARAMETER" });
}
