import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, readFileSync, writeFileSync, chmodSync, readdirSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { ServiceOperationStorage } from "../service-operation-storage.js";
import { ControlVerificationStore } from "./verification-store.js";
import {
    parseVerificationRecord,
    projectVerification,
    type VerificationRecord,
} from "./verification-record.js";
const directories: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of directories.splice(0))
        rmSync(directory, { recursive: true, force: true });
});
function fixture() {
    const directory = mkdtempSync(path.join(tmpdir(), "ob-verification-store-"));
    directories.push(directory);
    const store = new ControlVerificationStore(directory);
    const command = {
        operationId: randomUUID(),
        challengeId: randomUUID(),
        expected: { gatewayInstanceId: randomUUID(), configVersion: "test-config" },
        action: "submit" as const,
        data: { code: "891234" },
    };
    const record: VerificationRecord = {
        schemaVersion: 1,
        id: command.operationId,
        ownerHash: "a".repeat(64),
        requestDigest: store.digest(command),
        accountHash: store.accountHash("icqq", "123"),
        challengeId: command.challengeId,
        ...command.expected,
        action: command.action,
        status: "running",
        startedAt: new Date().toISOString(),
    };
    return {
        directory,
        store,
        command,
        record,
        operationPath: path.join(directory, "operations", `${record.id}.json`),
    };
}
describe("验证操作私有持久存储", () => {
    it("摘要稳定跨重启、与字段顺序无关、不同密钥隔离且不保存验证码", () => {
        const f = fixture(),
            other = fixture();
        expect(f.store.digest({ ...f.command, data: { code: "891234" } })).toBe(
            f.record.requestDigest,
        );
        expect(new ControlVerificationStore(f.directory).digest(f.command)).toBe(
            f.record.requestDigest,
        );
        expect(other.store.digest(f.command)).not.toBe(f.record.requestDigest);
        f.store.create(f.record);
        expect(readFileSync(f.operationPath, "utf8")).not.toContain("891234");
        expect(readdirSync(path.join(f.directory, "operations"))).toEqual([`${f.record.id}.json`]);
        expect(f.store.accountHash("a:b", "c")).not.toBe(f.store.accountHash("a", "b:c"));
    });
    it("启动将中断running持久转unknown，不重新派发，终态保持", () => {
        const f = fixture();
        f.store.create(f.record);
        const reopened = new ControlVerificationStore(f.directory);
        expect(reopened.read(f.record.id).status).toBe("unknown");
        expect(reopened.hasUncertainAccount(f.record.accountHash)).toBe(true);
        expect(new ControlVerificationStore(f.directory).read(f.record.id).status).toBe("unknown");
        const g = fixture();
        g.store.create(g.record);
        g.store.finish({ ...g.record, status: "succeeded", finishedAt: new Date().toISOString() });
        expect(new ControlVerificationStore(g.directory).read(g.record.id).status).toBe(
            "succeeded",
        );
        expect(g.store.hasUncertainAccount(g.record.accountHash)).toBe(false);
    });
    it("密钥缺失、内容损坏、替换均封锁，旧回执存在不得补key", () => {
        for (const kind of ["missing", "bad", "replace", "replace-both"]) {
            const f = fixture();
            f.store.create(f.record);
            const keyFile = path.join(f.directory, "keys", "hmac.json");
            if (kind === "missing") rmSync(keyFile);
            else if (kind === "bad") writeFileSync(keyFile, "{}");
            else {
                const key = randomBytes(32);
                writeFileSync(
                    keyFile,
                    JSON.stringify({ schemaVersion: 1, key: key.toString("base64") }),
                );
                if (kind === "replace-both")
                    writeFileSync(
                        path.join(f.directory, "keys", "fingerprint.json"),
                        JSON.stringify({
                            schemaVersion: 1,
                            fingerprint: createHash("sha256").update(key).digest("hex"),
                        }),
                    );
            }
            expect(f.store.health().available).toBe(false);
            expect(() => f.store.digest(f.command)).toThrow();
            expect(new ControlVerificationStore(f.directory).health().available).toBe(false);
            if (kind === "missing")
                expect(readdirSync(path.join(f.directory, "keys"))).not.toContain("hmac.json");
        }
    });
    it("权限放宽与坏记录封锁整个验证域，但不抛出构造异常", () => {
        const f = fixture();
        f.store.create(f.record);
        writeFileSync(f.operationPath, "{}");
        expect(f.store.health()).toEqual({ available: false });
        expect(() => f.store.create({ ...f.record, id: randomUUID() })).toThrow();
        expect(new ControlVerificationStore(f.directory).health().available).toBe(false);
        if (process.platform !== "win32") {
            const g = fixture();
            chmodSync(path.join(g.directory, "keys", "hmac.json"), 0o644);
            expect(g.store.health().available).toBe(false);
        }
    });
    it("finish落盘失败保留内存unknown并封锁，重启也unknown", () => {
        const f = fixture();
        f.store.create(f.record);
        const original = ServiceOperationStorage.prototype.write;
        vi.spyOn(ServiceOperationStorage.prototype, "write").mockImplementation(
            function (name, value, createOnly) {
                if (name === `${f.record.id}.json`) throw new Error("disk failure");
                return original.call(this, name, value, createOnly);
            },
        );
        expect(() =>
            f.store.finish({
                ...f.record,
                status: "succeeded",
                finishedAt: new Date().toISOString(),
            }),
        ).toThrow();
        expect(f.store.read(f.record.id).status).toBe("unknown");
        expect(f.store.health().available).toBe(false);
        vi.restoreAllMocks();
        expect(new ControlVerificationStore(f.directory).read(f.record.id).status).toBe("unknown");
    });
    it("finish时原文件权限损坏仍可诊断内存unknown，不再接受派发", () => {
        if (process.platform === "win32") return;
        const f = fixture();
        f.store.create(f.record);
        chmodSync(f.operationPath, 0o644);
        expect(() =>
            f.store.finish({
                ...f.record,
                status: "succeeded",
                finishedAt: new Date().toISOString(),
            }),
        ).toThrow();
        expect(f.store.read(f.record.id).status).toBe("unknown");
        expect(f.store.health().available).toBe(false);
    });
    it("拒绝篡改不可变身份、重复终态与多余秘密字段；投影不含hash", () => {
        const f = fixture();
        f.store.create(f.record);
        expect(() =>
            f.store.finish({
                ...f.record,
                ownerHash: "b".repeat(64),
                status: "succeeded",
                finishedAt: new Date().toISOString(),
            }),
        ).toThrow();
        expect(f.store.read(f.record.id)).toMatchObject({
            ownerHash: f.record.ownerHash,
            status: "unknown",
        });
        expect(() => parseVerificationRecord({ ...f.record, code: "891234" })).toThrow();
        expect(() => parseVerificationRecord({ ...f.record, status: "unknown" })).toThrow();
        expect(() =>
            parseVerificationRecord({ ...f.record, finishedAt: new Date().toISOString() }),
        ).toThrow();
        const operation = projectVerification(f.record);
        for (const key of ["schemaVersion", "ownerHash", "requestDigest", "accountHash"])
            expect(operation).not.toHaveProperty(key);
        const getter = vi.fn();
        expect(() =>
            parseVerificationRecord({ ...f.record, action: { toString: getter } }),
        ).toThrow();
        expect(getter).not.toHaveBeenCalled();
    });
    it("回执容量满拒绝新增且不淘汰", () => {
        const f = fixture();
        const original = ServiceOperationStorage.prototype.list;
        const recordRead = vi.spyOn(f.store, "read").mockReturnValue(f.record);
        vi.spyOn(ServiceOperationStorage.prototype, "list").mockImplementation(function () {
            const names = original.call(this);
            return names.includes("hmac.json")
                ? names
                : Array.from({ length: 10000 }, () => `${f.record.id}.json`);
        });
        expect(() => f.store.create(f.record)).toThrowError(
            expect.objectContaining({ httpStatus: 429 }),
        );
        expect(recordRead).toHaveBeenCalled();
        expect(readdirSync(path.join(f.directory, "operations"))).toEqual([]);
    });
});
