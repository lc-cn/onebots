import { describe, expect, it } from "vitest";
import type { AdapterCapabilityManifest } from "@onebots/core";
import {
    assertExtensionInstallAcknowledgement,
    buildExtensionInstallRequestHeaders,
    parseExtensionInventory,
    parseExtensionManagementSnapshot,
    parsePackageMutationStatus,
} from "./extension-inventory.js";
import {
    parseManagementEvidenceIdentity,
    sameManagementEvidenceIdentity,
} from "../management-evidence-identity.js";

const manifest: AdapterCapabilityManifest = {
    version: 1,
    actions: { send_message: { support: "native" } },
    events: {},
    segments: {},
    transports: {},
};

const summary = {
    actions: { total: 1, supported: 1, native: 1, emulated: 0, unsupported: 0 },
    events: { total: 0, supported: 0, native: 0, emulated: 0, unsupported: 0 },
    segments: { total: 0, supported: 0, native: 0, emulated: 0, unsupported: 0 },
    transports: { total: 0, supported: 0, native: 0, emulated: 0, unsupported: 0 },
};

function adapter(overrides: Record<string, unknown> = {}) {
    return {
        id: "adapter:mock",
        type: "adapter",
        name: "mock",
        displayName: "Mock",
        description: "Mock adapter",
        packageName: "@onebots/adapter-mock",
        configurationTarget: { kind: "account", platform: "mock" },
        configurationError: null,
        catalogError: null,
        runtimeError: null,
        packageManagerError: null,
        runtimeConfigError: null,
        targetVersion: "1.2.3",
        installedVersion: null,
        installedError: null,
        versionAligned: false,
        setup: [{ title: "配置", description: "填写账号", url: "https://example.com" }],
        installed: false,
        enabled: false,
        loaded: false,
        loadedVersion: null,
        restartSupported: true,
        installing: false,
        installation: null,
        lastInstallation: null,
        capability: {
            source: "catalog",
            status: "verified",
            packageVersion: "1.2.3",
            declared: true,
            summary,
            manifest,
        },
        ...overrides,
    };
}

function protocol(overrides: Record<string, unknown> = {}) {
    return {
        ...adapter(),
        id: "protocol:onebot-v11",
        type: "protocol",
        name: "onebot-v11",
        packageName: "@onebots/protocol-onebot-v11",
        configurationTarget: { kind: "protocol", protocolKey: "onebot_v11" },
        capability: null,
        ...overrides,
    };
}

function managementResponse(
    instanceId = "instance-a",
    extraHeaders: Record<string, string> = {},
): Response {
    return new Response(null, {
        headers: {
            "X-OneBots-Application": "onebots",
            "X-OneBots-Version": "1.2.8",
            "X-OneBots-Instance-Id": instanceId,
            "X-OneBots-Runtime-Contract-Id": "sha256:contract-a",
            ...extraHeaders,
        },
    });
}

