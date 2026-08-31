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
        checks.push(await probeAuthenticatedConfigState(base, credential.token, fetcher));
        checks.push(await probeAuthenticatedRuntime(base, credential.token, fetcher));
    } else {
        checks.push({
            name: "management-http-authenticated",
            level: credential.error ? "error" : "warning",
            message:
                credential.error ?? "配置未提供 access_token 或用户名/密码，无法验证合法管理凭据",
        });
        checks.push({
            name: "management-config",
            level: "warning",
            message: "未获得管理令牌，无法验证在线进程是否已应用当前磁盘配置",
        });
        checks.push({
            name: "management-runtime",
            level: "warning",
            message: "未获得管理令牌，无法定位账号与协议出口运行态",
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

interface RuntimeProtocolSummary {
    name?: unknown;
    version?: unknown;
    lifecycleStatus?: unknown;
}

interface RuntimeAccountSummary {
    uin?: unknown;
    status?: unknown;
    protocols?: unknown;
}

interface RuntimeAdapterSummary {
    platform?: unknown;
    accounts?: unknown;
}

/** 对比在线进程保留的应用快照与它当前看到的磁盘配置。 */
async function probeAuthenticatedConfigState(
    base: string,
    token: string,
    fetcher: DoctorFetch,
): Promise<DoctorCheck> {
    try {
        const response = await fetcher(`${base}/api/system`, {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(2_000),
        });
        const payload: unknown = await response.json();
        if (!response.ok || !isRecord(payload) || !isRecord(payload.configState)) {
            return {
                name: "management-config",
                level: "error",
                message: `在线配置状态响应无效: HTTP ${response.status}`,
            };
        }
        const status = payload.configState.status;
        const appliedAt = runtimeLabel(payload.configState.appliedAt, "未知时间");
        if (status === "in_sync") {
            return {
                name: "management-config",
                level: "ok",
                message: `在线进程已应用当前磁盘配置（应用时间 ${appliedAt}）`,
            };
        }
        if (status === "drifted") {
            return {
                name: "management-config",
                level: "error",
                message: `磁盘配置与在线进程已应用的版本不一致（应用时间 ${appliedAt}）；请重新加载或重启`,
            };
        }
        if (status === "unavailable") {
            return {
                name: "management-config",
                level: "error",
                message: "在线进程无法读取配置快照或当前磁盘配置",
            };
        }
        return {
            name: "management-config",
            level: "error",
            message: "在线配置状态契约无效: status 未知",
        };
    } catch (error) {
        return failedManagementCheck("management-config", "在线配置状态", error);
    }
}

/** 通过受保护的管理 API 定位公开 readiness 聚合背后的具体故障出口。 */
async function probeAuthenticatedRuntime(
    base: string,
    token: string,
    fetcher: DoctorFetch,
): Promise<DoctorCheck> {
    try {
        const response = await fetcher(`${base}/api/adapters`, {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(2_000),
        });
        const payload: unknown = await response.json();
        if (!response.ok || !Array.isArray(payload)) {
            return {
                name: "management-runtime",
                level: "error",
                message: `管理运行态响应无效: HTTP ${response.status}`,
            };
        }

        const issues: string[] = [];
        let accountCount = 0;
        let protocolCount = 0;
        for (const adapter of payload as RuntimeAdapterSummary[]) {
            if (!Array.isArray(adapter.accounts)) {
                return invalidRuntimeContract("适配器缺少 accounts 数组");
            }
            const platform = runtimeLabel(adapter.platform, "unknown");
            for (const account of adapter.accounts as RuntimeAccountSummary[]) {
                accountCount++;
                const accountId = runtimeLabel(account.uin, "unknown");
                const accountTarget = `${platform}.${accountId}`;
                const accountStatus = runtimeLabel(account.status, "unknown");
                if (accountStatus !== "online") {
                    issues.push(`${accountTarget} 账号状态 ${accountStatus}`);
                }
                if (!Array.isArray(account.protocols)) {
                    return invalidRuntimeContract(`${accountTarget} 缺少 protocols 生命周期数组`);
                }
                if (account.protocols.length === 0) {
                    issues.push(`${accountTarget} 无协议出口`);
                }
                for (const protocol of account.protocols as RuntimeProtocolSummary[]) {
                    protocolCount++;
                    const name = runtimeLabel(protocol.name, "unknown");
                    const version = runtimeLabel(protocol.version, "unknown");
                    const status = runtimeLabel(protocol.lifecycleStatus, "unknown");
                    if (status !== "ready") {
                        issues.push(`${accountTarget}/${name}.${version} 协议状态 ${status}`);
                    }
                }
            }
        }

        return {
            name: "management-runtime",
            level: issues.length === 0 ? "ok" : "error",
            message:
                issues.length === 0
                    ? `运行态已验证: ${accountCount} 个账号，${protocolCount} 个协议出口均就绪`
                    : `运行态未就绪: ${issues.join("；")}`,
        };
    } catch (error) {
        return failedManagementCheck("management-runtime", "管理运行态", error);
    }
}

function invalidRuntimeContract(detail: string): DoctorCheck {
    return {
        name: "management-runtime",
        level: "error",
        message: `管理运行态契约无效: ${detail}`,
    };
}

function runtimeLabel(value: unknown, fallback: string): string {
    return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
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
        stringConfigValue(process.env.ONEBOTS_ACCESS_TOKEN) ??
        stringConfigValue(config.access_token);
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
        const timeout = setTimeout(() => {
            request.destroy(new Error("WebSocket 握手超时"));
        }, 2_000);
        const finish = (result: DoctorWebSocketUpgradeResult) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            request.destroy();
            resolve(result);
        };
        const fail = (error: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            reject(error);
        };
        request.once("upgrade", (response, socket) => {
            socket.destroy();
            finish({ upgraded: true, status: response.statusCode ?? 101 });
        });
        request.once("response", response => {
            response.resume();
            finish({ upgraded: false, status: response.statusCode ?? 0 });
        });
        request.once("error", fail);
        request.once("close", () => {
            if (!settled) fail(new Error("WebSocket 握手在收到响应前关闭"));
        });
        request.end();
    });
}
