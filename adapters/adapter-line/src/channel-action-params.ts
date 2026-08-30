import type { liff, moduleOperation, shop } from "@line/bot-sdk";
import {
    exactParams,
    invalidParams,
    optionalBoolean,
    optionalIntegerInRange,
    optionalString,
    requireHttpsUrl,
    requireRecord,
    requireString,
} from "./platform-action-params.js";

const LIFF_VIEW_TYPES = new Set(["compact", "tall", "full"]);
const LIFF_SCOPES = new Set(["openid", "email", "profile", "chat_message.write"]);
const LIFF_BOT_PROMPTS = new Set(["normal", "aggressive", "none"]);

export function createLiffRequest(
    params: Readonly<Record<string, unknown>>,
): liff.AddLiffAppRequest {
    const request = liffRequest(params);
    return { ...request, view: parseLiffView(requireRecord(request, "view"), true) };
}

export function updateLiffRequest(
    params: Readonly<Record<string, unknown>>,
): liff.UpdateLiffAppRequest {
    const request = liffRequest(params);
    if (Object.keys(request).length === 0) {
        throw invalidParams("LINE LIFF 更新 request 至少包含一个字段");
    }
    return {
        ...request,
        view:
            request.view === undefined
                ? undefined
                : parseLiffView(requireRecord(request, "view"), false),
    };
}

function liffRequest(params: Readonly<Record<string, unknown>>): liff.UpdateLiffAppRequest {
    const request = requireRecord(params, "request");
    exactParams(request, [
        "view",
        "description",
        "features",
        "permanentLinkPattern",
        "scope",
        "botPrompt",
    ]);
    const permanentLinkPattern = optionalString(request, "permanentLinkPattern");
    if (permanentLinkPattern && permanentLinkPattern !== "concat") {
        throw invalidParams("LINE LIFF permanentLinkPattern 只能是 concat");
    }
    const botPrompt = optionalEnum(request, "botPrompt", LIFF_BOT_PROMPTS);
    const scope = optionalEnumArray(request, "scope", LIFF_SCOPES);
    const features = parseFeatures(request);
    const description = optionalString(request, "description");
    return {
        ...(description === undefined ? {} : { description }),
        ...(features === undefined ? {} : { features }),
        ...(permanentLinkPattern === undefined ? {} : { permanentLinkPattern }),
        ...(scope === undefined ? {} : { scope: scope as liff.LiffScope[] }),
        ...(botPrompt === undefined ? {} : { botPrompt: botPrompt as liff.LiffBotPrompt }),
        ...(request.view === undefined ? {} : { view: requireRecord(request, "view") }),
    } as liff.UpdateLiffAppRequest;
}

function parseLiffView(
    view: Readonly<Record<string, unknown>>,
    required: true,
): liff.LiffView;
function parseLiffView(
    view: Readonly<Record<string, unknown>>,
    required: false,
): liff.UpdateLiffView;
function parseLiffView(
    view: Readonly<Record<string, unknown>>,
    required: boolean,
): liff.LiffView | liff.UpdateLiffView {
    exactParams(view, ["type", "url", "moduleMode"]);
    if (!required && Object.keys(view).length === 0) {
        throw invalidParams("LINE LIFF view 至少包含一个字段");
    }
    const type = optionalEnum(view, "type", LIFF_VIEW_TYPES);
    const url = view.url === undefined ? undefined : requireHttpsUrl(view, "url");
    if (url && new URL(url).hash) throw invalidParams("LINE LIFF view.url 不能包含 URL fragment");
    if (required && (!type || !url)) {
        throw invalidParams("LINE LIFF view 必须包含 type 与 url");
    }
    return {
        type: type as liff.LiffView.TypeEnum | undefined,
        url,
        moduleMode: optionalBoolean(view, "moduleMode"),
    } as liff.UpdateLiffView;
}

function parseFeatures(
    request: Readonly<Record<string, unknown>>,
): liff.LiffFeatures | undefined {
    if (request.features === undefined) return undefined;
    const features = requireRecord(request, "features");
    exactParams(features, ["ble", "qrCode"]);
    if (Object.keys(features).length === 0) {
        throw invalidParams("LINE LIFF features 至少包含一个字段");
    }
    return {
        ble: optionalBoolean(features, "ble"),
        qrCode: optionalBoolean(features, "qrCode"),
    };
}

export function acquireChatControlRequest(
    params: Readonly<Record<string, unknown>>,
): moduleOperation.AcquireChatControlRequest | undefined {
    if (params.request === undefined) return undefined;
    const request = requireRecord(params, "request");
    exactParams(request, ["expired", "ttl"]);
    return {
        expired: optionalBoolean(request, "expired"),
        ttl: optionalIntegerInRange(request, "ttl", 1, 31_536_000),
    };
}

export function detachModuleRequest(
    params: Readonly<Record<string, unknown>>,
): moduleOperation.DetachModuleRequest | undefined {
    if (params.request === undefined) return undefined;
    const request = requireRecord(params, "request");
    exactParams(request, ["botId"]);
    return { botId: optionalString(request, "botId") };
}

export function missionStickerRequest(
    params: Readonly<Record<string, unknown>>,
): shop.MissionStickerRequest {
    const request = requireRecord(params, "request");
    exactParams(request, ["to", "productId", "productType", "sendPresentMessage"]);
    const productType = requireString(request, "productType");
    const sendPresentMessage = request.sendPresentMessage;
    if (productType !== "STICKER") {
        throw invalidParams("LINE Mission Sticker productType 必须是 STICKER");
    }
    if (sendPresentMessage !== false) {
        throw invalidParams("LINE Mission Sticker sendPresentMessage 必须是 false");
    }
    return {
        to: requireString(request, "to"),
        productId: requireString(request, "productId"),
        productType,
        sendPresentMessage,
    };
}

export function moduleLimit(params: Readonly<Record<string, unknown>>): number | undefined {
    return optionalIntegerInRange(params, "limit", 1, 100);
}

export function requireAuthorizationCodeGrant(
    params: Readonly<Record<string, unknown>>,
): string {
    const value = requireString(params, "grant_type");
    if (value !== "authorization_code") {
        throw invalidParams("LINE Module grant_type 必须是 authorization_code");
    }
    return value;
}

export function requireRedirectUri(params: Readonly<Record<string, unknown>>): string {
    const value = requireString(params, "redirect_uri");
    if (!URL.canParse(value)) throw invalidParams("LINE 参数 redirect_uri 必须是有效 URL");
    return value;
}

function optionalEnum(
    params: Readonly<Record<string, unknown>>,
    name: string,
    allowed: ReadonlySet<string>,
): string | undefined {
    const value = optionalString(params, name);
    if (value && !allowed.has(value)) {
        throw invalidParams(`LINE 参数 ${name} 的值不受支持`);
    }
    return value;
}

function optionalEnumArray(
    params: Readonly<Record<string, unknown>>,
    name: string,
    allowed: ReadonlySet<string>,
): string[] | undefined {
    const value = params[name];
    if (value === undefined) return undefined;
    if (!Array.isArray(value) || value.length === 0 || !value.every(item => typeof item === "string")) {
        throw invalidParams(`LINE 参数 ${name} 必须是非空字符串数组`);
    }
    if (value.some(item => !allowed.has(item)) || new Set(value).size !== value.length) {
        throw invalidParams(`LINE 参数 ${name} 包含不支持或重复的值`);
    }
    return [...value];
}
