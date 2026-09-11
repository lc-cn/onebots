import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ServiceHost } from "./service-host.js";

const security = vi.hoisted(() => ({
    inspectDirectory: vi.fn(() => "directory-proof"),
    inspectFile: vi.fn(() => "file-proof"),
    secureFile: vi.fn(() => "file-proof"),
}));
vi.mock("./windows-service-security.js", () => ({
    inspectWindowsServiceDirectorySecurity: security.inspectDirectory,
    inspectWindowsServiceFileSecurity: security.inspectFile,
    secureWindowsServiceFile: security.secureFile,
}));

import { acquireServiceMigrationLock } from "./service-migration-lock.js";
import { acquireControlWorkspace } from "./control/workspace.js";

const roots: string[] = [];
const host: ServiceHost = {
    platform: "win32",
    homedir: "C:\\Users\\operator",
    isElevated: true,
    windowsSid: "S-1-5-21-1",
    env: {},
    exec: () => "",
    spawn: async () => 0,
};

afterEach(() => {
    vi.clearAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function temporary(): string {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-windows-lock-"));
    roots.push(root);
    return root;
}

describe("Windows 服务锁 ACL 门禁", () => {
    it("新锁先收紧文件 ACL，复用时只读核验，不依赖 POSIX mode", () => {
        const directory = temporary();
        fs.chmodSync(directory, 0o777);
        const first = acquireServiceMigrationLock(directory, host);
        first();
        const lock = path.join(directory, "service-migration-lock.sqlite");
        fs.chmodSync(lock, 0o666);

        const second = acquireServiceMigrationLock(directory, host);
        second();

        expect(security.inspectDirectory).toHaveBeenCalledTimes(2);
        expect(security.secureFile).toHaveBeenCalledOnce();
        expect(security.secureFile).toHaveBeenCalledWith(host, lock);
        expect(security.inspectFile).toHaveBeenCalledWith(host, lock);
    });

    it("既有锁 ACL 无法证明时拒绝进入 SQLite 事务", () => {
        const directory = temporary();
        const first = acquireServiceMigrationLock(directory, host);
        first();
        security.inspectFile.mockImplementationOnce(() => {
            throw new Error("unsafe acl");
        });
        expect(() => acquireServiceMigrationLock(directory, host)).toThrow("unsafe acl");
    });

    it("管理工件锁使用相同的新建收紧和既有只读 ACL 契约", () => {
        const workspace = temporary();
        const control = path.join(workspace, ".control");
        fs.mkdirSync(control, { mode: 0o777 });
        const first = acquireControlWorkspace(workspace, host);
        first();
        const lock = path.join(fs.realpathSync(workspace), ".control", "manager-lock.sqlite");
        fs.chmodSync(lock, 0o666);

        const second = acquireControlWorkspace(workspace, host);
        second();

        expect(security.secureFile).toHaveBeenCalledWith(host, lock);
        expect(security.inspectFile).toHaveBeenCalledWith(host, lock);
    });
});
