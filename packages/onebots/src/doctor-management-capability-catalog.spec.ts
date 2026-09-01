import { describe, expect, it, vi } from "vitest";
import packageMetadata from "../package.json" with { type: "json" };
import { buildAdapterCapabilityReport } from "./capability-report.js";
import {
    inspectCapabilityCatalogPayload,
    probeAuthenticatedCapabilityCatalog,
} from "./doctor-management-capability-catalog.js";
import { getInstallableAdapterNames } from "./extension-catalog-integrity.js";
import { DOCTOR_MANAGEMENT_BODY_LIMIT_BYTES } from "./doctor-management-response.js";

describe("doctor management capability catalog", () => {
    it("verifies the complete zero-account catalog and application identity", () => {
        const report = completeReport();

        expect(inspectCapabilityCatalogPayload(report)).toEqual({
            name: "management-capability-catalog",
            level: "ok",
            message: `全平台能力目录已验证: ${report.adapters.length} 个官方适配器，0 个运行时清单，身份 ${packageMetadata.name}@${packageMetadata.version}`,
        });
    });

    it("rejects a report from another application version", () => {
        const report = completeReport();
        report.application.version = "0.0.0";

        expect(inspectCapabilityCatalogPayload(report)).toMatchObject({
            level: "error",
            message: expect.stringContaining(
                `应用身份必须为 ${packageMetadata.name}@${packageMetadata.version}`,
            ),
        });
    });

    it("rejects missing official platforms and forged summaries", () => {
        const report = completeReport();
        const removed = report.adapters.shift();
        if (!removed) throw new Error("测试目录不能为空");
        report.adapters[0]!.summary!.actions.supported++;

        const check = inspectCapabilityCatalogPayload(report);

        expect(check.level).toBe("error");
        expect(check.message).toContain(`缺少官方适配器 ${removed.name}`);
        expect(check.message).toContain(`${report.adapters[0]!.name} 的 summary 与能力清单不一致`);
    });

    it("distinguishes structurally valid but incomplete evidence", () => {
        const report = completeReport();
        report.complete = false;
        report.errors = ["extension-catalog: 版本错配"];
        report.adapters[0]!.status = "unavailable";
        report.adapters[0]!.packageVersion = null;
        report.adapters[0]!.declared = false;
        report.adapters[0]!.summary = null;
        report.adapters[0]!.capabilities = null;

        expect(inspectCapabilityCatalogPayload(report)).toEqual({
            name: "management-capability-catalog",
            level: "error",
            message: `证据不完整: extension-catalog: 版本错配；${report.adapters[0]!.name}=unavailable`,
        });
    });

    it("uses authenticated bounded reads for the online endpoint", async () => {
        const fetcher = vi.fn(
            async () =>
                new Response("", {
                    status: 200,
                    headers: {
                        "content-length": String(DOCTOR_MANAGEMENT_BODY_LIMIT_BYTES + 1),
                    },
                }),
        );

        const check = await probeAuthenticatedCapabilityCatalog(
            "http://127.0.0.1:6727/gateway",
            "secret",
            fetcher,
        );

        expect(fetcher).toHaveBeenCalledWith(
            "http://127.0.0.1:6727/gateway/api/adapter-capabilities",
            expect.objectContaining({
                headers: { authorization: "Bearer secret" },
                signal: expect.any(AbortSignal),
            }),
        );
        expect(check).toMatchObject({
            name: "management-capability-catalog",
            level: "error",
            message: expect.stringContaining("响应正文超过 4 MiB 上限"),
        });
    });
});

function completeReport() {
    return {
        schemaVersion: 1 as const,
        generatedAt: "2026-09-01T00:00:00.000Z",
        application: { name: packageMetadata.name, version: packageMetadata.version },
        ...buildAdapterCapabilityReport([], [], getInstallableAdapterNames()),
    };
}
