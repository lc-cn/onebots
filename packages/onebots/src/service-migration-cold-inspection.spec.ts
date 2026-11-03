import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectServiceMigration } from "./service-migration-coordinator.js";
import { migrateInstalledService } from "./service-migration.js";
import { bootstrapManagerService } from "./manager-service-bootstrap.js";
import { rollbackStoppedServiceMigration } from "./service-migration-recovery.js";
import { inspectServiceMigrationRecovery } from "./service-recovery-inspection.js";
import { getServiceFiles } from "./service-files.js";
import type { ServiceHost } from "./service-host.js";
import type { ServiceMigrationBackup } from "./service-migration-types.js";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

async function killedOwnerFixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ob-cold-inspection-")));
    roots.push(root);
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace, { mode: 0o700 });
    const host: ServiceHost = {
        platform: process.platform,
        homedir: root,
        uid: process.getuid?.(),
        env: {},
        exec: vi.fn(() => {
            throw new Error("不得派发 OS 命令");
        }),
        spawn: vi.fn(async () => {
            throw new Error("不得派发 OS 进程");
        }),
    };
    const files = getServiceFiles("user", host);
    const backup: ServiceMigrationBackup = {
        schemaVersion: 1,
        previousRunning: true,
        previousEnabled: true,
        target: {
            schemaVersion: 1,
            runtimeKind: "control",
            scope: "user",
            workspace,
            nodePath: process.execPath,
            binPath: process.execPath,
            workingDirectory: workspace,
            host: "127.0.0.1",
            port: 6727,
        },
        files: (["definition", "metadata", "configuration"] as const).map(role => ({
            role,
            path: path.join(root, role),
            mode: 0o600,
            contentBase64: Buffer.from(`synthetic-${role}`).toString("base64"),
        })),
    };
    // Use a real independent lock owner. Compiled entry points are required by the package's
    // existing build-before-test contract; no TS loader or mocked process-existence probe.
    const lockModule = new URL("../lib/service-migration-lock.js", import.meta.url).href;
    const journalModule = new URL("../lib/service-migration-journal.js", import.meta.url).href;
    const child = spawn(
        process.execPath,
        [
            "--input-type=module",
            "-e",
            `
import { acquireServiceMigrationLock } from ${JSON.stringify(lockModule)};
import { FileServiceMigrationJournal } from ${JSON.stringify(journalModule)};
const release = acquireServiceMigrationLock(${JSON.stringify(files.stateDir)});
const journal = new FileServiceMigrationJournal(${JSON.stringify(path.join(files.stateDir, "migrations"))});
const record = journal.prepare('cold-owner', ${JSON.stringify(backup)});
journal.save({...record, phase:'stopping-old'});
process.send({ready:true});
setInterval(()=>{void release;},60_000);`,
        ],
        { stdio: ["ignore", "ignore", "pipe", "ipc"] },
    );
    const closed = new Promise<{ status: number | null; signal: NodeJS.Signals | null }>(
        (resolve, reject) => {
            child.once("error", reject);
            child.once("close", (status, signal) => resolve({ status, signal }));
        },
    );
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
        if (stderr.length < 2048) stderr += chunk.toString("utf8").slice(0, 2048 - stderr.length);
    });
    try {
        const [ready] = await Promise.race([
            once(child, "message"),
            closed.then(result => {
                const diagnostic =
                    stderr.match(/ERR_[A-Z_]+|EACCES|ENOENT|SQLITE_[A-Z_]+/gu)?.join(",") ??
                    "unknown";
                throw new Error(
                    `锁 owner 在 ready 前退出：${result.status}/${result.signal}；${diagnostic}`,
                );
            }),
        ]);
        expect(ready).toEqual({ ready: true });
        expect(() => inspectServiceMigration(files.stateDir, "cold-owner")).toThrow("正在进行");
        expect(child.kill("SIGKILL")).toBe(true);
        expect(await closed).toEqual({ status: null, signal: "SIGKILL" });
    } finally {
        if (child.exitCode === null && child.signalCode === null) {
            child.kill("SIGKILL");
            await closed;
        }
    }
    const journalFile = path.join(files.stateDir, "migrations/cold-owner.journal.json");
    return { root, host, files, backup, journalFile, bytes: fs.readFileSync(journalFile) };
}

describe.skipIf(process.platform === "win32")("历史迁移的进程退出与显式冷检查", () => {
    it("SIGKILL/只读门禁不伪造中断；显式持锁 cold-open 才持久化 interrupted", async () => {
        const test = await killedOwnerFixture();
        expect(JSON.parse(test.bytes.toString())).toMatchObject({
            phase: "stopping-old",
            status: "running",
            recoveryRequired: false,
        });
        const target = {
            ...test.backup.target,
            schemaVersion: 2 as const,
            authorityDirectory: path.join(test.root, "authority"),
        };
        await expect(migrateInstalledService(target, test.host)).rejects.toThrow("不支持");
        const service = {
            schemaVersion: target.schemaVersion,
            runtimeKind: target.runtimeKind,
            scope: target.scope,
            workspace: target.workspace,
            nodePath: target.nodePath,
            host: target.host,
            port: target.port,
            authorityDirectory: target.authorityDirectory,
        };
        const artifact = {
            name: "onebots",
            version: "1.0.0",
            spec: "file:/unused",
            sha256: "a".repeat(64),
        };
        await expect(
            bootstrapManagerService(
                { service },
                { artifacts: { host: artifact, core: { ...artifact, name: "@onebots/core" } } },
                test.host,
            ),
        ).rejects.toThrow("首次管理服务安装尚未完成");
        expect(inspectServiceMigrationRecovery(test.files.stateDir)).toBe(true);
        expect(fs.readFileSync(test.journalFile)).toEqual(test.bytes);
        expect(test.host.exec).not.toHaveBeenCalled();
        expect(test.host.spawn).not.toHaveBeenCalled();

        const inspected = inspectServiceMigration(test.files.stateDir, "cold-owner");
        expect(inspected).toMatchObject({
            phase: "stopping-old",
            status: "interrupted",
            recoveryRequired: true,
        });
        expect(JSON.parse(fs.readFileSync(test.journalFile, "utf8"))).toEqual(inspected);
        const persisted = fs.readFileSync(test.journalFile);
        expect(inspectServiceMigration(test.files.stateDir, "cold-owner")).toEqual(inspected);
        expect(fs.readFileSync(test.journalFile)).toEqual(persisted);
    });

    it("公开 rollback 入口自身 cold-open；缺保留证明时中断落盘但不派发 OS 动作", async () => {
        const test = await killedOwnerFixture();
        await expect(
            rollbackStoppedServiceMigration("cold-owner", "user", test.host),
        ).rejects.toThrow("目标尚未接管");
        expect(JSON.parse(fs.readFileSync(test.journalFile, "utf8"))).toMatchObject({
            phase: "stopping-old",
            status: "interrupted",
            recoveryRequired: true,
        });
        expect(test.host.exec).not.toHaveBeenCalled();
        expect(test.host.spawn).not.toHaveBeenCalled();
    });
});
