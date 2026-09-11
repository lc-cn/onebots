import { ControlLogClient } from "./control-logs.js";
export * from "./control-logs.js";
import { ControlVerificationClient } from "./control-verification.js";
export * from "./control-verification.js";
export { verificationJson, verificationRequest } from "./control-verification-json.js";
import type { ControlDiagnostics } from "./control-diagnostics.js";
export type { ControlDiagnostics } from "./control-diagnostics.js";
import type { ControlOperation, ControlStatus } from "./control-status.js";
export type { ControlOperation, ControlStatus } from "./control-status.js";
import {
    messageDebugHistory,
    clearMessageDebug,
    type ControlMessageDebugSnapshot,
    type ControlMessageDebugClearReceipt,
} from "./control-message-debug.js";
export type {
    ControlMessageDebugJson,
    ControlMessageDebugEntry,
    ControlMessageDebugSnapshot,
    ControlMessageDebugClearReceipt,
} from "./control-message-debug.js";
export {
    isControlMessageDebugEntry,
    isControlMessageDebugSnapshot,
    isControlMessageDebugClearReceipt,
} from "./control-message-debug.js";
import {
    revokeControlSession,
    listControlSessions,
    type ControlSession,
} from "./control-sessions.js";
export type { ControlSession } from "./control-sessions.js";
import type {
    ControlSendContext,
    ControlSendRequest,
    ControlSendOperation,
} from "./control-send.js";
import type { AdapterCapabilityManifest } from "./adapter-capability.js";
export type {
    ControlSendContext,
    ControlSendRequest,
    ControlSendOperation,
} from "./control-send.js";
export {
    isControlSendContext,
    isControlSendRequest,
    isControlSendOperation,
} from "./control-send.js";
export interface ControlTransport {
    request<T>(method: "GET" | "POST", route: string, body?: unknown): Promise<T>;
    /** Optional long-lived byte stream used by read-only control subscriptions. */
    stream?(route: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>>;
}

export class ControlRequestError extends Error {
    constructor(
        public readonly status: number,
        message: string,
    ) {
        super(message);
    }
}

export interface ControlConfigurationBase {
    generationId: string | null;
    configRevision: string;
}
export interface ControlConfigurationProjection {
    document: Record<string, unknown>;
    secretStates: Array<{ path: string[]; configured: boolean }>;
    unknownPaths: string[][];
}
export interface ControlConfigurationDraft extends ControlConfigurationProjection {
    mode?: "repair";
    id: string;
    revision: string;
    base: ControlConfigurationBase;
}
export interface ControlConfigurationSnapshot extends ControlConfigurationProjection {
    base: ControlConfigurationBase;
    schemas: Record<string, unknown>;
}
export type ControlConfigurationChange =
    | { op: "set"; path: string[]; value: unknown }
    | { op: "remove"; path: string[] };
export type ControlSecretChange =
    | { op: "set"; path: string[]; value: unknown }
    | { op: "keep" | "clear"; path: string[] };
export interface ControlConfigurationValidation {
    valid: boolean;
    issues: Array<{ path: string[]; message: string }>;
    receiptId?: string;
    draftRevision: string;
}
export interface ControlConfigurationOperation {
    id: string;
    validationId: string;
    status: "running" | "succeeded" | "failed" | "interrupted";
    phase: "accepted" | "stopping" | "writing" | "starting" | "restoring" | "completed" | "failed";
    recoveryRequired: boolean;
    rolledBack?: boolean;
    sourceState?: "damaged";
    configRevision?: string;
    error?: string;
}

export interface ControlExtensionSelection {
    adapters: string[];
    protocols: string[];
    applications: string[];
}

export interface ControlInstallPlan {
    id: string;
    planDigest: string;
    baseGenerationId: string | null;
    selection: ControlExtensionSelection;
    removed: ControlExtensionSelection;
    packages: Array<{ name: string; version: string }>;
    peers: Array<{ requestedBy: string; packageName: string; range: string }>;
    recommendations: string[];
}

export interface ControlUpdatePlan {
    state: "current" | "updates_available";
    base: ControlConfigurationBase;
    packages: Array<{ name: string; current: string | null; target: string }>;
    peers: Array<{ requestedBy: string; packageName: string; range: string }>;
    recommendations: string[];
    installationPlan?: ControlInstallPlan;
}

export interface ControlInstallationCatalog {
    activeGenerationId: string | null;
    selection: ControlExtensionSelection;
    adapters: ControlAdapterCatalogEntry[];
    protocols: Array<{ name: string; displayName: string; version: string }>;
    applications: Array<{ name: string; displayName: string }>;
}

export interface ControlExtensionSetupStep {
    title: string;
    description: string;
    url?: string;
}

export interface ControlExtensionInstallRequirement {
    kind: "registry-authentication";
    title: string;
    description: string;
    scope: string;
    permission: string;
}

export interface ControlCapabilityCategorySummary {
    total: number;
    supported: number;
    native: number;
    emulated: number;
    unsupported: number;
}

export interface ControlAdapterCatalogEntry {
    name: string;
    displayName: string;
    version: string;
    /** 以下产品信息由支持富目录的管理服务提供；旧服务仍可返回基础三字段条目。 */
    description?: string;
    packageName?: string;
    setup?: ControlExtensionSetupStep[];
    requirements?: ControlExtensionInstallRequirement[];
    peerDependencies?: Array<{ packageName: string; range: string }>;
    capabilitySnapshot?: {
        packageVersion: string;
        summary: Record<
            "actions" | "events" | "segments" | "transports",
            ControlCapabilityCategorySummary
        >;
        manifest: AdapterCapabilityManifest;
    };
}

export interface ControlInstallOperation {
    schemaVersion: 1;
    id: string;
    planDigest: string;
    phase: "queued" | "downloading" | "verifying" | "verified" | "failed" | "interrupted";
    candidateId?: string;
    createdAt: string;
    finishedAt?: string;
    error?: string;
}

export interface ControlGenerationActivation {
    id: string;
    status: "running" | "succeeded" | "failed";
    phase: "accepted" | "stopping" | "starting" | "restoring" | "completed" | "failed";
    target: { id: string; planDigest: string };
    previous: { id: string; planDigest: string } | null;
    desiredBefore: "running" | "stopped";
    startedAt: string;
    finishedAt?: string;
    error?: string;
    rolledBack?: boolean;
    sourceState?: "damaged";
}

export class ControlClient {
    readonly logs: ControlLogClient;
    readonly verification: ControlVerificationClient;
    constructor(private readonly transport: ControlTransport) {
        this.logs = new ControlLogClient(transport);
        this.verification = new ControlVerificationClient(transport);
    }

