import * as http from "node:http";
import { randomBytes } from "node:crypto";
import type { DoctorCheck } from "./doctor.js";

type DoctorFetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface DoctorWebSocketUpgradeResult {
    upgraded: boolean;
    status: number;
}

export interface DoctorManagementProbeDependencies {
    fetcher?: DoctorFetch;
    upgrade?: (url: string, token?: string) => Promise<DoctorWebSocketUpgradeResult>;
}

interface DoctorManagementCredential {
    token?: string;
    session: boolean;
    error?: string;
}

/** 验证运行中网关的管理面同时满足匿名拒绝与合法凭据可用。 */
export async function probeDoctorManagement(
    base: string,
    config: Record<string, unknown>,
    dependencies: DoctorManagementProbeDependencies = {},
): Promise<DoctorCheck[]> {
    const fetcher = dependencies.fetcher ?? fetch;
    const upgrade = dependencies.upgrade ?? probeWebSocketUpgrade;
    const websocketUrl = managementWebSocketUrl(base);
    const checks: DoctorCheck[] = [];

    checks.push(await probeAnonymousManagementHttp(base, fetcher));
    const credential = await acquireDoctorManagementCredential(base, config, fetcher);
    if (credential.token) {
        checks.push(await probeAuthenticatedManagementHttp(base, credential.token, fetcher));
    } else {
        checks.push({
            name: "management-http-authenticated",
            level: credential.error ? "error" : "warning",
            message:
                credential.error ?? "配置未提供 access_token 或用户名/密码，无法验证合法管理凭据",
        });
    }

    checks.push(await probeAnonymousManagementWebSocket(websocketUrl, upgrade));
    if (credential.token) {
        checks.push(
            await probeAuthenticatedManagementWebSocket(websocketUrl, credential.token, upgrade),
        );
    } else {
        checks.push({
            name: "management-ws-authenticated",
            level: "warning",
            message: "未获得管理令牌，无法验证合法 WebSocket 握手",
        });
    }

    if (credential.session && credential.token) {
        checks.push(await revokeDoctorManagementSession(base, credential.token, fetcher));
    }
    return checks;
}

async function probeAnonymousManagementHttp(
    base: string,
    fetcher: DoctorFetch,
): Promise<DoctorCheck> {
    try {
        const response = await fetcher(`${base}/api/auth/me`, {
            signal: AbortSignal.timeout(2_000),
        });
        await response.body?.cancel();
        return {
            name: "management-http-anonymous",
            level: response.status === 401 ? "ok" : "error",
            message:
                response.status === 401
                    ? "管理 API 已拒绝匿名请求: HTTP 401"
                    : `管理 API 未按预期拒绝匿名请求: HTTP ${response.status}`,
        };
    } catch (error) {
        return failedManagementCheck("management-http-anonymous", "匿名管理 API", error);
    }
}

