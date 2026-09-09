import { Buffer } from "node:buffer";
import type { MessageDebugClearReceipt, MessageDebugEntry } from "../message-debug.js";
import { isGatewayMessageDebugEntry } from "./message-debug-contracts.js";

const MAX_ENTRIES = 300;
const MAX_ENTRY_BYTES = 16 * 1024;

/** 网关内的调试旁路；仅保存有界 JSON 快照，不持有业务对象或连接。 */
export class GatewayMessageDebugStore {
    private readonly entries: string[] = [];
    private seq = 0;

    recordInbound(platform: string, account_id: string, payload: unknown): void {
        this.push({ direction: "inbound", platform, account_id, payload });
    }

    recordOutbound(
        platform: string,
        account_id: string,
        protocol: string,
        version: string,
        payload: unknown,
    ): void {
        this.push({ direction: "outbound", platform, account_id, protocol, version, payload });
    }

    getHistory(): MessageDebugEntry[] {
        return this.entries.map(entry => JSON.parse(entry) as MessageDebugEntry);
    }

    clear(): MessageDebugClearReceipt {
        const receipt = { clearedCount: this.entries.length, clearedThroughSeq: this.seq };
        this.entries.length = 0;
        return receipt;
    }

    private push(input: Omit<MessageDebugEntry, "seq" | "time">): void {
        const entry: MessageDebugEntry = { ...input, seq: ++this.seq, time: Date.now() };
        let serialized: string;
        try {
            // 先序列化 payload，避免 undefined/function 等顶层值被悄悄丢弃。
            const payload = JSON.stringify(input.payload);
            if (payload === undefined) throw new Error("调试数据不是 JSON 值");
            entry.payload = JSON.parse(payload) as unknown;
            serialized = JSON.stringify(entry);
        } catch {
            // 不读取异常对象；getter/toJSON 可抛出任意值，调试失败不得打断消息分发。
            entry.payload = { debugUnavailable: true, reason: "消息无法序列化为 JSON" };
            serialized = JSON.stringify(entry);
        }
        if (Buffer.byteLength(serialized, "utf8") > MAX_ENTRY_BYTES) {
            entry.payload = { debugUnavailable: true, reason: "消息超过 16 KiB 调试记录上限" };
            // 标识本身也可能过长；限制它们保证整个记录而不仅是 payload 有界。
            entry.platform = entry.platform.slice(0, 256);
            entry.account_id = entry.account_id.slice(0, 256);
            if (entry.protocol !== undefined) entry.protocol = entry.protocol.slice(0, 256);
            if (entry.version !== undefined) entry.version = entry.version.slice(0, 256);
            serialized = JSON.stringify(entry);
        }
        if (!isGatewayMessageDebugEntry(JSON.parse(serialized))) {
            entry.payload = { debugUnavailable: true, reason: "消息超过调试传输结构限制" };
            serialized = JSON.stringify(entry);
        }
        this.entries.push(serialized);
        if (this.entries.length > MAX_ENTRIES) this.entries.shift();
    }
}
