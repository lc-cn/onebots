import { describe, it, expect } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { inspectConfigurationRuntime } from "./configuration-runtime-inspect.js";
import { collectRuntimeSchemas } from "./configuration-schema-collection.js";

const empty = { adapters: [], protocols: [], applications: [] };
describe("受信运行环境 Schema 探测", () => {
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
                `import fs from 'node:fs';import {spawn} from 'node:child_process';const child=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});fs.writeFileSync(${JSON.stringify(path.join(root, "pid"))},JSON.stringify([process.pid,child.pid]));await new Promise(()=>{});`,
            );
            await expect(
                inspectConfigurationRuntime({
                    runtimeRoot: root,
                    selection: empty,
                    timeoutMs: 300,
                }),
            ).rejects.toThrow("运行环境配置能力探测未完成");
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