async function acquireDoctorManagementCredential(
    base: string,
    config: Record<string, unknown>,
    fetcher: DoctorFetch,
): Promise<DoctorManagementCredential> {
    const accessToken =
        stringConfigValue(config.access_token) ??
        stringConfigValue(process.env.ONEBOTS_ACCESS_TOKEN);
    if (accessToken) return { token: accessToken, session: false };

    const username = stringConfigValue(config.username);
    const password = stringConfigValue(config.password);
    if (!username || !password) return { session: false };
    try {
        const response = await fetcher(`${base}/api/auth/login`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ username, password }),
            signal: AbortSignal.timeout(2_000),
        });
        const payload = (await response.json()) as { token?: unknown };
        if (!response.ok || typeof payload.token !== "string" || !payload.token) {
            return { session: false, error: `管理登录失败: HTTP ${response.status}` };
        }
        return { token: payload.token, session: true };
    } catch (error) {
        return {
            session: false,
            error: `管理登录不可达: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

async function probeAuthenticatedManagementHttp(
    base: string,
    token: string,
    fetcher: DoctorFetch,
): Promise<DoctorCheck> {
    try {
        const response = await fetcher(`${base}/api/auth/me`, {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(2_000),
        });
        const payload = (await response.json()) as { success?: unknown };
        const valid = response.ok && payload.success === true;
        return {
            name: "management-http-authenticated",
            level: valid ? "ok" : "error",
            message: valid
                ? `管理 API 已接受合法凭据: HTTP ${response.status}`
                : `管理 API 未接受合法凭据或响应语义无效: HTTP ${response.status}`,
        };
    } catch (error) {
        return failedManagementCheck("management-http-authenticated", "已认证管理 API", error);
    }
}

async function probeAnonymousManagementWebSocket(
    url: string,
    upgrade: NonNullable<DoctorManagementProbeDependencies["upgrade"]>,
): Promise<DoctorCheck> {
    try {
        const result = await upgrade(url);
        return {
            name: "management-ws-anonymous",
            level: !result.upgraded && result.status === 401 ? "ok" : "error",
            message:
                !result.upgraded && result.status === 401
                    ? "管理 WebSocket 已在升级前拒绝匿名请求: HTTP 401"
                    : result.upgraded
                      ? "管理 WebSocket 错误接受了匿名升级"
                      : `管理 WebSocket 匿名握手返回意外状态: HTTP ${result.status}`,
        };
    } catch (error) {
        return failedManagementCheck("management-ws-anonymous", "匿名管理 WebSocket", error);
    }
}

async function probeAuthenticatedManagementWebSocket(
    url: string,
    token: string,
    upgrade: NonNullable<DoctorManagementProbeDependencies["upgrade"]>,
): Promise<DoctorCheck> {
    try {
        const result = await upgrade(url, token);
        return {
            name: "management-ws-authenticated",
            level: result.upgraded && result.status === 101 ? "ok" : "error",
            message:
                result.upgraded && result.status === 101
                    ? "管理 WebSocket 已接受合法令牌: HTTP 101"
                    : `管理 WebSocket 未接受合法令牌: HTTP ${result.status}`,
        };
    } catch (error) {
        return failedManagementCheck("management-ws-authenticated", "已认证管理 WebSocket", error);
    }
}

async function revokeDoctorManagementSession(
    base: string,
    token: string,
    fetcher: DoctorFetch,
): Promise<DoctorCheck> {
    try {
        const response = await fetcher(`${base}/api/auth/logout`, {
            method: "POST",
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(2_000),
        });
        await response.body?.cancel();
        return {
            name: "management-session-cleanup",
            level: response.ok ? "ok" : "error",
            message: response.ok
                ? "诊断会话令牌已撤销"
                : `诊断会话令牌撤销失败: HTTP ${response.status}`,
        };
    } catch (error) {
        return failedManagementCheck("management-session-cleanup", "诊断会话清理", error);
    }
}

function failedManagementCheck(name: string, label: string, error: unknown): DoctorCheck {
    return {
        name,
        level: "error",
        message: `${label}探测失败: ${error instanceof Error ? error.message : String(error)}`,
    };
}

function stringConfigValue(value: unknown): string | undefined {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function managementWebSocketUrl(base: string): string {
    const url = new URL(base);
    url.pathname = "/";
    url.search = "";
    url.hash = "";
    return url.toString();
}

/** 使用 Node 内置 HTTP 客户端执行最小 WebSocket 握手，成功后立即销毁套接字。 */
export function probeWebSocketUpgrade(
    url: string,
    token?: string,
): Promise<DoctorWebSocketUpgradeResult> {
    return new Promise((resolve, reject) => {
        const headers: http.OutgoingHttpHeaders = {
            connection: "Upgrade",
            upgrade: "websocket",
            "sec-websocket-version": "13",
            "sec-websocket-key": randomBytes(16).toString("base64"),
        };
        if (token) headers.authorization = `Bearer ${token}`;
        const request = http.request(url, { headers });
        let settled = false;
        const finish = (result: DoctorWebSocketUpgradeResult) => {
            if (settled) return;
            settled = true;
            request.destroy();
            resolve(result);
        };
        request.once("upgrade", (response, socket) => {
            socket.destroy();
            finish({ upgraded: true, status: response.statusCode ?? 101 });
        });
        request.once("response", response => {
            response.resume();
            finish({ upgraded: false, status: response.statusCode ?? 0 });
        });
        request.once("error", error => {
            if (!settled) reject(error);
        });
        request.setTimeout(2_000, () => {
            request.destroy(new Error("WebSocket 握手超时"));
        });
        request.end();
    });
}
