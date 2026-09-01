import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { acquirePackageMutationLock } from "./package-mutation-lock.js";

const directories: string[] = [];

afterEach(() => {
    for (const directory of directories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function fixture(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-package-lock-"));
    directories.push(root);
    return root;
}

describe("package mutation lock", () => {
    it("拒绝共享运行目录中的第二个活跃安装并公开所有者证据", () => {
        const root = fixture();
        const first = acquirePackageMutationLock(root, {
            token: "first-token",
            operationId: "operation-1",
            extensionId: "adapter:slack",
        });

        expect(() =>
            acquirePackageMutationLock(root, {
                token: "second-token",
                operationId: "operation-2",
                extensionId: "protocol:mcp-v1",
            }),
        ).toThrow(/adapter:slack.*进程.*安装事务.*operation-1.*请等待完成后重试/);

        first.release();
        expect(fs.existsSync(path.join(root, ".onebots-package-mutation.lock"))).toBe(false);
    });

    it("自动回收已退出进程留下的租约", () => {
        const root = fixture();
        acquirePackageMutationLock(
            root,
            {
                token: "abandoned-token",
                operationId: "operation-1",
                extensionId: "adapter:slack",
            },
            { isProcessAlive: () => true },
        );

        const replacement = acquirePackageMutationLock(
            root,
            {
                token: "replacement-token",
                operationId: "operation-2",
                extensionId: "protocol:mcp-v1",
            },
            { isProcessAlive: () => false },
        );
        replacement.release();
    });

    it("不同主机无法用本地 PID 探测提前回收新鲜租约", () => {
        const root = fixture();
        acquirePackageMutationLock(
            root,
            {
                token: "remote-token",
                operationId: "operation-1",
                extensionId: "adapter:slack",
            },
            { hostname: () => "host-a" },
        );

        expect(() =>
            acquirePackageMutationLock(
                root,
                {
                    token: "local-token",
                    operationId: "operation-2",
                    extensionId: "protocol:mcp-v1",
                },
                { hostname: () => "host-b", isProcessAlive: () => false },
            ),
        ).toThrow(/host-a.*进程.*请等待完成后重试/);
    });

    it("超过完整事务上限后不被复用的进程号永久阻塞", () => {
        const root = fixture();
        acquirePackageMutationLock(
            root,
            {
                token: "old-token",
                operationId: "operation-1",
                extensionId: "adapter:slack",
            },
            { now: () => new Date("2026-09-01T00:00:00.000Z") },
        );

        const replacement = acquirePackageMutationLock(
            root,
            {
                token: "replacement-token",
                operationId: "operation-2",
                extensionId: "protocol:mcp-v1",
            },
            {
                now: () => new Date("2026-09-01T00:31:00.000Z"),
                isProcessAlive: () => true,
            },
        );
        replacement.release();
    });

    it("过期释放不能删除后来操作的租约", () => {
        const root = fixture();
        const first = acquirePackageMutationLock(root, {
            token: "first-token",
            operationId: "operation-1",
            extensionId: "adapter:slack",
        });
        const lockPath = path.join(root, ".onebots-package-mutation.lock");
        const movedPath = `${lockPath}.old`;
        fs.renameSync(lockPath, movedPath);
        const second = acquirePackageMutationLock(root, {
            token: "second-token",
            operationId: "operation-2",
            extensionId: "protocol:mcp-v1",
        });

        expect(() => first.release()).toThrow(/租约所有权已丢失/);
        expect(fs.existsSync(lockPath)).toBe(true);
        second.release();
        fs.rmSync(movedPath, { recursive: true, force: true });
    });
});
