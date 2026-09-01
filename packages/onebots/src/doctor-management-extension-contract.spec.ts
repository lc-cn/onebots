import { describe, expect, it } from "vitest";
import { summarizeManifest } from "./capability-report.js";
import { validateManagementExtensionInventory } from "./doctor-management-extension-contract.js";
import {
    getExtensionCapabilityCatalogEntry,
    getExtensionPackageCatalogEntry,
} from "./extension-capability-catalog.js";
import { TRUSTED_EXTENSION_CATALOG } from "./trusted-extension-catalog.js";

describe("doctor management extension inventory contract", () => {
    it("接受当前 OneBots 的完整官方扩展目录", () => {
        expect(validateManagementExtensionInventory(managementInventoryEvidence())).toEqual([]);
    });

    it("拒绝缺项、未知项与静态安装身份漂移", () => {
        const missing = managementInventoryEvidence().slice(1);
        expect(validateManagementExtensionInventory(missing)).toContain(
            `扩展目录缺少官方项: ${TRUSTED_EXTENSION_CATALOG[0]!.id}`,
        );

        const unknown = managementInventoryEvidence();
        unknown.push({ ...unknown[0], id: "adapter:forged" });
        expect(validateManagementExtensionInventory(unknown)).toContain(
            "扩展目录包含未知项: adapter:forged",
        );

        const drifted = managementInventoryEvidence();
        drifted[0] = { ...drifted[0], packageName: "forged-package" };
        expect(validateManagementExtensionInventory(drifted)).toEqual(
            expect.arrayContaining([expect.stringContaining("目录身份、配置目标或引导步骤")]),
        );
    });

    it("拒绝目标版本、能力摘要与目录能力快照漂移", () => {
        const targetDrift = managementInventoryEvidence();
        targetDrift[0] = { ...targetDrift[0], targetVersion: "99.0.0" };
        expect(validateManagementExtensionInventory(targetDrift)).toEqual(
            expect.arrayContaining([expect.stringContaining("目标版本无效")]),
        );

        const summaryDrift = managementInventoryEvidence();
        const capability = structuredClone(summaryDrift[0]!.capability) as Record<string, unknown>;
        const summary = capability.summary as Record<string, Record<string, number>>;
        summary.actions!.supported += 1;
        summaryDrift[0] = { ...summaryDrift[0], capability };
        expect(validateManagementExtensionInventory(summaryDrift)).toEqual(
            expect.arrayContaining([expect.stringContaining("能力摘要与清单不一致")]),
        );

        const manifestDrift = managementInventoryEvidence();
        const driftedCapability = structuredClone(manifestDrift[0]!.capability) as Record<
            string,
            unknown
        >;
        const manifest = driftedCapability.manifest as Record<string, Record<string, unknown>>;
        manifest.actions!.invented = { support: "native" };
        driftedCapability.summary = summarizeManifest(manifest as never);
        manifestDrift[0] = { ...manifestDrift[0], capability: driftedCapability };
        expect(validateManagementExtensionInventory(manifestDrift)).toEqual(
            expect.arrayContaining([expect.stringContaining("目录能力快照与当前 OneBots 不一致")]),
        );
    });

    it("拒绝安装标志、活动操作、终态和私有 token 的矛盾证据", () => {
        const inventory = managementInventoryEvidence();
        inventory[0] = {
            ...inventory[0],
            installing: false,
            installation: {
                operationId: "operation-1",
                phase: "preflighting",
                startedAt: "2026-09-02T00:00:00.000Z",
                token: "private",
            },
            lastInstallation: {
                operationId: "operation-0",
                status: "succeeded",
                startedAt: "2026-09-01T00:00:00.000Z",
                completedAt: "2026-09-01T00:00:01.000Z",
                message: "不应存在",
            },
        };

        expect(validateManagementExtensionInventory(inventory)).toEqual(
            expect.arrayContaining([
                expect.stringContaining("installing 与活动安装证据矛盾"),
                expect.stringContaining("活动安装证据无效"),
                expect.stringContaining("安装终态证据无效"),
                expect.stringContaining("同时携带活动安装与历史终态"),
            ]),
        );
    });
});

function managementInventoryEvidence(): Array<Record<string, unknown>> {
    return TRUSTED_EXTENSION_CATALOG.map(entry => {
        const packageEntry = getExtensionPackageCatalogEntry(entry.packageName);
        if (!packageEntry) throw new Error(`测试目录缺少 ${entry.packageName}`);
        const capability =
            entry.type === "adapter" ? getExtensionCapabilityCatalogEntry(entry.name) : undefined;
        if (entry.type === "adapter" && !capability) {
            throw new Error(`测试目录缺少 ${entry.name} 能力`);
        }
        return {
            ...structuredClone(entry),
            catalogError: null,
            runtimeError: null,
            packageManagerError: null,
            runtimeConfigError: null,
            configurationError: null,
            targetVersion: packageEntry.packageVersion,
            installedVersion: null,
            installedError: null,
            versionAligned: false,
            installed: false,
            enabled: false,
            loaded: false,
            loadedVersion: null,
            restartSupported: true,
            installing: false,
            installation: null,
            lastInstallation: null,
            capability: capability
                ? {
                      source: "catalog",
                      status: "verified",
                      packageVersion: capability.packageVersion,
                      declared: true,
                      summary: summarizeManifest(capability.manifest),
                      manifest: capability.manifest,
                  }
                : null,
        };
    });
}
