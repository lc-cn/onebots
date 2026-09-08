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
            if (!response.ok) throw new Error(data?.message ?? `控制请求失败 (${response.status})`);
            return data as T;
        },
    };
}
