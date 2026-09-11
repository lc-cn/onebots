import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { acquireServiceMigrationLock } from "./service-migration-lock.js";
import { acquireControlWorkspace } from "./control/workspace.js";
const roots: string[] = [];
const children: ChildProcess[] = [];
const loader = createRequire(new URL("../package.json", import.meta.url)).resolve("tsx");
afterEach(async () => {
    for (const child of children.splice(0))
        if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, "exit");
            child.kill("SIGKILL");
            await exited;
        }
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function root() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ob-service-lock-"));
    roots.push(directory);
    return directory;
}
async function contender(directory: string) {
    const child = spawn(
        process.execPath,
        [
            "--import",
            loader,
            "--input-type=module",
            "-e",
            `
        import {acquireServiceMigrationLock} from ${JSON.stringify(new URL("./service-migration-lock.ts", import.meta.url).href)};
        let release;process.on('message', command=>{try { if(command==='acquire'){release=acquireServiceMigrationLock(${JSON.stringify(directory)});process.send('acquired')} else {release?.();process.send('released')} }catch(error){process.send({failure:error.message})}});process.send('ready');
    `,
        ],
        { stdio: ["ignore", "ignore", "ignore", "ipc"] },
    );
    children.push(child);
    expect((await once(child, "message"))[0]).toBe("ready");
    return {
        child,
        async request(command: string) {
            const reply = once(child, "message");
            child.send(command);
            return (await reply)[0];
        },
    };
}
describe("服务迁移排他锁", () => {
    it("真实并发仅一个成功，正常释放后复用同一文件", async () => {
        const directory = root();
        const workers = await Promise.all(Array.from({ length: 4 }, () => contender(directory)));
        const results = await Promise.all(workers.map(worker => worker.request("acquire")));
        expect(results.filter(value => value === "acquired")).toHaveLength(1);
        const winner = results.indexOf("acquired");
        const lock = path.join(directory, "service-migration-lock.sqlite");
        const inode = fs.statSync(lock).ino;
        expect(results.filter(value => value !== "acquired")).toEqual(
            Array.from({ length: 3 }, () => ({
                failure: "已有服务迁移操作正在进行，禁止重复执行",
            })),
        );
        await workers[winner].request("release");
        expect(await workers[(winner + 1) % 4].request("acquire")).toBe("acquired");
        expect(fs.statSync(lock).ino).toBe(inode);
        expect(fs.statSync(lock).mode & 0o777).toBe(0o600);
    });
    it("持锁进程强杀自动释放，无需删除或替换锁文件", async () => {
        const directory = root();
        const owner = await contender(directory);
        const waiting = await contender(directory);
        expect(await owner.request("acquire")).toBe("acquired");
        const exited = once(owner.child, "exit");
        owner.child.kill("SIGKILL");
        await exited;
        expect(await waiting.request("acquire")).toBe("acquired");
    });
    it("服务锁与同目录目标工作区锁可同时取得，重复释放不影响新owner", () => {
        const directory = root();
        const service = acquireServiceMigrationLock(directory);
        const workspace = acquireControlWorkspace(directory);
        try {
            expect(() => acquireServiceMigrationLock(directory)).toThrow("已有服务迁移操作");
            service();
            const replacement = acquireServiceMigrationLock(directory);
            try {
                service();
                expect(() => acquireServiceMigrationLock(directory)).toThrow("已有服务迁移操作");
            } finally {
                replacement();
            }
        } finally {
            workspace();
            service();
        }
    });
    it("拒绝symlink目录/锁、hardlink以及开放权限文件，不替用户修正不安全状态", () => {
        const directory = root();
        const target = root();
        const alias = path.join(directory, "alias");
        fs.symlinkSync(target, alias);
        expect(() => acquireServiceMigrationLock(alias)).toThrow("私有目录");
        const lock = path.join(directory, "service-migration-lock.sqlite");
        const targetFile = path.join(target, "lock.sqlite");
        fs.writeFileSync(targetFile, "", { mode: 0o600 });
        fs.symlinkSync(targetFile, lock);
        expect(() => acquireServiceMigrationLock(directory)).toThrow("独立常规文件");
        fs.unlinkSync(lock);
        fs.linkSync(targetFile, lock);
        expect(() => acquireServiceMigrationLock(directory)).toThrow("独立常规文件");
        fs.unlinkSync(lock);
        fs.writeFileSync(lock, "", { mode: 0o644 });
        expect(() => acquireServiceMigrationLock(directory)).toThrow("私有独立常规文件");
        fs.chmodSync(directory, 0o755);
        expect(() => acquireServiceMigrationLock(directory)).toThrow("私有目录");
    });
});
