import { describe, expect, it } from "vitest";
import {
    getExtensionInstallCompletion,
    getExtensionInstallRequestRecovery,
    getExtensionInstallationAction,
    getExtensionInstallationProgress,
    getExtensionRuntimeStatus,
} from "./extension-installation.js";

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

const base = {
    catalogError: null,
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
