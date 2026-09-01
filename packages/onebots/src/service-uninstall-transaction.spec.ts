import { describe, expect, it, vi } from "vitest";
import { runServiceUninstallTransaction } from "./service-uninstall-transaction.js";

describe("service uninstall transaction", () => {
    it("元数据提交失败时恢复并复验平台定义", async () => {
        const remove = vi.fn(async () => undefined);
        const restore = vi.fn(async () => undefined);
        const commitError = new Error("service.json unlink failed");

        await expect(
            runServiceUninstallTransaction({
                remove,
                restore,
                verifyRestored: () => true,
                commit: () => {
                    throw commitError;
                },
                definitionPath: "/service/definition",
            }),
        ).rejects.toMatchObject({
            message: expect.stringContaining("已恢复平台定义并保留私有元数据"),
            cause: commitError,
        });

        expect(remove).toHaveBeenCalledOnce();
        expect(restore).toHaveBeenCalledOnce();
    });

    it("删除与恢复同时失败时保留双方证据", async () => {
        const removeError = new Error("task delete failed");
        const restoreError = new Error("task restore failed");

        let error: unknown;
        try {
            await runServiceUninstallTransaction({
                remove: async () => {
                    throw removeError;
                },
                restore: async () => {
                    throw restoreError;
                },
                verifyRestored: () => false,
                commit: vi.fn(),
                definitionPath: "/service/definition",
            });
        } catch (caught) {
            error = caught;
        }

        expect(error).toBeInstanceOf(AggregateError);
        expect((error as AggregateError).errors).toEqual([removeError, restoreError]);
        expect((error as Error).message).toContain("无法恢复平台定义");
    });
});
