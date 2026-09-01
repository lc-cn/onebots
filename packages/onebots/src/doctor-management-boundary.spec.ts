import { describe, expect, it, vi } from "vitest";
import packageMetadata from "../package.json" with { type: "json" };
import { probeDoctorManagementAfterIdentity } from "./doctor-management-boundary.js";
import type { DoctorCheck } from "./doctor-endpoint.js";

const currentIdentity = {
    application: packageMetadata.name,
    version: packageMetadata.version,
    instanceId: "instance-a",
};

function check(overrides: Partial<DoctorCheck> = {}): DoctorCheck {
    return {
        name: "probe",
        level: "ok",
        message: "ok",
        identity: currentIdentity,
        ...overrides,
    };
}

describe("doctor management credential boundary", () => {
    it.each([
        {
            label: "health 语义失败",
            health: check({ level: "error" }),
            identity: check(),
            runtimeContract: undefined,
            reason: "health 未证明当前 OneBots CLI 的健康运行实例",
        },
        {
            label: "实例证据冲突",
            health: check(),
            identity: check({ level: "error", identity: undefined }),
            runtimeContract: undefined,
            reason: "health 与 ready 未证明来自同一运行实例",
        },
        {
            label: "应用身份错误",
            health: check(),
            identity: check({ identity: { ...currentIdentity, application: "other-app" } }),
            runtimeContract: undefined,
            reason: "在线应用不是 onebots",
        },
        {
            label: "在线版本不一致",
            health: check(),
            identity: check({ identity: { ...currentIdentity, version: "0.0.1" } }),
            runtimeContract: undefined,
            reason: "在线 OneBots 0.0.1 与当前 CLI",
        },
        {
            label: "受管启动契约不一致",
            health: check(),
            identity: check(),
            runtimeContract: check({ level: "error" }),
            reason: "在线实例未证明采用当前受管服务启动契约",
        },
    ])("$label 时不调用带凭据探针", async ({ health, identity, runtimeContract, reason }) => {
        const probe = vi.fn(async () => [check({ name: "authenticated" })]);

        await expect(
            probeDoctorManagementAfterIdentity({
                health,
                identity,
                ...(runtimeContract ? { runtimeContract } : {}),
                probe,
            }),
        ).resolves.toEqual([
            {
                name: "management-identity",
                level: "error",
                message: expect.stringContaining(reason),
            },
        ]);
        expect(probe).not.toHaveBeenCalled();
    });

    it("公开身份与受管启动契约完整时才执行管理探针", async () => {
        const authenticated = check({ name: "management-http-authenticated" });
        const probe = vi.fn(async () => [authenticated]);

        await expect(
            probeDoctorManagementAfterIdentity({
                health: check(),
                identity: check(),
                runtimeContract: check(),
                probe,
            }),
        ).resolves.toEqual([
            {
                name: "management-identity",
                level: "ok",
                message: "公开探针已证明当前 OneBots 实例，允许执行带凭据的管理诊断",
                identity: currentIdentity,
            },
            authenticated,
        ]);
        expect(probe).toHaveBeenCalledOnce();
    });

    it("独立运行实例无需受管契约也可诊断 readiness 故障", async () => {
        const authenticated = check({ name: "management-runtime" });
        const probe = vi.fn(async () => [authenticated]);

        await expect(
            probeDoctorManagementAfterIdentity({
                health: check(),
                identity: check({ message: "ready 为 503，但成对身份一致" }),
                probe,
            }),
        ).resolves.toEqual([
            expect.objectContaining({ name: "management-identity", level: "ok" }),
            authenticated,
        ]);
        expect(probe).toHaveBeenCalledOnce();
    });
});