    openMcp(account?: string): Promise<{ id: string; gatewayInstanceId: string }> {
        return this.transport.request("POST", "/api/control/mcp/open", { account });
    }

    exchangeMcp(id: string, message: string): Promise<{ message: string | null }> {
        return this.transport.request("POST", "/api/control/mcp/exchange", { id, message });
    }

    pollMcp(id: string): Promise<{ events: string[] }> {
        return this.transport.request("POST", "/api/control/mcp/poll", { id });
    }

    closeMcp(id: string): Promise<{ closed: true }> {
        return this.transport.request("POST", "/api/control/mcp/close", { id });
    }

    configurationSnapshot(): Promise<ControlConfigurationSnapshot> {
        return this.transport.request("GET", "/api/control/configuration");
    }
    reconcileConfiguration(
        id: string,
        expectedRevision: string,
    ): Promise<ControlConfigurationOperation> {
        return this.transport.request("POST", "/api/control/configuration/reconcile", {
            id,
            expectedRevision,
        });
    }
    configurationSource(): Promise<{
        state: "ready" | "damaged";
        base: ControlConfigurationBase;
        reason?: "INVALID_YAML";
        repairAvailable?: boolean;
    }> {
        return this.transport.request("GET", "/api/control/configuration/source");
    }
    createConfigurationRepairDraft(
        base: ControlConfigurationBase,
    ): Promise<{ draft: ControlConfigurationDraft; schemas: Record<string, unknown> }> {
        return this.transport.request("POST", "/api/control/configuration/repair-drafts", {
            base,
            strategy: "new-empty",
        });
    }
    configurationDraftContext(
        id: string,
    ): Promise<{ draft: ControlConfigurationDraft; schemas: Record<string, unknown> }> {
        return this.transport.request(
            "GET",
            `/api/control/configuration/drafts/${encodeURIComponent(id)}/context`,
        );
    }
    createConfigurationDraft(base: ControlConfigurationBase): Promise<ControlConfigurationDraft> {
        return this.transport.request("POST", "/api/control/configuration/drafts", { base });
    }
    configurationDraft(id: string): Promise<ControlConfigurationDraft> {
        return this.transport.request(
            "GET",
            `/api/control/configuration/drafts/${encodeURIComponent(id)}`,
        );
    }
    editConfigurationDraft(
        id: string,
        request: {
            expectedRevision: string;
            changes: ControlConfigurationChange[];
            secrets: ControlSecretChange[];
        },
    ): Promise<ControlConfigurationDraft> {
        return this.transport.request(
            "POST",
            `/api/control/configuration/drafts/${encodeURIComponent(id)}/edit`,
            request,
        );
    }
    addConfigurationAccount(
        id: string,
        request: { expectedRevision: string; platform: string; accountId: string },
    ): Promise<ControlConfigurationDraft> {
        return this.transport.request(
            "POST",
            `/api/control/configuration/drafts/${encodeURIComponent(id)}/accounts`,
            request,
        );
    }
    removeConfigurationAccount(
        id: string,
        request: { expectedRevision: string; accountKey: string },
    ): Promise<ControlConfigurationDraft> {
        return this.transport.request(
            "POST",
            `/api/control/configuration/drafts/${encodeURIComponent(id)}/remove-account`,
            request,
        );
    }
    setConfigurationProtocol(
        id: string,
        request: {
            expectedRevision: string;
            accountKey: string | null;
            protocol: string;
            enabled: boolean;
        },
    ): Promise<ControlConfigurationDraft> {
        return this.transport.request(
            "POST",
            `/api/control/configuration/drafts/${encodeURIComponent(id)}/protocol`,
            request,
        );
    }
    editConfigurationList(
        id: string,
        request: {
            expectedRevision: string;
            path: string[];
            action: "append" | "remove";
            index?: number;
        },
    ): Promise<ControlConfigurationDraft> {
        return this.transport.request(
            "POST",
            `/api/control/configuration/drafts/${encodeURIComponent(id)}/list`,
            request,
        );
    }
    validateConfigurationDraft(
        id: string,
        expectedRevision: string,
    ): Promise<ControlConfigurationValidation> {
        return this.transport.request(
            "POST",
            `/api/control/configuration/drafts/${encodeURIComponent(id)}/validate`,
            { expectedRevision },
        );
    }
    applyConfiguration(id: string, receiptId: string): Promise<ControlConfigurationOperation> {
        return this.transport.request("POST", "/api/control/configuration/apply", {
            id,
            receiptId,
        });
    }
    configurationOperation(id: string): Promise<ControlConfigurationOperation> {
        return this.transport.request(
            "GET",
            `/api/control/configuration/operations/${encodeURIComponent(id)}`,
        );
    }

