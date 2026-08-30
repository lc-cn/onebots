import { createWechatJsApiSignature } from "onebots";
import type { WeComClient } from "./client.js";
import type { WeComActionHandler, WeComActionParams } from "./platform-action-context.js";
import {
    invalid,
    optionalBoolean,
    optionalNumber,
    optionalString,
    post,
    requireString,
} from "./platform-action-params.js";

const OAUTH_SCOPES = new Set(["snsapi_base", "snsapi_userinfo", "snsapi_privateinfo"]);

/** 企业微信网页授权、wx.config 与 wx.agentConfig 动作。 */
export const WECOM_WEB_ACTIONS = {
    build_oauth_url: async (client: WeComClient, params: WeComActionParams) => ({
        url: buildOAuthUrl(client, params),
    }),
    get_oauth_user_identity: async (client: WeComClient, params: WeComActionParams) =>
        client.call({
            path: "/cgi-bin/auth/getuserinfo",
            query: { code: oauthCode(params) },
        }),
    get_oauth_user_detail: async (client: WeComClient, params: WeComActionParams) =>
        post(client, "/cgi-bin/auth/getuserdetail", {
            user_ticket: requireString(params, "user_ticket"),
        }),
    get_corp_jsapi_ticket: async (client: WeComClient, params: WeComActionParams) => ({
        ticket: await client.getCorpJsApiTicket(optionalBoolean(params, "force") || false),
    }),
    get_agent_jsapi_ticket: async (client: WeComClient, params: WeComActionParams) => ({
        ticket: await client.getAgentJsApiTicket(optionalBoolean(params, "force") || false),
    }),
    sign_corp_jsapi_config: async (client: WeComClient, params: WeComActionParams) => ({
        appId: client.config.corp_id,
        ...createWechatJsApiSignature({
            ticket: await client.getCorpJsApiTicket(optionalBoolean(params, "force") || false),
            url: requireWebUrl(params, "url"),
            nonceStr: optionalString(params, "nonce_str"),
            timestamp: optionalTimestamp(params),
        }),
    }),
    sign_agent_jsapi_config: async (client: WeComClient, params: WeComActionParams) => ({
        corpid: client.config.corp_id,
        agentid: Number(client.config.agent_id),
        ...createWechatJsApiSignature({
            ticket: await client.getAgentJsApiTicket(optionalBoolean(params, "force") || false),
            url: requireWebUrl(params, "url"),
            nonceStr: optionalString(params, "nonce_str"),
            timestamp: optionalTimestamp(params),
        }),
    }),
} satisfies Readonly<Record<string, WeComActionHandler>>;

function buildOAuthUrl(client: WeComClient, params: WeComActionParams): string {
    const scope = optionalString(params, "scope") || "snsapi_base";
    if (!OAUTH_SCOPES.has(scope)) {
        invalid("scope 必须是 snsapi_base、snsapi_userinfo 或 snsapi_privateinfo");
    }
    const state = optionalString(params, "state");
    if (state && Buffer.byteLength(state, "utf8") > 128) {
        invalid("state 的 UTF-8 长度不能超过 128 字节");
    }
    const url = new URL("https://open.weixin.qq.com/connect/oauth2/authorize");
    url.searchParams.set("appid", client.config.corp_id);
    url.searchParams.set("redirect_uri", requireWebUrl(params, "redirect_uri"));
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scope);
    if (state) url.searchParams.set("state", state);
    url.searchParams.set("agentid", client.config.agent_id);
    url.hash = "wechat_redirect";
    return url.toString();
}

function oauthCode(params: WeComActionParams): string {
    const code = requireString(params, "code");
    if (Buffer.byteLength(code, "utf8") > 512) invalid("code 不能超过 512 字节");
    return code;
}

function optionalTimestamp(params: WeComActionParams): number | undefined {
    const timestamp = optionalNumber(params, "timestamp");
    if (timestamp !== undefined && (!Number.isSafeInteger(timestamp) || timestamp < 1)) {
        invalid("timestamp 必须是正安全整数");
    }
    return timestamp;
}

function requireWebUrl(params: WeComActionParams, name: string): string {
    const value = requireString(params, name);
    if (!URL.canParse(value)) invalid(`${name} 必须是有效 HTTP(S) URL`);
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
        invalid(`${name} 必须是无凭据的 HTTP(S) URL`);
    }
    return value;
}
