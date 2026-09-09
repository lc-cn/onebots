import { ServiceOperationStorage, canonicalServiceJson } from "../service-operation-storage.js";
import {
    observeNamedPersistedOperation,
    type PersistedOperationObserver,
} from "../persisted-operation-observer.js";
import { ControlSendError, parseSendRecord, sendId, type SendRecord } from "./send-contracts.js";
/** 唯一持有工作区锁的manager使用；任何存储失败仅封锁发送域，不阻止管理端启动。 */
export class ControlSendStore {
    private storage?: ServiceOperationStorage;
    private blocked = false;
    private readonly uncertain = new Map<string, SendRecord>();
    constructor(
        directory: string,
        private readonly onOperation?: PersistedOperationObserver,
    ) {
        try {
            this.storage = new ServiceOperationStorage(directory);
            for (const name of this.storage.list()) {
                const record = this.read(name.slice(0, -5));
                if (record.status === "running") {
                    const unknown = {
                        ...record,
                        status: "unknown" as const,
                        finishedAt: new Date().toISOString(),
                    };
                    this.uncertain.set(record.id, unknown);
                    this.storage.write(name, unknown);
                    this.uncertain.delete(record.id);
                    this.observe(unknown);
                }
            }
        } catch {
            this.blocked = true;
        }
    }
    health() {
        return { available: !this.blocked && Boolean(this.storage) };
    }
    read(id: string): SendRecord {
        if (!sendId(id)) throw new ControlSendError(400);
        if (!this.storage) throw new ControlSendError(503);
        try {
            if (!this.storage.has(`${id}.json`)) throw new ControlSendError(404);
            const value = parseSendRecord(this.storage.read(`${id}.json`));
            if (value.id !== id) throw new Error();
            return structuredClone(this.uncertain.get(id) ?? value);
        } catch (error) {
            if (error instanceof ControlSendError && error.httpStatus === 404) throw error;
            this.blocked = true;
            throw new ControlSendError(503);
        }
    }
    create(record: SendRecord): void {
        if (this.blocked || !this.storage) throw new ControlSendError(503);
        try {
            const names = this.storage.list();
            for (const name of names) this.read(name.slice(0, -5));
            if (names.length >= 10000) throw new ControlSendError(429);
            this.storage.write(`${record.id}.json`, parseSendRecord(record), true);
            this.observe(record);
        } catch (error) {
            if (error instanceof ControlSendError && error.httpStatus === 429) throw error;
            this.blocked = true;
            throw new ControlSendError(503);
        }
    }
    finish(record: SendRecord): void {
        const value = parseSendRecord(record);
        try {
            if (this.blocked || !this.storage) throw new Error();
            const previous = this.read(record.id);
            const immutable = (item: SendRecord) => ({
                id: item.id,
                ownerHash: item.ownerHash,
                requestDigest: item.requestDigest,
                gatewayInstanceId: item.gatewayInstanceId,
                configVersion: item.configVersion,
                startedAt: item.startedAt,
            });
            if (
                previous.status !== "running" ||
                value.status === "running" ||
                canonicalServiceJson(immutable(previous)) !== canonicalServiceJson(immutable(value))
            )
                throw new Error();
            this.storage.write(`${value.id}.json`, value);
            this.observe(value);
        } catch {
            this.blocked = true;
            const { messageId: _messageId, ...safe } = value;
            this.uncertain.set(value.id, {
                ...safe,
                status: "unknown",
                finishedAt: new Date().toISOString(),
            });
            throw new ControlSendError(503);
        }
    }
    private observe(record: SendRecord): void {
        observeNamedPersistedOperation(this.onOperation, "message.send", {
            id: record.id,
            status: record.status,
            ...(record.finishedAt ? { finishedAt: record.finishedAt } : {}),
        });
    }
}