    diagnostics(): Promise<ControlDiagnostics> {
        return this.transport.request("GET", "/api/control/diagnostics");
    }

    status(): Promise<ControlStatus> {
        return this.transport.request("GET", "/api/control/status");
    }

    gateway(action: "start" | "stop" | "restart"): Promise<ControlOperation> {
        return this.transport.request("POST", `/api/control/gateway/${action}`, {});
    }

    messageDebugHistory(): Promise<ControlMessageDebugSnapshot> {
        return messageDebugHistory(this.transport);
    }

    clearMessageDebug(expectedGatewayInstanceId: string): Promise<ControlMessageDebugClearReceipt> {
        return clearMessageDebug(this.transport, expectedGatewayInstanceId);
    }

    sendContext(): Promise<ControlSendContext> {
        return this.transport.request("GET", "/api/control/messages/context");
    }

    sendMessage(request: ControlSendRequest): Promise<ControlSendOperation> {
        return this.transport.request("POST", "/api/control/messages/send", request);
    }

    sendOperation(id: string): Promise<ControlSendOperation> {
        return this.transport.request(
            "GET",
            `/api/control/messages/operations/${encodeURIComponent(id)}`,
        );
    }

    bootstrap(): Promise<{ code: string }> {
        return this.transport.request("POST", "/api/control/auth/bootstrap", {});
    }

    /** 仅受本地权限保护的控制连接可签发恢复码，HTTP 传输将被拒绝。 */
    recoverAuthentication(): Promise<{ code: string }> {
        return this.transport.request("POST", "/api/control/auth/recovery", {});
    }

    /** 本机签发追加设备码，不撤销其他浏览器。 */
    authorizeDevice(): Promise<{ code: string }> {
        return this.transport.request("POST", "/api/control/auth/device", {});
    }

    sessions(): Promise<{ sessions: ControlSession[] }> {
        return listControlSessions(this.transport);
    }

