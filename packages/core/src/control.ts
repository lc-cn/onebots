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
    action: "start" | "stop" | "restart" | "shutdown" | "reconcile";
    status: "running" | "succeeded" | "failed";
    startedAt: string;
    finishedAt?: string;
    error?: string;
}

export interface ControlTransport {
    request<T>(method: "GET" | "POST", route: string, body?: unknown): Promise<T>;
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
