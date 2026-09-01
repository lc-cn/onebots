import { afterEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import * as net from "node:net";
import {
    inspectExtensionRootAlignment,
    compareDoctorEndpointIdentities,
    inspectConfiguredPublicStaticDirectory,
    inspectDataDirectory,
    inspectDoctorPluginSelection,
    inspectSensitiveDirectoryPermissions,
    inspectSensitiveDirectoryMutationPermissions,
    inspectSensitiveFilePermissions,
    probeDoctorEndpoint,
    resolveGatewayBaseUrl,
    resolveDoctorPluginSelection,
    runDoctor,
} from "./doctor.js";
import { ServiceController, type ServiceSpec } from "./service-manager.js";
import packageMetadata from "../package.json" with { type: "json" };
import {
    DOCTOR_ENDPOINT_BODY_LIMIT_BYTES,
    verifyDoctorRuntimeContract,
} from "./doctor-endpoint.js";
import { inspectGatewayPortAvailability } from "./doctor-port.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe.runIf(process.platform !== "win32")("doctor config permissions", () => {
    it("accepts owner-only access and reports intentional group read as a warning", () => {
        const privateConfig = createConfigFile(0o600);
        const groupReadableConfig = createConfigFile(0o640);

        expect(inspectSensitiveFilePermissions(privateConfig, "config-mode", "配置文件")).toEqual({
            name: "config-mode",
            level: "ok",
            message: "配置文件权限 600 未向组或其他用户开放",
        });
        expect(
            inspectSensitiveFilePermissions(groupReadableConfig, "config-mode", "配置文件", true),
        ).toEqual({
            name: "config-mode",
            level: "warning",
            message: "配置文件权限 640 允许同组用户读取；请确认这是服务部署所需",
        });
        expect(fs.statSync(groupReadableConfig).mode & 0o777).toBe(0o640);
    });

    it.each([
        { mode: 0o644, label: "644" },
        { mode: 0o620, label: "620" },
    ])("rejects unsafe mode $label without changing it", ({ mode }) => {
        const configPath = createConfigFile(mode);

        expect(
            inspectSensitiveFilePermissions(configPath, "config-mode", "配置文件"),
        ).toMatchObject({
            name: "config-mode",
            level: "error",
            message: expect.stringContaining(mode.toString(8)),
        });
        expect(fs.statSync(configPath).mode & 0o777).toBe(mode);
    });

    it("repairs unsafe config backups only when --fix is explicit", () => {
        const backupPath = createConfigFile(0o644);

        expect(
            inspectSensitiveFilePermissions(backupPath, "config-backup-mode", "配置备份", true),
        ).toEqual({
            name: "config-backup-mode",
            level: "ok",
            message: "已将配置备份权限从 644 收紧为 0600",
            fixed: true,
        });
        expect(fs.statSync(backupPath).mode & 0o777).toBe(0o600);
    });

    it("拒绝允许其他用户替换配置路径的父目录权限", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-config-dir-mode-"));
        temporaryDirectories.push(directory);
        fs.chmodSync(directory, 0o770);

        expect(inspectSensitiveDirectoryMutationPermissions(directory)).toEqual({
            name: "config-dir-mode",
            level: "error",
            message: "配置目录权限 770 允许组或其他用户替换配置路径；请由目录所有者移除对应写权限",
        });
        expect(fs.statSync(directory).mode & 0o777).toBe(0o770);
    });

    it("允许组和其他用户遍历但不可修改的常见部署目录", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-config-dir-mode-"));
        temporaryDirectories.push(directory);
        fs.chmodSync(directory, 0o755);

        expect(inspectSensitiveDirectoryMutationPermissions(directory)).toEqual({
            name: "config-dir-mode",
            level: "ok",
            message: "配置目录权限 755 不允许组或其他用户替换配置路径",
        });
    });

    it("把 sticky bit 保护的共享临时目录保留为严格模式可见的警告", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-config-dir-mode-"));
        temporaryDirectories.push(directory);
        fs.chmodSync(directory, 0o1777);

        expect(inspectSensitiveDirectoryMutationPermissions(directory)).toEqual({
            name: "config-dir-mode",
            level: "warning",
            message:
                "配置目录权限 1777 允许共享写入但启用了 sticky bit；请确认这是隔离后的临时部署目录",
        });
    });
});

describe("doctor data directory", () => {
    it("distinguishes a writable directory from a colliding file", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-data-"));
        temporaryDirectories.push(directory);
        const usablePath = path.join(directory, "usable");
        const filePath = path.join(directory, "file");
        fs.mkdirSync(usablePath);
        fs.writeFileSync(filePath, "not a directory");

        expect(inspectDataDirectory(usablePath)).toEqual({
            name: "data-dir",
            level: "ok",
            message: `数据目录可读写: ${usablePath}`,
        });
        expect(inspectDataDirectory(filePath, true)).toEqual({
            name: "data-dir",
            level: "error",
            message: `数据存储路径不是目录: ${filePath}`,
        });
    });

    it.runIf(process.platform !== "win32" && process.getuid?.() !== 0)(
        "rejects a data directory that the runtime user cannot write",
        () => {
            const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-data-mode-"));
            temporaryDirectories.push(directory);
            const dataDirectory = path.join(directory, "data");
            fs.mkdirSync(dataDirectory, { mode: 0o500 });
            fs.chmodSync(dataDirectory, 0o500);

            expect(inspectDataDirectory(dataDirectory)).toMatchObject({
                name: "data-dir",
                level: "error",
                message: expect.stringContaining("数据目录不可用"),
            });
        },
    );

    it("creates and verifies only a missing data directory when --fix is enabled", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-data-fix-"));
        temporaryDirectories.push(directory);
        const dataDirectory = path.join(directory, "data");

        expect(inspectDataDirectory(dataDirectory)).toEqual({
            name: "data-dir",
            level: "warning",
            message: `数据目录尚未创建: ${dataDirectory}（--fix 可修复）`,
        });
        expect(fs.existsSync(dataDirectory)).toBe(false);
        expect(inspectDataDirectory(dataDirectory, true)).toEqual({
            name: "data-dir",
            level: "ok",
            message: `已创建并验证数据目录: ${dataDirectory}`,
            fixed: true,
        });
        expect(fs.statSync(dataDirectory).isDirectory()).toBe(true);
        if (process.platform !== "win32") {
            expect(fs.statSync(dataDirectory).mode & 0o777).toBe(0o700);
        }
    });
});

