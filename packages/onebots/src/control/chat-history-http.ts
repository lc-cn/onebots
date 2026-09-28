import type { IncomingMessage, ServerResponse } from "node:http";
import type { ControlChatHistoryQuery, ControlChatHistorySettings } from "@onebots/core/control";
import type { ControlAuth } from "./auth.js";
import type { ChatHistoryStore } from "../chat-history-store.js";
import { jsonResponse, readBody } from "./http-utils.js";

const safeId = (value: unknown): value is string =>
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 512 &&
    !/[\u0000-\u001f\u007f]/.test(value);

function historyQuery(url: URL): ControlChatHistoryQuery | undefined {
    const platform = url.searchParams.get("platform");
    const accountId = url.searchParams.get("accountId");
    const sceneType = url.searchParams.get("sceneType");
    const sceneId = url.searchParams.get("sceneId");
    const guildId = url.searchParams.get("guildId");
    const beforeValue = url.searchParams.get("before");
    const before = beforeValue === null ? undefined : Number(beforeValue);
    if (
        !safeId(platform) ||
        !safeId(accountId) ||
        !safeId(sceneId) ||
        (guildId !== null && (sceneType !== "channel" || !safeId(guildId))) ||
        (sceneType !== "private" &&
            sceneType !== "direct" &&
            sceneType !== "group" &&
            sceneType !== "channel") ||
        (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) ||
        [...url.searchParams.keys()].some(
            key =>
                !["platform", "accountId", "sceneType", "sceneId", "guildId", "before"].includes(
                    key,
                ),
        )
    )
        return undefined;
    return {
        platform,
        accountId,
        sceneType,
        sceneId,
        ...(guildId ? { guildId } : {}),
        ...(before ? { before } : {}),
    };
}

function settingsInput(value: unknown): value is ControlChatHistorySettings {
    return (
        !!value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Object.keys(value).length === 2 &&
        typeof (value as ControlChatHistorySettings).enabled === "boolean" &&
        Number.isInteger((value as ControlChatHistorySettings).retentionDays) &&
        (value as ControlChatHistorySettings).retentionDays >= 1 &&
        (value as ControlChatHistorySettings).retentionDays <= 3650
    );
}

/** 只通过管理服务的设备会话提供历史，网关数据文件不直接暴露给 Web。 */
export async function respondControlChatHistory(
    store: ChatHistoryStore | undefined,
    request: IncomingMessage,
    response: ServerResponse,
    pathname: string,
    local: boolean,
    auth?: ControlAuth,
): Promise<boolean> {
    if (!pathname.startsWith("/api/control/accounts/history")) return false;
    const token = (request.headers.authorization ?? "").replace(/^Bearer\s+/i, "");
    const authorized = () => local || Boolean(auth?.verify(token));
    try {
        if (!authorized()) {
            jsonResponse(response, 401, { message: "控制认证失败" });
            return true;
        }
        if (!store) {
            jsonResponse(response, 503, { message: "聊天历史存储不可用" });
            return true;
        }
        const url = new URL(request.url ?? "/", "http://localhost");
        if (pathname === "/api/control/accounts/history/settings") {
            if (request.method === "GET") {
                jsonResponse(response, 200, store.settings());
                return true;
            }
            const input: unknown = await readBody(request, 2048);
            if (!authorized()) {
                jsonResponse(response, 401, { message: "控制认证失败" });
                return true;
            }
            if (request.method !== "POST" || !settingsInput(input)) {
                jsonResponse(response, 400, { message: "聊天记录设置无效" });
                return true;
            }
            jsonResponse(response, 200, store.updateSettings(input));
            return true;
        }
        if (pathname === "/api/control/accounts/history/clear" && request.method === "POST") {
            await readBody(request, 256);
            if (!authorized()) {
                jsonResponse(response, 401, { message: "控制认证失败" });
                return true;
            }
            jsonResponse(response, 200, { deleted: store.clear() });
            return true;
        }
        if (
            pathname === "/api/control/accounts/history/conversations" &&
            request.method === "GET"
        ) {
            const platform = url.searchParams.get("platform");
            const accountId = url.searchParams.get("accountId");
            const beforeValue = url.searchParams.get("before");
            const before = beforeValue === null ? undefined : Number(beforeValue);
            if (
                !safeId(platform) ||
                !safeId(accountId) ||
                (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) ||
                [...url.searchParams.keys()].some(
                    key => !["platform", "accountId", "before"].includes(key),
                )
            ) {
                jsonResponse(response, 400, { message: "会话查询无效" });
                return true;
            }
            const conversations = store.conversations(platform, accountId, before);
            jsonResponse(response, 200, {
                conversations: conversations.slice(0, 50),
                hasMore: conversations.length > 50,
            });
            return true;
        }
        if (pathname === "/api/control/accounts/history" && request.method === "GET") {
            const query = historyQuery(url);
            if (!query) {
                jsonResponse(response, 400, { message: "聊天记录查询无效" });
                return true;
            }
            jsonResponse(response, 200, store.historyPage(query));
            return true;
        }
        jsonResponse(response, 404, { message: "聊天历史接口不存在" });
    } catch {
        if (!response.headersSent) jsonResponse(response, 503, { message: "聊天历史操作失败" });
    }
    return true;
}
