import { describe, expect, it } from "vitest";
import {
    getExtensionDisableAction,
    getExtensionDisableProgress,
    getExtensionDisableRequestRecovery,
    getExtensionInstallCompletion,
    getExtensionInstallRequestRecovery,
    getExtensionInstallationAction,
    getExtensionInstallationProgress,
    getExtensionRuntimeStatus,
    hasExtensionRuntimeVersionDrift,
    shouldRefreshExtensionOperations,
} from "./extension-installation.js";

describe("extension operation refresh", () => {
    it("持续观察活动事务和断线后尚未闭合的请求", () => {
        const idle = [{ installing: false, disabling: false }];
        expect(
            shouldRefreshExtensionOperations({
                extensions: idle,
                packageMutationActive: false,
                disconnectedRequest: false,
            }),
        ).toBe(false);
        expect(
            shouldRefreshExtensionOperations({
                extensions: idle,
                packageMutationActive: false,
                disconnectedRequest: true,
            }),
        ).toBe(true);
        expect(
            shouldRefreshExtensionOperations({
                extensions: [{ installing: false, disabling: true }],
                packageMutationActive: false,
                disconnectedRequest: false,
            }),
        ).toBe(true);
    });
});

describe("extension disable action", () => {
    it("只为已启用扩展提供停用操作并说明重启边界", () => {
        expect(
            getExtensionDisableAction({
                enabled: true,
                restartSupported: true,
                runtimeConfigError: null,
            }),
        ).toEqual({ visible: true, available: true, label: "停用并重启" });
        expect(
            getExtensionDisableAction({
                enabled: true,
                restartSupported: false,
                runtimeConfigError: null,
            }),
        ).toEqual({
            visible: true,
            available: true,
            label: "停用并在完成后手动重启",
        });
        expect(
            getExtensionDisableAction({
                enabled: false,
                restartSupported: true,
                runtimeConfigError: null,
            }),
        ).toEqual({ visible: false, available: false, label: "已停用" });
    });

    it("启动配置不可读取时阻止停用", () => {
        expect(
            getExtensionDisableAction({
                enabled: true,
                restartSupported: true,
                runtimeConfigError: "配置损坏",
            }),
        ).toEqual({ visible: true, available: false, label: "启动配置不可用" });
    });
});

describe("extension disable request recovery", () => {
    const previous = {
        operationId: "previous-disable",
        status: "succeeded" as const,
        startedAt: "2026-09-02T00:00:00.000Z",
        completedAt: "2026-09-02T00:01:00.000Z",
        message: null,
    };

    it("等待活动停用并只采用本次请求产生的新终态", () => {
        expect(
            getExtensionDisableRequestRecovery(previous.operationId, {
                disableOperation: {
                    operationId: "active-disable",
                    startedAt: "2026-09-02T00:02:00.000Z",
                },
                lastDisable: null,
            }),
        ).toEqual({ status: "running" });
        expect(
            getExtensionDisableRequestRecovery(previous.operationId, {
                disableOperation: null,
                lastDisable: { ...previous, operationId: "completed-disable" },
            }),
        ).toEqual({ status: "succeeded" });
        expect(
            getExtensionDisableRequestRecovery(previous.operationId, {
                disableOperation: null,
                lastDisable: {
                    ...previous,
                    operationId: "failed-disable",
                    status: "failed",
                    message: "账号仍在引用",
                },
            }),
        ).toEqual({ status: "failed", message: "账号仍在引用" });
        expect(
            getExtensionDisableRequestRecovery(previous.operationId, {
                disableOperation: null,
                lastDisable: previous,
            }),
        ).toEqual({ status: "unknown" });
    });

    it("展示活动停用与最近失败证据", () => {
        expect(
            getExtensionDisableProgress({
                disabling: true,
                disableOperation: {
                    operationId: "active-disable",
                    startedAt: "2026-09-02T00:02:00.000Z",
                },
                lastDisable: null,
            }),
        ).toMatchObject({ variant: "warning", label: "正在隔离预检并停用扩展" });
        expect(
            getExtensionDisableProgress({
                disabling: false,
                disableOperation: null,
                lastDisable: {
                    ...previous,
                    status: "failed",
                    message: "账号仍在引用",
                },
            }),
        ).toMatchObject({ variant: "danger", label: "上次停用失败：账号仍在引用" });
    });
});

