import { handleControlSessions } from "./auth-sessions-api.js";
import { createHash } from "node:crypto";
import { readBody } from "./http-utils.js";
import type { ControlMcpService } from "./mcp-api.js";
import type { IncomingMessage } from "node:http";
import type { ControlAuth } from "./auth.js";

/** 认证交换独立于已登录控制 API；签发能力仅授予私有本地 socket。 */
export async function handleControlAuth(input: {
    pathname: string;
    request: Pick<IncomingMessage, "method" | "headers">;
    local: boolean;
    auth?: ControlAuth;
    body(): Promise<Record<string, unknown>>;
    revoked?(owner: string): void;
}): Promise<{ status: number; body: unknown } | undefined> {
    const sessions = await handleControlSessions(input);
    if (sessions) return sessions;
    const action = input.pathname.slice("/api/control/auth/".length);
    if (
        !input.pathname.startsWith("/api/control/auth/") ||
        !["bootstrap", "recovery", "device", "pair", "logout"].includes(action) ||
        input.request.method !== "POST"
    )
        return;
    if (action === "logout") return logout(input);
    if (action !== "pair" && !input.local)
        return { status: 403, body: { message: "配对码和恢复码只能通过本地控制连接签发" } };
    try {
        const body = await input.body();
        if (!input.auth) throw new Error("认证失败");
        if (action === "pair") {
            if (typeof body.code !== "string" || Object.keys(body).length !== 1)
                throw new Error("认证失败");
            const result = input.auth.pairWithRevocations(body.code);
            for (const owner of result.revoked) input.revoked?.(owner);
            return { status: 200, body: { token: result.token } };
        }
        if (Object.keys(body).length) throw new Error("认证失败");
        return {
            status: 200,
            body: {
                code:
                    action === "recovery"
                        ? input.auth.issueRecovery()
                        : action === "device" ? input.auth.issueDevice() : input.auth.issueBootstrap(),
            },
        };
    } catch {
        // 解析及文件错误可能含秘密；认证边界始终返回固定诊断。
        return { status: 401, body: { message: "控制认证失败" } };
    }
}

/** 本地 socket 同样必须出示当前会话；本地管理权限不等于浏览器会话身份。 */
async function logout(input: {
    request: Pick<IncomingMessage, "headers">;
    auth?: ControlAuth;
    body(): Promise<Record<string, unknown>>;
    revoked?(owner: string): void;
}): Promise<{ status: number; body: unknown }> {
    const token = /^Bearer\s+(\S+)$/i.exec(input.request.headers.authorization ?? "")?.[1];
    try {
        if (!token || !input.auth?.verify(token))
            return { status: 401, body: { message: "控制认证失败" } };
        const body = await input.body();
        if (!input.auth.verify(token)) return { status: 401, body: { message: "控制认证失败" } };
        if (Object.keys(body).length)
            return { status: 400, body: { message: "退出请求必须为空对象" } };
        input.auth.revoke(token);
        input.revoked?.(createHash("sha256").update(token).digest("hex"));
        // revoke 同步持久化，成功后不再用已撤销的凭据进行响应鉴权。
        return { status: 200, body: { loggedOut: true } };
    } catch {
        // 磁盘写入结果可能未知，不能把撤销失败报告成成功，且不泄漏底层错误。
        return { status: 503, body: { message: "未能确认会话撤销，请重试或使用本地恢复入口" } };
    }
}

/** HTTP 适配负责请求解析和撤销后的 MCP 会话清理。 */
export function handleControlAuthRequest(
    request: IncomingMessage,
    local: boolean,
    auth: ControlAuth | undefined,
    mcp: ControlMcpService,
) {
    return handleControlAuth({
        pathname: new URL(request.url ?? "/", "http://localhost").pathname,
        request,
        local,
        auth,
        body: () => readBody(request),
        revoked: owner => mcp.revokeOwner(owner),
    });
}
