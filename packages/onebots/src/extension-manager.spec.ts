import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import yaml from "js-yaml";
import { AdapterRegistry, defineAdapterCapabilities, type Adapter } from "@onebots/core";
import {
    ExtensionManager,
    formatExtensionInstallationError,
    preflightExtensionConfig,
    type ExtensionConfigPreflight,
    type ExtensionInstaller,
} from "./extension-manager.js";
import type { ServicePreflightSpec } from "./service-preflight.js";
import { getExtensionPackageCatalogEntry } from "./extension-capability-catalog.js";

const directories: string[] = [];
const successfulPreflight: ExtensionConfigPreflight = async () => undefined;

describe("formatExtensionInstallationError", () => {
    it("脱敏包管理器错误中的常见凭据并限制诊断长度", () => {
        const message = formatExtensionInstallationError(
            new Error(
                `fetch https://user:secret@registry.example/pkg?token=secret Bearer abc ${"x".repeat(5_000)}`,
            ),
        );

        expect(message).toContain("https://***@registry.example/pkg?token=***");
        expect(message).toContain("Bearer ***");
        expect(message).not.toContain("secret");
        expect(message).toHaveLength(4_000);
        expect(message.endsWith("…")).toBe(true);
    });
});

afterEach(() => {
    AdapterRegistry.clear();
    for (const directory of directories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-extensions-"));
    directories.push(root);
    fs.writeFileSync(path.join(root, "package.json"), '{"private":true}\n');
    const configPath = path.join(root, "config.yaml");
    fs.writeFileSync(
        configPath,
        "plugins:\n  adapters: []\n  protocols: [onebot-v11]\ngeneral: {}\n",
    );
    return { root, configPath };
}

function catalogVersion(packageName: string): string {
    const entry = getExtensionPackageCatalogEntry(packageName);
    if (!entry) throw new Error(`测试目录缺少 ${packageName}`);
    return entry.packageVersion;
}

function installFixturePackage(packageName: string, version: string, runtimeRoot: string): void {
    const packageDirectory = path.join(runtimeRoot, "node_modules", ...packageName.split("/"));
    fs.mkdirSync(packageDirectory, { recursive: true });
    fs.writeFileSync(
        path.join(packageDirectory, "package.json"),
        `${JSON.stringify({ name: packageName, version })}\n`,
    );
}

function removeFixturePackage(packageName: string, runtimeRoot: string): void {
    fs.rmSync(path.join(runtimeRoot, "node_modules", ...packageName.split("/")), {
        recursive: true,
        force: true,
    });
}

describe("ExtensionManager", () => {
    it("向已加载适配器发布注册表中的权威能力清单", () => {
        const { root, configPath } = fixture();
        const capabilities = defineAdapterCapabilities({
            actions: {
                send_message: { support: "native" },
                delete_message: { support: "unsupported" },
            },
            events: {},
            segments: {},
            transports: {
                websocket: {
                    support: "emulated",
                    mode: "websocket",
                },
            },
        });
        AdapterRegistry.register("slack", (() => undefined) as unknown as Adapter.Factory, {
            capabilities,
        });
        const manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            preflight: successfulPreflight,
        });

        const slack = manager
            .list([
                {
                    type: "adapter",
                    name: "slack",
                    packageName: "@onebots/adapter-slack",
                    version: "1.2.3",
                    entryPath: "/runtime/slack.js",
                },
            ])
            .find(item => item.id === "adapter:slack");

        expect(slack?.capability).toEqual({
            source: "runtime",
            packageVersion: "1.2.3",
            declared: true,
            summary: expect.objectContaining({
                actions: {
                    total: 2,
                    supported: 1,
                    native: 1,
                    emulated: 0,
                    unsupported: 1,
                },
                transports: {
                    total: 1,
                    supported: 1,
                    native: 0,
                    emulated: 1,
                    unsupported: 0,
                },
            }),
            manifest: capabilities,
        });
    });

    it("明确标记未声明能力清单的已加载第三方适配器", () => {
        const { root, configPath } = fixture();
        AdapterRegistry.register("slack", (() => undefined) as unknown as Adapter.Factory);
        const manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            preflight: successfulPreflight,
        });

        const slack = manager
            .list([
                {
                    type: "adapter",
                    name: "slack",
                    packageName: "third-party-slack",
                    version: null,
                    entryPath: "/runtime/slack.js",
                },
            ])
            .find(item => item.id === "adapter:slack");

        expect(slack?.capability).toEqual({
            source: "runtime",
            packageVersion: null,
            declared: false,
            summary: null,
            manifest: null,
        });
    });

    it("在安装和创建账号前提供带版本的目录能力快照", () => {
        const { root, configPath } = fixture();
        const manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            preflight: successfulPreflight,
        });

        const slack = manager.list([]).find(item => item.id === "adapter:slack");

        expect(slack?.loaded).toBe(false);
        expect(slack).toMatchObject({
            catalogError: null,
            configurationError: null,
            targetVersion: catalogVersion("@onebots/adapter-slack"),
            installedVersion: null,
            versionAligned: false,
        });
        expect(slack?.capability).toMatchObject({
            source: "catalog",
            packageVersion: expect.any(String),
            declared: true,
            summary: {
                actions: { total: expect.any(Number), supported: expect.any(Number) },
            },
            manifest: { version: 1 },
        });
    });

    it("目录闭合失败时隔离静态能力证据并保留运行时信息", () => {
        const { root, configPath } = fixture();
        const manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            preflight: successfulPreflight,
            catalogIssues: () => ["适配器能力快照版本错配: slack"],
        });

        const slack = manager.list([]).find(item => item.id === "adapter:slack");

        expect(slack).toMatchObject({
            catalogError: "扩展目录完整性校验失败：适配器能力快照版本错配: slack",
            targetVersion: catalogVersion("@onebots/adapter-slack"),
            capability: {
                source: "catalog",
                packageVersion: null,
                declared: false,
                summary: null,
                manifest: null,
            },
        });

        const runtimeCapabilities = defineAdapterCapabilities({
            actions: { send_message: { support: "native" } },
            events: {},
            segments: {},
            transports: {},
        });
        AdapterRegistry.register("slack", (() => undefined) as unknown as Adapter.Factory, {
            capabilities: runtimeCapabilities,
        });
        const runtimeSlack = manager
            .list([
                {
                    type: "adapter",
                    name: "slack",
                    packageName: "@onebots/adapter-slack",
                    version: "1.2.3",
                    entryPath: "/runtime/slack.js",
                },
            ])
            .find(item => item.id === "adapter:slack");
        expect(runtimeSlack?.capability).toMatchObject({
            source: "runtime",
            declared: true,
            manifest: runtimeCapabilities,
        });
    });

    it("候选配置临时文件使用私有权限并在预检失败后清理", async () => {
        const { root, configPath } = fixture();
        let temporaryPath = "";
        const runPreflight = vi.fn(async (spec: ServicePreflightSpec) => {
            temporaryPath = spec.configPath;
            expect(fs.statSync(temporaryPath).mode & 0o777).toBe(0o600);
            expect(fs.readFileSync(temporaryPath, "utf8")).toContain("access_token: secret");
            throw new Error("候选插件损坏");
        });

        await expect(
            preflightExtensionConfig(
                {
                    content: "access_token: secret\n",
                    selection: { adapters: ["slack"], protocols: [] },
                    runtimeRoot: root,
                    configPath,
                },
                runPreflight,
            ),
        ).rejects.toThrow("候选插件损坏");

        expect(runPreflight).toHaveBeenCalledOnce();
        expect(temporaryPath).not.toBe("");
        expect(fs.existsSync(temporaryPath)).toBe(false);
    });

    it("只安装目录中的固定包名并持久化插件选择", async () => {
        const { root, configPath } = fixture();
        const install = vi.fn(
            async (packageName: string, packageVersion: string, runtimeRoot: string) => {
                installFixturePackage(packageName, packageVersion, runtimeRoot);
            },
        );
        const manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            installer: { install } satisfies ExtensionInstaller,
            preflight: successfulPreflight,
        });

        await expect(manager.install("adapter:slack")).resolves.toEqual({
            restartRequired: true,
        });
        expect(install).toHaveBeenCalledWith(
            "@onebots/adapter-slack",
            catalogVersion("@onebots/adapter-slack"),
            root,
        );
        const config = yaml.load(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
        expect(config.plugins).toEqual({
            adapters: ["slack"],
            protocols: ["onebot-v11"],
        });
        expect(manager.list([]).find(item => item.id === "adapter:slack")).toMatchObject({
            installed: true,
            installedVersion: catalogVersion("@onebots/adapter-slack"),
            versionAligned: true,
            enabled: true,
            loaded: false,
        });
    });

    it("拒绝任意 npm 包名", async () => {
        const { root, configPath } = fixture();
        const install = vi.fn();
        const manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            installer: { install },
            preflight: successfulPreflight,
        });

        await expect(manager.install("adapter:slack@latest;rm -rf /")).rejects.toThrow(
            "不允许从管理端安装",
        );
        expect(install).not.toHaveBeenCalled();
    });

    it("目录闭合失败时在读取配置或下载依赖前阻止安装", async () => {
        const { root, configPath } = fixture();
        const install = vi.fn();
        const manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            installer: { install },
            preflight: successfulPreflight,
            catalogIssues: () => ["适配器能力快照缺失: slack"],
        });

        await expect(manager.install("adapter:slack")).rejects.toThrow(
            "扩展目录完整性校验失败，已阻止安装：适配器能力快照缺失: slack",
        );
        expect(install).not.toHaveBeenCalled();
        expect(fs.readFileSync(configPath, "utf8")).not.toContain("- slack");
    });

    it("已安装依赖只启用配置，不重复调用包管理器", async () => {
        const { root, configPath } = fixture();
        installFixturePackage(
            "@onebots/adapter-slack",
            catalogVersion("@onebots/adapter-slack"),
            root,
        );
        const install = vi.fn();
        const manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            installer: { install },
            preflight: successfulPreflight,
        });

        await manager.install("adapter:slack");
        expect(install).not.toHaveBeenCalled();
    });

    it("同一扩展的并发请求复用安装、预检与配置写入结果", async () => {
        const { root, configPath } = fixture();
        let releaseInstall: (() => void) | undefined;
        let releasePreflight: (() => void) | undefined;
        const installGate = new Promise<void>(resolve => {
            releaseInstall = resolve;
        });
        const preflightGate = new Promise<void>(resolve => {
            releasePreflight = resolve;
        });
        const install = vi.fn(
            async (packageName: string, packageVersion: string, runtimeRoot: string) => {
                await installGate;
                installFixturePackage(packageName, packageVersion, runtimeRoot);
            },
        );
        const preflight = vi.fn(async () => {
            await preflightGate;
        });
        const manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            installer: { install },
            preflight,
        });

        const first = manager.install("adapter:slack");
        const retry = manager.install("adapter:slack");
        const installing = manager.list([]).find(item => item.id === "adapter:slack");
        expect(installing?.installing).toBe(true);
        expect(installing?.installation).toEqual({
            operationId: expect.any(String),
            phase: "installing_package",
            startedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
        });
        const operationId = installing?.installation?.operationId;
        releaseInstall?.();

        await vi.waitFor(() => {
            expect(
                manager.list([]).find(item => item.id === "adapter:slack")?.installation,
            ).toEqual(expect.objectContaining({ operationId, phase: "preflighting" }));
        });
        releasePreflight?.();

        await expect(Promise.all([first, retry])).resolves.toEqual([
            { restartRequired: true },
            { restartRequired: true },
        ]);
        expect(install).toHaveBeenCalledOnce();
        expect(preflight).toHaveBeenCalledOnce();
        expect(manager.list([]).find(item => item.id === "adapter:slack")).toEqual(
            expect.objectContaining({
                installing: false,
                installation: null,
                lastInstallation: expect.objectContaining({
                    operationId,
                    status: "succeeded",
                    message: null,
                }),
            }),
        );
    });

    it("不同扩展继续互斥，失败后同一扩展可以重新安装", async () => {
        const { root, configPath } = fixture();
        let attempt = 0;
        const install = vi.fn(
            async (packageName: string, packageVersion: string, runtimeRoot: string) => {
                attempt += 1;
                if (attempt === 1) throw new Error("registry timeout");
                installFixturePackage(packageName, packageVersion, runtimeRoot);
            },
        );
        const manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            installer: { install },
            preflight: successfulPreflight,
        });

        const first = manager.install("adapter:slack");
        const joined = manager.install("adapter:slack");
        await expect(manager.install("adapter:telegram")).rejects.toThrow(
            /扩展 adapter:slack 正在安装/,
        );
        const failures = await Promise.allSettled([first, joined]);
        expect(failures).toEqual([
            expect.objectContaining({ status: "rejected", reason: expect.any(Error) }),
            expect.objectContaining({ status: "rejected", reason: expect.any(Error) }),
        ]);
        expect(install).toHaveBeenCalledOnce();
        const failedResult = manager
            .list([])
            .find(item => item.id === "adapter:slack")?.lastInstallation;
        expect(failedResult).toEqual({
            operationId: expect.any(String),
            status: "failed",
            startedAt: expect.any(String),
            completedAt: expect.any(String),
            message: "registry timeout",
        });

        await expect(manager.install("adapter:slack")).resolves.toEqual({
            restartRequired: true,
        });
        expect(install).toHaveBeenCalledTimes(2);
        const successfulResult = manager
            .list([])
            .find(item => item.id === "adapter:slack")?.lastInstallation;
        expect(successfulResult).toEqual(
            expect.objectContaining({ status: "succeeded", message: null }),
        );
        expect(successfulResult?.operationId).not.toBe(failedResult?.operationId);
    });

    it("已安装版本偏离目录时切换到当前 OneBots 验证版本", async () => {
        const { root, configPath } = fixture();
        installFixturePackage("@onebots/adapter-slack", "99.0.0", root);
        const install = vi.fn(
            async (packageName: string, packageVersion: string, runtimeRoot: string) => {
                installFixturePackage(packageName, packageVersion, runtimeRoot);
            },
        );
        const manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            installer: { install },
            preflight: successfulPreflight,
        });

        expect(manager.list([]).find(item => item.id === "adapter:slack")).toMatchObject({
            installedVersion: "99.0.0",
            targetVersion: catalogVersion("@onebots/adapter-slack"),
            versionAligned: false,
        });

        await manager.install("adapter:slack");

        expect(install).toHaveBeenCalledWith(
            "@onebots/adapter-slack",
            catalogVersion("@onebots/adapter-slack"),
            root,
        );
        expect(manager.list([]).find(item => item.id === "adapter:slack")).toMatchObject({
            installedVersion: catalogVersion("@onebots/adapter-slack"),
            versionAligned: true,
        });
    });

    it("包管理器未落下验证版本时在插件预检前失败", async () => {
        const { root, configPath } = fixture();
        const preflight = vi.fn(successfulPreflight);
        const manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            installer: {
                install: async (packageName, _packageVersion, runtimeRoot) => {
                    installFixturePackage(packageName, "0.0.0-wrong", runtimeRoot);
                },
            },
            preflight,
        });

        await expect(manager.install("adapter:slack")).rejects.toThrow(
            /扩展安装版本校验失败.*期望.*实际 0\.0\.0-wrong/,
        );
        expect(preflight).not.toHaveBeenCalled();
    });

    it("配置无效时不开始安装，避免留下半完成依赖", async () => {
        const { root, configPath } = fixture();
        fs.writeFileSync(configPath, "plugins: []\n");
        const install = vi.fn();
        const manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            installer: { install },
            preflight: successfulPreflight,
        });

        await expect(manager.install("adapter:slack")).rejects.toThrow("plugins 必须是对象");
        expect(install).not.toHaveBeenCalled();
    });

    it("安装期间配置发生变化时合并最新内容", async () => {
        const { root, configPath } = fixture();
        const install = vi.fn(async (packageName: string, version: string, runtimeRoot: string) => {
            installFixturePackage(packageName, version, runtimeRoot);
            fs.writeFileSync(
                configPath,
                "plugins:\n  adapters: [telegram]\n  protocols: [onebot-v11]\ngeneral:\n  host: 127.0.0.1\n",
            );
        });
        const manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            installer: { install },
            preflight: successfulPreflight,
        });

        await manager.install("adapter:slack");

        const config = yaml.load(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
        expect(config).toMatchObject({
            plugins: {
                adapters: ["telegram", "slack"],
                protocols: ["onebot-v11"],
            },
            general: { host: "127.0.0.1" },
        });
    });

    it("候选插件预检失败时不启用配置", async () => {
        const { root, configPath } = fixture();
        const original = fs.readFileSync(configPath, "utf8");
        const install = vi.fn(async (packageName: string, version: string, runtimeRoot: string) => {
            installFixturePackage(packageName, version, runtimeRoot);
        });
        const preflight = vi.fn(async () => {
            throw new Error("插件没有注册配置 Schema");
        });
        let manager: ExtensionManager;
        let restorePhase: string | undefined;
        const restore = vi.fn(async (packageName: string, previousVersion: string | null) => {
            expect(previousVersion).toBeNull();
            restorePhase = manager.list([]).find(item => item.id === "adapter:slack")
                ?.installation?.phase;
            removeFixturePackage(packageName, root);
        });
        manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            installer: { install, restore },
            preflight,
        });

        await expect(manager.install("adapter:slack")).rejects.toThrow("插件没有注册配置 Schema");

        expect(install).toHaveBeenCalledOnce();
        expect(preflight).toHaveBeenCalledWith(
            expect.objectContaining({
                selection: { adapters: ["slack"], protocols: ["onebot-v11"] },
                runtimeRoot: root,
                configPath,
            }),
        );
        expect(fs.readFileSync(configPath, "utf8")).toBe(original);
        expect(restore).toHaveBeenCalledWith("@onebots/adapter-slack", null, root);
        expect(restorePhase).toBe("restoring_package");
        expect(manager.list([]).find(item => item.id === "adapter:slack")?.installed).toBe(false);
    });

    it("升级后的候选预检失败时恢复原扩展版本", async () => {
        const { root, configPath } = fixture();
        installFixturePackage("@onebots/adapter-slack", "3.0.7", root);
        const restore = vi.fn(
            async (packageName: string, previousVersion: string | null, runtimeRoot: string) => {
                if (!previousVersion) throw new Error("测试缺少原版本");
                installFixturePackage(packageName, previousVersion, runtimeRoot);
            },
        );
        const manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            installer: {
                install: async (packageName, packageVersion, runtimeRoot) => {
                    installFixturePackage(packageName, packageVersion, runtimeRoot);
                },
                restore,
            },
            preflight: async () => {
                throw new Error("候选版本无法加载");
            },
        });

        await expect(manager.install("adapter:slack")).rejects.toThrow("候选版本无法加载");

        expect(restore).toHaveBeenCalledWith("@onebots/adapter-slack", "3.0.7", root);
        expect(manager.list([]).find(item => item.id === "adapter:slack")?.installedVersion).toBe(
            "3.0.7",
        );
    });

    it("依赖恢复失败时同时保留原错误与恢复错误", async () => {
        const { root, configPath } = fixture();
        const manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            installer: {
                install: async (packageName, packageVersion, runtimeRoot) => {
                    installFixturePackage(packageName, packageVersion, runtimeRoot);
                },
                restore: async () => {
                    throw new Error("锁文件只读");
                },
            },
            preflight: async () => {
                throw new Error("插件入口损坏");
            },
        });

        await expect(manager.install("adapter:slack")).rejects.toThrow(
            /扩展安装失败且依赖恢复失败.*插件入口损坏.*锁文件只读/,
        );
        expect(
            manager.list([]).find(item => item.id === "adapter:slack")?.lastInstallation?.message,
        ).toMatch(/插件入口损坏.*锁文件只读/);
    });

    it("候选预检期间配置变化时重新合并并验证", async () => {
        const { root, configPath } = fixture();
        const preflight = vi.fn(async () => {
            if (preflight.mock.calls.length === 1) {
                fs.writeFileSync(
                    configPath,
                    "plugins:\n  adapters: [telegram]\n  protocols: [onebot-v11]\ngeneral: {}\n",
                );
            }
        });
        const manager = new ExtensionManager({
            runtimeRoot: root,
            configPath,
            installer: {
                install: vi.fn(
                    async (packageName: string, version: string, runtimeRoot: string) => {
                        installFixturePackage(packageName, version, runtimeRoot);
                    },
                ),
            },
            preflight,
        });

        await manager.install("adapter:slack");

        expect(preflight).toHaveBeenCalledTimes(2);
        expect(preflight).toHaveBeenNthCalledWith(
            2,
            expect.objectContaining({
                selection: expect.objectContaining({ adapters: ["telegram", "slack"] }),
            }),
        );
        const config = yaml.load(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>;
        expect(config.plugins).toEqual({
            adapters: ["telegram", "slack"],
            protocols: ["onebot-v11"],
        });
    });
});
