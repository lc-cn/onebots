import { spawn } from "node:child_process";
import { once } from "node:events";
import {
    recoverConfigurationVerifications,
    readConfigurationVerificationOwner,
} from "./configuration-verify-ownership.js";
import { describe, it, expect, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectConfigurationRuntime } from "./configuration-runtime-inspect.js";
import { collectRuntimeSchemas } from "./configuration-schema-collection.js";

const empty = { adapters: [], protocols: [], applications: [] };
describe("受信运行环境 Schema 探测", () => {
    it.each(["spawning", "running"])(
        "父进程在 %s 阶段强杀仍保留可保守对账的所有权",
        async phase => {
            const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-inspect-owner-"));
            const privateRoot = path.join(root, "owners");
            const host = path.join(root, "node_modules/onebots");
            await fs.mkdir(host, { recursive: true });
            await fs.writeFile(
                path.join(host, "package.json"),
                JSON.stringify({ name: "onebots", type: "module", main: "index.js" }),
            );
            await fs.writeFile(path.join(host, "index.js"), "");
            await fs.writeFile(path.join(host, "plugin-loader.js"), "await new Promise(()=>{});");
            const source = new URL("./configuration-runtime-inspect.ts", import.meta.url).href;
            const script = `import fs from 'node:fs'; import {inspectConfigurationRuntime} from ${JSON.stringify(source)};
            const original = fs.renameSync;
            fs.renameSync = (...args) => {
                original(...args);
                if(String(args[1]).endsWith('/owner.json')) {
                    const owner=JSON.parse(fs.readFileSync(args[1],'utf8'));
                    if(owner.phase===${JSON.stringify(phase)}) process.kill(process.pid,'SIGKILL');
                }
            };
            await inspectConfigurationRuntime({runtimeRoot:${JSON.stringify(root)},privateRoot:${JSON.stringify(privateRoot)},selection:{adapters:[],protocols:[],applications:[]}});`;
            const parent = spawn(
                process.execPath,
                ["--import", import.meta.resolve("tsx/esm"), "--input-type=module", "-e", script],
                { stdio: "ignore" },
            );
            const closed = once(parent, "close");
            let workerPid: number | null = null;
            try {
                await closed;
                expect(parent.signalCode).toBe("SIGKILL");
                const ids = await fs.readdir(privateRoot);
                expect(ids).toHaveLength(1);
                const owner = readConfigurationVerificationOwner(path.join(privateRoot, ids[0]));
                expect(owner.phase).toBe(phase);
                workerPid = owner.workerPid;
                if (phase === "spawning") {
                    expect(recoverConfigurationVerifications(privateRoot).blocked).toEqual(ids);
                    expect(await fs.readdir(privateRoot)).toEqual(ids);
                } else {
                    // 父断连发生在 worker 安装监听前时，记录仍保留；绝不靠空内存映射删除。
                    const recovery = recoverConfigurationVerifications(privateRoot);
                    expect([...recovery.blocked, ...recovery.removed]).toEqual(ids);
                    if (recovery.removed.length)
                        expect(() => process.kill(-workerPid!, 0)).toThrow();
                }
            } finally {
                parent.kill("SIGKILL");
                await closed;
                if (workerPid) {
                    try {
                        process.kill(-workerPid, "SIGKILL");
                    } catch {
                        /* fixture may already be gone */
                    }
                }
                await fs.rm(root, { recursive: true, force: true });
            }
        },
    );
    it("空工作目录通过管理服务明确宿主入口探测，不依赖 cwd 安装 onebots", async () => {
        const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ob-empty-cwd-inspect-"));
        try {
            await expect(
                inspectConfigurationRuntime({ runtimeRoot, selection: empty }),
            ).rejects.toThrow("运行环境配置能力探测未完成");
            const result = await inspectConfigurationRuntime({
                runtimeRoot,
                selection: empty,
                hostEntrypoint: path.resolve("packages/onebots/lib/index.js"),
            });
            expect(result.schemas.adapters).toEqual({});
            expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
        } finally {
            await fs.rm(runtimeRoot, { recursive: true, force: true });
        }
    });
    it("未安装候选的空宿主能取得稳定 fingerprint，不读取无效配置文件", async () => {
        const result = await inspectConfigurationRuntime({
            runtimeRoot: path.resolve("development"),
            selection: empty,
        });
        expect(result.schemas).toMatchObject({
            adapters: {},
            protocols: {},
            applications: {},
            protocolMetadata: [],
        });
        expect(result.fingerprint).toMatch(/^[a-f0-9]{64}$/);
        const second = await inspectConfigurationRuntime({
            runtimeRoot: path.resolve("development"),
            selection: empty,
        });
        expect(second.fingerprint).toBe(result.fingerprint);
    });
    it("真实 Mock 与 OneBot 注册表采集元数据且不创建账号", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-inspect-real-"));
        try {
            await fs.mkdir(path.join(root, "node_modules/@onebots"), { recursive: true });
            for (const [name, directory] of [
                ["onebots", "packages/onebots"],
                ["@onebots/core", "packages/core"],
                ["@onebots/adapter-mock", "adapters/adapter-mock"],
                ["@onebots/protocol-onebot-v11", "protocols/onebot-v11/protocol"],
            ])
                await fs.symlink(path.resolve(directory), path.join(root, "node_modules", name));
            await fs.writeFile(path.join(root, "config.yaml"), "this is deliberately invalid: [");
            const result = await inspectConfigurationRuntime({
                runtimeRoot: root,
                selection: { adapters: ["mock"], protocols: ["onebot-v11"], applications: [] },
            });
            expect(result.schemas.protocolMetadata).toEqual([
                { registrationName: "onebot-v11", name: "onebot", version: "v11" },
            ]);
            expect(result.schemas.adapters).toHaveProperty("mock");
            expect(result.schemas.protocols).toHaveProperty("onebot-v11");
            const blank = await inspectConfigurationRuntime({
                runtimeRoot: root,
                selection: empty,
            });
            expect(result.fingerprint).not.toBe(blank.fingerprint);
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });
    it("fingerprint 绑定目标宿主 manifest 和入口字节", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-inspect-fingerprint-"));
        const host = path.join(root, "node_modules/onebots");
        const core = path.join(root, "node_modules/@onebots/core");
        try {
            await fs.mkdir(host, { recursive: true });
            await fs.mkdir(core, { recursive: true });
            await fs.writeFile(
                path.join(host, "package.json"),
                JSON.stringify({
                    name: "onebots",
                    main: "index.js",
                    type: "module",
                    version: "1.0.0",
                }),
            );
            await fs.writeFile(
                path.join(core, "package.json"),
                JSON.stringify({
                    name: "@onebots/core",
                    main: "index.js",
                    type: "module",
                    version: "1.0.0",
                }),
            );
            await fs.writeFile(path.join(host, "index.js"), "export const fixture = true;");
            await fs.writeFile(path.join(core, "index.js"), "export const fixture = true;");
            await fs.writeFile(
                path.join(host, "plugin-loader.js"),
                `export function inspectPlugin(){return {status:'ready',entryPath:${JSON.stringify(path.join(core, "index.js"))}}}`,
            );
            const first = await inspectConfigurationRuntime({
                runtimeRoot: root,
                selection: empty,
            });
            await fs.appendFile(path.join(host, "index.js"), "\n// changed entry bytes");
            const second = await inspectConfigurationRuntime({
                runtimeRoot: root,
                selection: empty,
            });
            expect(second.schemas).toEqual(first.schemas);
            expect(second.fingerprint).not.toBe(first.fingerprint);
            await fs.writeFile(
                path.join(core, "package.json"),
                JSON.stringify({
                    name: "@onebots/core",
                    main: "index.js",
                    type: "module",
                    version: "1.0.1",
                }),
            );
            const third = await inspectConfigurationRuntime({
                runtimeRoot: root,
                selection: empty,
            });
            expect(third.fingerprint).not.toBe(second.fingerprint);
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });
    it("共享序列化仅标记函数和访问器，不执行 Schema 用户代码", () => {
        let invoked = false;
        const schema = {
            field: {
                type: "string",
                validate() {
                    invoked = true;
                },
            },
        };
        Object.defineProperty(schema.field, "default", {
            enumerable: true,
            get() {
                invoked = true;
                return "secret";
            },
        });
        const core = {
            AdapterRegistry: { has: () => true, getSchema: () => schema },
        } as unknown as typeof import("@onebots/core");
        const result = JSON.parse(
            collectRuntimeSchemas(core, { adapters: ["fixture"], protocols: [], applications: [] }),
        );
        expect(invoked).toBe(false);
        expect(result.runtimeOnly).toContain("$.adapters.fixture.field.validate");
        expect(result.runtimeOnly).toContain("$.adapters.fixture.field.default");
    });
    it.each(["transient", "permanent"])("Schema清理 %s EPERM仍只凭ESRCH释放owner", async mode => {
        const runtimeRoot = await fs.mkdtemp(path.join(os.tmpdir(), "ob-inspect-permission-"));
        const privateRoot = path.join(runtimeRoot, "owners");
        const original = process.kill.bind(process);
        let calls = 0;
        const mocked = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
            if (pid < 0 && signal === 0 && (mode === "permanent" || calls++ === 0))
                throw Object.assign(new Error("permission"), { code: "EPERM" });
            return original(pid, signal);
        });
        try {
            const pending = inspectConfigurationRuntime({
                runtimeRoot,
                privateRoot,
                selection: empty,
                hostEntrypoint: path.resolve("packages/onebots/lib/index.js"),
            });
            if (mode === "transient") {
                await expect(pending).resolves.toHaveProperty("fingerprint");
                expect(await fs.readdir(privateRoot)).toEqual([]);
            } else {
                await expect(pending).rejects.toThrow("运行环境配置能力探测未完成");
                expect(await fs.readdir(privateRoot)).toHaveLength(1);
            }
        } finally {
            mocked.mockRestore();
            await fs.rm(runtimeRoot, { recursive: true, force: true });
        }
    });
    it("缺失扩展、取消和超时只返回固定错误并回收进程", async () => {
        const root = await fs.mkdtemp(path.join(os.tmpdir(), "ob-inspect-wait-"));
        try {
            await fs.mkdir(path.join(root, "node_modules/onebots"), { recursive: true });
            await fs.writeFile(
                path.join(root, "node_modules/onebots/package.json"),
                JSON.stringify({ name: "onebots", type: "module", main: "index.js" }),
            );
            await fs.writeFile(path.join(root, "node_modules/onebots/index.js"), "");
            await fs.writeFile(
                path.join(root, "node_modules/onebots/plugin-loader.js"),
                `import fs from 'node:fs';const owner=JSON.parse(fs.readFileSync(process.env.HOME+'/owner.json','utf8'));if(owner.phase!=='running'||owner.workerPid!==process.pid)throw new Error('ownership');import {spawn} from 'node:child_process';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(path.join(root, "pid"))},JSON.stringify([process.pid,child.pid]));await new Promise(()=>{});`,
            );
            await expect(
                inspectConfigurationRuntime({
                    runtimeRoot: root,
                    selection: empty,
                    timeoutMs: 300,
                    privateRoot: path.join(root, "owners"),
                }),
            ).rejects.toThrow("运行环境配置能力探测未完成");
            expect(await fs.readdir(path.join(root, "owners"))).toEqual([]);
            const pids: number[] = JSON.parse(await fs.readFile(path.join(root, "pid"), "utf8"));
            for (const pid of pids) expect(() => process.kill(pid, 0)).toThrow();
            const abort = new AbortController();
            abort.abort();
            await expect(
                inspectConfigurationRuntime({
                    runtimeRoot: root,
                    selection: empty,
                    signal: abort.signal,
                }),
            ).rejects.toThrow("运行环境配置能力探测未完成");
        } finally {
            await fs.rm(root, { recursive: true, force: true });
        }
    });
});
