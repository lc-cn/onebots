import type { ServerResponse } from "node:http";
import { ManagementStreamClients } from "./management-stream-clients.js";

export class VerificationManager {
    private static readonly TTL_MS = 30 * 60 * 1000;
    private static readonly MAX_PENDING = 20;

    private readonly streamClients = new ManagementStreamClients();
    public readonly pending: Map<string, { payload: Record<string, unknown>; createdAt: number }> =
        new Map();

    get clients(): Set<ServerResponse> {
        return this.streamClients.clients;
    }

    registerClient(client: ServerResponse, dispose: () => void): void {
        this.streamClients.register(client, dispose);
    }

    removeClient(client: ServerResponse): void {
        this.streamClients.remove(client);
    }

    disconnectClients(): unknown[] {
        return this.streamClients.disconnectAll();
    }

    private broadcast(payload: Record<string, unknown>) {
        const data = `data: ${JSON.stringify(payload)}\n\n`;
        for (const client of this.clients) {
            try {
                client.write(data);
            } catch {
                this.removeClient(client);
            }
        }
    }

    storeAndBroadcast(payload: Record<string, unknown>) {
        const platform = String(payload.platform ?? "");
        const account_id = String(payload.account_id ?? "");
        const type = String(payload.type ?? "");
        if (!platform || !account_id) return;

        const key = `${platform}:${account_id}:${type}`;
        if (this.pending.size >= VerificationManager.MAX_PENDING && !this.pending.has(key)) {
            let oldestKey: string | null = null;
            let oldestTime = Infinity;
            for (const [k, { createdAt: t }] of this.pending) {
                if (t < oldestTime) {
                    oldestTime = t;
                    oldestKey = k;
                }
            }
            if (oldestKey != null) this.pending.delete(oldestKey);
        }
        this.pending.set(key, { payload, createdAt: Date.now() });
        this.broadcast(payload);
    }

    clearAndBroadcast(payload: Record<string, unknown>) {
        const platform = String(payload.platform ?? "");
        const account_id = String(payload.account_id ?? "");
        const type = payload.type != null ? String(payload.type) : "";
        if (!platform || !account_id) return;

        if (type) {
            this.pending.delete(`${platform}:${account_id}:${type}`);
        } else {
            for (const key of [...this.pending.keys()]) {
                if (key.startsWith(`${platform}:${account_id}:`)) {
                    this.pending.delete(key);
                }
            }
        }
        this.broadcast({
            event: "clear",
            platform,
            account_id,
            ...(type ? { type } : {}),
        });
    }

    getPendingList(): Record<string, unknown>[] {
        const now = Date.now();
        const list: Record<string, unknown>[] = [];
        for (const [key, { payload, createdAt }] of this.pending) {
            if (now - createdAt <= VerificationManager.TTL_MS) {
                list.push(payload);
            } else {
                this.pending.delete(key);
            }
        }
        return list;
    }
}
