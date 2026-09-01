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
        const confirm = vi.fn(async () => check());

        await expect(
            probeDoctorManagementAfterIdentity({
                health,
                identity,
                ...(runtimeContract ? { runtimeContract } : {}),
                probe,
                confirm,
            }),
        ).resolves.toEqual([
            {
                name: "management-identity",
                level: "error",
                message: expect.stringContaining(reason),
            },
        ]);
        expect(probe).not.toHaveBeenCalled();
        expect(confirm).not.toHaveBeenCalled();
    });

    it("公开身份与受管启动契约完整时才执行管理探针", async () => {
        const authenticated = check({ name: "management-http-authenticated" });
        const probe = vi.fn(async () => [authenticated]);
        const confirm = vi.fn(async () => check({ name: "health-confirmation" }));

        await expect(
            probeDoctorManagementAfterIdentity({
                health: check(),
                identity: check(),
                runtimeContract: check(),
                probe,
                confirm,
            }),
        ).resolves.toEqual([
            {
                name: "management-identity",
                level: "ok",
                message: "公开探针已证明当前 OneBots 实例，允许执行带凭据的管理诊断",
                identity: currentIdentity,
            },
            authenticated,
            {
                name: "management-instance",
                level: "ok",
                message:
                    "管理诊断前后均由 onebots@" +
                    packageMetadata.version +
                    " 实例 instance-a 响应，管理证据属于同一运行实例",
                identity: currentIdentity,
            },
        ]);
        expect(probe).toHaveBeenCalledOnce();
        expect(confirm).toHaveBeenCalledOnce();
    });

    it("独立运行实例无需受管契约也可诊断 readiness 故障", async () => {
        const authenticated = check({ name: "management-runtime" });
        const probe = vi.fn(async () => [authenticated]);
        const confirm = vi.fn(async () => check({ name: "health-confirmation" }));

        await expect(
            probeDoctorManagementAfterIdentity({
                health: check(),
                identity: check({ message: "ready 为 503，但成对身份一致" }),
                probe,
                confirm,
            }),
        ).resolves.toEqual([
            expect.objectContaining({ name: "management-identity", level: "ok" }),
            authenticated,
            expect.objectContaining({ name: "management-instance", level: "ok" }),
        ]);
        expect(probe).toHaveBeenCalledOnce();
        expect(confirm).toHaveBeenCalledOnce();
    });

    it("管理诊断期间实例切换时拒绝跨实例证据", async () => {
        const probe = vi.fn(async () => [check({ name: "management-runtime" })]);

        await expect(
            probeDoctorManagementAfterIdentity({
                health: check(),
                identity: check(),
                probe,
                confirm: vi.fn(async () =>
                    check({
                        name: "health-confirmation",
                        identity: { ...currentIdentity, instanceId: "instance-b" },
                    }),
                ),
            }),
        ).resolves.toEqual([
            expect.objectContaining({ name: "management-identity", level: "ok" }),
            expect.objectContaining({ name: "management-runtime" }),
            {
                name: "management-instance",
                level: "error",
                message: expect.stringContaining(
                    "开始为 onebots@" +
                        packageMetadata.version +
                        " 实例 instance-a，结束为 onebots@" +
                        packageMetadata.version +
                        " 实例 instance-b",
                ),
            },
        ]);
    });

    it("最终健康证据的受管启动契约变化时拒绝管理证据", async () => {
        const managedIdentity = {
            ...currentIdentity,
            runtimeContractId: "sha256:contract-a",
        };

        const checks = await probeDoctorManagementAfterIdentity({
            health: check({ identity: managedIdentity }),
            identity: check({ identity: managedIdentity }),
            runtimeContract: check({ identity: managedIdentity }),
            probe: vi.fn(async () => [check({ name: "management-runtime" })]),
            confirm: vi.fn(async () =>
                check({
                    name: "health-confirmation",
                    identity: { ...managedIdentity, runtimeContractId: "sha256:contract-b" },
                }),
            ),
        });

        expect(checks.at(-1)).toEqual({
            name: "management-instance",
            level: "error",
            message: expect.stringContaining(
                "契约 sha256:contract-a，结束为 onebots@" +
                    packageMetadata.version +
                    " 实例 instance-a 契约 sha256:contract-b",
            ),
        });
    });

    it("管理诊断后的健康探针失败时不接受管理证据", async () => {
        await expect(
            probeDoctorManagementAfterIdentity({
                health: check(),
                identity: check(),
                probe: vi.fn(async () => [check({ name: "management-runtime" })]),
                confirm: vi.fn(async () =>
                    check({
                        name: "health-confirmation",
                        level: "error",
                        message: "health 不可达: fetch failed",
                        identity: undefined,
                    }),
                ),
            }),
        ).resolves.toEqual([
            expect.objectContaining({ name: "management-identity", level: "ok" }),
            expect.objectContaining({ name: "management-runtime" }),
            {
                name: "management-instance",
                level: "error",
                message: "管理诊断完成后无法重新证明原实例仍持有端口：health 不可达: fetch failed",
            },
        ]);
    });
});
