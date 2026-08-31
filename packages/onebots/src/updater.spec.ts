import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ServiceSpec } from "./service-manager.js";
import {
    loadTargetExtensionVersionCatalog,
    packageNamesFor,
    refreshServiceAfterUpdate,
    resolveInstalledPackageVersion,
    resolveUpdatePluginSelection,
    resolveVerifiedUpdateTargets,
    runUpdatedServicePreflight,
} from "./updater.js";
import { readServiceInstanceId, verifyServiceOnline } from "./service-online-verification.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function temporaryServiceSpec(): ServiceSpec {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-update-preflight-"));
    temporaryDirectories.push(directory);
    const configPath = path.join(directory, "config.yaml");
    fs.writeFileSync(configPath, "general: {}\n", "utf8");
    return {
        scope: "user",
        configPath,
        adapters: ["mock"],
        protocols: ["onebot-v11"],
        nodePath: process.execPath,
        binPath: path.join(directory, "updated-cli.mjs"),
        workingDirectory: directory,
    };
}

function fakeController(running: boolean) {
    return {
        status: vi.fn(() => ({ running })),
        install: vi.fn(async (_spec: ServiceSpec) => undefined),
        restart: vi.fn(async () => undefined),
    };
}

function writePackageManifest(root: string, name: string, version: string): void {
    const manifest = path.join(root, "node_modules", ...name.split("/"), "package.json");
    fs.mkdirSync(path.dirname(manifest), { recursive: true });
    fs.writeFileSync(manifest, JSON.stringify({ name, version }), "utf8");
}

function refreshDependencies(
    overrides: {
        preflight?: () => void | Promise<void>;
        confirmRestart?: () => Promise<boolean>;
        readInstanceId?: (spec: ServiceSpec) => Promise<string | null>;
        verifyOnline?: (
            spec: ServiceSpec,
            expectedVersion: string,
            previousInstanceId: string | null,
        ) => Promise<void>;
    } = {},
) {
    return {
        preflight: overrides.preflight ?? vi.fn(async () => undefined),
        confirmRestart: overrides.confirmRestart ?? vi.fn(async () => true),
        readInstanceId: overrides.readInstanceId ?? vi.fn(async () => "previous-instance"),
        verifyOnline: overrides.verifyOnline ?? vi.fn(async () => undefined),
    };
}

