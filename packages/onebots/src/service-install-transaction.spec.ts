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
