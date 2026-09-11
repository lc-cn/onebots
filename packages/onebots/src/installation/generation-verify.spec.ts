import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { once } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGenerationPlan } from "./generation-plan.js";
import { verifyGeneration } from "./generation-verify.js";

const directories: string[] = [];
afterEach(() => {
    vi.unstubAllEnvs();
    for (const directory of directories.splice(0))
        fs.rmSync(directory, { recursive: true, force: true });
});

function fixture() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-verify-test-"));
    directories.push(directory);
    const writePackage = (
        name: string,
        extra: object = {},
        source = "export {};",
        parent = directory,
    ) => {
        const root = path.join(parent, "node_modules", name);
        fs.mkdirSync(path.join(root, "lib"), { recursive: true });
        fs.writeFileSync(
            path.join(root, "package.json"),
            JSON.stringify({
                name,
                version: "1.0.0",
                type: "module",
                main: "lib/index.js",
                ...extra,
            }),
        );
        fs.writeFileSync(path.join(root, "lib/index.js"), source);
        return root;
    };
    fs.writeFileSync(path.join(directory, "package.json"), '{"type":"module"}');
    fs.writeFileSync(path.join(directory, "pnpm-lock.yaml"), "lockfileVersion: '9.0'");
    const core = writePackage(
        "@onebots/core",
        {},
        `
        export const schemas = new Map();
        export const AdapterRegistry = { has: name => schemas.has(name), getSchema: name => schemas.get(name) };
        export const ProtocolRegistry = { has: () => false };
        export const ApplicationRegistry = { has: () => false };
    `,
    );
    const host = writePackage(
        "onebots",
        { dependencies: { "@onebots/core": "1.0.0" } },
        `
        if (process.env.NODE_AUTH_TOKEN || process.env.NPM_TOKEN || process.env.GITHUB_TOKEN || process.env.ONEBOTS_ACCESS_TOKEN || process.env.NODE_OPTIONS)
            throw new Error('inherited credential');
        if (process.cwd() !== ${JSON.stringify(fs.realpathSync(directory))}) throw new Error('wrong cwd');
        globalThis.onebotsVerificationHostLoaded = true;
    `,
    );
    fs.mkdirSync(path.join(host, "lib/gateway"));
    fs.writeFileSync(
        path.join(host, "lib/gateway/entry.js"),
        "throw new Error('gateway must not be started');",
    );
    fs.writeFileSync(
        path.join(host, "lib/plugin-loader.js"),
        `
        import { pathToFileURL } from 'node:url';
        import fs from 'node:fs';
        import path from 'node:path';
        export function inspectPlugin(candidates, require) {
            const file = require.resolve.paths(candidates[0]).map(root => path.join(root, candidates[0], 'package.json')).find(file => fs.existsSync(file));
            return { status: 'ready', entryPath: path.join(path.dirname(file), 'lib/index.js') };
        }
        export async function tryLoadRegisteredPlugin(type, name, candidates, require) {
            if (!globalThis.onebotsVerificationHostLoaded) throw new Error('host not loaded');
            await import(pathToFileURL(require.resolve(candidates[0])).href);
            return { loaded: true };
        }
    `,
    );
    const plugin = writePackage(
        "@onebots/adapter-fixture",
        { peerDependencies: { onebots: "^1.0.0" } },
        `
        import { schemas } from '@onebots/core';
        schemas.set('fixture', { token: { type: 'string', sensitive: true, validator: () => true }, name: { pattern: /abc/i } });
    `,
    );
    const plan = createGenerationPlan({
        host: { name: "onebots", version: "1.0.0", spec: "1.0.0" },
        core: { name: "@onebots/core", version: "1.0.0", spec: "1.0.0" },
        extensions: [
            {
                type: "adapter",
                name: "fixture",
                packageName: "@onebots/adapter-fixture",
                version: "1.0.0",
                spec: "1.0.0",
                peerDependencies: { onebots: "^1.0.0" },
            },
        ],
        selection: { adapters: ["fixture"], protocols: [], applications: [] },
    });
    return { directory, host, core, plugin, plan, writePackage };
}

