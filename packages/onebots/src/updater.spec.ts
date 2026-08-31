import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ServiceSpec } from "./service-manager.js";
import {
    assertUpdatedPackageVersions,
    packageNamesFor,
    refreshServiceAfterUpdate,
    resolveInstalledPackageVersion,
    resolveUpdatePluginSelection,
    runUpdatedServicePreflight,
} from "./updater.js";
import { readServiceInstanceId, verifyServiceOnline } from "./service-online-verification.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
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

    it("verifies every selected package from the runtime installation before service preflight", () => {
        const spec = temporaryServiceSpec();
        writePackageManifest(spec.workingDirectory, "onebots", "1.3.0");
        writePackageManifest(spec.workingDirectory, "@onebots/adapter-mock", "2.4.0");

        expect(() =>
            assertUpdatedPackageVersions(
                [
                    { name: "onebots", latest: "1.3.0" },
                    { name: "@onebots/adapter-mock", latest: "2.4.0" },
                ],
                spec.workingDirectory,
            ),
        ).not.toThrow();
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

    it("reports every missing or mismatched package before the service can switch", () => {
        const versions = new Map([
            ["onebots", "1.2.9"],
            ["@onebots/adapter-mock", null],
        ]);

        expect(() =>
            assertUpdatedPackageVersions(
                [
                    { name: "onebots", latest: "1.3.0" },
                    { name: "@onebots/adapter-mock", latest: "2.4.0" },
                ],
                "/runtime",
                name => versions.get(name) ?? null,
            ),
        ).toThrow(
            "包更新版本校验失败：onebots 期望 1.3.0，实际 1.2.9；@onebots/adapter-mock 期望 2.4.0，实际 未安装。服务预检、定义改写与重启均未执行",
        );
    });

    it("does not rewrite or restart the service when the updated runtime fails preflight", async () => {
        const controller = fakeController(true);
        const spec = temporaryServiceSpec();
        const confirmRestart = vi.fn(async () => true);

        await expect(
            refreshServiceAfterUpdate(controller, spec, {
                expectedVersion: "1.3.0",
                yes: true,
                dependencies: refreshDependencies({
                    preflight: async () => {
                        throw new Error("updated plugin failed");
                    },
                    confirmRestart,
                }),
            }),
        ).rejects.toThrow(/软件包已更新.*服务定义与当前运行实例保持不变.*updated plugin failed/);
        expect(controller.install).not.toHaveBeenCalled();
        expect(controller.restart).not.toHaveBeenCalled();
        expect(confirmRestart).not.toHaveBeenCalled();
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
