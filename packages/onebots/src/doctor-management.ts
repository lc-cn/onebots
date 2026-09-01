import * as http from "node:http";
import { randomBytes } from "node:crypto";
import { assertAdapterCapabilities } from "@onebots/core";
import type { DoctorCheck, DoctorEndpointIdentity } from "./doctor.js";
import {
    acquireManagementCredential,
    revokeManagementSession,
    type ManagementFetch,
} from "./management-credential.js";
import { probeAuthenticatedExtensions } from "./doctor-management-extensions.js";
import { probeAuthenticatedCapabilityCatalog } from "./doctor-management-capability-catalog.js";
import { readDoctorManagementJson } from "./doctor-management-response.js";

type DoctorFetch = ManagementFetch;

export interface DoctorWebSocketUpgradeResult {
    upgraded: boolean;
    status: number;
}

export interface DoctorManagementProbeDependencies {
    fetcher?: DoctorFetch;
    upgrade?: (url: string, token?: string) => Promise<DoctorWebSocketUpgradeResult>;
    expectedIdentity?: DoctorEndpointIdentity;
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

    const anonymousHttpPromise = probeAnonymousManagementHttp(base, fetcher);
    const anonymousWebSocketPromise = probeAnonymousManagementWebSocket(websocketUrl, upgrade);
    const credential = await acquireManagementCredential(base, config, fetcher);
    const authenticatedPromise = credential.token
        ? Promise.all([
              probeAuthenticatedManagementHttp(base, credential.token, fetcher),
              probeAuthenticatedConfigState(base, credential.token, fetcher),
              probeAuthenticatedExtensions(base, credential.token, fetcher),
              probeAuthenticatedCapabilityCatalog(
                  base,
                  credential.token,
                  fetcher,
                  dependencies.expectedIdentity,
              ),
              probeAuthenticatedRuntime(base, credential.token, fetcher),
              probeAuthenticatedManagementWebSocket(websocketUrl, credential.token, upgrade),
          ])
        : null;
    const [anonymousHttp, anonymousWebSocket, authenticated] = await Promise.all([
        anonymousHttpPromise,
        anonymousWebSocketPromise,
        authenticatedPromise,
    ]);

