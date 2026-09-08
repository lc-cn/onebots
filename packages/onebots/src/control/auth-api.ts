import type { ControlAuth } from "./auth.js";

/** 认证交换独立于已登录控制 API；签发能力仅授予私有本地 socket。 */
export async function handleControlAuth(input: {
    pathname: string;
    method?: string;
    local: boolean;
    auth?: ControlAuth;
    body(): Promise<Record<string, unknown>>;
}): Promise<{ status: number; body: unknown } | undefined> {
    const action = input.pathname.slice("/api/control/auth/".length);
    if (
        !input.pathname.startsWith("/api/control/auth/") ||
        !["bootstrap", "recovery", "pair"].includes(action) ||
        input.method !== "POST"
    )
        return;
    if (action !== "pair" && !input.local)
        return { status: 403, body: { message: "配对码和恢复码只能通过本地控制连接签发" } };
    try {
        const body = await input.body();
        if (!input.auth) throw new Error("认证失败");
        if (action === "pair") {
            if (typeof body.code !== "string" || Object.keys(body).length !== 1)
                throw new Error("认证失败");
            return { status: 200, body: { token: input.auth.pair(body.code) } };
        }
        if (Object.keys(body).length) throw new Error("认证失败");
        return {
            status: 200,
            body: {
                code:
                    action === "recovery"
                        ? input.auth.issueRecovery()
                        : input.auth.issueBootstrap(),
            },
        };
    } catch {
        // 解析及文件错误可能含秘密；认证边界始终返回固定诊断。
        return { status: 401, body: { message: "控制认证失败" } };
    }
}
