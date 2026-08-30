import { createWechatJsApiSignature } from "onebots";
import type { WechatClient } from "./client.js";
import { defineWechatActionContract } from "./platform-action-contract.js";
import type { WechatActionHandler, WechatActionParams } from "./platform-action-context.js";
import {
    invalid,
    optionalBoolean,
    optionalInteger,
    optionalString,
    requireString,
} from "./platform-action-params.js";

const OAUTH_SCOPES = new Set(["snsapi_base", "snsapi_userinfo"]);
const OAUTH_LANGUAGES = new Set(["zh_CN", "zh_TW", "en"]);

/** 公众号网页授权与 JS-SDK 动作。 */
export const WECHAT_WEB_ACTIONS = defineWechatActionContract(
    {
        get_jsapi_ticket: async (client: WechatClient, params: WechatActionParams) => ({
            ticket: await client.getJsApiTicket(optionalBoolean(params, "force") || false),
        }),
        sign_jsapi_config: async (client: WechatClient, params: WechatActionParams) =>
            signJsApiConfig(client, params),
        build_oauth_url: async (client: WechatClient, params: WechatActionParams) => ({
            url: buildOAuthUrl(client, params),
        }),
        exchange_oauth_code: async (client: WechatClient, params: WechatActionParams) =>
            client.call({
                path: "/sns/oauth2/access_token",
                query: {
                    appid: client.config.app_id,
                    secret: client.config.app_secret,
                    code: requireString(params, "code"),
                    grant_type: "authorization_code",
                },
                token: false,
            }),
        refresh_oauth_access_token: async (client: WechatClient, params: WechatActionParams) =>
            client.call({
                path: "/sns/oauth2/refresh_token",
                query: {
                    appid: client.config.app_id,
                    grant_type: "refresh_token",
                    refresh_token: requireString(params, "refresh_token"),
                },
                token: false,
            }),
        get_oauth_user_info: async (client: WechatClient, params: WechatActionParams) =>
            client.call({
                path: "/sns/userinfo",
                query: {
                    access_token: requireString(params, "oauth_access_token"),
                    openid: requireString(params, "openid"),
                    lang: oauthLanguage(params),
                },
                token: false,
            }),
        check_oauth_access_token: async (client: WechatClient, params: WechatActionParams) =>
            client.call({
                path: "/sns/auth",
                query: {
                    access_token: requireString(params, "oauth_access_token"),
                    openid: requireString(params, "openid"),
                },
                token: false,
            }),
    } satisfies Readonly<Record<string, WechatActionHandler>>,
    {
        get_jsapi_ticket: ["force"],
        sign_jsapi_config: ["url", "nonce_str", "timestamp", "force"],
        build_oauth_url: ["redirect_uri", "scope", "state"],
        exchange_oauth_code: ["code"],
        refresh_oauth_access_token: ["refresh_token"],
        get_oauth_user_info: ["oauth_access_token", "openid", "lang"],
        check_oauth_access_token: ["oauth_access_token", "openid"],
    },
);

async function signJsApiConfig(
    client: WechatClient,
    params: WechatActionParams,
): Promise<Record<string, string | number>> {
    const ticket = await client.getJsApiTicket(optionalBoolean(params, "force") || false);
    const signed = createWechatJsApiSignature({
        ticket,
        url: requireWebUrl(params, "url"),
        nonceStr: optionalString(params, "nonce_str"),
        timestamp: optionalInteger(params, "timestamp", 1),
    });
    return {
        appId: client.config.app_id,
        ...signed,
    };
}

function buildOAuthUrl(client: WechatClient, params: WechatActionParams): string {
    const redirectUri = requireWebUrl(params, "redirect_uri");
    const scope = optionalString(params, "scope") || "snsapi_base";
    if (!OAUTH_SCOPES.has(scope)) invalid("scope 必须是 snsapi_base 或 snsapi_userinfo");
    const state = optionalString(params, "state");
    if (state && Buffer.byteLength(state, "utf8") > 128) {
        invalid("state 的 UTF-8 长度不能超过 128 字节");
    }
    const url = new URL("https://open.weixin.qq.com/connect/oauth2/authorize");
    url.searchParams.set("appid", client.config.app_id);
    url.searchParams.set("redirect_uri", redirectUri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", scope);
    if (state) url.searchParams.set("state", state);
    url.hash = "wechat_redirect";
    return url.toString();
}

function requireWebUrl(params: WechatActionParams, name: string): string {
    const value = requireString(params, name);
    if (!URL.canParse(value)) invalid(`${name} 必须是有效 HTTP(S) URL`);
    const url = new URL(value);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
        invalid(`${name} 必须是无凭据的 HTTP(S) URL`);
    }
    return value;
}

function oauthLanguage(params: WechatActionParams): string {
    const lang = optionalString(params, "lang") || "zh_CN";
    if (!OAUTH_LANGUAGES.has(lang)) invalid("lang 必须是 zh_CN、zh_TW 或 en");
    return lang;
}