describe("doctor plugin selection", () => {
    const selection = (adapters: string[], protocols: string[]) => ({
        adapters,
        protocols,
        adapterSource: adapters.length ? ("config" as const) : ("none" as const),
        protocolSource: protocols.length ? ("config" as const) : ("none" as const),
        workingDirectory: "/srv/onebots",
    });

    it("只有平台入口时明确指出缺少协议出口", () => {
        expect(inspectDoctorPluginSelection(selection(["qq"], []))).toMatchObject({
            level: "warning",
            message: expect.stringContaining("未选择协议，账号无法配置对外出口"),
        });
    });

    it("只有协议出口时明确指出缺少平台入口", () => {
        expect(inspectDoctorPluginSelection(selection([], ["onebot-v11"]))).toMatchObject({
            level: "warning",
            message: expect.stringContaining("未选择适配器，无法创建平台账号"),
        });
    });

    it("平台入口与协议出口都存在时才通过", () => {
        expect(inspectDoctorPluginSelection(selection(["qq"], ["onebot-v11"]))).toMatchObject({
            level: "ok",
        });
    });

    it("验证扩展管理目录与已安装服务从同一位置解析依赖", () => {
        expect(inspectExtensionRootAlignment("/srv/onebots", "/srv/onebots")).toEqual({
            name: "extension-root-alignment",
            level: "ok",
            message: "扩展运行目录与服务工作目录一致: /srv/onebots",
        });
        expect(inspectExtensionRootAlignment("/srv/extensions", "/srv/service")).toMatchObject({
            name: "extension-root-alignment",
            level: "error",
            message: expect.stringContaining(
                "扩展运行目录 /srv/extensions 与服务工作目录 /srv/service 不一致",
            ),
        });
    });
});

describe.runIf(process.platform !== "win32")("doctor data directory permissions", () => {
    it("接受仅所有者可访问的目录，并保留明确的同组访问授权", () => {
        const privateDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-data-private-"));
        const groupDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-data-group-"));
        temporaryDirectories.push(privateDirectory, groupDirectory);
        fs.chmodSync(privateDirectory, 0o700);
        fs.chmodSync(groupDirectory, 0o750);

        expect(inspectSensitiveDirectoryPermissions(privateDirectory)).toEqual({
            name: "data-dir-mode",
            level: "ok",
            message: "数据目录权限 700 未向组或其他用户开放",
        });
        expect(inspectSensitiveDirectoryPermissions(groupDirectory, true)).toEqual({
            name: "data-dir-mode",
            level: "warning",
            message: "数据目录权限 750 允许同组用户访问；请确认这是服务部署所需",
        });
        expect(fs.statSync(groupDirectory).mode & 0o777).toBe(0o750);
    });

    it.each([
        { mode: 0o755, label: "755" },
        { mode: 0o720, label: "720" },
    ])("拒绝危险权限 $label，并仅在 --fix 时收紧", ({ mode, label }) => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-data-unsafe-"));
        temporaryDirectories.push(directory);
        fs.chmodSync(directory, mode);

        expect(inspectSensitiveDirectoryPermissions(directory)).toMatchObject({
            name: "data-dir-mode",
            level: "error",
            message: expect.stringContaining(mode.toString(8)),
        });
        expect(fs.statSync(directory).mode & 0o777).toBe(mode);
        expect(inspectSensitiveDirectoryPermissions(directory, true)).toEqual({
            name: "data-dir-mode",
            level: "ok",
            message: `已将数据目录权限从 ${label} 收紧为 0700`,
            fixed: true,
        });
        expect(fs.statSync(directory).mode & 0o777).toBe(0o700);
    });

    it("目录在取证前消失时返回错误而不抛出异常", () => {
        const missing = path.join(os.tmpdir(), "onebots-data-missing", "data");

        expect(inspectSensitiveDirectoryPermissions(missing)).toEqual({
            name: "data-dir-mode",
            level: "error",
            message: `数据目录权限无法验证: ${missing} (ENOENT)`,
        });
    });
});

describe("doctor public static directory", () => {
    it("将未创建目录作为警告，并且仅在 --fix 时创建", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-static-doctor-"));
        temporaryDirectories.push(directory);
        const expected = path.join(directory, "public");

        expect(inspectConfiguredPublicStaticDirectory(directory, "public")).toEqual({
            check: {
                name: "public-static-dir",
                level: "warning",
                message: `站点根静态目录尚未创建: ${expected}（--fix 可修复）`,
            },
            path: expected,
        });
        expect(fs.existsSync(expected)).toBe(false);
        const fixed = inspectConfiguredPublicStaticDirectory(directory, "public", true);
        const resolved = fs.realpathSync(expected);
        expect(fixed).toEqual({
            check: {
                name: "public-static-dir",
                level: "ok",
                message: `已创建并验证站点根静态目录: ${resolved}`,
                fixed: true,
            },
            path: resolved,
        });
    });

    it("区分未启用与无效配置类型", () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-static-doctor-"));
        temporaryDirectories.push(directory);

        expect(inspectConfiguredPublicStaticDirectory(directory, undefined)).toEqual({
            check: {
                name: "public-static-dir",
                level: "ok",
                message: "未启用站点根静态目录",
            },
            path: null,
        });
        expect(inspectConfiguredPublicStaticDirectory(directory, 42)).toEqual({
            check: {
                name: "public-static-dir",
                level: "error",
                message: "public_static_dir 必须是字符串路径",
            },
            path: null,
        });
    });
});

