import { describe, expect, it, vi } from "vitest";
import {
    inspectRuntimeExtensions,
    probeAuthenticatedExtensions,
} from "./doctor-management-extensions.js";

describe("doctor extension runtime evidence", () => {
    it("accepts enabled extensions only after disk and process versions converge", () => {
        expect(inspectRuntimeExtensions([extensionEvidence()])).toEqual({
            name: "management-extensions",
            level: "ok",
            message: "扩展运行证据已验证: 1 个已启用，1 个已加载，版本均已收敛",
        });
    });

    it("fails when disk installation has not replaced the version loaded by the process", () => {
        expect(
            inspectRuntimeExtensions([
                extensionEvidence({ installedVersion: "1.2.0", loadedVersion: "1.1.0" }),
            ]),
        ).toEqual({
            name: "management-extensions",
            level: "error",
            message:
                "扩展运行版本未收敛: adapter:mock 当前进程仍运行 1.1.0，磁盘已安装 1.2.0；请重启",
        });
    });

    it("rejects enabled extensions without a loaded plugin or complete version evidence", () => {
        expect(
            inspectRuntimeExtensions([
                extensionEvidence({ loaded: false, loadedVersion: null }),
                extensionEvidence({ id: "protocol:onebot-v11", loadedVersion: null }),
            ]),
        ).toEqual({
            name: "management-extensions",
            level: "error",
            message:
                "扩展运行版本未收敛: adapter:mock 已启用但当前进程未加载；protocol:onebot-v11 缺少安装或加载版本，无法证明运行版本一致",
        });
    });

    it("rejects contradictory extension evidence instead of inferring convergence", () => {
        expect(
            inspectRuntimeExtensions([
                extensionEvidence({ installed: false, installedVersion: "1.2.0" }),
            ]),
        ).toEqual({
            name: "management-extensions",
            level: "error",
            message: expect.stringContaining(
                "扩展运行证据契约无效: adapter:mock 的 installed 与 installedVersion 相互矛盾",
            ),
        });
    });

    it("reports a shared catalog failure once across all extension entries", () => {
        const catalogError = "扩展目录完整性校验失败：协议版本目录缺失";
        expect(
            inspectRuntimeExtensions([
                extensionEvidence({ id: "adapter:mock", catalogError }),
                extensionEvidence({ id: "protocol:onebot-v11", catalogError }),
            ]),
        ).toEqual({
            name: "management-extensions",
            level: "error",
            message: `扩展运行版本未收敛: ${catalogError}`,
        });
    });

    it("uses the authenticated endpoint and rejects a malformed response", async () => {
        const fetcher = vi.fn(async () => new Response("{}", { status: 200 }));
        await expect(
            probeAuthenticatedExtensions("http://127.0.0.1:6727/gateway", "secret", fetcher),
        ).resolves.toEqual({
            name: "management-extensions",
            level: "error",
            message: "扩展运行证据响应无效: HTTP 200",
        });
        expect(fetcher).toHaveBeenCalledWith(
            "http://127.0.0.1:6727/gateway/api/extensions",
            expect.objectContaining({ headers: { authorization: "Bearer secret" } }),
        );
    });
});

function extensionEvidence(overrides: Record<string, unknown> = {}) {
    return {
        id: "adapter:mock",
        installed: true,
        installedVersion: "1.2.0",
        targetVersion: "1.2.0",
        versionAligned: true,
        enabled: true,
        loaded: true,
        loadedVersion: "1.2.0",
        installing: false,
        catalogError: null,
        runtimeConfigError: null,
        installedError: null,
        configurationError: null,
        ...overrides,
    };
}