describe("generation verification worker", () => {
    it("从实际注册表导出协议映射并与配置读取共用收据工件", async () => {
        const test = fixture();
        fs.appendFileSync(
            path.join(test.core, "lib/index.js"),
            `
            ProtocolRegistry.getProtocolNames = () => ['custom-wire'];
            ProtocolRegistry.getVersions = name => name === 'custom-wire' ? ['v2'] : [];
            ProtocolRegistry.has = (name, version) => name === 'custom-wire' && version === 'v2';
            ProtocolRegistry.getSchema = key => key === 'custom-wire.v2' ? { token: { type: 'string', sensitive: true } } : undefined;
        `,
        );
        test.writePackage("@onebots/protocol-custom-wire-v2");
        const plan = createGenerationPlan({
            ...test.plan,
            extensions: [
                ...test.plan.extensions,
                {
                    type: "protocol",
                    name: "custom-wire-v2",
                    packageName: "@onebots/protocol-custom-wire-v2",
                    version: "1.0.0",
                    spec: "1.0.0",
                    peerDependencies: {},
                },
            ],
            selection: { ...test.plan.selection, protocols: ["custom-wire-v2"] },
        });
        const verification = await verifyGeneration(test.directory, plan);
        const schemas = JSON.parse(
            fs.readFileSync(path.join(test.directory, "schemas.json"), "utf8"),
        );
        expect(schemas.protocolMetadata).toEqual([
            { registrationName: "custom-wire-v2", name: "custom-wire", version: "v2" },
        ]);
        const { GenerationStore } = await import("./generation-store.js");
        const { readGenerationConfigurationSchema } =
            await import("../configuration/configuration-runtime-schema.js");
        const store = new GenerationStore({
            root: path.join(test.directory, "generations"),
            isActive: () => false,
        });
        const candidate = store.allocate("schema-test", plan.digest);
        fs.cpSync(
            path.join(test.directory, "node_modules"),
            path.join(candidate.directory, "node_modules"),
            { recursive: true },
        );
        for (const name of ["pnpm-lock.yaml", "schemas.json"])
            fs.copyFileSync(path.join(test.directory, name), path.join(candidate.directory, name));
        store.commitVerified(candidate.id, verification);
        const bundle = readGenerationConfigurationSchema(store, candidate.id);
        expect(bundle.protocols["custom-wire.v2"].token).toEqual({
            type: "string",
            sensitive: true,
        });
        expect(bundle.protocols["custom-wire-v2"]).toBeUndefined();
        fs.appendFileSync(path.join(candidate.directory, "schemas.json"), " ");
        expect(() => readGenerationConfigurationSchema(store, candidate.id)).toThrow(
            "运行版本缺少有效配置 Schema",
        );
    });
    it.skipIf(process.platform === "win32")(
        "管理父进程强杀后IPC断连回收验证worker及其helper",
        async () => {
            const test = fixture();
            const pidFile = path.join(test.directory, "disconnect-helper.json");
            const privateRoot = path.join(test.directory, "owners");
            fs.appendFileSync(
                path.join(test.plugin, "lib/index.js"),
                `
import {spawn} from 'node:child_process';
import fs from 'node:fs';
const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'ignore'});
const owner=JSON.parse(fs.readFileSync(process.env.HOME+"/owner.json","utf8"));
if(owner.phase!=="running" || owner.workerPid!==process.pid) throw new Error("ownership before import");
fs.writeFileSync(${JSON.stringify(pidFile + ".tmp")}, JSON.stringify({helper:helper.pid,worker:process.pid}));
fs.renameSync(${JSON.stringify(pidFile + ".tmp")}, ${JSON.stringify(pidFile)});
await new Promise(() => {});
`,
            );
            const source = new URL("./generation-verify.ts", import.meta.url).href;
            const parent = spawn(
                process.execPath,
                [
                    "--import",
                    import.meta.resolve("tsx/esm"),
                    "--input-type=module",
                    "-e",
                    `import {verifyGeneration} from ${JSON.stringify(source)}; await verifyGeneration(${JSON.stringify(test.directory)},${JSON.stringify(test.plan)},{privateRoot:${JSON.stringify(privateRoot)}});`,
                ],
                { stdio: "ignore" },
            );
            const closed = once(parent, "close");
            let pids: { helper: number; worker: number } | undefined;
            try {
                for (let attempt = 0; !fs.existsSync(pidFile) && attempt < 200; attempt++)
                    await new Promise(resolve => setTimeout(resolve, 10));
                pids = JSON.parse(fs.readFileSync(pidFile, "utf8"));
                expect(pids && [pids.helper, pids.worker].every(pid => Number.isSafeInteger(pid) && pid > 0)).toBe(true);
                const owners = fs.readdirSync(privateRoot);
                expect(owners).toHaveLength(1);
                const owner = JSON.parse(
                    fs.readFileSync(path.join(privateRoot, owners[0], "owner.json"), "utf8"),
                );
                expect(owner).toMatchObject({
                    phase: "running",
                    workerPid: pids!.worker,
                    parentPid: parent.pid,
                });
                parent.kill("SIGKILL");
                await closed;
                for (const pid of [pids!.helper, pids!.worker]) {
                    let absent = false;
                    for (let attempt = 0; attempt < 200; attempt++) {
                        try {
                            process.kill(pid, 0);
                        } catch {
                            absent = true;
                            break;
                        }
                        await new Promise(resolve => setTimeout(resolve, 10));
                    }
                    expect(absent).toBe(true);
                }
                expect(fs.existsSync(path.join(privateRoot, owners[0], "owner.json"))).toBe(true);
                expect(fs.existsSync(path.join(test.directory, "schemas.json"))).toBe(false);
            } finally {
                parent.kill("SIGKILL");
                await closed;
                for (const pid of pids ? [pids.helper, pids.worker] : []) {
                    try {
                        process.kill(pid, "SIGKILL");
                    } catch {
                        /* Expected already reaped. */
                    }
                }
            }
        },
    );
    it.skipIf(process.platform === "win32").each(["timeout", "abort"])(
        "%s 时验证worker及其普通子进程均退出",
        async mode => {
            const test = fixture();
            const pidFile = path.join(test.directory, "helper-cancel.pid");
            const groupFile = path.join(test.directory, "helper-cancel.pgid");
            fs.appendFileSync(
                path.join(test.plugin, "lib/index.js"),
                `
import {spawn} from 'node:child_process';
import fs from 'node:fs';
const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'ignore'});
fs.writeFileSync(${JSON.stringify(groupFile)}, String(process.pid));
fs.writeFileSync(${JSON.stringify(pidFile + ".tmp")}, String(helper.pid));
fs.renameSync(${JSON.stringify(pidFile + ".tmp")}, ${JSON.stringify(pidFile)});
await new Promise(() => {});
`,
            );
            const cancellation = new AbortController();
            const pending = verifyGeneration(test.directory, test.plan, {
                timeoutMs: mode === "timeout" ? 500 : 5000,
                signal: cancellation.signal,
                privateRoot: path.join(test.directory, "owners"),
            }).then(
                () => null,
                error => error,
            );
            let pid: number | undefined;
            try {
                for (let attempt = 0; !fs.existsSync(pidFile) && attempt < 100; attempt++)
                    await new Promise(resolve => setTimeout(resolve, 10));
                pid = Number(fs.readFileSync(pidFile, "utf8"));
                expect(Number.isSafeInteger(pid) && pid > 0, "helper PID必须完整且为正整数").toBe(true);
                if (mode === "abort") cancellation.abort();
                expect(await pending).toBeInstanceOf(Error);
                expect(fs.readdirSync(path.join(test.directory, "owners"))).toEqual([]);
                let probeThrew = false;
                try {
                    process.kill(pid!, 0);
                } catch {
                    probeThrew = true; /* 与原toThrow断言保持完全相同的成功条件。 */
                }
                let diagnostic: string | undefined;
                if (!probeThrew) {
                    const expectedGroup = fs.readFileSync(groupFile, "utf8").trim();
                    let snapshot: string;
                    try {
                        snapshot =
                            execFileSync(
                                "/bin/ps",
                                ["-o", "pid=,ppid=,pgid=,stat=,lstart=", "-p", String(pid)],
                                {
                                    encoding: "utf8",
                                    timeout: 2000,
                                    stdio: ["ignore", "pipe", "pipe"],
                                },
                            ).trim() || "PID在ps取证时已消失";
                    } catch (error) {
                        const detail = error as {
                            status?: number;
                            stdout?: string | Buffer;
                            stderr?: string | Buffer;
                        };
                        snapshot =
                            detail.status === 1 &&
                            !String(detail.stdout ?? "").trim() &&
                            !String(detail.stderr ?? "").trim()
                                ? "PID在ps取证时已消失"
                                : "ps取证不可用（无权限或查询失败）";
                    }
                    diagnostic = `helper PID=${pid}; expected worker PGID=${expectedGroup}; initial kill(pid,0) succeeded; ps(pid,ppid,pgid,stat,lstart): ${snapshot}`;
                }
                expect(probeThrew, diagnostic).toBe(true);
                expect(fs.existsSync(path.join(test.directory, "schemas.json"))).toBe(false);
            } finally {
                cancellation.abort();
                await pending;
                // worker所属进程组由verifyGeneration回收；旧PID可能已重用，测试不盲杀。
            }
        },
    );
    it.skipIf(process.platform === "win32").each(["transient", "permanent"])(
        "%s EPERM只在确认ESRCH后释放所有权",
        async mode => {
            const test = fixture(),
                privateRoot = path.join(test.directory, "owners");
            const original = process.kill.bind(process);
            let probes = 0;
            const probe = vi.spyOn(process, "kill").mockImplementation((pid, signal) => {
                if (pid < 0 && signal === 0) {
                    probes++;
                    if (mode === "permanent" || probes === 1)
                        throw Object.assign(new Error("permission"), { code: "EPERM" });
                }
                return original(pid, signal);
            });
            try {
                const result = verifyGeneration(test.directory, test.plan, { privateRoot });
                if (mode === "transient") {
                    await expect(result).resolves.toHaveProperty("checks.singleHost", true);
                    expect(fs.readdirSync(privateRoot)).toEqual([]);
                } else {
                    await expect(result).rejects.toThrow("候选验证进程组无法确认退出");
                    const owners = fs.readdirSync(privateRoot);
                    expect(owners).toHaveLength(1);
                    expect(
                        JSON.parse(
                            fs.readFileSync(
                                path.join(privateRoot, owners[0], "owner.json"),
                                "utf8",
                            ),
                        ).phase,
                    ).toBe("running");
                    expect(fs.existsSync(path.join(test.directory, "schemas.json"))).toBe(false);
                }
                expect(probes).toBeGreaterThan(1);
            } finally {
                probe.mockRestore();
            }
        },
    );
    it.skipIf(process.platform === "win32")("验证返回前回收插件加载产生的普通子进程", async () => {
        const test = fixture();
        const pidFile = path.join(test.directory, "helper.pid");
        fs.appendFileSync(
            path.join(test.plugin, "lib/index.js"),
            `
import {spawn} from 'node:child_process';
import fs from 'node:fs';
const helper = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {stdio:'ignore'});
helper.unref();
fs.writeFileSync(${JSON.stringify(pidFile + ".tmp")}, String(helper.pid));
fs.renameSync(${JSON.stringify(pidFile + ".tmp")}, ${JSON.stringify(pidFile)});
`,
        );
        let pid: number | undefined;
        try {
            await verifyGeneration(test.directory, test.plan);
            pid = Number(fs.readFileSync(pidFile, "utf8"));
            expect(Number.isSafeInteger(pid) && pid > 0).toBe(true);
            expect(() => process.kill(pid!, 0)).toThrow();
        } finally {
            if (!pid && fs.existsSync(pidFile)) pid = Number(fs.readFileSync(pidFile, "utf8"));
            if (pid) {
                try {
                    process.kill(pid, "SIGKILL");
                } catch {
                    /* The expected result is already reaped. */
                }
            }
        }
    });
    it.each(["missing", "incompatible"])(
        "安装后manifest遗漏原始必需peer时仍拒绝 %s SDK",
        async mode => {
            const test = fixture();
            const plan = createGenerationPlan({
                ...test.plan,
                extensions: test.plan.extensions.map(extension => ({
                    ...extension,
                    peerDependencies: { ...extension.peerDependencies, "required-sdk": "^2.0.0" },
                })),
            });
            // Actual plugin manifest has no required-sdk peer; the accepted plan still requires it.
            if (mode === "incompatible") test.writePackage("required-sdk");
            await expect(verifyGeneration(test.directory, plan)).rejects.toThrow("验证失败");
        },
    );
    it("真实子进程加载候选自己的宿主/注册表，凭据不继承，输出声明Schema", async () => {
        const test = fixture();
        for (const key of [
            "NODE_AUTH_TOKEN",
            "NPM_TOKEN",
            "GITHUB_TOKEN",
            "ONEBOTS_ACCESS_TOKEN",
            "NODE_OPTIONS",
        ])
            vi.stubEnv(key, "synthetic-secret");
        const evidence = await verifyGeneration(test.directory, test.plan);
        expect(evidence.planDigest).toBe(test.plan.digest);
        expect(Object.values(evidence.checks).every(value => value === true)).toBe(true);
        const schemas = JSON.parse(
            fs.readFileSync(path.join(test.directory, "schemas.json"), "utf8"),
        );
        expect(schemas.adapters.fixture.token).toEqual({ type: "string", sensitive: true });
        expect(schemas.adapters.fixture.name.pattern).toEqual({ source: "abc", flags: "i" });
        expect(schemas.runtimeOnly).toContain("$.adapters.fixture.token.validator");
        expect(JSON.stringify(schemas)).not.toContain("synthetic-secret");
        expect(fs.existsSync(path.join(test.directory, "receipt.json"))).toBe(false);
        expect(fs.existsSync(path.join(test.directory, "config.yaml"))).toBe(false);
    });

    it("缺少真实gateway入口不能视为可启动", async () => {
        const test = fixture();
        fs.unlinkSync(path.join(test.host, "lib/gateway/entry.js"));
        await expect(verifyGeneration(test.directory, test.plan)).rejects.toThrow("验证失败");
        expect(fs.existsSync(path.join(test.directory, "schemas.json"))).toBe(false);
    });

    it("使用候选loader解析仅含import条件导出的core", async () => {
        const test = fixture();
        const file = path.join(test.core, "package.json");
        const metadata = JSON.parse(fs.readFileSync(file, "utf8"));
        fs.writeFileSync(
            file,
            JSON.stringify({ ...metadata, exports: { ".": { import: "./lib/index.js" } } }),
        );
        await expect(verifyGeneration(test.directory, test.plan)).resolves.toHaveProperty(
            "checks.singleHost",
            true,
        );
    });

    it("拒绝插件嵌套的另一份宿主", async () => {
        const test = fixture();
        test.writePackage("onebots", {}, "export {};", test.plugin);
        await expect(verifyGeneration(test.directory, test.plan)).rejects.toThrow("验证失败");
    });

    it.each(["missing", "incompatible"])("读取实际manifest并拒绝 %s 必需peer", async mode => {
        const test = fixture();
        fs.writeFileSync(
            path.join(test.plugin, "package.json"),
            JSON.stringify({
                name: "@onebots/adapter-fixture",
                version: "1.0.0",
                type: "module",
                main: "lib/index.js",
                peerDependencies: { requiredSdk: "^2.0.0" },
            }),
        );
        if (mode === "incompatible") test.writePackage("requiredSdk");
        await expect(verifyGeneration(test.directory, test.plan)).rejects.toThrow("验证失败");
    });

    it("缺少实际注册不得只凭loader返回成功生成Schema", async () => {
        const test = fixture();
        fs.writeFileSync(path.join(test.plugin, "lib/index.js"), "export {};");
        await expect(verifyGeneration(test.directory, test.plan)).rejects.toThrow("验证失败");
    });

    it("缺失可选依赖可跳过，但存在的越界可选依赖不能静默跳过", async () => {
        const test = fixture();
        const file = path.join(test.plugin, "package.json");
        const manifest = JSON.parse(fs.readFileSync(file, "utf8"));
        fs.writeFileSync(
            file,
            JSON.stringify({ ...manifest, optionalDependencies: { optionalSdk: "1.0.0" } }),
        );
        await expect(verifyGeneration(test.directory, test.plan)).resolves.toHaveProperty(
            "checks.peerDependencies",
            true,
        );
        const other = fixture();
        const outside = other.writePackage("optionalSdk");
        fs.symlinkSync(outside, path.join(test.directory, "node_modules/optionalSdk"), "dir");
        await expect(verifyGeneration(test.directory, test.plan)).rejects.toThrow("验证失败");
    });

    it("越界宿主链接和篡改计划都拒绝", async () => {
        const test = fixture();
        const other = fixture();
        fs.rmSync(test.host, { recursive: true });
        fs.symlinkSync(other.host, test.host, "dir");
        await expect(verifyGeneration(test.directory, test.plan)).rejects.toThrow("验证失败");
        await expect(
            verifyGeneration(other.directory, { ...other.plan, digest: "0".repeat(64) }),
        ).rejects.toThrow("计划");
    });

    it("超时与取消回收worker，不生成成功产物或泄漏插件异常", async () => {
        const test = fixture();
        fs.writeFileSync(path.join(test.plugin, "lib/index.js"), "await new Promise(() => {});");
        await expect(
            verifyGeneration(test.directory, test.plan, { timeoutMs: 200 }),
        ).rejects.toThrow("超时");
        const controller = new AbortController();
        const result = verifyGeneration(test.directory, test.plan, { signal: controller.signal });
        controller.abort();
        await expect(result).rejects.toThrow("取消");
        fs.writeFileSync(
            path.join(test.plugin, "lib/index.js"),
            "throw new Error('synthetic-secret');",
        );
        await expect(verifyGeneration(test.directory, test.plan)).rejects.toThrow(
            /^候选依赖、宿主身份或插件注册验证失败$/,
        );
        expect(fs.existsSync(path.join(test.directory, "schemas.json"))).toBe(false);
    });
});
