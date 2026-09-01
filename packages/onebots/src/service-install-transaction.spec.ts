import { describe, expect, it, vi } from "vitest";
import type { ServiceSpec } from "./service-definition.js";
import { runServiceInstallTransaction } from "./service-install-transaction.js";

const target: ServiceSpec = {
    scope: "user",
    configPath: "/srv/onebots/candidate.yaml",
    adapters: ["mock"],
    protocols: ["onebot-v11"],
    nodePath: "/usr/bin/node",
    binPath: "/srv/onebots/bin.js",
    workingDirectory: "/srv/onebots",
};
const previous: ServiceSpec = { ...target, configPath: "/srv/onebots/previous.yaml" };

describe("service install transaction", () => {
    it("定义复验失败时清理首次安装且不提交元数据", async () => {
        const apply = vi.fn(async () => undefined);
        const remove = vi.fn(async () => undefined);
        const commit = vi.fn();

        await expect(
            runServiceInstallTransaction({
                target,
                previous: null,
                apply,
                remove,
                verify: () => false,
                commit,
                definitionPath: () => "/service/definition",
            }),
        ).rejects.toThrow("服务定义安装后验证失败: /service/definition");

        expect(remove).toHaveBeenCalledWith(target);
        expect(commit).not.toHaveBeenCalled();
    });

    it("提交前配置复验失败时恢复上一份服务定义且不提交元数据", async () => {
        const validationError = new Error("candidate config changed");
        const apply = vi.fn(async () => undefined);
        const commit = vi.fn();

        await expect(
            runServiceInstallTransaction({
                target,
                previous,
                apply,
                remove: vi.fn(async () => undefined),
                verify: () => true,
                validateBeforeCommit: () => {
                    throw validationError;
                },
                commit,
                definitionPath: () => "/service/definition",
            }),
        ).rejects.toBe(validationError);

        expect(apply).toHaveBeenNthCalledWith(1, target, previous);
        expect(apply).toHaveBeenNthCalledWith(2, previous, target);
        expect(commit).not.toHaveBeenCalled();
    });

    it("首次安装提交前配置复验失败时移除候选定义", async () => {
        const validationError = new Error("candidate config changed");
        const remove = vi.fn(async () => undefined);

        await expect(
            runServiceInstallTransaction({
                target,
                previous: null,
                apply: vi.fn(async () => undefined),
                remove,
                verify: () => true,
                validateBeforeCommit: () => {
                    throw validationError;
                },
                commit: vi.fn(),
                definitionPath: () => "/service/definition",
            }),
        ).rejects.toBe(validationError);

        expect(remove).toHaveBeenCalledWith(target);
    });

    it("回滚也失败时同时保留安装与恢复错误", async () => {
        const installError = new Error("candidate install failed");
        const rollbackError = new Error("previous restore failed");
        const apply = vi
            .fn()
            .mockRejectedValueOnce(installError)
            .mockRejectedValueOnce(rollbackError);

        let error: unknown;
        try {
            await runServiceInstallTransaction({
                target,
                previous,
                apply,
                remove: vi.fn(async () => undefined),
                verify: () => true,
                commit: vi.fn(),
                definitionPath: () => "/service/definition",
            });
        } catch (caught) {
            error = caught;
        }

        expect(error).toBeInstanceOf(AggregateError);
        expect((error as AggregateError).errors).toEqual([installError, rollbackError]);
        expect((error as Error).message).toContain("无法恢复上一份定义");
        expect(apply).toHaveBeenNthCalledWith(2, previous, target);
    });
});
