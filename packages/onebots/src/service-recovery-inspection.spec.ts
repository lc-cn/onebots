import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
    inspectServiceRecovery,
    inspectServiceMigrationRecovery,
    inspectServiceRecoveryDetails,
} from "./service-recovery-inspection.js";
import { FileManagerServiceJournal } from "./manager-service-journal.js";
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});
function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-recovery-read-"));
    roots.push(root);
    return root;
}
function prepare(root: string) {
    const journal = new FileManagerServiceJournal(path.join(root, "manager-operations"));
    const record = journal.prepare({
        id: "test",
        action: "start",
        desiredEnabled: true,
        spec: {
            schemaVersion: 1,
            runtimeKind: "control",
            scope: "user",
            workspace: root,
            workingDirectory: root,
            nodePath: process.execPath,
            binPath: "/app/bin.js",
            host: "127.0.0.1",
            port: 6727,
        },
    });
    return { journal, record, file: path.join(root, "manager-operations/test.json") };
}
function noWrites() {
    const spies = [
        vi.spyOn(fs, "mkdirSync"),
        vi.spyOn(fs, "chmodSync"),
        vi.spyOn(fs, "writeFileSync"),
        vi.spyOn(fs, "renameSync"),
        vi.spyOn(fs, "unlinkSync"),
    ];
    return () => spies.forEach(spy => expect(spy).not.toHaveBeenCalled());
}
describe("系统操作恢复状态纯只读检查", () => {
    it("列出待核实操作 ID 和阶段，不暴露工作区、宿主或快照", () => {
        const root = fixture();
        const f = prepare(root);
        const before = fs.readFileSync(f.file);
        const verifyNoWrites = noWrites();
        expect(inspectServiceRecoveryDetails(root)).toEqual({
            serviceRecoveryRequired: true,
            readable: true,
            truncated: false,
            operations: [
                {
                    kind: "manager",
                    id: "test",
                    action: "start",
                    phase: "prepared",
                    status: "running",
                },
            ],
        });
        expect(JSON.stringify(inspectServiceRecoveryDetails(root))).not.toContain(root);
        expect(fs.readFileSync(f.file)).toEqual(before);
        verifyNoWrites();
    });
    it("任意记录损坏时不展示先前读到的局部列表", () => {
        const root = fixture();
        prepare(root);
        fs.writeFileSync(path.join(root, "manager-operations/zzz.json"), '{"secret":', {
            mode: 0o600,
        });
        expect(inspectServiceRecoveryDetails(root)).toEqual({
            serviceRecoveryRequired: true,
            readable: false,
            truncated: false,
            operations: [],
        });
    });
    it("截断仅影响展示，不能把更多未完成操作当作不存在", () => {
        const root = fixture();
        const f = prepare(root);
        const raw = JSON.parse(fs.readFileSync(f.file, "utf8"));
        for (let index = 0; index < 100; index++) {
            const id = `more-${index}`;
            fs.writeFileSync(
                path.join(root, `manager-operations/${id}.json`),
                JSON.stringify({ ...raw, id }),
                { mode: 0o600 },
            );
        }
        const result = inspectServiceRecoveryDetails(root);
        expect(result).toMatchObject({
            serviceRecoveryRequired: true,
            readable: true,
            truncated: true,
        });
        expect(result.operations).toHaveLength(100);
    });
    it("精确普通操作对账可单独检查迁移，但不能忽略损坏迁移痕迹", () => {
        const root = fixture();
        prepare(root);
        expect(inspectServiceRecovery(root).serviceRecoveryRequired).toBe(true);
        expect(inspectServiceMigrationRecovery(root)).toBe(false);
        fs.mkdirSync(path.join(root, "migrations"), { mode: 0o700 });
        fs.writeFileSync(path.join(root, "migrations/broken.journal.json"), "{", { mode: 0o600 });
        const verifyNoWrites = noWrites();
        expect(inspectServiceMigrationRecovery(root)).toBe(true);
        verifyNoWrites();
    });
    it("缺失及空目录均无pending，查询不创建任何文件或目录", () => {
        const root = fixture();
        fs.mkdirSync(path.join(root, "manager-operations"), { mode: 0o700 });
        fs.mkdirSync(path.join(root, "migrations"), { mode: 0o700 });
        const verifyNoWrites = noWrites();
        expect(inspectServiceRecovery(root)).toEqual({ serviceRecoveryRequired: false });
        expect(inspectServiceRecovery(path.join(root, "absent"))).toEqual({
            serviceRecoveryRequired: false,
        });
        expect(fs.existsSync(path.join(root, "absent"))).toBe(false);
        expect(fs.readdirSync(path.join(root, "manager-operations"))).toEqual([]);
        expect(fs.readdirSync(path.join(root, "migrations"))).toEqual([]);
        verifyNoWrites();
    });
    it("running记录保持原字节和状态，不触发journal构造函数的coldmark", () => {
        const root = fixture(),
            f = prepare(root);
        const before = fs.readFileSync(f.file);
        const stamp = fs.statSync(f.file);
        const verifyNoWrites = noWrites();
        expect(inspectServiceRecovery(root)).toEqual({ serviceRecoveryRequired: true });
        expect(fs.readFileSync(f.file)).toEqual(before);
        expect(JSON.parse(fs.readFileSync(f.file, "utf8")).status).toBe("running");
        expect(fs.statSync(f.file).mtimeMs).toBe(stamp.mtimeMs);
        expect(fs.statSync(f.file).mode).toBe(stamp.mode);
        verifyNoWrites();
    });
    it("interrupted或恢复标记要求对账，最终成功记录才不阻塞", () => {
        const root = fixture(),
            f = prepare(root);
        f.record.status = "interrupted";
        f.record.recoveryRequired = true;
        f.journal.save(f.record);
        expect(inspectServiceRecovery(root).serviceRecoveryRequired).toBe(true);
        f.record.status = "succeeded";
        f.record.recoveryRequired = false;
        f.record.phase = "completed";
        f.journal.save(f.record);
        expect(inspectServiceRecovery(root).serviceRecoveryRequired).toBe(false);
    });
    it("迁移记录也检查，备份仅核验文件边界不打开正文", () => {
        const root = fixture(),
            directory = path.join(root, "migrations");
        fs.mkdirSync(directory, { mode: 0o700 });
        const digest = "a".repeat(64),
            backup = path.join(directory, digest + ".backup.json");
        fs.writeFileSync(backup, '{"private":"do-not-read"}', { mode: 0o400 });
        const file = path.join(directory, "test.journal.json");
        const value = {
            schemaVersion: 1,
            id: "test",
            backupDigest: digest,
            phase: "completed",
            status: "succeeded",
            recoveryRequired: false,
            rolledBack: false,
        };
        fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
        const original = fs.openSync;
        const open = vi
            .spyOn(fs, "openSync")
            .mockImplementation((...args: Parameters<typeof fs.openSync>) => {
                if (args[0] === backup) throw new Error("禁止打开备份正文");
                return original(...args);
            });
        expect(inspectServiceRecovery(root)).toEqual({ serviceRecoveryRequired: false });
        expect(open.mock.calls.some(call => call[0] === backup)).toBe(false);
        fs.writeFileSync(file, JSON.stringify({ ...value, status: "failed", rolledBack: true }));
        expect(inspectServiceRecovery(root)).toEqual({ serviceRecoveryRequired: false });
        fs.writeFileSync(file, JSON.stringify({ ...value, status: "failed", rolledBack: false }));
        expect(inspectServiceRecovery(root)).toEqual({ serviceRecoveryRequired: true });
        fs.writeFileSync(
            file,
            JSON.stringify({ ...value, phase: "starting-manager", status: "running" }),
        );
        expect(inspectServiceRecovery(root)).toEqual({ serviceRecoveryRequired: true });
    });
    it("损坏记录、临时残留、孤立备份、权限及读取异常全部failclosed且不回显", () => {
        for (const name of ["test.json", ".partial.tmp", "orphan.backup.json"]) {
            const root = fixture(),
                directory = path.join(root, "manager-operations");
            fs.mkdirSync(directory, { mode: 0o700 });
            fs.writeFileSync(path.join(directory, name), '{"secret":', { mode: 0o600 });
            expect(inspectServiceRecovery(root)).toEqual({ serviceRecoveryRequired: true });
        }
        const root = fixture(),
            f = prepare(root);
        fs.chmodSync(f.file, 0o644);
        expect(inspectServiceRecovery(root).serviceRecoveryRequired).toBe(true);
        const original = fs.readdirSync;
        vi.spyOn(fs, "readdirSync").mockImplementation(
            (...args: Parameters<typeof fs.readdirSync>) => {
                if (args[0] === path.join(root, "manager-operations"))
                    throw Object.assign(new Error("private EACCES"), { code: "EACCES" });
                return original(...args);
            },
        );
        expect(inspectServiceRecovery(root)).toEqual({ serviceRecoveryRequired: true });
    });
});