describe("extension install completion", () => {
    it("keeps automatic restart for managed and legacy servers", () => {
        expect(
            getExtensionInstallCompletion({ restartRequired: true, restartSupported: true }),
        ).toEqual({ restart: true, message: null });
        expect(getExtensionInstallCompletion({ restartRequired: true })).toEqual({
            restart: true,
            message: null,
        });
    });

    it("preserves the foreground process and returns a manual restart instruction", () => {
        expect(
            getExtensionInstallCompletion({
                restartRequired: true,
                restartSupported: false,
                message: "请手动重启 OneBots",
            }),
        ).toEqual({ restart: false, message: "请手动重启 OneBots" });
    });
});

describe("extension runtime version evidence", () => {
    it("只在磁盘版本与当前进程版本都有证据且不一致时标记漂移", () => {
        expect(
            hasExtensionRuntimeVersionDrift({
                installedVersion: "2.0.0",
                loaded: true,
                loadedVersion: "1.0.0",
            }),
        ).toBe(true);
        expect(
            hasExtensionRuntimeVersionDrift({
                installedVersion: "2.0.0",
                loaded: true,
                loadedVersion: "2.0.0",
            }),
        ).toBe(false);
        expect(
            hasExtensionRuntimeVersionDrift({
                installedVersion: "2.0.0",
                loaded: true,
                loadedVersion: null,
            }),
        ).toBe(false);
    });

    it("把尚未切换到磁盘版本的已加载扩展标为等待切换", () => {
        expect(
            getExtensionRuntimeStatus({
                enabled: true,
                installed: true,
                installedVersion: "2.0.0",
                loaded: true,
                loadedVersion: "1.0.0",
            }),
        ).toEqual({ variant: "warning", label: "已加载，等待版本切换" });
    });
});

const base = {
    catalogError: null,
    runtimeError: null,
    packageManagerError: null,
    runtimeConfigError: null,
    enabled: false,
    installed: false,
    loaded: false,
    targetVersion: "1.2.3",
    versionAligned: false,
};