describe("doctor health probes", () => {
    it.each([
        [{ port: 7788 }, "http://127.0.0.1:7788"],
        [{ port: 7788, path: "gateway" }, "http://127.0.0.1:7788/gateway"],
        [{ port: 7788, path: "/gateway/" }, "http://127.0.0.1:7788/gateway"],
    ])("使用与 HTTP Router 一致的规范网关地址", (config, expected) => {
        expect(resolveGatewayBaseUrl(config)).toBe(expected);
    });

    it("使用 PORT 覆盖独立进程的配置端口", () => {
        expect(resolveGatewayBaseUrl({ port: 7788, path: "gateway" }, "7860")).toBe(
            "http://127.0.0.1:7860/gateway",
        );
        expect(resolveGatewayBaseUrl({ port: 7788 }, " ")).toBe("http://127.0.0.1:7788");
        expect(() => resolveGatewayBaseUrl({ port: 7788 }, "invalid")).toThrow(
            "PORT 必须是 1 到 65535 之间的整数",
        );
    });

    it.each([{ port: 0 }, { port: 65_536 }, { port: "invalid" }])(
        "拒绝无效的网关端口 $port",
        config => {
            expect(() => resolveGatewayBaseUrl(config)).toThrow(
                "网关 port 必须是 1 到 65535 之间的整数",
            );
        },
    );

    it("accepts only a health and readiness pair from the same runtime instance", () => {
        const health = {
            name: "health",
            level: "ok" as const,
            message: "health ok",
            identity: { application: "onebots", version: "1.2.8", instanceId: "instance-a" },
        };
        const sameInstance = {
            name: "ready",
            level: "ok" as const,
            message: "ready ok",
            identity: { application: "onebots", version: "1.2.8", instanceId: "instance-a" },
        };
        const staleInstance = {
            ...sameInstance,
            identity: { ...sameInstance.identity, instanceId: "instance-b" },
        };

        expect(compareDoctorEndpointIdentities(health, sameInstance)).toMatchObject({
            level: "ok",
            identity: health.identity,
        });
        expect(compareDoctorEndpointIdentities(health, staleInstance)).toMatchObject({
            level: "error",
            message: expect.stringContaining("拒绝拼接不一致的探针证据"),
        });
        expect(
            compareDoctorEndpointIdentities(health, {
                name: "ready",
                level: "error",
                message: "legacy ready",
            }),
        ).toMatchObject({ level: "error", message: expect.stringContaining("ready 缺少") });
    });

    it("要求成对探针声明并匹配服务启动契约", () => {
        const identityCheck = {
            name: "probe-instance",
            level: "ok" as const,
            message: "same instance",
            identity: {
                application: "onebots",
                version: "1.2.8",
                instanceId: "instance-a",
                runtimeContractId: "sha256:expected",
            },
        };

        expect(verifyDoctorRuntimeContract(identityCheck, "sha256:expected")).toMatchObject({
            name: "service-runtime-contract",
            level: "ok",
        });
        expect(verifyDoctorRuntimeContract(identityCheck, "sha256:other")).toMatchObject({
            level: "error",
            message: expect.stringContaining("启动契约与服务元数据不一致"),
        });
        expect(
            verifyDoctorRuntimeContract(
                {
                    ...identityCheck,
                    identity: { ...identityCheck.identity, runtimeContractId: undefined },
                },
                "sha256:expected",
            ),
        ).toMatchObject({
            level: "error",
            message: expect.stringContaining("未声明 runtime_contract_id"),
        });
    });

    it.each([
        ["drifted", "磁盘配置未应用"],
        ["unavailable", "配置文件不可读"],
    ])("明确报告运行时配置状态 %s", async (status, message) => {
        const fetcher = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        ready: false,
                        configured: true,
                        config: { status, in_sync: false },
                        adapters: {},
                        summary: { total_accounts: 0, online_accounts: 0 },
                    }),
                    { status: 503 },
                ),
        );

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "ready", fetcher),
        ).resolves.toMatchObject({
            level: "error",
            message: `ready: HTTP 503；${message}；账号 0/0 在线`,
        });
    });

    it("明确报告配置重载中的暂时不可用", async () => {
        const fetcher = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        ready: false,
                        reloading: true,
                        runtime_operation: "configuration_reload",
                        configured: false,
                        summary: { total_accounts: 0, online_accounts: 0 },
                    }),
                    { status: 503 },
                ),
        );

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "ready", fetcher),
        ).resolves.toMatchObject({
            level: "error",
            message: "ready: HTTP 503；完整配置重载中；账号 0/0 在线",
        });
    });

    it("明确区分账号上下线造成的暂时不可用", async () => {
        const fetcher = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        ready: false,
                        reloading: true,
                        runtime_operation: "account_lifecycle",
                        configured: true,
                        summary: { total_accounts: 1, online_accounts: 1 },
                    }),
                    { status: 503 },
                ),
        );

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "ready", fetcher),
        ).resolves.toMatchObject({
            level: "error",
            message: "ready: HTTP 503；账号上下线切换中；账号 1/1 在线",
        });
    });

    it("fails readiness when any configured account is offline and reports the platform", async () => {
        const fetcher = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        ready: false,
                        adapters: { kook: { online: 0, offline: 1, total: 1 } },
                        summary: { total_accounts: 1, online_accounts: 0 },
                    }),
                    { status: 503 },
                ),
        );

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "ready", fetcher),
        ).resolves.toEqual({
            name: "ready",
            level: "error",
            message: "ready: HTTP 503；账号 0/1 在线；未就绪: kook(0/1)",
        });
    });

    it("accepts a healthy endpoint and keeps its status evidence", async () => {
        const fetcher = vi.fn(
            async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
        );

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "health", fetcher),
        ).resolves.toEqual({
            name: "health",
            level: "ok",
            message: "health: HTTP 200；状态 ok",
        });
        expect(fetcher).toHaveBeenCalledWith(
            "http://127.0.0.1:6727/health",
            expect.objectContaining({
                cache: "no-store",
                redirect: "error",
                signal: expect.any(AbortSignal),
            }),
        );
    });

    it("拒绝把重定向到其他实例的公开响应作为本机身份", async () => {
        let cancelled = false;
        const body = new ReadableStream<Uint8Array>({
            cancel() {
                cancelled = true;
            },
        });
        const redirected = new Response(body, { status: 200 });
        Object.defineProperty(redirected, "redirected", { value: true });
        const fetcher = vi.fn(async () => redirected);

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "health", fetcher),
        ).resolves.toEqual({
            name: "health",
            level: "error",
            message: "health: 拒绝接受重定向后的探针响应",
        });
        expect(cancelled).toBe(true);
    });

    it("reports the running OneBots and Core versions when they match the CLI", async () => {
        const fetcher = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        status: "ok",
                        application: "onebots",
                        version: "1.2.8",
                        core_version: "1.2.5",
                    }),
                    { status: 200 },
                ),
        );

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "health", fetcher, "1.2.8"),
        ).resolves.toEqual({
            name: "health",
            level: "ok",
            message: "health: HTTP 200；状态 ok；onebots@1.2.8；@onebots/core@1.2.5",
        });
    });

    it("warns when the online process version differs from the current CLI", async () => {
        const fetcher = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        status: "ok",
                        application: "onebots",
                        version: "1.2.7",
                    }),
                    { status: 200 },
                ),
        );

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "health", fetcher, "1.2.8"),
        ).resolves.toEqual({
            name: "health",
            level: "warning",
            message:
                "health: HTTP 200；状态 ok；onebots@1.2.7；在线 OneBots 1.2.7 与当前 CLI 1.2.8 不一致；请重启或核对运行入口",
        });
    });

    it("warns when a legacy health response cannot prove its running version", async () => {
        const fetcher = vi.fn(
            async () => new Response(JSON.stringify({ status: "ok" }), { status: 200 }),
        );

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "health", fetcher, "1.2.8"),
        ).resolves.toEqual({
            name: "health",
            level: "warning",
            message: "health: HTTP 200；状态 ok；响应未声明运行版本（当前 CLI 1.2.8）",
        });
    });

    it("warns when a health response cannot prove the running application identity", async () => {
        const fetcher = vi.fn<typeof fetch>(
            async () =>
                new Response(JSON.stringify({ status: "ok", version: "1.2.8" }), { status: 200 }),
        );

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "health", fetcher, "1.2.8"),
        ).resolves.toEqual({
            name: "health",
            level: "warning",
            message: "health: HTTP 200；状态 ok；onebots@1.2.8；响应未声明运行应用身份",
        });
    });

    it("rejects a same-version process that is not the OneBots application", async () => {
        const fetcher = vi.fn<typeof fetch>(
            async () =>
                new Response(
                    JSON.stringify({
                        status: "ok",
                        application: "embedded-gateway",
                        version: "1.2.8",
                    }),
                    { status: 200 },
                ),
        );

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "health", fetcher, "1.2.8"),
        ).resolves.toEqual({
            name: "health",
            level: "warning",
            message:
                "health: HTTP 200；状态 ok；embedded-gateway@1.2.8；在线应用 embedded-gateway 不是 onebots",
        });
    });

    it("reports protocol startup failures even when the platform account is online", async () => {
        const fetcher = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        ready: false,
                        configured: true,
                        adapters: {
                            kook: {
                                online: 1,
                                offline: 0,
                                total: 1,
                                protocols: { ready: 0, unavailable: 1, total: 1 },
                            },
                        },
                        summary: {
                            total_accounts: 1,
                            online_accounts: 1,
                            total_protocols: 1,
                            ready_protocols: 0,
                        },
                    }),
                    { status: 503 },
                ),
        );

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "ready", fetcher),
        ).resolves.toEqual({
            name: "ready",
            level: "error",
            message: "ready: HTTP 503；账号 1/1 在线；协议 0/1 就绪；协议未就绪: kook(0/1)",
        });
    });

    it("reports online accounts that have no protocol outlet", async () => {
        const fetcher = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        ready: false,
                        configured: true,
                        adapters: {
                            mock: {
                                online: 1,
                                offline: 0,
                                total: 1,
                                accounts_without_protocols: 1,
                                protocols: { ready: 0, unavailable: 0, total: 0 },
                            },
                        },
                        summary: {
                            total_accounts: 1,
                            online_accounts: 1,
                            total_protocols: 0,
                            ready_protocols: 0,
                            accounts_without_protocols: 1,
                        },
                    }),
                    { status: 503 },
                ),
        );

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "ready", fetcher),
        ).resolves.toEqual({
            name: "ready",
            level: "error",
            message: "ready: HTTP 503；账号 1/1 在线；无协议出口: mock(1)",
        });
    });

    it("marks a reachable but unconfigured first-run gateway as a warning", async () => {
        const fetcher = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        ready: true,
                        application: "onebots",
                        version: "1.2.8",
                        instance_id: "doctor-instance",
                        configured: false,
                        adapters: {},
                        summary: { total_accounts: 0, online_accounts: 0 },
                    }),
                    { status: 200 },
                ),
        );

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "ready", fetcher),
        ).resolves.toEqual({
            name: "ready",
            level: "warning",
            message:
                "ready: HTTP 200；onebots@1.2.8；实例 doctor-instance；未配置账号；账号 0/0 在线",
            identity: {
                application: "onebots",
                version: "1.2.8",
                instanceId: "doctor-instance",
            },
        });
    });

    it("rejects readiness that cannot identify a concrete OneBots instance", async () => {
        const missingInstance = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({ ready: true, application: "onebots", version: "1.2.8" }),
                    { status: 200 },
                ),
        );
        const wrongApplication = vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        ready: true,
                        application: "other",
                        version: "1.2.8",
                        instance_id: "other-instance",
                    }),
                    { status: 200 },
                ),
        );

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "ready", missingInstance),
        ).resolves.toMatchObject({
            level: "error",
            message: expect.stringContaining("instance_id"),
        });
        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "ready", wrongApplication),
        ).resolves.toMatchObject({
            level: "error",
            message: expect.stringContaining("在线应用 other 不是 onebots"),
        });
    });

    it("rejects a contradictory HTTP 200 readiness body", async () => {
        const fetcher = vi.fn(
            async () =>
                new Response(JSON.stringify({ ready: false, configured: true }), { status: 200 }),
        );

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "ready", fetcher),
        ).resolves.toEqual({
            name: "ready",
            level: "error",
            message: "ready: HTTP 200；响应未声明 ready: true",
        });
    });

    it("rejects a non-JSON health response even when it returns HTTP 200", async () => {
        const fetcher = vi.fn(async () => new Response("OK", { status: 200 }));

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "health", fetcher),
        ).resolves.toEqual({
            name: "health",
            level: "error",
            message: "health: HTTP 200；响应 OK；响应不是有效 JSON",
        });
    });

    it("拒绝并取消超过上限的流式探针响应", async () => {
        let cancelled = false;
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                controller.enqueue(new Uint8Array(DOCTOR_ENDPOINT_BODY_LIMIT_BYTES + 1));
            },
            cancel() {
                cancelled = true;
            },
        });
        const fetcher = vi.fn(async () => new Response(body, { status: 200 }));

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "health", fetcher),
        ).resolves.toEqual({
            name: "health",
            level: "error",
            message: "health: HTTP 200；响应正文超过 64 KiB 上限",
        });
        expect(cancelled).toBe(true);
    });

    it("接受恰好位于字节上限的有效探针响应", async () => {
        const payload = JSON.stringify({
            status: "ok",
            application: "onebots",
            version: "1.2.8",
            instance_id: "bounded-instance",
        });
        const body = payload.padEnd(DOCTOR_ENDPOINT_BODY_LIMIT_BYTES, " ");
        const fetcher = vi.fn(async () => new Response(body, { status: 200 }));

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "health", fetcher),
        ).resolves.toMatchObject({
            name: "health",
            level: "ok",
            identity: {
                application: "onebots",
                version: "1.2.8",
                instanceId: "bounded-instance",
            },
        });
    });

    it("在读取正文前拒绝声明超限的探针响应", async () => {
        let cancelled = false;
        const body = new ReadableStream<Uint8Array>({
            cancel() {
                cancelled = true;
            },
        });
        const fetcher = vi.fn(
            async () =>
                new Response(body, {
                    status: 200,
                    headers: {
                        "content-length": String(DOCTOR_ENDPOINT_BODY_LIMIT_BYTES + 1),
                    },
                }),
        );

        await expect(
            probeDoctorEndpoint("http://127.0.0.1:6727", "ready", fetcher),
        ).resolves.toEqual({
            name: "ready",
            level: "error",
            message: "ready: HTTP 200；响应正文超过 64 KiB 上限",
        });
        expect(cancelled).toBe(true);
    });
});

