/** 无服务器或插件依赖的控制契约，CLI/TUI/Web 共用此入口。 */
export interface ControlStatus {
    schemaVersion: 1;
    manager: { id: string; version: string };
    gateway: {
        desired: "running" | "stopped";
        actual: "starting" | "running" | "stopping" | "stopped" | "failed";
        instance?: { id: string };
        recoveryRequired: boolean;
        error?: string;
        operations: ControlOperation[];
    };
}

export interface ControlOperation {
    id: string;
    action: "start" | "stop" | "restart" | "shutdown" | "reconcile" | "suspend";
    status: "running" | "succeeded" | "failed";
    startedAt: string;
    finishedAt?: string;
    error?: string;
}

export interface ControlTransport {
    request<T>(method: "GET" | "POST", route: string, body?: unknown): Promise<T>;
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
    packages: Array<{ name: string; version: string }>;
    peers: Array<{ requestedBy: string; packageName: string; range: string }>;
    recommendations: string[];
}

export interface ControlInstallationCatalog {
    activeGenerationId: string | null;
    selection: ControlExtensionSelection;
    adapters: Array<{ name: string; displayName: string; version: string }>;
    protocols: Array<{ name: string; displayName: string; version: string }>;
    applications: Array<{ name: string; displayName: string }>;
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
}

export class ControlClient {
    constructor(private readonly transport: ControlTransport) {}

    configurationSnapshot(): Promise<ControlConfigurationSnapshot> {
        return this.transport.request("GET", "/api/control/configuration");
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

    status(): Promise<ControlStatus> {
        return this.transport.request("GET", "/api/control/status");
    }

    gateway(action: "start" | "stop" | "restart"): Promise<ControlOperation> {
        return this.transport.request("POST", `/api/control/gateway/${action}`, {});
    }

    bootstrap(): Promise<{ code: string }> {
        return this.transport.request("POST", "/api/control/auth/bootstrap", {});
    }

    pair(code: string): Promise<{ token: string }> {
        return this.transport.request("POST", "/api/control/auth/pair", { code });
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
            });
            const data = await response.json();
            if (!response.ok)
                throw new ControlRequestError(
                    response.status,
                    data?.message ?? `控制请求失败 (${response.status})`,
                );
            return data as T;
        },
    };
}