describe("extension installation action", () => {
    it("blocks installation when the server cannot prove catalog integrity", () => {
        expect(
            getExtensionInstallationAction({
                ...base,
                catalogError: "适配器能力快照缺失: slack",
            }),
        ).toEqual({ visible: true, available: false, label: "目录校验失败" });
    });

    it("blocks an entry without a verified target version", () => {
        expect(getExtensionInstallationAction({ ...base, targetVersion: null })).toEqual({
            visible: true,
            available: false,
            label: "验证版本不可用",
        });
    });

    it("blocks installation when the runtime directory identity cannot be proven", () => {
        expect(
            getExtensionInstallationAction({
                ...base,
                runtimeError: "扩展运行目录未声明 onebots 依赖",
            }),
        ).toEqual({ visible: true, available: false, label: "运行目录不可用" });
    });

    it("单独标记缺少包管理器且不混淆运行目录身份错误", () => {
        expect(
            getExtensionInstallationAction({
                ...base,
                packageManagerError: "当前进程的 PATH 中找不到 pnpm",
            }),
        ).toEqual({ visible: true, available: false, label: "包管理器不可用" });
    });

    it("keeps capability browsing but blocks installation when startup config is unreadable", () => {
        expect(
            getExtensionInstallationAction({
                ...base,
                runtimeConfigError: "扩展启动配置无法读取：YAML 解析失败",
            }),
        ).toEqual({ visible: true, available: false, label: "启动配置不可用" });
    });

    it("keeps the normal install and version-alignment actions", () => {
        expect(getExtensionInstallationAction(base)).toEqual({
            visible: true,
            available: true,
            label: "安装 v1.2.3 并重启",
        });
        expect(getExtensionInstallationAction({ ...base, installed: true })).toEqual({
            visible: true,
            available: true,
            label: "切换至 v1.2.3 并重启",
        });
    });

    it("makes the manual restart boundary visible before foreground installation", () => {
        expect(getExtensionInstallationAction({ ...base, restartSupported: false })).toEqual({
            visible: true,
            available: true,
            label: "安装 v1.2.3 并在完成后手动重启",
        });
        expect(
            getExtensionInstallationAction({
                ...base,
                installed: true,
                enabled: true,
                versionAligned: true,
                restartSupported: false,
            }),
        ).toEqual({ visible: true, available: false, label: "请手动重启以加载" });
    });

    it("distinguishes enabling an installed package from restarting an enabled one", () => {
        expect(
            getExtensionInstallationAction({ ...base, installed: true, versionAligned: true }),
        ).toEqual({ visible: true, available: true, label: "启用并重启" });
        expect(
            getExtensionInstallationAction({
                ...base,
                installed: true,
                enabled: true,
                versionAligned: true,
            }),
        ).toEqual({ visible: true, available: true, label: "重启以加载" });
        expect(
            getExtensionInstallationAction({
                ...base,
                installed: true,
                enabled: true,
                loaded: true,
                versionAligned: true,
            }),
        ).toEqual({ visible: false, available: false, label: "已加载" });
    });

    it("为入口无法验证的固定版本提供明确修复操作", () => {
        expect(
            getExtensionInstallationAction({
                ...base,
                installed: true,
                installedError: "插件入口解析到实际包目录外",
            }),
        ).toEqual({ visible: true, available: true, label: "修复 v1.2.3 并重启" });
    });

    it("为磁盘与当前进程版本漂移提供明确切换操作", () => {
        const drifted = {
            ...base,
            installed: true,
            installedVersion: "1.2.3",
            enabled: true,
            loaded: true,
            loadedVersion: "1.1.0",
            versionAligned: true,
        };
        expect(getExtensionInstallationAction(drifted)).toEqual({
            visible: true,
            available: true,
            label: "重启以切换版本",
        });
        expect(getExtensionInstallationAction({ ...drifted, restartSupported: false })).toEqual({
            visible: true,
            available: false,
            label: "请手动重启以切换版本",
        });
    });
});

describe("extension installation progress", () => {
    it.each([
        [
            { installing: true, installation: undefined },
            { variant: "warning", label: "正在安装扩展", detail: null },
        ],
        [
            {
                installing: true,
                installation: {
                    operationId: "operation-1",
                    phase: "installing_package" as const,
                    startedAt: "2026-08-31T00:00:00.000Z",
                },
            },
            {
                variant: "warning",
                label: "正在安装并核验依赖",
                detail: "操作 operatio · 2026-08-31T00:00:00.000Z",
            },
        ],
        [
            {
                installing: true,
                installation: {
                    operationId: "operation-1",
                    phase: "preflighting" as const,
                    startedAt: "2026-08-31T00:00:00.000Z",
                },
            },
            {
                variant: "warning",
                label: "正在执行隔离预检",
                detail: "操作 operatio · 2026-08-31T00:00:00.000Z",
            },
        ],
        [
            {
                installing: true,
                installation: {
                    operationId: "operation-1",
                    phase: "restoring_package" as const,
                    startedAt: "2026-08-31T00:00:00.000Z",
                },
            },
            {
                variant: "warning",
                label: "正在恢复安装前依赖",
                detail: "操作 operatio · 2026-08-31T00:00:00.000Z",
            },
        ],
        [
            {
                installing: false,
                installation: {
                    operationId: "operation-1",
                    phase: "preflighting" as const,
                    startedAt: "2026-08-31T00:00:00.000Z",
                },
            },
            null,
        ],
        [
            {
                installing: false,
                installation: null,
                lastInstallation: {
                    operationId: "failed-operation",
                    status: "failed" as const,
                    startedAt: "2026-08-31T00:00:00.000Z",
                    completedAt: "2026-08-31T00:01:00.000Z",
                    message: "registry timeout",
                },
            },
            {
                variant: "danger",
                label: "上次安装失败：registry timeout",
                detail: "操作 failed-o · 2026-08-31T00:01:00.000Z",
            },
        ],
        [
            {
                installing: false,
                installation: null,
                lastInstallation: {
                    operationId: "successful-operation",
                    status: "succeeded" as const,
                    startedAt: "2026-08-31T00:00:00.000Z",
                    completedAt: "2026-08-31T00:01:00.000Z",
                    message: null,
                },
            },
            null,
        ],
    ])("maps %j to an observable label", (extension, expected) => {
        expect(getExtensionInstallationProgress(extension)).toEqual(expected);
    });
});

