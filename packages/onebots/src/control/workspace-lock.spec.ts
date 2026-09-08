import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it } from "vitest";
import { acquireControlWorkspace } from "./workspace.js";

const directories: string[] = [];
const children: ChildProcess[] = [];
const loader = createRequire(new URL("../../package.json", import.meta.url)).resolve("tsx");
const workspaceModule = new URL("./workspace.ts", import.meta.url).href;

afterEach(async () => {
    for (const child of children.splice(0)) {
        if (child.exitCode === null && child.signalCode === null) {
            const exited = once(child, "exit");
            child.kill("SIGKILL");
            await exited;
        }
    }
    for (const directory of directories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function fixture(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-workspace-lock-"));
    directories.push(directory);
    return directory;
}

async function contender(root: string) {
    const child = spawn(
        process.execPath,
        [
            "--import",
            loader,
            "--input-type=module",
            "-e",
            `
        import { acquireControlWorkspace } from ${JSON.stringify(workspaceModule)};
        let release;
        process.on('message', command => {
            if (command === 'acquire') {
                try {
                    release = acquireControlWorkspace(${JSON.stringify(root)});
                    process.send('acquired');
                } catch (error) { process.send({ failure: error.message }); }
            } else if (command === 'release') {
                release?.();
                process.send('released');
            }
        });
        process.send('ready');
    `,
        ],
        { stdio: ["ignore", "ignore", "pipe", "ipc"] },
    );
    children.push(child);
    let diagnostics = "";
    child.stderr?.on("data", data => {
        diagnostics += String(data);
    });
    const ready = await message(child, () => diagnostics);
    expect(ready).toBe("ready");
    return {
        child,
        request(command: string) {
            const response = message(child, () => diagnostics);
            child.send(command);
            return response;
        },
    };
}

function message(child: ChildProcess, diagnostics: () => string): Promise<unknown> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            cleanup();
            reject(new Error(`锁测试子进程未响应：${diagnostics()}`));
        }, 10_000);
        const cleanup = () => {
            clearTimeout(timer);
            child.off("message", received);
            child.off("exit", exited);
            child.off("error", failed);
        };
        const received = (value: unknown) => {
            cleanup();
            resolve(value);
        };
        const exited = () => {
            cleanup();
            reject(new Error(`锁测试子进程退出：${diagnostics()}`));
        };
        const failed = (error: Error) => {
            cleanup();
            reject(error);
        };
        child.once("message", received);
        child.once("exit", exited);
        child.once("error", failed);
    });
}

describe("control workspace lock", () => {
    it("独立进程同时抢锁只有一个成功，正常释放后同一数据库可重用", async () => {
        const root = fixture();
        const contenders = await Promise.all([contender(root), contender(root), contender(root)]);
        const results = await Promise.all(contenders.map(item => item.request("acquire")));
        expect(results.filter(value => value === "acquired")).toHaveLength(1);
        expect(results.filter(value => value !== "acquired")).toEqual([
            { failure: "此工作区已有管理服务，禁止重复启动" },
            { failure: "此工作区已有管理服务，禁止重复启动" },
        ]);
        const lock = path.join(root, ".control", "manager-lock.sqlite");
        const inode = fs.statSync(lock).ino;
        const winner = results.indexOf("acquired");
        expect(await contenders[winner].request("release")).toBe("released");
        expect(await contenders[(winner + 1) % 3].request("acquire")).toBe("acquired");
        expect(fs.statSync(lock).ino).toBe(inode);
        if (process.platform !== "win32") {
            expect(fs.statSync(lock).mode & 0o777).toBe(0o600);
            expect(fs.statSync(path.dirname(lock)).mode & 0o777).toBe(0o700);
        }
    });

    it("强杀持有进程自动释放，无需删除数据库或死 PID 记录", async () => {
        const root = fixture();
        const owner = await contender(root);
        expect(await owner.request("acquire")).toBe("acquired");
        const lock = path.join(root, ".control", "manager-lock.sqlite");
        const inode = fs.statSync(lock).ino;
        const waiting = await contender(root);
        expect(await waiting.request("acquire")).toEqual({
            failure: "此工作区已有管理服务，禁止重复启动",
        });
        const exited = once(owner.child, "exit");
        owner.child.kill("SIGKILL");
        await exited;
        expect(await waiting.request("acquire")).toBe("acquired");
        expect(fs.statSync(lock).ino).toBe(inode);
    });

    it("路径别名仍互斥，重复释放不会释放后来的 owner", async () => {
        const root = fixture();
        const alias = path.join(fixture(), "alias");
        fs.symlinkSync(root, alias, "dir");
        const release = acquireControlWorkspace(root);
        try {
            const other = await contender(alias);
            expect(await other.request("acquire")).toEqual({
                failure: "此工作区已有管理服务，禁止重复启动",
            });
            release();
            expect(await other.request("acquire")).toBe("acquired");
            release();
            expect(() => acquireControlWorkspace(root)).toThrow("此工作区已有管理服务");
        } finally {
            release();
        }
    });

    it("拒绝符号链接锁数据库", () => {
        const root = fixture();
        const directory = path.join(root, ".control");
        fs.mkdirSync(directory);
        const target = path.join(root, "other.sqlite");
        fs.writeFileSync(target, "");
        fs.symlinkSync(target, path.join(directory, "manager-lock.sqlite"));
        expect(() => acquireControlWorkspace(root)).toThrow("独立常规文件");
    });
});
