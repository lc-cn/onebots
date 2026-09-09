import { types } from "node:util";
import type { ControlVerificationAbandonment } from "@onebots/core/control";
import { closedServiceObject, ServiceOperationStorage } from "../service-operation-storage.js";
import {
    ControlVerificationError,
    verificationHash,
    verificationId,
} from "./verification-record.js";

interface AbandonmentRecord extends ControlVerificationAbandonment {
    schemaVersion: 1;
    ownerHash: string;
}
/** 与验证回执使用相同密钥身份；封存编号不能再成为执行意图。 */
export class VerificationAbandonmentStore {
    private readonly storage: ServiceOperationStorage;
    constructor(
        directory: string,
        private readonly fingerprint: () => string,
    ) {
        this.storage = new ServiceOperationStorage(directory);
    }
    list(): string[] {
        return this.storage.list();
    }
    read(id: string): AbandonmentRecord {
        if (!verificationId(id)) throw new ControlVerificationError(400);
        if (!this.storage.has(`${id}.json`)) throw new ControlVerificationError(404);
        const envelope = closedServiceObject(this.storage.read(`${id}.json`), [
            "keyFingerprint",
            "record",
        ]);
        if (
            !envelope.record ||
            typeof envelope.record !== "object" ||
            types.isProxy(envelope.record)
        )
            throw new Error("封存记录无效");
        const record = closedServiceObject(envelope.record, [
            "schemaVersion",
            "id",
            "ownerHash",
            "abandonedAt",
        ]);
        if (
            envelope.keyFingerprint !== this.fingerprint() ||
            record.schemaVersion !== 1 ||
            record.id !== id ||
            !verificationHash(record.ownerHash) ||
            typeof record.abandonedAt !== "string" ||
            !Number.isFinite(Date.parse(record.abandonedAt)) ||
            new Date(record.abandonedAt).toISOString() !== record.abandonedAt
        )
            throw new Error("封存记录无效");
        return record as unknown as AbandonmentRecord;
    }
    has(id: string): boolean {
        try {
            this.read(id);
            return true;
        } catch (error) {
            if (error instanceof ControlVerificationError && error.httpStatus === 404) return false;
            throw error;
        }
    }
    create(id: string, ownerHash: string): AbandonmentRecord {
        if (!verificationId(id) || !verificationHash(ownerHash))
            throw new ControlVerificationError(400);
        const record: AbandonmentRecord = {
            schemaVersion: 1,
            id,
            ownerHash,
            abandonedAt: new Date().toISOString(),
        };
        this.storage.write(`${id}.json`, { keyFingerprint: this.fingerprint(), record }, true);
        return record;
    }
}
