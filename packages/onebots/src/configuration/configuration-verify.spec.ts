import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { verifyConfiguration, recoverConfigurationVerifications } from "./configuration-verify.js";

const selection = { adapters: [], protocols: [], applications: [] };
describe("配置隔离验证", () => {
    it("空工作目录通过明确管理宿主验证配置，不依赖 cwd 包解析", async () => {
        const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ob-empty-cwd-verify-"));
        try {
            await expect(
                verifyConfiguration({ runtimeRoot, selection, document: {} }),
            ).rejects.toMatchObject({ code: "WORKER_FAILED" });
            await expect(
                verifyConfiguration({
                    runtimeRoot,
                    selection,
                    document: {},
                    hostEntrypoint: path.resolve("packages/onebots/lib/index.js"),
                }),
            ).resolves.toEqual({ valid: true, issues: [] });
        } finally {
            await fs.rm(runtimeRoot, { recursive: true, force: true });
        }
    });
    it("严格快照拒绝 getter、toJSON 和 undefined，不执行用户代码", async () => {
        let invoked = false;
        const getter = Object.defineProperty({}, "token", {
            enumerable: true,
            get() {
                invoked = true;
                return "secret";
            },
        });
        for (const document of [
            getter,
            { token: undefined },
            {
                toJSON() {
                    invoked = true;
                    return {};
                },
            },
        ]) {
            await expect(
                verifyConfiguration({
                    runtimeRoot: path.resolve("development"),
                    selection,
                    document,
                }),
            ).rejects.toMatchObject({ code: "INVALID_INPUT" });
        }
        expect(invoked).toBe(false);
    });
    it("使用真实宿主验证空配置和非法端口，不回显秘密", async () => {
        const runtimeRoot = path.resolve("development");
        await expect(
            verifyConfiguration({ runtimeRoot, selection, document: {} }),
        ).resolves.toEqual({ valid: true, issues: [] });
        const result = await verifyConfiguration({
            runtimeRoot,
            selection,
            document: { port: "secret-port-value" },
        });
        expect(result.valid).toBe(false);
        expect(result.issues).toContainEqual({ path: ["port"], message: "配置字段无效" });
        expect(JSON.stringify(result)).not.toContain("secret-port-value");
    });
    it("真实 Mock 与 OneBot 注册后验证账号但不创建账号", async () => {
        const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ob-config-real-"));
        await fs.mkdir(path.join(runtimeRoot, "node_modules/@onebots"), { recursive: true });
        await fs.symlink(
            path.resolve("packages/onebots"),
            path.join(runtimeRoot, "node_modules/onebots"),
        );
        await fs.symlink(
            path.resolve("adapters/adapter-mock"),
            path.join(runtimeRoot, "node_modules/@onebots/adapter-mock"),
        );
        await fs.symlink(
            path.resolve("protocols/onebot-v11/protocol"),
            path.join(runtimeRoot, "node_modules/@onebots/protocol-onebot-v11"),
        );
        try {
            const result = await verifyConfiguration({
                runtimeRoot,
                selection: { adapters: ["mock"], protocols: ["onebot-v11"], applications: [] },
                document: { "mock.bot": { "onebot.v11": { use_http: true } } },
            });
            expect(result).toEqual({ valid: true, issues: [] });
            const invalid = await verifyConfiguration({
                runtimeRoot,
                selection: { adapters: ["mock"], protocols: ["onebot-v11"], applications: [] },
                document: {
                    "mock.bot": { latency: "private-latency", "onebot.v11": { use_http: true } },
                },
            });
            expect(invalid.valid).toBe(false);
            expect(invalid.issues).toContainEqual({
                path: ["mock.bot", "latency"],
                message: "配置字段无效",
            });
            expect(JSON.stringify(invalid)).not.toContain("private-latency");
        } finally {
            await fs.rm(runtimeRoot, { recursive: true, force: true });
        }
    });
    it("父进程强杀后清理敏感请求，保留owner供冷恢复", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-config-crash-"));
        const privateDirectory = path.join(root, "private");
        const host = path.join(root, "node_modules/onebots");
        await fs.mkdir(host, { recursive: true });
        await fs.mkdir(privateDirectory, { mode: 0o700 });
        await fs.writeFile(
            path.join(host, "package.json"),
            JSON.stringify({ name: "onebots", type: "module", main: "index.js" }),
        );
        await fs.writeFile(path.join(host, "index.js"), "");
        await fs.writeFile(
            path.join(host, "plugin-loader.js"),
            `import fs from 'node:fs';fs.writeFileSync(${JSON.stringify(path.join(root, "ready"))}, String(process.pid));await new Promise(()=>{});`,
        );
        const script = path.join(root, "parent.mjs");
        await fs.writeFile(
            script,
            `import {verifyConfiguration} from ${JSON.stringify(path.resolve("packages/onebots/lib/configuration/configuration-verify.js"))};await verifyConfiguration({runtimeRoot:${JSON.stringify(root)},privateRoot:${JSON.stringify(privateDirectory)},selection:${JSON.stringify(selection)},document:{token:'private-test-value'},timeoutMs:60000});`,
        );
        const parent = spawn(process.execPath, [script], { stdio: "ignore" });
        const exited = new Promise(resolve => parent.once("close", resolve));
        try {
            let workerPid = 0;
            for (let attempt = 0; attempt < 100; attempt++) {
                try {
                    workerPid = Number(await fs.readFile(path.join(root, "ready"), "utf8"));
                    // 文件创建先于内容写完；空文件不是 worker 就绪证明。
                    if (Number.isSafeInteger(workerPid) && workerPid > 0) break;
                } catch {
                    // 启动中的 worker 尚未发布就绪文件。
                }
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            expect(workerPid).toBeGreaterThan(0);
            parent.kill("SIGKILL");
            await exited;
            let cleaned = false;
            for (let attempt = 0; attempt < 100; attempt++) {
                try {
                    const [id] = await fs.readdir(privateDirectory);
                    await fs.stat(path.join(privateDirectory, id, "request.json"));
                } catch {
                    cleaned = true;
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            expect(cleaned).toBe(true);
            for (let attempt = 0; attempt < 100; attempt++) {
                try {
                    process.kill(workerPid, 0);
                } catch {
                    workerPid = 0;
                    break;
                }
                await new Promise(resolve => setTimeout(resolve, 20));
            }
            expect(workerPid).toBe(0);
            const [id] = await fs.readdir(privateDirectory);
            const owner = JSON.parse(
                await fs.readFile(path.join(privateDirectory, id, "owner.json"), "utf8"),
            );
            expect(owner.parentPid).toBe(parent.pid);
            expect(owner.phase).toBe("running");
            expect(recoverConfigurationVerifications(privateDirectory)).toEqual({
                removed: [id],
                blocked: [],
            });
            expect(await fs.readdir(privateDirectory)).toEqual([]);
        } finally {
            parent.kill("SIGKILL");
            await exited;
            await fs.rm(root, { recursive: true, force: true });
        }
    });
    it("超时和取消均清理私密目录，插件异常不泄露文案", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-config-fixture-"));
        const host = path.join(root, "node_modules/onebots");
        await fs.mkdir(host, { recursive: true });
        await fs.writeFile(
            path.join(host, "package.json"),
            JSON.stringify({ name: "onebots", type: "module", main: "index.js" }),
        );
        await fs.writeFile(path.join(host, "index.js"), "");
        await fs.writeFile(
            path.join(host, "plugin-loader.js"),
            `import fs from 'node:fs';
            const observedPath = ${JSON.stringify(path.join(root, "observed.json"))};
            fs.writeFileSync(observedPath+'.tmp', JSON.stringify({home:process.env.HOME,secret:process.env.ONEBOTS_TEST_SECRET,mode:fs.statSync(process.env.HOME+'/request.json').mode & 511}));
            fs.renameSync(observedPath+'.tmp', observedPath);
            await new Promise(()=>{});`,
        );
        try {
            process.env.ONEBOTS_TEST_SECRET = "private-value";
            await expect(
                verifyConfiguration({
                    runtimeRoot: root,
                    selection,
                    document: { secret: "value" },
                    timeoutMs: 400,
                }),
            ).rejects.toMatchObject({ code: "TIMEOUT", message: "配置验证未完成" });
            const observed = JSON.parse(
                await fs.readFile(path.join(root, "observed.json"), "utf8"),
            );
            expect(observed.mode).toBe(0o600);
            expect(observed.secret).toBeUndefined();
            await expect(fs.stat(observed.home)).rejects.toMatchObject({ code: "ENOENT" });
            await fs.rm(path.join(root, "observed.json"));
            const activeAbort = new AbortController();
            const pending = verifyConfiguration({
                runtimeRoot: root,
                selection,
                document: {},
                signal: activeAbort.signal,
            });
            const rejected = expect(pending).rejects.toMatchObject({ code: "CANCELLED" });
            for (let attempt = 0; attempt < 100; attempt++) {
                try {
                    await fs.stat(path.join(root, "observed.json"));
                    break;
                } catch {
                    await new Promise(resolve => setTimeout(resolve, 20));
                }
            }
            activeAbort.abort();
            await rejected;
            const cancelled = JSON.parse(
                await fs.readFile(path.join(root, "observed.json"), "utf8"),
            );
            await expect(fs.stat(cancelled.home)).rejects.toMatchObject({ code: "ENOENT" });
            const abort = new AbortController();
            abort.abort();
            await expect(
                verifyConfiguration({
                    runtimeRoot: root,
                    selection,
                    document: {},
                    signal: abort.signal,
                }),
            ).rejects.toMatchObject({ code: "CANCELLED" });
        } finally {
            delete process.env.ONEBOTS_TEST_SECRET;
            await fs.rm(root, { recursive: true, force: true });
        }
    });
});
