import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import packageMetadata from "../package.json" with { type: "json" };
import type { ServiceSpec } from "./service-manager.js";
import {
    acquireUpdatePackageMutationLock,
    loadTargetExtensionVersionCatalog,
    packageNamesFor,
    preflightCurrentPackagesOnlyRuntime,
    preflightPackagesOnlyUpdate,
    refreshServiceAfterUpdate,
    requireUpdatePackageManager,
    resolveInstalledPackageVersion,
    resolvePackageUpdateProjectRoot,
    resolveUpdatePluginSelection,
    resolveUpdateRuntimeTarget,
    resolveVerifiedUpdateTargets,
    runUpdatedServicePreflight,
} from "./updater.js";
import { DOCTOR_ENDPOINT_BODY_LIMIT_BYTES } from "./doctor-endpoint.js";
import { readServiceInstanceId, verifyServiceOnline } from "./service-online-verification.js";
import { resolveServiceRuntimeContractId } from "./service-runtime-contract.js";

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
        status: vi.fn<() => { running: boolean; detail?: string; error?: string }>(() => ({
            running,
        })),
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
    it("在 registry 查询与依赖写入前拒绝过旧的实际包管理器", async () => {
        const inspect = vi.fn(async () => ({
            manager: "pnpm" as const,
            executable: "pnpm",
            resolvedPath: "/tools/pnpm",
            version: "8.15.9",
            error: "扩展包管理器版本过旧：pnpm 8.15.9，要求 >=9.12.0。",
        }));

        await expect(requireUpdatePackageManager("/runtime", inspect)).rejects.toThrow(
            /更新包管理器不可用.*pnpm 8\.15\.9.*>=9\.12\.0/,
        );
        expect(inspect).toHaveBeenCalledWith("/runtime");
    });

    it("仅把带实际版本的已验证包管理器交给更新查询与事务", async () => {
        await expect(
            requireUpdatePackageManager("/runtime", async () => ({
                manager: "npm",
                executable: "npm",
                resolvedPath: "/tools/npm",
                version: "11.17.0",
                error: null,
            })),
        ).resolves.toEqual({ manager: "npm", resolvedPath: "/tools/npm" });
        await expect(
            requireUpdatePackageManager("/runtime", async () => ({
                manager: "npm",
                executable: "npm",
                resolvedPath: "/tools/npm",
                version: null,
                error: null,
            })),
        ).rejects.toThrow("无法确认实际版本");
    });

    it("CLI 更新在同一运行目录中取得跨进程租约", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-update-lock-"));
        temporaryDirectories.push(root);
        const first = acquireUpdatePackageMutationLock(root, "update-operation-1");

        expect(() => acquireUpdatePackageMutationLock(root, "update-operation-2")).toThrow(
            /OneBots 软件包更新事务.*update-operation-1/,
        );
        first.release();
        const retry = acquireUpdatePackageMutationLock(root, "update-operation-3");
        retry.release();
    });

    it("不会把仅依赖 core 的普通项目当成 OneBots 更新目标", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-core-consumer-"));
        temporaryDirectories.push(root);
        fs.writeFileSync(
            path.join(root, "package.json"),
            JSON.stringify({ dependencies: { "@onebots/core": "^1.0.0" } }),
            "utf8",
        );

        expect(resolvePackageUpdateProjectRoot(root)).toBeNull();
    });

    it("跳过损坏的子目录清单并验证真正的 OneBots 项目身份", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-update-root-"));
        temporaryDirectories.push(root);
        fs.writeFileSync(
            path.join(root, "package.json"),
            JSON.stringify({ name: "onebots", version: packageMetadata.version }),
            "utf8",
        );
        const child = path.join(root, "runtime");
        fs.mkdirSync(child);
        fs.writeFileSync(path.join(child, "package.json"), "{broken", "utf8");

        expect(resolvePackageUpdateProjectRoot(child)).toBe(root);
    });

    it("没有可信上层项目时拒绝把损坏清单降级为全局更新", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-update-invalid-root-"));
        temporaryDirectories.push(root);
        fs.writeFileSync(path.join(root, "package.json"), "{broken", "utf8");

        expect(() => resolvePackageUpdateProjectRoot(root)).toThrow(
            `无法确定项目更新目录：package.json 无法读取或解析：${path.join(root, "package.json")}`,
        );
    });

    it("在修改依赖前拒绝与当前 CLI 版本不一致的项目安装", () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-update-mismatch-"));
        temporaryDirectories.push(root);
        fs.writeFileSync(
            path.join(root, "package.json"),
            JSON.stringify({ dependencies: { onebots: "^0.1.0" } }),
            "utf8",
        );
        writePackageManifest(root, "onebots", "0.1.0");

        expect(() => resolvePackageUpdateProjectRoot(root)).toThrow(
            `项目更新目录无法验证：扩展运行目录中的 onebots@0.1.0 与当前进程 onebots@${packageMetadata.version} 不一致`,
        );
    });

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

        expect(
            loadTargetExtensionVersionCatalog(
                { manager: "npm", resolvedPath: "/verified/npm" },
                spec.workingDirectory,
                "1.3.0",
            ),
        ).toEqual({
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

        expect(
            loadTargetExtensionVersionCatalog(
                { manager: "npm", resolvedPath: npm },
                spec.workingDirectory,
                "1.3.0",
            ),
        ).toEqual({
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

    it("不从超限的旧健康响应接受实例身份", async () => {
        const spec = temporaryServiceSpec();
        const fetcher = vi.fn<typeof fetch>(
            async () =>
                new Response("", {
                    status: 200,
                    headers: {
                        "content-length": String(DOCTOR_ENDPOINT_BODY_LIMIT_BYTES + 1),
                    },
                }),
        );

        await expect(readServiceInstanceId(spec, fetcher)).resolves.toBeNull();
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

    it("packages-only 无需服务快照即可读取指定配置中的插件", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-update-config-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "managed.yaml");
        fs.writeFileSync(
            configPath,
            "plugins:\n  adapters: [slack]\n  protocols: [milky-v1]\ngeneral: {}\n",
        );

        expect(
            resolveUpdatePluginSelection({ adapters: [], protocols: [] }, null, configPath),
        ).toEqual({ adapters: ["slack"], protocols: ["milky-v1"] });
    });

    it("packages-only 忽略已有服务并固定使用当前运行目录", () => {
        const spec = temporaryServiceSpec();
        const currentDirectory = path.join(spec.workingDirectory, "installer-runtime");

        expect(resolveUpdateRuntimeTarget(true, spec, currentDirectory)).toEqual({
            spec: null,
            runtimeRoot: currentDirectory,
        });
        expect(resolveUpdateRuntimeTarget(false, spec, currentDirectory)).toEqual({
            spec,
            runtimeRoot: spec.workingDirectory,
        });
    });

    it("packages-only 通过真实配置预检后保留新依赖", async () => {
        const spec = temporaryServiceSpec();
        const preflight = vi.fn(async () => undefined);
        const rollback = vi.fn(async () => undefined);

        await expect(
            preflightPackagesOnlyUpdate(spec, { preflight, rollback }),
        ).resolves.toBeUndefined();
        expect(preflight).toHaveBeenCalledWith(spec);
        expect(rollback).not.toHaveBeenCalled();
    });

    it("packages-only 无需改包时仍预检当前整组运行环境", async () => {
        const spec = temporaryServiceSpec();
        const preflight = vi.fn(async () => undefined);

        await expect(preflightCurrentPackagesOnlyRuntime(spec, preflight)).resolves.toBeUndefined();
        expect(preflight).toHaveBeenCalledWith(spec);
    });

    it("packages-only 当前依赖预检失败时明确声明没有修改", async () => {
        const spec = temporaryServiceSpec();

        await expect(
            preflightCurrentPackagesOnlyRuntime(spec, async () => {
                throw new Error("existing protocol cannot load with new core");
            }),
        ).rejects.toThrow(
            /当前依赖隔离预检失败；未修改依赖、服务定义或运行实例.*existing protocol cannot load with new core/,
        );
    });

    it("packages-only 预检失败时恢复依赖且不触碰服务", async () => {
        const spec = temporaryServiceSpec();
        const rollback = vi.fn(async () => undefined);

        await expect(
            preflightPackagesOnlyUpdate(spec, {
                preflight: async () => {
                    throw new Error("new adapter rejected config");
                },
                rollback,
            }),
        ).rejects.toThrow(
            /新依赖隔离预检失败，已恢复更新前依赖.*服务定义与当前运行实例保持不变.*new adapter rejected config/,
        );
        expect(rollback).toHaveBeenCalledOnce();
    });

    it("packages-only 预检与依赖恢复都失败时保留双方证据", async () => {
        const spec = temporaryServiceSpec();

        await expect(
            preflightPackagesOnlyUpdate(spec, {
                preflight: async () => {
                    throw new Error("new protocol cannot load");
                },
                rollback: async () => {
                    throw new Error("package lock is read-only");
                },
            }),
        ).rejects.toThrow(/new protocol cannot load.*package lock is read-only/);
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

    it("restores updated packages when service state cannot be established", async () => {
        const controller = fakeController(false);
        controller.status.mockReturnValue({
            running: false,
            detail: "systemd bus unavailable",
            error: "进程管理器状态查询失败",
        });
        const recoverPreflightFailure = vi.fn(async () => undefined);
        const preflight = vi.fn(async () => undefined);

        await expect(
            refreshServiceAfterUpdate(controller, temporaryServiceSpec(), {
                expectedVersion: "1.3.0",
                yes: true,
                recoverPreflightFailure,
                dependencies: refreshDependencies({ preflight }),
            }),
        ).rejects.toThrow(
            /无法确认更新前服务状态，已恢复更新前依赖.*进程管理器状态查询失败：systemd bus unavailable/,
        );
        expect(recoverPreflightFailure).toHaveBeenCalledOnce();
        expect(preflight).not.toHaveBeenCalled();
        expect(controller.install).not.toHaveBeenCalled();
        expect(controller.restart).not.toHaveBeenCalled();
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
        const runtimeContractId = resolveServiceRuntimeContractId(spec);
        let healthAttempts = 0;
        const fetcher = vi.fn<typeof fetch>(async input => {
            if (String(input).endsWith("/ready")) {
                return new Response(
                    JSON.stringify({
                        ready: true,
                        application: "onebots",
                        version: "1.3.0",
                        instance_id: "updated-instance",
                        runtime_contract_id: runtimeContractId,
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
                    runtime_contract_id: runtimeContractId,
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
        const runtimeContractId = resolveServiceRuntimeContractId(spec);
        const fetcher = vi.fn<typeof fetch>(async input =>
            String(input).endsWith("/ready")
                ? new Response(
                      JSON.stringify({
                          ready: true,
                          application: "onebots",
                          version: "1.3.0",
                          instance_id: "old-instance",
                          runtime_contract_id: runtimeContractId,
                      }),
                      { status: 200 },
                  )
                : new Response(
                      JSON.stringify({
                          status: "ok",
                          application: "onebots",
                          version: "1.3.0",
                          instance_id: "old-instance",
                          runtime_contract_id: runtimeContractId,
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
        const runtimeContractId = resolveServiceRuntimeContractId(spec);
        const fetcher = vi.fn<typeof fetch>(async input =>
            String(input).endsWith("/ready")
                ? new Response(
                      JSON.stringify({
                          ready: true,
                          application: "onebots",
                          version: "1.3.0",
                          instance_id: "new-instance",
                          runtime_contract_id: runtimeContractId,
                      }),
                      { status: 200 },
                  )
                : new Response(
                      JSON.stringify({
                          status: "ok",
                          application: "onebots",
                          version: "1.3.0",
                          instance_id: "new-instance",
                          runtime_contract_id: runtimeContractId,
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

    it("拒绝同版本新实例使用与服务元数据不同的启动契约", async () => {
        const spec = temporaryServiceSpec();
        const fetcher = vi.fn<typeof fetch>(
            async input =>
                new Response(
                    JSON.stringify({
                        ...(String(input).endsWith("/ready") ? { ready: true } : { status: "ok" }),
                        application: "onebots",
                        version: "1.3.0",
                        instance_id: "new-instance",
                        runtime_contract_id: "sha256:wrong-contract",
                    }),
                    { status: 200 },
                ),
        );

        await expect(verifyServiceOnline(spec, "1.3.0", { fetcher, attempts: 1 })).rejects.toThrow(
            /在线进程的启动契约与服务元数据不一致.*onebots restart/,
        );
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