    checks.push(anonymousHttp);
    if (credential.token) {
        const [
            authenticatedHttp,
            configState,
            extensions,
            capabilityCatalog,
            runtime,
            authenticatedWebSocket,
        ] = authenticated!;
        checks.push(authenticatedHttp, configState, extensions, capabilityCatalog, ...runtime);
        checks.push(anonymousWebSocket, authenticatedWebSocket);
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
            name: "management-extensions",
            level: "warning",
            message: "未获得管理令牌，无法验证磁盘扩展与在线进程加载版本是否一致",
        });
        checks.push({
            name: "management-capability-catalog",
            level: "warning",
            message: "未获得管理令牌，无法验证全平台能力目录",
        });
        checks.push({
            name: "management-runtime",
            level: "warning",
            message: "未获得管理令牌，无法定位账号与协议出口运行态",
        });
        checks.push({
            name: "management-capabilities",
            level: "warning",
            message: "未获得管理令牌，无法验证账号能力证据",
        });
        checks.push(anonymousWebSocket);
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
    capabilityDeclared?: unknown;
    capabilities?: unknown;
    accountCapabilities?: unknown;
    accountCapabilityErrors?: unknown;
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
        const payload = await readDoctorManagementJson(response);
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
): Promise<DoctorCheck[]> {
    try {
        const response = await fetcher(`${base}/api/adapters`, {
            headers: { authorization: `Bearer ${token}` },
            signal: AbortSignal.timeout(2_000),
        });
        const payload = await readDoctorManagementJson(response);
        if (!response.ok || !Array.isArray(payload)) {
            return unavailableRuntimeChecks(`管理运行态响应无效: HTTP ${response.status}`);
        }

        const issues: string[] = [];
        const capabilityIssues: string[] = [];
        const capabilityContractIssues: string[] = [];
        let accountCount = 0;
        let protocolCount = 0;
        for (const adapter of payload as RuntimeAdapterSummary[]) {
            if (!Array.isArray(adapter.accounts)) {
                return unavailableRuntimeChecks("管理运行态契约无效: 适配器缺少 accounts 数组");
            }
            const platform = runtimeLabel(adapter.platform, "unknown");
            if (typeof adapter.capabilityDeclared !== "boolean") {
                capabilityContractIssues.push(`${platform} 的 capabilityDeclared 必须是布尔值`);
            }
            if (adapter.capabilityDeclared === false) {
                capabilityIssues.push(`${platform}: 适配器默认能力清单未声明`);
            }
            inspectCapabilityManifest(
                `${platform} 默认能力清单`,
                adapter.capabilities,
                capabilityContractIssues,
            );
            const accountIds = new Set(
                (adapter.accounts as RuntimeAccountSummary[]).map(account =>
                    runtimeLabel(account.uin, "unknown"),
                ),
            );
            const overrideIds = inspectAccountCapabilityOverrides(
                platform,
                accountIds,
                adapter.accountCapabilities,
                capabilityContractIssues,
            );
            inspectCapabilityDiagnostics(
                platform,
                accountIds,
                adapter.accountCapabilityErrors,
                capabilityIssues,
                capabilityContractIssues,
                overrideIds,
            );
            for (const account of adapter.accounts as RuntimeAccountSummary[]) {
                accountCount++;
                const accountId = runtimeLabel(account.uin, "unknown");
                const accountTarget = `${platform}.${accountId}`;
                const accountStatus = runtimeLabel(account.status, "unknown");
                if (accountStatus !== "online") {
                    issues.push(`${accountTarget} 账号状态 ${accountStatus}`);
                }
                if (!Array.isArray(account.protocols)) {
                    return unavailableRuntimeChecks(
                        `管理运行态契约无效: ${accountTarget} 缺少 protocols 生命周期数组`,
                    );
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

        return [
            {
                name: "management-runtime",
                level: issues.length === 0 ? "ok" : "error",
                message:
                    issues.length === 0
                        ? `运行态已验证: ${accountCount} 个账号，${protocolCount} 个协议出口均就绪`
                        : `运行态未就绪: ${issues.join("；")}`,
            },
            capabilityDoctorCheck(
                payload.length,
                accountCount,
                capabilityIssues,
                capabilityContractIssues,
            ),
        ];
    } catch (error) {
        return [
            failedManagementCheck("management-runtime", "管理运行态", error),
            failedManagementCheck("management-capabilities", "账号能力证据", error),
        ];
    }
}

function inspectAccountCapabilityOverrides(
    platform: string,
    accountIds: ReadonlySet<string>,
    value: unknown,
    contractIssues: string[],
): ReadonlySet<string> {
    const overrideIds = new Set<string>();
    if (!isRecord(value)) {
        contractIssues.push(`${platform} 缺少 accountCapabilities 对象`);
        return overrideIds;
    }
    for (const [accountId, manifest] of Object.entries(value)) {
        overrideIds.add(accountId);
        if (!accountIds.has(accountId)) {
            contractIssues.push(`${platform}.${accountId} 的能力覆写不对应已配置账号`);
            continue;
        }
        inspectCapabilityManifest(
            `${platform}.${accountId} 账号能力清单`,
            manifest,
            contractIssues,
        );
    }
    return overrideIds;
}

function inspectCapabilityManifest(label: string, value: unknown, contractIssues: string[]): void {
    try {
        assertAdapterCapabilities(value);
    } catch (error) {
        const detail = error instanceof Error ? error.message : "未知结构错误";
        contractIssues.push(`${label}无效: ${detail.slice(0, 500)}`);
    }
}

function inspectCapabilityDiagnostics(
    platform: string,
    accountIds: ReadonlySet<string>,
    value: unknown,
    issues: string[],
    contractIssues: string[],
    overrideIds: ReadonlySet<string>,
): void {
    if (!isRecord(value)) {
        contractIssues.push(`${platform} 缺少 accountCapabilityErrors 对象`);
        return;
    }
    for (const [accountId, diagnostic] of Object.entries(value)) {
        if (!accountIds.has(accountId)) {
            contractIssues.push(`${platform}.${accountId} 不对应已配置账号`);
            continue;
        }
        if (
            !isRecord(diagnostic) ||
            diagnostic.code !== "capability_unavailable" ||
            typeof diagnostic.message !== "string" ||
            !diagnostic.message.trim()
        ) {
            contractIssues.push(`${platform}.${accountId} 诊断结构无效`);
            continue;
        }
        if (overrideIds.has(accountId)) {
            contractIssues.push(`${platform}.${accountId} 同时声明能力覆写和不可用诊断`);
            continue;
        }
        issues.push(`${platform}.${accountId}: ${diagnostic.message.trim().slice(0, 500)}`);
    }
}

function capabilityDoctorCheck(
    adapterCount: number,
    accountCount: number,
    issues: string[],
    contractIssues: string[],
): DoctorCheck {
    if (contractIssues.length > 0) {
        return {
            name: "management-capabilities",
            level: "error",
            message: `适配器能力契约无效: ${contractIssues.join("；")}`,
        };
    }
    return {
        name: "management-capabilities",
        level: issues.length === 0 ? "ok" : "error",
        message:
            issues.length === 0
                ? accountCount === 0
                    ? adapterCount === 0
                        ? "能力证据已验证: 当前未加载适配器，尚无账号能力可核对"
                        : `能力证据已验证: ${adapterCount} 个适配器默认清单有效，尚未配置账号`
                    : `能力证据已验证: ${adapterCount} 个适配器默认清单与 ${accountCount} 个账号能力均可信`
                : `账号能力证据不可用: ${issues.join("；")}`,
    };
}

function unavailableRuntimeChecks(message: string): DoctorCheck[] {
    return [
        { name: "management-runtime", level: "error", message },
        {
            name: "management-capabilities",
            level: "error",
            message: "账号能力证据无法验证: 管理运行态响应不可用",
        },
    ];
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
        const payload = (await readDoctorManagementJson(response)) as { success?: unknown };
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
    const result = await revokeManagementSession(base, token, fetcher);
    return {
        name: "management-session-cleanup",
        level: result.ok ? "ok" : "error",
        message: result.ok
            ? "诊断会话令牌已撤销"
            : result.error
              ? `诊断会话清理探测失败: ${result.error}`
              : `诊断会话令牌撤销失败: HTTP ${result.status ?? 0}`,
    };
}

function failedManagementCheck(name: string, label: string, error: unknown): DoctorCheck {
    return {
        name,
        level: "error",
        message: `${label}探测失败: ${error instanceof Error ? error.message : String(error)}`,
    };
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
