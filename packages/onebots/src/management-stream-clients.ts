import type { ServerResponse } from "node:http";

/** 管理 SSE 客户端的统一注册表，确保定时器与响应在撤销时一起释放。 */
export class ManagementStreamClients {
    public readonly clients = new Set<ServerResponse>();
    private readonly disposers = new Map<ServerResponse, () => void>();

    register(client: ServerResponse, dispose: () => void): void {
        this.clients.add(client);
        this.disposers.set(client, dispose);
    }

    remove(client: ServerResponse): void {
        const dispose = this.disposers.get(client);
        this.disposers.delete(client);
        this.clients.delete(client);
        try {
            dispose?.();
        } catch {
            // 单个已断开连接的清理失败不能影响其他客户端。
        }
    }

    disconnectAll(): unknown[] {
        const failures: unknown[] = [];
        for (const client of [...this.clients]) {
            const dispose = this.disposers.get(client);
            this.disposers.delete(client);
            this.clients.delete(client);
            try {
                dispose?.();
            } catch (error) {
                failures.push(error);
            }
            try {
                client.end();
            } catch (error) {
                failures.push(error);
            }
        }
        return failures;
    }
}
