import type { IncomingMessage } from "node:http";
import type { ControlAuth } from "./auth.js";
import { validSessionPolicy } from "./auth-policy.js";

export async function handleControlSessions(input: {
    pathname: string;
    request: Pick<IncomingMessage, "headers" | "method">;
    auth?: ControlAuth;
    body(): Promise<Record<string, unknown>>;
    revoked?(owner: string): void;
}): Promise<{ status: number; body: unknown } | undefined> {
    const listing = input.pathname === "/api/control/auth/sessions";
    const revoking = input.pathname === "/api/control/auth/sessions/revoke";
    const issuing = input.pathname === "/api/control/auth/sessions/device";
    const policy = input.pathname === "/api/control/auth/sessions/policy";
    const renewing = input.pathname === "/api/control/auth/sessions/renew";
    if (!listing && !revoking && !issuing && !policy && !renewing) return;
    if (
        input.request.method !==
        (listing || (policy && input.request.method === "GET") ? "GET" : "POST")
    )
        return { status: 405, body: { message: "不支持此方法" } };
    const token = /^Bearer\s+(\S+)$/i.exec(input.request.headers.authorization ?? "")?.[1];
    try {
        if (!token || !input.auth?.verify(token))
            return { status: 401, body: { message: "控制认证失败" } };
        if (listing) return { status: 200, body: { sessions: input.auth.sessions(token) } };
        if (policy && input.request.method === "GET")
            return { status: 200, body: input.auth.sessionPolicy(token) };
        const body = await input.body();
        if (!input.auth.verify(token)) return { status: 401, body: { message: "控制认证失败" } };
        if (issuing) {
            if (Object.keys(body).length)
                return { status: 400, body: { message: "设备码签发请求必须为空对象" } };
            return { status: 200, body: input.auth.issueDeviceForSession(token) };
        }
        if (policy) {
            if (!validSessionPolicy(body))
                return { status: 400, body: { message: "会话策略无效" } };
            return { status: 200, body: input.auth.setSessionPolicy(token, body) };
        }
        if (renewing) {
            if (Object.keys(body).length)
                return { status: 400, body: { message: "续期请求必须为空对象" } };
            return { status: 200, body: { session: input.auth.renewSession(token) } };
        }
        if (
            Object.keys(body).length !== 1 ||
            typeof body.id !== "string" ||
            !/^[a-f0-9]{32}$/.test(body.id)
        )
            return { status: 400, body: { message: "设备会话标识无效" } };
        const owner = input.auth.revokeSession(token, body.id);
        if (owner !== null) input.revoked?.(owner);
        return { status: 200, body: { revoked: true } };
    } catch {
        // 不泄漏凭据或磁盘错误，写入结果未知时不能声称撤销成功。
        return { status: 503, body: { message: "设备会话操作未确认，请刷新后重试" } };
    }
}