describe("post-update service safety", () => {
    it("使用目标 OneBots 目录固定所有插件版本而不是各自追随 latest", () => {
        expect(
            resolveVerifiedUpdateTargets(
                ["onebots", "@onebots/adapter-mock", "@onebots/protocol-onebot-v11"],
                "1.3.0",
                {
                    schemaVersion: 2,
                    packages: {
                        "@onebots/adapter-mock": { version: "2.4.0" },
                        "@onebots/protocol-onebot-v11": { version: "3.0.8" },
                    },
                },
            ),
        ).toEqual([
            { name: "onebots", target: "1.3.0" },
            { name: "@onebots/adapter-mock", target: "2.4.0" },
            { name: "@onebots/protocol-onebot-v11", target: "3.0.8" },
        ]);
    });

    it("目标目录缺项或损坏时在生成安装命令前失败", () => {
        expect(() =>
            resolveVerifiedUpdateTargets(["onebots", "@onebots/adapter-mock"], "1.3.0", {
                schemaVersion: 2,
                packages: {},
            }),
        ).toThrow("目标 OneBots 的扩展版本目录缺少 @onebots/adapter-mock");
        expect(() =>
            resolveVerifiedUpdateTargets(["onebots"], "1.3.0", {
                schemaVersion: 1,
                packages: {},
            }),
        ).toThrow("目标 OneBots 的扩展版本目录格式无效");
    });

    it("目标主程序版本未变化时直接读取当前安装目录，不运行暂存安装", () => {
        const spec = temporaryServiceSpec();
        writePackageManifest(spec.workingDirectory, "onebots", "1.3.0");
        const catalog = path.join(
            spec.workingDirectory,
            "node_modules",
            "onebots",
            "lib",
            "extension-capability-catalog.json",
        );
        fs.mkdirSync(path.dirname(catalog), { recursive: true });
        fs.writeFileSync(
            catalog,
            JSON.stringify({
                schemaVersion: 2,
                packages: { "@onebots/adapter-mock": { version: "2.4.0" } },
            }),
        );

        expect(loadTargetExtensionVersionCatalog("npm", spec.workingDirectory, "1.3.0")).toEqual({
            schemaVersion: 2,
            packages: { "@onebots/adapter-mock": { version: "2.4.0" } },
        });
    });

    it("目标主程序变化时以禁用脚本的隔离安装读取新目录", () => {
        const spec = temporaryServiceSpec();
        const bin = path.join(spec.workingDirectory, "bin");
        const marker = path.join(spec.workingDirectory, "staging-command.txt");
        fs.mkdirSync(bin);
        const npm = path.join(bin, "npm");
        fs.writeFileSync(
            npm,
            `#!/bin/sh
printf '%s\n' "$*" > "$UPDATE_MARKER"
mkdir -p node_modules/onebots/lib
cat > node_modules/onebots/package.json <<'EOF'
{"name":"onebots","version":"1.3.0"}
EOF
cat > node_modules/onebots/lib/extension-capability-catalog.json <<'EOF'
{"schemaVersion":2,"packages":{"@onebots/adapter-mock":{"version":"2.5.0"}}}
EOF
`,
            { mode: 0o755 },
        );
        vi.stubEnv("PATH", `${bin}:${process.env.PATH ?? ""}`);
        vi.stubEnv("UPDATE_MARKER", marker);

        expect(loadTargetExtensionVersionCatalog("npm", spec.workingDirectory, "1.3.0")).toEqual({
            schemaVersion: 2,
            packages: { "@onebots/adapter-mock": { version: "2.5.0" } },
        });
        expect(fs.readFileSync(marker, "utf8").trim()).toBe(
            "install --ignore-scripts --no-save --omit=dev onebots@1.3.0",
        );
    });

    it("bypasses caches when recording the pre-update service instance", async () => {
        const spec = temporaryServiceSpec();
        const fetcher = vi.fn<typeof fetch>(
            async () =>
                new Response(JSON.stringify({ instance_id: "current-instance" }), { status: 200 }),
        );

        await expect(readServiceInstanceId(spec, fetcher)).resolves.toBe("current-instance");
        expect(fetcher).toHaveBeenCalledWith(
            "http://127.0.0.1:6727/health",
            expect.objectContaining({ cache: "no-store", signal: expect.any(AbortSignal) }),
        );
    });

    it("使用当前配置中的 Web 后装插件覆盖过期服务快照", () => {
        const spec = temporaryServiceSpec();
        fs.writeFileSync(
            spec.configPath,
            "plugins:\n  adapters: [slack, telegram]\n  protocols: [milky-v1]\ngeneral: {}\n",
        );

        const selection = resolveUpdatePluginSelection({ adapters: [], protocols: [] }, spec);

        expect(selection).toEqual({
            adapters: ["slack", "telegram"],
            protocols: ["milky-v1"],
        });
        expect(packageNamesFor(selection.adapters, selection.protocols)).toEqual([
            "onebots",
            "@onebots/adapter-slack",
            "@onebots/adapter-telegram",
            "@onebots/protocol-milky-v1",
        ]);
    });

    it("按类别保留显式参数，并让另一类别使用当前配置", () => {
        const spec = temporaryServiceSpec();
        fs.writeFileSync(
            spec.configPath,
            "plugins:\n  adapters: [slack]\n  protocols: [milky-v1]\ngeneral: {}\n",
        );

        expect(
            resolveUpdatePluginSelection({ adapters: ["telegram"], protocols: [] }, spec),
        ).toEqual({ adapters: ["telegram"], protocols: ["milky-v1"] });
    });

    it("旧配置缺少 plugins 时回退服务快照", () => {
        const spec = temporaryServiceSpec();

        expect(resolveUpdatePluginSelection({ adapters: [], protocols: [] }, spec)).toEqual({
            adapters: ["mock"],
            protocols: ["onebot-v11"],
        });
    });

    it("当前配置的插件选择损坏时拒绝使用过期快照", () => {
        const spec = temporaryServiceSpec();
        fs.writeFileSync(spec.configPath, "plugins:\n  adapters: invalid\n", "utf8");

        expect(() => resolveUpdatePluginSelection({ adapters: [], protocols: [] }, spec)).toThrow(
            "plugins.adapters 必须是字符串数组",
        );
    });

    it("falls back to packages beside the current OneBots installation for a global CLI", () => {
        const spec = temporaryServiceSpec();
        const globalRoot = path.join(spec.workingDirectory, "global");
        const cliEntry = path.join(globalRoot, "node_modules", "onebots", "lib", "bin.js");
        fs.mkdirSync(path.dirname(cliEntry), { recursive: true });
        fs.writeFileSync(cliEntry, "", "utf8");
        writePackageManifest(globalRoot, "@onebots/core", "1.2.5");

        expect(
            resolveInstalledPackageVersion(
                "@onebots/core",
                path.join(spec.workingDirectory, "unrelated-cwd"),
                cliEntry,
            ),
        ).toBe("1.2.5");
    });

    it("does not rewrite or restart the service when the updated runtime fails preflight", async () => {
        const controller = fakeController(true);
        const spec = temporaryServiceSpec();
        const confirmRestart = vi.fn(async () => true);
        const recoverPreflightFailure = vi.fn(async () => undefined);

        await expect(
            refreshServiceAfterUpdate(controller, spec, {
                expectedVersion: "1.3.0",
                yes: true,
                recoverPreflightFailure,
                dependencies: refreshDependencies({
                    preflight: async () => {
                        throw new Error("updated plugin failed");
                    },
                    confirmRestart,
                }),
            }),
        ).rejects.toThrow(/预检失败，已恢复更新前依赖.*updated plugin failed/);
        expect(recoverPreflightFailure).toHaveBeenCalledOnce();
        expect(controller.install).not.toHaveBeenCalled();
        expect(controller.restart).not.toHaveBeenCalled();
        expect(confirmRestart).not.toHaveBeenCalled();
    });

    it("新运行环境预检与依赖恢复都失败时保留双方证据", async () => {
        const controller = fakeController(true);

        await expect(
            refreshServiceAfterUpdate(controller, temporaryServiceSpec(), {
                expectedVersion: "1.3.0",
                yes: true,
                recoverPreflightFailure: async () => {
                    throw new Error("lockfile is read-only");
                },
                dependencies: refreshDependencies({
                    preflight: async () => {
                        throw new Error("updated plugin failed");
                    },
                }),
            }),
        ).rejects.toThrow(/updated plugin failed.*lockfile is read-only/);
        expect(controller.install).not.toHaveBeenCalled();
        expect(controller.restart).not.toHaveBeenCalled();
    });

    it("rewrites and restarts a running service only after preflight succeeds", async () => {
        const controller = fakeController(true);
        const spec = temporaryServiceSpec();
        const order: string[] = [];
        controller.install.mockImplementation(async () => {
            order.push("install");
        });
        controller.restart.mockImplementation(async () => {
            order.push("restart");
        });

        const result = await refreshServiceAfterUpdate(controller, spec, {
            expectedVersion: "1.3.0",
            yes: true,
            dependencies: refreshDependencies({
                preflight: async () => {
                    order.push("preflight");
                },
                confirmRestart: vi.fn(async () => false),
                readInstanceId: async () => {
                    order.push("read-instance");
                    return "previous-instance";
                },
                verifyOnline: async (_spec, version, previousInstanceId) => {
                    order.push(`verify:${version}:${previousInstanceId}`);
                },
            }),
        });

        expect(order).toEqual([
            "preflight",
            "install",
            "read-instance",
            "restart",
            "verify:1.3.0:previous-instance",
        ]);
        expect(result).toEqual({ wasRunning: true, restarted: true, onlineVerified: true });
    });

    it("keeps the old process explicit when restart is deferred", async () => {
        const controller = fakeController(true);
        const verifyOnline = vi.fn(async () => undefined);

        const result = await refreshServiceAfterUpdate(controller, temporaryServiceSpec(), {
            expectedVersion: "1.3.0",
            dependencies: refreshDependencies({
                confirmRestart: vi.fn(async () => false),
                verifyOnline,
            }),
        });

        expect(result).toEqual({ wasRunning: true, restarted: false, onlineVerified: false });
        expect(controller.install).toHaveBeenCalledOnce();
        expect(controller.restart).not.toHaveBeenCalled();
        expect(verifyOnline).not.toHaveBeenCalled();
    });

    it("fails after restart when the target version cannot be proven online", async () => {
        const controller = fakeController(true);

        await expect(
            refreshServiceAfterUpdate(controller, temporaryServiceSpec(), {
                expectedVersion: "1.3.0",
                yes: true,
                dependencies: refreshDependencies({
                    verifyOnline: async () => {
                        throw new Error("still running 1.2.9");
                    },
                }),
            }),
        ).rejects.toThrow(/服务也已重启，但在线验证失败.*still running 1\.2\.9.*onebots status/);
        expect(controller.restart).toHaveBeenCalledOnce();
    });

    it("waits through the old process and accepts the target version once ready", async () => {
        const spec = temporaryServiceSpec();
        fs.writeFileSync(spec.configPath, "port: 7788\npath: gateway\n", "utf8");
        let healthAttempts = 0;
        const fetcher = vi.fn<typeof fetch>(async input => {
            if (String(input).endsWith("/ready")) {
                return new Response(
                    JSON.stringify({
                        ready: true,
                        application: "onebots",
                        version: "1.3.0",
                        instance_id: "updated-instance",
                    }),
                    { status: 200 },
                );
            }
            healthAttempts += 1;
            return new Response(
                JSON.stringify({
                    status: "ok",
                    application: "onebots",
                    version: healthAttempts === 1 ? "1.2.9" : "1.3.0",
                    instance_id: "updated-instance",
                }),
                { status: 200 },
            );
        });
        const sleep = vi.fn(async () => undefined);

        await expect(
            verifyServiceOnline(spec, "1.3.0", {
                fetcher,
                attempts: 2,
                intervalMs: 1,
                sleep,
            }),
        ).resolves.toBeUndefined();
        expect(sleep).toHaveBeenCalledOnce();
        expect(fetcher).toHaveBeenCalledWith(
            "http://127.0.0.1:7788/gateway/health",
            expect.anything(),
        );
    });

    it("preserves the final health and readiness evidence when verification times out", async () => {
        const spec = temporaryServiceSpec();
        const fetcher = vi.fn<typeof fetch>(async input =>
            String(input).endsWith("/health")
                ? new Response(
                      JSON.stringify({ status: "ok", application: "onebots", version: "1.2.9" }),
                      { status: 200 },
                  )
                : new Response(JSON.stringify({ ready: false }), { status: 503 }),
        );

        await expect(
            verifyServiceOnline(spec, "1.3.0", {
                fetcher,
                attempts: 1,
            }),
        ).rejects.toThrow(/目标版本 1\.3\.0.*在线 OneBots 1\.2\.9.*ready: HTTP 503/);
    });

    it("rejects a healthy endpoint when restart did not replace the previous instance", async () => {
        const spec = temporaryServiceSpec();
        const fetcher = vi.fn<typeof fetch>(async input =>
            String(input).endsWith("/ready")
                ? new Response(
                      JSON.stringify({
                          ready: true,
                          application: "onebots",
                          version: "1.3.0",
                          instance_id: "old-instance",
                      }),
                      { status: 200 },
                  )
                : new Response(
                      JSON.stringify({
                          status: "ok",
                          application: "onebots",
                          version: "1.3.0",
                          instance_id: "old-instance",
                      }),
                      { status: 200 },
                  ),
        );

        await expect(
            verifyServiceOnline(spec, "1.3.0", {
                fetcher,
                attempts: 1,
                previousInstanceId: "old-instance",
            }),
        ).rejects.toThrow(/实例仍为 old-instance.*未证明新进程已接管端口/);
    });

    it("rejects a target-version endpoint without process identity evidence", async () => {
        const spec = temporaryServiceSpec();
        const fetcher = vi.fn<typeof fetch>(async input =>
            String(input).endsWith("/ready")
                ? new Response(
                      JSON.stringify({
                          ready: true,
                          application: "onebots",
                          version: "1.3.0",
                          instance_id: "new-instance",
                      }),
                      { status: 200 },
                  )
                : new Response(
                      JSON.stringify({
                          status: "ok",
                          application: "onebots",
                          version: "1.3.0",
                      }),
                      { status: 200 },
                  ),
        );

        await expect(verifyServiceOnline(spec, "1.3.0", { fetcher, attempts: 1 })).rejects.toThrow(
            /health 缺少完整应用、版本或 instance_id.*无法证明探针来自同一实例/,
        );
    });

    it("rejects health and readiness evidence split across different instances", async () => {
        const spec = temporaryServiceSpec();
        const fetcher = vi.fn<typeof fetch>(async input =>
            String(input).endsWith("/ready")
                ? new Response(
                      JSON.stringify({
                          ready: true,
                          application: "onebots",
                          version: "1.3.0",
                          instance_id: "stale-instance",
                      }),
                      { status: 200 },
                  )
                : new Response(
                      JSON.stringify({
                          status: "ok",
                          application: "onebots",
                          version: "1.3.0",
                          instance_id: "new-instance",
                      }),
                      { status: 200 },
                  ),
        );

        await expect(verifyServiceOnline(spec, "1.3.0", { fetcher, attempts: 1 })).rejects.toThrow(
            /health 来自 onebots@1\.3\.0 实例 new-instance.*ready 来自 onebots@1\.3\.0 实例 stale-instance.*拒绝拼接不一致的探针证据/,
        );
    });

    it("accepts the target version only after a different instance owns the endpoint", async () => {
        const spec = temporaryServiceSpec();
        const fetcher = vi.fn<typeof fetch>(async input =>
            String(input).endsWith("/ready")
                ? new Response(
                      JSON.stringify({
                          ready: true,
                          application: "onebots",
                          version: "1.3.0",
                          instance_id: "new-instance",
                      }),
                      { status: 200 },
                  )
                : new Response(
                      JSON.stringify({
                          status: "ok",
                          application: "onebots",
                          version: "1.3.0",
                          instance_id: "new-instance",
                      }),
                      { status: 200 },
                  ),
        );

        await expect(
            verifyServiceOnline(spec, "1.3.0", {
                fetcher,
                attempts: 1,
                previousInstanceId: "old-instance",
            }),
        ).resolves.toBeUndefined();
    });

    it("launches the saved updated CLI in the service working directory", () => {
        const spec = temporaryServiceSpec();
        const marker = path.join(spec.workingDirectory, "invocation.json");
        fs.writeFileSync(
            spec.binPath,
            `import fs from "node:fs";
fs.writeFileSync(${JSON.stringify(marker)}, JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));
`,
            "utf8",
        );

        runUpdatedServicePreflight(spec);

        expect(JSON.parse(fs.readFileSync(marker, "utf8"))).toEqual({
            argv: [
                "--service-runtime",
                "preflight",
                "-c",
                spec.configPath,
                "-r",
                "mock",
                "-p",
                "onebot-v11",
            ],
            cwd: fs.realpathSync(spec.workingDirectory),
        });
    });
});