describe("extension inventory response", () => {
    it("要求响应携带完整实例身份并精确比较运行契约", () => {
        const identity = parseManagementEvidenceIdentity(
            new Response(null, {
                headers: {
                    "X-OneBots-Application": "onebots",
                    "X-OneBots-Version": "1.2.8",
                    "X-OneBots-Instance-Id": "instance-a",
                    "X-OneBots-Runtime-Contract-Id": "sha256:contract-a",
                },
            }),
        );
        expect(identity).toEqual({
            application: "onebots",
            version: "1.2.8",
            instanceId: "instance-a",
            runtimeContractId: "sha256:contract-a",
        });
        expect(sameManagementEvidenceIdentity(identity, identity)).toBe(true);
        expect(
            sameManagementEvidenceIdentity(identity, {
                ...identity,
                runtimeContractId: "sha256:contract-b",
            }),
        ).toBe(false);
        expect(() => parseManagementEvidenceIdentity(new Response())).toThrow("缺少完整");
    });

    it("接受状态闭合的适配器和协议目录", () => {
        const value = [
            adapter(),
            adapter({
                id: "adapter:runtime",
                name: "runtime",
                configurationTarget: { kind: "account", platform: "runtime" },
                installed: true,
                installedVersion: "1.2.3",
                versionAligned: true,
                enabled: true,
                loaded: true,
                loadedVersion: "1.2.3",
                capability: {
                    source: "runtime",
                    status: "unknown",
                    packageVersion: null,
                    declared: true,
                    summary,
                    manifest,
                },
            }),
            adapter({
                id: "adapter:unavailable",
                name: "unavailable",
                configurationTarget: { kind: "account", platform: "unavailable" },
                catalogError: "目录校验失败",
                capability: {
                    source: "catalog",
                    status: "unavailable",
                    packageVersion: null,
                    declared: false,
                    summary: null,
                    manifest: null,
                },
            }),
            protocol(),
        ];
        expect(parseExtensionInventory(value)).toEqual(value);
    });

    it("原子采用同实例且带配置修订的扩展管理快照", () => {
        const revision = `sha256:${"a".repeat(64)}`;
        const inventoryResponse = managementResponse("instance-a", {
            "X-OneBots-Config-Revision": revision,
        });
        const mutationResponse = managementResponse();
        const idle = { state: "idle", available: true, owner: null, error: null };

        expect(
            parseExtensionManagementSnapshot(
                inventoryResponse,
                mutationResponse,
                [adapter()],
                idle,
            ),
        ).toMatchObject({
            identity: { application: "onebots", instanceId: "instance-a" },
            configRevision: revision,
            extensions: [{ id: "adapter:mock" }],
            packageMutationStatus: idle,
        });
        expect(() =>
            parseExtensionManagementSnapshot(
                inventoryResponse,
                managementResponse("instance-b"),
                [adapter()],
                idle,
            ),
        ).toThrow("来自不同 OneBots 实例");
        expect(() =>
            parseExtensionManagementSnapshot(
                managementResponse(),
                mutationResponse,
                [adapter()],
                idle,
            ),
        ).toThrow("缺少有效配置修订号");
    });

    it("只接受同一实例签发且包含新配置修订的安装回执", () => {
        const identity = {
            application: "onebots",
            version: "1.2.8",
            instanceId: "instance-a",
            runtimeContractId: "sha256:contract-a",
        };
        const revision = `sha256:${"b".repeat(64)}`;
        expect(
            assertExtensionInstallAcknowledgement(
                managementResponse(),
                {
                    success: true,
                    application: "onebots",
                    instance_id: "instance-a",
                    config_revision: revision,
                },
                identity,
            ),
        ).toBe(revision);
        expect(() =>
            assertExtensionInstallAcknowledgement(
                managementResponse("instance-b"),
                {
                    success: true,
                    application: "onebots",
                    instance_id: "instance-b",
                    config_revision: revision,
                },
                identity,
            ),
        ).toThrow("安装回执实例不匹配");
        expect(() =>
            assertExtensionInstallAcknowledgement(
                managementResponse(),
                { success: true, application: "onebots", instance_id: "instance-a" },
                identity,
            ),
        ).toThrow("缺少有效配置修订号");
    });

    it("把安装请求绑定到目录实例和配置修订", () => {
        const revision = `sha256:${"c".repeat(64)}`;
        expect(
            buildExtensionInstallRequestHeaders(
                { application: "onebots", version: "1.2.8", instanceId: "instance-a" },
                revision,
            ),
        ).toEqual({
            "X-OneBots-Expected-Instance-Id": "instance-a",
            "X-OneBots-Expected-Config-Revision": revision,
        });
        expect(() =>
            buildExtensionInstallRequestHeaders(
                { application: "onebots", version: "1.2.8", instanceId: "instance-a" },
                "stale",
            ),
        ).toThrow("缺少有效配置修订号");
    });

    it.each([
        ["重复 id", [adapter(), adapter()], "重复 id"],
        ["安装版本矛盾", [adapter({ installed: true })], "installed 与 installedVersion 矛盾"],
        ["加载版本矛盾", [adapter({ loadedVersion: "1.2.3" })], "未加载却声明 loadedVersion"],
        [
            "能力来源矛盾",
            [
                adapter({
                    capability: {
                        source: "runtime",
                        status: "verified",
                        packageVersion: "1.2.3",
                        declared: true,
                        summary,
                        manifest,
                    },
                }),
            ],
            "能力来源与加载状态矛盾",
        ],
        [
            "伪造能力摘要",
            [
                adapter({
                    capability: {
                        source: "catalog",
                        status: "verified",
                        packageVersion: "1.2.3",
                        declared: true,
                        summary: { ...summary, actions: { ...summary.actions, supported: 0 } },
                        manifest,
                    },
                }),
            ],
            "能力摘要与清单不一致",
        ],
        [
            "不安全引导链接",
            [
                adapter({
                    setup: [{ title: "打开", description: "继续", url: "javascript:alert(1)" }],
                }),
            ],
            "结构无效",
        ],
        [
            "活动与终态并存",
            [
                adapter({
                    installing: true,
                    installation: {
                        operationId: "operation-1",
                        phase: "preflighting",
                        startedAt: "2026-09-02T00:00:00.000Z",
                    },
                    lastInstallation: {
                        operationId: "operation-0",
                        status: "failed",
                        startedAt: "2026-09-01T00:00:00.000Z",
                        completedAt: "2026-09-01T00:00:01.000Z",
                        message: "失败",
                    },
                }),
            ],
            "同时携带活动操作与终态",
        ],
    ])("拒绝%s", (_name, value, message) => {
        expect(() => parseExtensionInventory(value)).toThrow(message);
    });
});

describe("package mutation response", () => {
    it("接受空闲状态和活动租约", () => {
        const idle = { state: "idle", available: true, owner: null, error: null };
        const active = {
            state: "active",
            available: false,
            owner: {
                operationId: "operation-1",
                operation: "extension_install",
                extensionId: "adapter:mock",
                host: "gateway",
                pid: 42,
                startedAt: "2026-09-02T00:00:00.000Z",
            },
            error: null,
        };
        expect(parsePackageMutationStatus(idle)).toEqual(idle);
        expect(parsePackageMutationStatus(active)).toEqual(active);
        expect(
            parsePackageMutationStatus({
                ...active,
                owner: {
                    ...active.owner,
                    operation: "extension_disable",
                },
            }),
        ).toMatchObject({ owner: { operation: "extension_disable", extensionId: "adapter:mock" } });
    });

    it("拒绝开放安装的活动租约、泄露 token 的所有者与无原因的无效状态", () => {
        expect(() =>
            parsePackageMutationStatus({
                state: "active",
                available: true,
                owner: {
                    operationId: "operation-1",
                    operation: "package_update",
                    extensionId: null,
                    host: "gateway",
                    pid: 42,
                    startedAt: "2026-09-02T00:00:00.000Z",
                },
                error: null,
            }),
        ).toThrow("结论与租约证据矛盾");
        expect(() =>
            parsePackageMutationStatus({
                state: "active",
                available: false,
                owner: {
                    operationId: "operation-1",
                    operation: "package_update",
                    extensionId: null,
                    host: "gateway",
                    pid: 42,
                    startedAt: "2026-09-02T00:00:00.000Z",
                    token: "private",
                },
                error: null,
            }),
        ).toThrow("所有者结构无效");
        expect(() =>
            parsePackageMutationStatus({
                state: "invalid",
                available: false,
                owner: null,
                error: null,
            }),
        ).toThrow("结论与租约证据矛盾");
    });
});
