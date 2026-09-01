import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    acquirePackageMutationLock,
    inspectPackageMutationLock,
} from "./package-mutation-lock.js";

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
    it("公开空闲状态且不创建租约", () => {
        const root = fixture();

        expect(inspectPackageMutationLock(root)).toEqual({
            state: "idle",
            available: true,
            owner: null,
            error: null,
        });
        expect(fs.existsSync(path.join(root, ".onebots-package-mutation.lock"))).toBe(false);
    });

    it("公开活跃更新的运维证据但不泄露所有权 token", () => {
        const root = fixture();
        const lock = acquirePackageMutationLock(root, {
            token: "private-token",
            operationId: "update-operation",
            operation: "package_update",
        });

        expect(inspectPackageMutationLock(root)).toEqual({
            state: "active",
            available: false,
            owner: {
                operationId: "update-operation",
                operation: "package_update",
                extensionId: null,
                host: expect.any(String),
                pid: process.pid,
                startedAt: expect.any(String),
            },
            error: null,
        });
        expect(JSON.stringify(inspectPackageMutationLock(root))).not.toContain("private-token");
        lock.release();
    });

    it("把同机已退出进程的租约标为可回收但不在读取时修改目录", () => {
        const root = fixture();
        acquirePackageMutationLock(root, {
            token: "abandoned-token",
            operationId: "operation-1",
            operation: "extension_install",
            extensionId: "adapter:slack",
        });

        expect(inspectPackageMutationLock(root, { isProcessAlive: () => false })).toMatchObject({
            state: "recoverable",
            available: true,
            owner: { operationId: "operation-1", extensionId: "adapter:slack" },
            error: null,
        });
        expect(fs.existsSync(path.join(root, ".onebots-package-mutation.lock"))).toBe(true);
    });

    it("把保护期内损坏的租约标为不可用", () => {
        const root = fixture();
        const lockPath = path.join(root, ".onebots-package-mutation.lock");
        fs.mkdirSync(lockPath);

        expect(inspectPackageMutationLock(root)).toEqual({
            state: "invalid",
            available: false,
            owner: null,
            error: "owner.json 缺失",
        });
    });

    it("不会把租约文件中的终端控制字符公开为所有者证据", () => {
        const root = fixture();
        const lockPath = path.join(root, ".onebots-package-mutation.lock");
        fs.mkdirSync(lockPath);
        fs.writeFileSync(
            path.join(lockPath, "owner.json"),
            JSON.stringify({
                token: "private-token",
                operationId: "update\u001b[31m",
                operation: "package_update",
                extensionId: null,
                host: "host-a",
                pid: 42,
                startedAt: "2026-09-01T01:00:00.000Z",
            }),
        );

        expect(inspectPackageMutationLock(root)).toEqual({
            state: "invalid",
            available: false,
            owner: null,
            error: "owner.json 字段无效",
        });
    });

    it("拒绝共享运行目录中的第二个活跃安装并公开所有者证据", () => {
        const root = fixture();
        const first = acquirePackageMutationLock(root, {
            token: "first-token",
            operationId: "operation-1",
            operation: "extension_install",
            extensionId: "adapter:slack",
        });

        expect(() =>
            acquirePackageMutationLock(root, {
                token: "second-token",
                operationId: "operation-2",
                operation: "extension_install",
                extensionId: "protocol:mcp-v1",
            }),
        ).toThrow(/adapter:slack.*安装事务.*进程.*operation-1.*请等待完成后重试/);

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
                operation: "extension_install",
                extensionId: "adapter:slack",
            },
            { isProcessAlive: () => true },
        );

        const replacement = acquirePackageMutationLock(
            root,
            {
                token: "replacement-token",
                operationId: "operation-2",
                operation: "extension_install",
                extensionId: "protocol:mcp-v1",
            },
            { isProcessAlive: () => false },
        );
        replacement.release();
    });

    it("软件包更新会阻止扩展安装进入同一运行目录", () => {
        const root = fixture();
        const update = acquirePackageMutationLock(root, {
            token: "update-token",
            operationId: "update-operation",
            operation: "package_update",
        });

        expect(() =>
            acquirePackageMutationLock(root, {
                token: "extension-token",
                operationId: "extension-operation",
                operation: "extension_install",
                extensionId: "adapter:slack",
            }),
        ).toThrow(/OneBots 软件包更新事务.*进程.*update-operation.*请等待完成后重试/);
        update.release();
    });

    it("不同主机无法用本地 PID 探测提前回收新鲜租约", () => {
        const root = fixture();
        acquirePackageMutationLock(
            root,
            {
                token: "remote-token",
                operationId: "operation-1",
                operation: "extension_install",
                extensionId: "adapter:slack",
            },
            { hostIdentity: () => "host-a" },
        );

        expect(() =>
            acquirePackageMutationLock(
                root,
                {
                    token: "local-token",
                    operationId: "operation-2",
                    operation: "package_update",
                },
                { hostIdentity: () => "host-b", isProcessAlive: () => false },
            ),
        ).toThrow(/host-a.*进程.*请等待完成后重试/);
    });

    it("超过保护期后回收无法直接探测的远端租约", () => {
        const root = fixture();
        acquirePackageMutationLock(
            root,
            {
                token: "old-token",
                operationId: "operation-1",
                operation: "package_update",
            },
            {
                now: () => new Date("2026-09-01T00:00:00.000Z"),
                hostIdentity: () => "host-a",
            },
        );

        const replacement = acquirePackageMutationLock(
            root,
            {
                token: "replacement-token",
                operationId: "operation-2",
                operation: "extension_install",
                extensionId: "protocol:mcp-v1",
            },
            {
                now: () => new Date("2026-09-01T00:31:00.000Z"),
                hostIdentity: () => "host-b",
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
            operation: "extension_install",
            extensionId: "adapter:slack",
        });
        const lockPath = path.join(root, ".onebots-package-mutation.lock");
        const movedPath = `${lockPath}.old`;
        fs.renameSync(lockPath, movedPath);
        const second = acquirePackageMutationLock(root, {
            token: "second-token",
            operationId: "operation-2",
            operation: "package_update",
        });

        expect(() => first.release()).toThrow(/租约所有权已丢失/);
        expect(fs.existsSync(lockPath)).toBe(true);
        second.release();
        fs.rmSync(movedPath, { recursive: true, force: true });
    });
});
