import path from "node:path";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import {
    ServiceOperationStorage,
    canonicalServiceJson,
    closedServiceObject,
} from "../service-operation-storage.js";
import {
    parseGatewayVerificationCommand,
    type GatewayVerificationCommand,
} from "../gateway/verification-command.js";
import {
    ControlVerificationError,
    parseVerificationRecord,
    verificationHash,
    verificationId,
    type VerificationRecord,
} from "./verification-record.js";
export { ControlVerificationError, type VerificationRecord } from "./verification-record.js";
/** 唯一manager持锁访问；密钥与回执分目录，验证码只参与带秘密密钥的摘要。 */
export class ControlVerificationStore {
    private root?: ServiceOperationStorage;
    private keys?: ServiceOperationStorage;
    private operations?: ServiceOperationStorage;
    private key?: Buffer;
    private fingerprint?: string;
    private blocked = false;
    private readonly uncertain = new Map<string, VerificationRecord>();
    private readonly observed = new Map<string, VerificationRecord>();
    constructor(directory: string) {
        try {
            this.root = new ServiceOperationStorage(directory);
            this.keys = new ServiceOperationStorage(path.join(directory, "keys"));
            this.operations = new ServiceOperationStorage(path.join(directory, "operations"));
            const names = this.operations.list();
            const keyNames = this.keys.list();
            if (!keyNames.length && !names.length) {
                const key = randomBytes(32);
                const fingerprint = createHash("sha256").update(key).digest("hex");
                this.keys.write(
                    "hmac.json",
                    { schemaVersion: 1, key: key.toString("base64") },
                    true,
                );
                this.keys.write("fingerprint.json", { schemaVersion: 1, fingerprint }, true);
            }
            this.verifyKey();
            for (const name of names) {
                const record = this.read(name.slice(0, -5));
                if (record.status !== "running") continue;
                const unknown: VerificationRecord = {
                    ...record,
                    status: "unknown",
                    finishedAt: this.finishedAt(record),
                };
                this.uncertain.set(record.id, unknown);
                this.write(unknown);
                this.uncertain.delete(record.id);
            }
        } catch {
            this.blocked = true;
        }
    }
    health(): { available: boolean } {
        if (!this.blocked) {
            try {
                this.verifyKey();
                this.audit();
            } catch {
                this.blocked = true;
            }
        }
        return { available: !this.blocked && Boolean(this.operations && this.key) };
    }
    digest(input: GatewayVerificationCommand): string {
        this.assertAvailable();
        const command = parseGatewayVerificationCommand(input);
        if (!command) throw new ControlVerificationError(400);
        return createHmac("sha256", this.key!)
            .update("verification-command\0")
            .update(canonicalServiceJson(command))
            .digest("hex");
    }
    accountHash(platform: string, accountId: string): string {
        this.assertAvailable();
        if (
            ![platform, accountId].every(
                value =>
                    typeof value === "string" &&
                    value.length > 0 &&
                    Buffer.byteLength(value) <= 4096 &&
                    !/[\u0000-\u001f\u007f]/u.test(value),
            )
        )
            throw new ControlVerificationError(400);
        return createHmac("sha256", this.key!)
            .update("verification-account\0")
            .update(canonicalServiceJson([platform, accountId]))
            .digest("hex");
    }
    read(id: string): VerificationRecord {
        if (!verificationId(id)) throw new ControlVerificationError(400);
        if (!this.operations) throw new ControlVerificationError(503);
        try {
            if (this.uncertain.has(id)) return structuredClone(this.uncertain.get(id)!);
            if (!this.operations.has(`${id}.json`)) throw new ControlVerificationError(404);
            const envelope = closedServiceObject(this.operations.read(`${id}.json`), [
                "keyFingerprint",
                "record",
            ]);
            if (!verificationHash(envelope.keyFingerprint)) throw new Error();
            if (this.fingerprint && envelope.keyFingerprint !== this.fingerprint) throw new Error();
            const record = parseVerificationRecord(envelope.record);
            if (record.id !== id) throw new Error();
            this.observed.set(id, structuredClone(record));
            return structuredClone(record);
        } catch (error) {
            if (error instanceof ControlVerificationError && error.httpStatus === 404) throw error;
            this.blocked = true;
            throw new ControlVerificationError(503);
        }
    }
    create(input: VerificationRecord): void {
        this.assertAvailable();
        try {
            const record = parseVerificationRecord(input);
            if (record.status !== "running") throw new Error();
            const count = this.audit();
            if (count >= 10000) throw new ControlVerificationError(429);
            this.write(record, true);
            this.observed.set(record.id, structuredClone(record));
        } catch (error) {
            if (error instanceof ControlVerificationError && error.httpStatus === 429) throw error;
            this.blocked = true;
            throw new ControlVerificationError(503);
        }
    }
    finish(input: VerificationRecord): void {
        let record: VerificationRecord;
        try {
            record = parseVerificationRecord(input);
        } catch {
            this.blocked = true;
            throw new ControlVerificationError(503);
        }
        let previous = this.observed.get(record.id);
        try {
            this.assertAvailable();
            previous = this.read(record.id);
            const immutable = ({
                status: _status,
                finishedAt: _finished,
                ...value
            }: VerificationRecord) => value;
            if (
                previous.status !== "running" ||
                record.status === "running" ||
                canonicalServiceJson(immutable(previous)) !==
                    canonicalServiceJson(immutable(record))
            )
                throw new Error();
            this.write(record);
            this.observed.set(record.id, structuredClone(record));
        } catch {
            this.blocked = true;
            // 只从原有回执生成unknown，不接纳调用方篡改的不可变身份。
            try {
                previous ??= this.read(record.id);
                if (previous.status === "running")
                    this.uncertain.set(previous.id, {
                        ...previous,
                        status: "unknown",
                        finishedAt: this.finishedAt(previous),
                    });
            } catch {
                /* 原文件不可读时保留封锁，不能伪造可验证回执。 */
            }
            throw new ControlVerificationError(503);
        }
    }
    hasUncertainAccount(accountHash: string): boolean {
        if (!verificationHash(accountHash)) throw new ControlVerificationError(400);
        this.assertAvailable();
        try {
            for (const name of this.operations!.list()) {
                const record = this.read(name.slice(0, -5));
                if (
                    record.accountHash === accountHash &&
                    (record.status === "running" || record.status === "unknown")
                )
                    return true;
            }
            return false;
        } catch {
            this.blocked = true;
            throw new ControlVerificationError(503);
        }
    }
    private assertAvailable(): void {
        if (!this.health().available) throw new ControlVerificationError(503);
    }
    private audit(): number {
        if (!this.operations) throw new Error();
        const names = this.operations.list();
        for (const name of names) this.read(name.slice(0, -5));
        return names.length;
    }
    private verifyKey(): void {
        if (!this.root || !this.keys) throw new Error();
        this.root.has("identity-check.json");
        const names = this.keys.list().sort();
        if (canonicalServiceJson(names) !== canonicalServiceJson(["fingerprint.json", "hmac.json"]))
            throw new Error();
        const stored = closedServiceObject(this.keys.read("hmac.json"), ["schemaVersion", "key"]);
        const metadata = closedServiceObject(this.keys.read("fingerprint.json"), [
            "schemaVersion",
            "fingerprint",
        ]);
        if (
            stored.schemaVersion !== 1 ||
            typeof stored.key !== "string" ||
            metadata.schemaVersion !== 1 ||
            !verificationHash(metadata.fingerprint)
        )
            throw new Error();
        const key = Buffer.from(stored.key, "base64");
        const fingerprint = createHash("sha256").update(key).digest("hex");
        if (
            key.length !== 32 ||
            key.toString("base64") !== stored.key ||
            metadata.fingerprint !== fingerprint ||
            (this.key && !timingSafeEqual(this.key, key)) ||
            (this.fingerprint && this.fingerprint !== fingerprint)
        )
            throw new Error();
        this.key = key;
        this.fingerprint = fingerprint;
    }
    private write(record: VerificationRecord, createOnly = false): void {
        this.verifyKey();
        this.operations!.write(
            `${record.id}.json`,
            { keyFingerprint: this.fingerprint, record },
            createOnly,
        );
    }
    private finishedAt(record: VerificationRecord): string {
        return new Date(Math.max(Date.now(), Date.parse(record.startedAt))).toISOString();
    }
}