describe("extension install request recovery", () => {
    const previous = {
        operationId: "previous-operation",
        status: "succeeded" as const,
        startedAt: "2026-08-31T00:00:00.000Z",
        completedAt: "2026-08-31T00:01:00.000Z",
        message: null,
    };

    it("keeps polling when the server still owns an active operation", () => {
        expect(
            getExtensionInstallRequestRecovery(previous.operationId, {
                installation: {
                    operationId: "active-operation",
                    phase: "preflighting",
                    startedAt: "2026-08-31T00:02:00.000Z",
                },
                lastInstallation: null,
            }),
        ).toEqual({ status: "running" });
    });

    it("recovers only a terminal result created after the request started", () => {
        expect(
            getExtensionInstallRequestRecovery(previous.operationId, {
                installation: null,
                lastInstallation: { ...previous, operationId: "successful-operation" },
            }),
        ).toEqual({ status: "succeeded" });
        expect(
            getExtensionInstallRequestRecovery(previous.operationId, {
                installation: null,
                lastInstallation: {
                    ...previous,
                    operationId: "failed-operation",
                    status: "failed",
                    message: "registry timeout",
                },
            }),
        ).toEqual({ status: "failed", message: "registry timeout" });
    });

    it("does not mistake stale or missing evidence for this request", () => {
        expect(
            getExtensionInstallRequestRecovery(previous.operationId, {
                installation: null,
                lastInstallation: previous,
            }),
        ).toEqual({ status: "unknown" });
        expect(getExtensionInstallRequestRecovery(previous.operationId, null)).toEqual({
            status: "unknown",
        });
    });
});

describe("extension runtime status", () => {
    it.each([
        [{ installed: false, enabled: false, loaded: false }, null],
        [
            { installed: true, enabled: false, loaded: false },
            { variant: "neutral", label: "已安装，未启用" },
        ],
        [
            { installed: true, enabled: true, loaded: false },
            { variant: "warning", label: "等待重启加载" },
        ],
        [
            { installed: true, enabled: true, loaded: true },
            { variant: "success", label: "已加载" },
        ],
        [
            { installed: false, enabled: true, loaded: false },
            { variant: "danger", label: "配置已启用，依赖缺失" },
        ],
        [
            { installed: false, enabled: true, loaded: true },
            { variant: "danger", label: "已加载，依赖缺失" },
        ],
        [
            { installed: true, enabled: false, loaded: true },
            { variant: "warning", label: "已加载，等待停用" },
        ],
        [
            { installed: false, enabled: false, loaded: true },
            { variant: "danger", label: "已加载，配置与依赖均缺失" },
        ],
    ] as const)("maps %j to an explicit state", (extension, expected) => {
        expect(getExtensionRuntimeStatus(extension)).toEqual(expected);
    });
});