    revokeSession(id: string): Promise<{ revoked: true }> {
        return revokeControlSession(this.transport, id);
    }

    pair(code: string): Promise<{ token: string }> {
        return this.transport.request("POST", "/api/control/auth/pair", { code });
    }

    /** 撤销当前浏览器会话；传输失败时不得假定撤销成功。 */
    async logout(): Promise<void> {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const result: unknown = await Promise.race([
                this.transport.request("POST", "/api/control/auth/logout", {}),
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => reject(new Error("会话撤销结果未确认")), 15_000);
                }),
            ]);
            if (
                !result ||
                typeof result !== "object" ||
                Array.isArray(result) ||
                Object.keys(result).length !== 1 ||
                !("loggedOut" in result) ||
                result.loggedOut !== true
            )
                throw new Error("会话撤销结果未确认");
        } finally {
            if (timer !== undefined) clearTimeout(timer);
        }
    }

    planUpdate(expected: ControlConfigurationBase): Promise<ControlUpdatePlan> {
        return this.transport.request("POST", "/api/control/updates/plan", { expected });
    }

    planInstallation(
        selection: ControlExtensionSelection,
        expectedGenerationId: string | null,
    ): Promise<ControlInstallPlan> {
        return this.transport.request("POST", "/api/control/installations/plan", {
            selection,
            expectedGenerationId,
        });
    }

    installationCatalog(): Promise<ControlInstallationCatalog> {
        return this.transport.request("GET", "/api/control/installations/catalog");
    }

    install(request: {
        id: string;
        planId: string;
        token?: string;
    }): Promise<ControlInstallOperation> {
        return this.transport.request("POST", "/api/control/installations", request);
    }

    installation(id: string): Promise<ControlInstallOperation> {
        return this.transport.request(
            "GET",
            `/api/control/installations/${encodeURIComponent(id)}`,
        );
    }

    cancelInstallation(id: string): Promise<ControlInstallOperation> {
        return this.transport.request(
            "POST",
            `/api/control/installations/${encodeURIComponent(id)}/cancel`,
            {},
        );
    }

    activateGeneration(id: string): Promise<ControlGenerationActivation> {
        return this.transport.request(
            "POST",
            `/api/control/generations/${encodeURIComponent(id)}/activate`,
            {},
        );
    }
}

export function createHttpControlTransport(
    baseUrl: string,
    token: () => string,
    fetcher: typeof fetch = fetch,
): ControlTransport {
    return {
        async request<T>(method: "GET" | "POST", route: string, body?: unknown): Promise<T> {
            const response = await fetcher(`${baseUrl.replace(/\/$/, "")}${route}`, {
                method,
                headers: { "Content-Type": "application/json", Authorization: `Bearer ${token()}` },
                body: body === undefined ? undefined : JSON.stringify(body),
                cache: "no-store",
                redirect: "error",
                signal:
                    (method === "POST" &&
                        ["/api/control/auth/logout", "/api/control/auth/sessions/revoke"].includes(
                            route,
                        )) ||
                    (method === "GET" && route === "/api/control/auth/sessions")
                        ? AbortSignal.timeout(15_000)
                        : undefined,
            });
            const data = await response.json();
            if (!response.ok)
                throw new ControlRequestError(
                    response.status,
                    data?.message ?? `控制请求失败 (${response.status})`,
                );
            return data as T;
        },
        async stream(route: string, signal: AbortSignal): Promise<ReadableStream<Uint8Array>> {
            const response = await fetcher(`${baseUrl.replace(/\/$/, "")}${route}`, {
                method: "GET",
                headers: { Authorization: `Bearer ${token()}` },
                cache: "no-store",
                redirect: "error",
                signal,
            });
            if (!response.ok || !response.body) {
                let message = `控制请求失败 (${response.status})`;
                try {
                    const data: unknown = await response.json();
                    if (
                        data &&
                        typeof data === "object" &&
                        "message" in data &&
                        typeof data.message === "string"
                    )
                        message = data.message;
                } catch {
                    // 非 JSON 错误响应只返回固定状态，不暴露服务端正文。
                }
                throw new ControlRequestError(response.status, message);
            }
            if (!(response.headers.get("content-type") ?? "").startsWith("text/event-stream")) {
                await response.body.cancel();
                throw new ControlRequestError(response.status, "控制流响应格式无效");
            }
            return response.body;
        },
    };
}
