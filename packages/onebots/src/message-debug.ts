import type { ServerResponse } from "node:http";
import { ManagementStreamClients } from "./management-stream-clients.js";

export interface MessageDebugEntry {
    /** 单调递增序号，供前端去重/排序 */
    seq: number;
    /** 记录时间（毫秒） */
    time: number;
    /** inbound：适配器收到的原始 CommonEvent；outbound：协议转换后发往客户端的数据 */
    direction: "inbound" | "outbound";
    platform: string;
    account_id: string;
    /** outbound 时为协议名（如 onebot），inbound 为空 */
    protocol?: string;
    /** outbound 时为协议版本（如 v11），inbound 为空 */
    version?: string;
    /** inbound 为 CommonEvent 对象；outbound 为协议 dispatch 抛出的 JSON 字符串或对象 */
    payload: unknown;
}

export class MessageDebugManager {
    private static readonly MAX_ENTRIES = 300;

    private readonly streamClients = new ManagementStreamClients();
    private readonly entries: MessageDebugEntry[] = [];
    private seq = 0;

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

    private broadcast(entry: MessageDebugEntry) {
        if (this.clients.size === 0) return;
        let data: string;
        try {
            data = `data: ${JSON.stringify(entry)}\n\n`;
        } catch {
            // entry.payload 可能带有 BigInt / 循环引用等无法直接序列化的字段；
            // 这是调试旁路功能，序列化失败绝不能影响真正的消息分发。
            return;
        }
        for (const client of this.clients) {
            try {
                client.write(data);
            } catch {
                this.removeClient(client);
            }
        }
    }

    private push(entry: Omit<MessageDebugEntry, "seq" | "time">) {
        const full: MessageDebugEntry = { ...entry, seq: ++this.seq, time: Date.now() };
        this.entries.push(full);
        if (this.entries.length > MessageDebugManager.MAX_ENTRIES) {
            this.entries.shift();
        }
        this.broadcast(full);
    }

    recordInbound(platform: string, account_id: string, payload: unknown) {
        this.push({ direction: "inbound", platform, account_id, payload });
    }

    recordOutbound(
        platform: string,
        account_id: string,
        protocol: string,
        version: string,
        payload: unknown,
    ) {
        this.push({ direction: "outbound", platform, account_id, protocol, version, payload });
    }

    getHistory(): MessageDebugEntry[] {
        return this.entries.slice();
    }

    clear() {
        this.entries.length = 0;
    }
}