describe("doctor gateway port availability", () => {
    it("使用网关的实际监听方式区分可用端口与已占用端口", async () => {
        const occupyingServer = net.createServer();
        await new Promise<void>((resolve, reject) => {
            occupyingServer.once("error", reject);
            occupyingServer.listen(0, resolve);
        });
        const address = occupyingServer.address();
        if (!address || typeof address === "string") throw new Error("测试服务器未取得 TCP 端口");

        await expect(inspectGatewayPortAvailability(address.port)).resolves.toMatchObject({
            name: "port",
            level: "error",
            message: expect.stringContaining("EADDRINUSE"),
        });

        await new Promise<void>((resolve, reject) => {
            occupyingServer.close(error => {
                if (error) reject(error);
                else resolve();
            });
        });
        await expect(inspectGatewayPortAvailability(address.port)).resolves.toEqual({
            name: "port",
            level: "ok",
            message: `端口 ${address.port} 可用（已验证实际监听）`,
        });
    });
});

describe("doctor persisted plugin selection", () => {
    it("fails the deployment report when the runtime data path is a file", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-data-report-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "config.yaml");
        const dataDirectory = path.join(directory, "data");
        fs.writeFileSync(configPath, "port: 61996\ngeneral: {}\n", { mode: 0o600 });
        fs.writeFileSync(dataDirectory, "invalid mount target");

        const report = await runDoctor({
            configPath,
            adapters: [],
            protocols: [],
            scope: "user",
            useInstalledService: false,
            extensionRoot: createExtensionRuntimeRoot(),
            fix: true,
        });

        expect(report.ok).toBe(false);
        expect(report.target.dataDirectory).toBe(dataDirectory);
        expect(report.checks.find(check => check.name === "data-dir")).toEqual({
            name: "data-dir",
            level: "error",
            message: `数据存储路径不是目录: ${dataDirectory}`,
        });
        expect(fs.statSync(dataDirectory).isFile()).toBe(true);
    });

    it("独立诊断使用当前进程的 PORT 覆盖", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-port-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "config.yaml");
        fs.writeFileSync(configPath, "port: 61998\ngeneral: {}\n", { mode: 0o600 });
        fs.mkdirSync(path.join(directory, "data"), { mode: 0o700 });

        const report = await runDoctor({
            configPath,
            adapters: [],
            protocols: [],
            scope: "user",
            useInstalledService: false,
            environmentPort: "invalid",
        });

        expect(report.checks.find(check => check.name === "gateway-address")).toEqual({
            name: "gateway-address",
            level: "error",
            message: "网关地址配置无效: PORT 必须是 1 到 65535 之间的整数",
        });
    });

    it("将不安全的宿主 path 保留为诊断结果而不是让 doctor 崩溃", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-path-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "config.yaml");
        fs.writeFileSync(configPath, 'port: 61998\npath: "//example.com/gateway"\ngeneral: {}\n', {
            mode: 0o600,
        });
        fs.mkdirSync(path.join(directory, "data"));

        const report = await runDoctor({
            configPath,
            adapters: [],
            protocols: [],
            scope: "user",
            useInstalledService: false,
        });

        expect(report.ok).toBe(false);
        expect(report.checks.find(check => check.name === "runtime-config")).toMatchObject({
            level: "error",
            message: expect.stringContaining("网关 path 不能以 // 开头"),
        });
        expect(report.checks.find(check => check.name === "gateway-address")).toEqual({
            name: "gateway-address",
            level: "error",
            message: "网关地址配置无效: 网关 path 不能以 // 开头",
        });
    });

    it("配置语法损坏时不把相邻凭据带入诊断报告", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-config-error-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "config.yaml");
        fs.writeFileSync(configPath, "access_token: secret-never-return\nplugins: [\n", {
            mode: 0o600,
        });
        fs.mkdirSync(path.join(directory, "data"));

        const report = await runDoctor({
            configPath,
            adapters: [],
            protocols: [],
            scope: "user",
            useInstalledService: false,
            extensionRoot: createExtensionRuntimeRoot(),
        });
        const configCheck = report.checks.find(check => check.name === "config");

        expect(report.ok).toBe(false);
        expect(configCheck).toMatchObject({
            level: "error",
            message: expect.stringContaining("配置无效: YAML 解析失败"),
        });
        expect(configCheck?.message).not.toContain("secret-never-return");
        expect(configCheck?.message).not.toContain("plugins: [");
    });

    it("only fails a first-run warning when strict mode is enabled", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-strict-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "config.yaml");
        fs.writeFileSync(configPath, "general: {}\npublic_static_dir: static\n", { mode: 0o600 });
        fs.mkdirSync(path.join(directory, "data"), { mode: 0o700 });
        fs.mkdirSync(path.join(directory, "static"));
        const extensionRoot = createExtensionRuntimeRoot();

        const normal = await runDoctor({
            configPath,
            adapters: [],
            protocols: [],
            scope: "user",
            useInstalledService: false,
            extensionRoot,
        });
        const strict = await runDoctor({
            configPath,
            adapters: [],
            protocols: [],
            scope: "user",
            strict: true,
            useInstalledService: false,
            extensionRoot,
        });

        expect(normal).toMatchObject({ ok: true, strict: false });
        expect(strict).toMatchObject({ ok: false, strict: true });
        expect(strict.checks.find(check => check.name === "plugin-selection")).toMatchObject({
            level: "warning",
        });
        expect(normal.checks.find(check => check.name === "extension-root")).toMatchObject({
            level: "ok",
            message: expect.stringContaining(`onebots@${packageMetadata.version}`),
        });
        expect(normal.target.publicStaticDirectory).toBe(
            fs.realpathSync(path.join(directory, "static")),
        );
    });

    it("将错误的扩展运行目录作为部署失败证据", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-extension-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "config.yaml");
        fs.writeFileSync(configPath, "general: {}\n", { mode: 0o600 });
        fs.mkdirSync(path.join(directory, "data"));
        fs.writeFileSync(path.join(directory, "package.json"), '{"name":"unrelated"}\n');

        const report = await runDoctor({
            configPath,
            adapters: [],
            protocols: [],
            scope: "user",
            useInstalledService: false,
            extensionRoot: directory,
        });

        expect(report.ok).toBe(false);
        expect(report.checks.find(check => check.name === "extension-root")).toMatchObject({
            level: "error",
            message: expect.stringContaining("扩展运行目录未声明 onebots 依赖"),
        });
        expect(report.checks.find(check => check.name === "package-manager")).toMatchObject({
            level: "error",
            message: "扩展运行目录未通过验证，无法确定安全的包管理器",
        });
    });

    it("将缺失的扩展包管理器作为部署失败证据", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-manager-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "config.yaml");
        fs.writeFileSync(configPath, "general: {}\n", { mode: 0o600 });
        fs.mkdirSync(path.join(directory, "data"));
        const extensionRoot = createExtensionRuntimeRoot();
        fs.writeFileSync(
            path.join(extensionRoot, "package.json"),
            JSON.stringify({
                private: true,
                packageManager: "pnpm@9.15.9",
                dependencies: { onebots: packageMetadata.version },
            }),
        );
        vi.stubEnv("PATH", "");

        const report = await runDoctor({
            configPath,
            adapters: [],
            protocols: [],
            scope: "user",
            useInstalledService: false,
            extensionRoot,
        });

        expect(report.ok).toBe(false);
        expect(report.checks.find(check => check.name === "package-manager")).toMatchObject({
            level: "error",
            message: expect.stringContaining("PATH 中找不到可执行入口"),
        });
    });

    it("将过旧的扩展包管理器版本作为部署失败证据", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-manager-version-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "config.yaml");
        fs.writeFileSync(configPath, "general: {}\n", { mode: 0o600 });
        fs.mkdirSync(path.join(directory, "data"));
        const extensionRoot = createExtensionRuntimeRoot();

        const report = await runDoctor({
            configPath,
            adapters: [],
            protocols: [],
            scope: "user",
            useInstalledService: false,
            extensionRoot,
            packageManagerInspector: async () => ({
                manager: "pnpm",
                executable: "pnpm",
                resolvedPath: "/tools/pnpm",
                version: "8.15.9",
                error: "扩展包管理器版本过旧：pnpm 8.15.9，要求 >=9.12.0。",
            }),
        });

        expect(report.ok).toBe(false);
        expect(report.checks.find(check => check.name === "package-manager")).toEqual({
            name: "package-manager",
            level: "error",
            message: "扩展包管理器版本过旧：pnpm 8.15.9，要求 >=9.12.0。",
        });
    });

    it("拒绝服务定义中的旧 Node，并用 --fix 切换到当前运行时", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-service-node-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "config.yaml");
        fs.writeFileSync(configPath, "port: 61996\ngeneral: {}\n", { mode: 0o600 });
        fs.mkdirSync(path.join(directory, "data"));
        const extensionRoot = createExtensionRuntimeRoot();
        const spec: ServiceSpec = {
            scope: "user",
            configPath,
            adapters: [],
            protocols: [],
            nodePath: "/legacy/node",
            binPath: process.argv[1],
            workingDirectory: process.cwd(),
        };
        vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(spec);
        vi.spyOn(ServiceController.prototype, "status").mockReturnValue({
            installed: true,
            running: false,
            scope: "user",
            detail: "inactive",
        });
        vi.spyOn(ServiceController.prototype, "paths").mockReturnValue({
            stateDir: directory,
            definition: path.join(directory, "service.plist"),
            metadata: path.join(directory, "service.json"),
        });
        const metadataPath = path.join(directory, "service.json");
        const definitionPath = path.join(directory, "service.plist");
        if (process.platform !== "win32") {
            fs.writeFileSync(metadataPath, JSON.stringify(spec), { mode: 0o644 });
            fs.writeFileSync(definitionPath, "service definition", { mode: 0o666 });
            fs.chmodSync(definitionPath, 0o666);
        }
        vi.spyOn(ServiceController.prototype, "definitionIsCurrent").mockReturnValue(true);
        const install = vi.spyOn(ServiceController.prototype, "install").mockResolvedValue();
        const serviceRuntimeInspector = vi.fn((nodePath: string) =>
            nodePath === spec.nodePath
                ? {
                      supported: false,
                      check: {
                          name: "service-node" as const,
                          level: "error" as const,
                          message: "服务定义使用 Node.js v22.14.0",
                      },
                  }
                : {
                      supported: true,
                      check: {
                          name: "service-node" as const,
                          level: "ok" as const,
                          message: `服务 Node.js ${process.version}`,
                      },
                  },
        );
        const options = {
            configPath,
            adapters: [],
            protocols: [],
            scope: "user" as const,
            extensionRoot,
            serviceRuntimeInspector,
            serviceEntryInspector: () => ({
                valid: true,
                check: {
                    name: "service-entry",
                    level: "ok" as const,
                    message: "服务入口 onebots@current",
                },
            }),
        };

        const invalid = await runDoctor(options);
        expect(invalid.ok).toBe(false);
        expect(invalid.checks.find(check => check.name === "service-credentials")).toEqual({
            name: "service-credentials",
            level: "error",
            message:
                "服务配置缺少持久化管理凭据；当前 shell 的 ONEBOTS_ACCESS_TOKEN 不会写入服务定义，请将凭据写入配置或取消该环境变量后执行 onebots setup --force",
        });
        expect(invalid.checks.find(check => check.name === "service-node")).toMatchObject({
            level: "error",
        });
        expect(invalid.checks.find(check => check.name === "service-definition")).toMatchObject({
            level: "error",
        });
        if (process.platform !== "win32") {
            expect(
                invalid.checks.find(check => check.name === "service-metadata-mode"),
            ).toMatchObject({ level: "error" });
            expect(
                invalid.checks.find(check => check.name === "service-definition-mode"),
            ).toMatchObject({ level: "error" });
            expect(fs.statSync(metadataPath).mode & 0o777).toBe(0o644);
            expect(fs.statSync(definitionPath).mode & 0o777).toBe(0o666);
        }
        expect(install).not.toHaveBeenCalled();

        if (process.platform !== "win32") {
            const systemReport = await runDoctor({ ...options, scope: "system", fix: true });
            expect(
                systemReport.checks.find(check => check.name === "service-metadata-mode"),
            ).toMatchObject({ level: "error" });
            expect(
                systemReport.checks.find(check => check.name === "service-metadata-mode"),
            ).not.toHaveProperty("fixed");
            expect(
                systemReport.checks.find(check => check.name === "service-definition-mode"),
            ).toMatchObject({ level: "error" });
            expect(
                systemReport.checks.find(check => check.name === "service-definition-mode"),
            ).not.toHaveProperty("fixed");
            expect(fs.statSync(metadataPath).mode & 0o777).toBe(0o644);
            expect(fs.statSync(definitionPath).mode & 0o777).toBe(0o666);
            expect(install).not.toHaveBeenCalled();
        }

        const repaired = await runDoctor({ ...options, fix: true });
        expect(repaired.checks.find(check => check.name === "service-node")).toEqual({
            name: "service-node",
            level: "ok",
            message: `服务 Node.js ${process.version}`,
            fixed: true,
        });
        expect(repaired.checks.find(check => check.name === "service-definition")).toMatchObject({
            level: "ok",
            fixed: true,
        });
        if (process.platform !== "win32") {
            expect(
                repaired.checks.find(check => check.name === "service-metadata-mode"),
            ).toMatchObject({ level: "ok", fixed: true });
            expect(
                repaired.checks.find(check => check.name === "service-definition-mode"),
            ).toMatchObject({ level: "ok", fixed: true });
            expect(fs.statSync(metadataPath).mode & 0o777).toBe(0o600);
            expect(fs.statSync(definitionPath).mode & 0o777).toBe(0o644);
        }
        expect(install).toHaveBeenCalledWith({
            ...spec,
            configPath,
            nodePath: process.execPath,
            binPath: path.resolve(process.argv[1]),
        });

        install.mockRejectedValueOnce(
            new Error("systemctl failed with ONEBOTS_ACCESS_TOKEN=secret-token"),
        );
        const failedRepair = await runDoctor({ ...options, fix: true });
        expect(failedRepair.ok).toBe(false);
        const failedRuntimeCheck = failedRepair.checks.find(check => check.name === "service-node");
        expect(failedRuntimeCheck).toMatchObject({ level: "error" });
        expect(failedRuntimeCheck).not.toHaveProperty("fixed");
        expect(failedRepair.checks.find(check => check.name === "service-definition")).toEqual({
            name: "service-definition",
            level: "error",
            message: `用户级服务定义修复失败: ${path.join(directory, "service.plist")}`,
        });
        expect(JSON.stringify(failedRepair)).not.toContain("secret-token");
    });

    it("不把临时环境 Secret 作为已安装服务的凭据证据", async () => {
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-service-auth-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "config.yaml");
        fs.writeFileSync(configPath, "general: {}\n", { mode: 0o600 });
        fs.mkdirSync(path.join(directory, "data"));
        vi.stubEnv("ONEBOTS_ACCESS_TOKEN", "transient-shell-token");
        const spec: ServiceSpec = {
            scope: "user",
            configPath,
            adapters: [],
            protocols: [],
            nodePath: process.execPath,
            binPath: process.argv[1],
            workingDirectory: process.cwd(),
        };
        vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(spec);
        vi.spyOn(ServiceController.prototype, "status").mockReturnValue({
            installed: true,
            running: false,
            scope: "user",
            detail: "inactive",
        });

        const report = await runDoctor({
            configPath,
            adapters: [],
            protocols: [],
            scope: "user",
            extensionRoot: createExtensionRuntimeRoot(),
            serviceRuntimeInspector: () => ({
                supported: true,
                check: { name: "service-node", level: "ok", message: "服务 Node.js 可用" },
            }),
            serviceEntryInspector: () => ({
                valid: true,
                check: { name: "service-entry", level: "ok", message: "服务入口可用" },
            }),
            serviceDefinitionInspector: () => ({ current: true, error: null }),
        });

        expect(report.checks.find(check => check.name === "service-credentials")).toMatchObject({
            level: "error",
            message: expect.stringContaining("当前 shell 的 ONEBOTS_ACCESS_TOKEN 不会写入服务定义"),
        });
        expect(JSON.stringify(report)).not.toContain("transient-shell-token");
    });

    it("exposes category-level precedence and ignores service defaults in standalone mode", () => {
        const service: ServiceSpec = {
            scope: "user",
            configPath: "/service/config.yaml",
            adapters: ["service-adapter"],
            protocols: ["service-v1"],
            nodePath: process.execPath,
            binPath: process.argv[1],
            workingDirectory: "/service",
        };

        expect(
            resolveDoctorPluginSelection(
                { adapters: ["cli-adapter"], protocols: [], useInstalledService: true },
                { adapters: ["config-adapter"], protocols: ["config-v1"] },
                service,
            ),
        ).toMatchObject({
            adapters: ["cli-adapter"],
            protocols: ["service-v1"],
            adapterSource: "cli",
            protocolSource: "service",
            workingDirectory: "/service",
        });
        expect(
            resolveDoctorPluginSelection(
                { adapters: [], protocols: [], useInstalledService: false },
                { adapters: ["config-adapter"], protocols: ["config-v1"] },
                service,
            ),
        ).toMatchObject({
            adapters: ["config-adapter"],
            protocols: ["config-v1"],
            adapterSource: "config",
            protocolSource: "config",
            workingDirectory: process.cwd(),
        });
    });

    it("reports an installed but stopped managed service as a warning", async () => {
        vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(null);
        vi.spyOn(ServiceController.prototype, "status").mockReturnValue({
            installed: true,
            running: false,
            scope: "user",
            detail: "服务已安装但未运行",
        });
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-stopped-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "config.yaml");
        fs.writeFileSync(configPath, "general: {}\n", { mode: 0o600 });
        fs.mkdirSync(path.join(directory, "data"));

        const report = await runDoctor({
            configPath,
            adapters: [],
            protocols: [],
            scope: "user",
            strict: true,
        });

        expect(report.ok).toBe(false);
        expect(report.checks.find(check => check.name === "service")).toEqual({
            name: "service",
            level: "warning",
            message: "服务已安装但未运行",
        });
    });

    it("fails diagnosis when the process manager cannot prove service state", async () => {
        vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(null);
        vi.spyOn(ServiceController.prototype, "status").mockReturnValue({
            installed: true,
            running: false,
            scope: "user",
            detail: "systemd bus unavailable",
            error: "进程管理器状态查询失败",
        });
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-status-error-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "config.yaml");
        fs.writeFileSync(configPath, "general: {}\n", { mode: 0o600 });
        fs.mkdirSync(path.join(directory, "data"));

        const report = await runDoctor({
            configPath,
            adapters: [],
            protocols: [],
            scope: "user",
        });

        expect(report.ok).toBe(false);
        expect(report.checks.find(check => check.name === "service")).toEqual({
            name: "service",
            level: "error",
            message: "进程管理器状态查询失败：systemd bus unavailable",
        });
    });

    it("uses config defaults when no service or explicit plugin flags exist", async () => {
        vi.spyOn(ServiceController.prototype, "readSpec").mockReturnValue(null);
        vi.spyOn(ServiceController.prototype, "status").mockReturnValue({
            installed: false,
            running: false,
            scope: "user",
            detail: "服务未安装",
        });
        const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-plugins-"));
        temporaryDirectories.push(directory);
        const configPath = path.join(directory, "config.yaml");
        fs.writeFileSync(
            configPath,
            "port: 61999\nplugins:\n  adapters: [missing-first-run]\n  protocols: []\n",
            { mode: 0o600 },
        );
        fs.mkdirSync(path.join(directory, "data"));

        const report = await runDoctor({
            configPath,
            adapters: [],
            protocols: [],
            scope: "user",
        });

        expect(
            report.checks.find(check => check.name === "adapter:missing-first-run"),
        ).toMatchObject({ level: "error" });
        expect(report.checks.find(check => check.name === "plugin-selection")).toMatchObject({
            level: "warning",
            message: expect.stringContaining("适配器 配置文件 [missing-first-run]"),
        });
        expect(report.target).toMatchObject({
            configPath,
            dataDirectory: path.join(directory, "data"),
            databasePath: path.join(directory, "data", "onebots.db"),
            service: { scope: "user", mode: "uninstalled" },
            plugins: {
                adapters: { source: "config", names: ["missing-first-run"] },
                protocols: { source: "config", names: [] },
            },
        });
    });
});

function createConfigFile(mode: number): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-doctor-mode-"));
    temporaryDirectories.push(directory);
    const configPath = path.join(directory, "config.yaml");
    fs.writeFileSync(configPath, "general: {}\n", { mode });
    fs.chmodSync(configPath, mode);
    return configPath;
}

function createExtensionRuntimeRoot(): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-extension-root-"));
    temporaryDirectories.push(directory);
    fs.mkdirSync(path.join(directory, "node_modules", "onebots"), { recursive: true });
    fs.writeFileSync(
        path.join(directory, "package.json"),
        JSON.stringify({ private: true, dependencies: { onebots: packageMetadata.version } }),
    );
    fs.writeFileSync(
        path.join(directory, "node_modules", "onebots", "package.json"),
        JSON.stringify({ name: "onebots", version: packageMetadata.version }),
    );
    return directory;
}
