import fs from "node:fs";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { selectManagerBootstrapCycle } from "./manager-bootstrap-cycle.js";
import { getServiceFiles } from "./service-files.js";
import { readManagerMigrationOrigin } from "./manager-migration-origin.js";
import type { ServiceHost } from "./service-host.js";

vi.mock("./manager-migration-origin.js", () => ({ readManagerMigrationOrigin: vi.fn() }));

it("已有首次安装目录缺失意图时，不用迁移来源绕过损坏历史", () => {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/bootstrap-migration-"));
    try {
        const host: ServiceHost = {
            platform: "linux",
            homedir: root,
            env: {},
            uid: process.getuid?.(),
            exec: () => {
                throw new Error("不得调用OS");
            },
            spawn: async () => {
                throw new Error("不得启动");
            },
        };
        const files = getServiceFiles("user", host);
        fs.mkdirSync(path.join(files.stateDir, "manager-artifacts/bootstrap"), {
            recursive: true,
            mode: 0o700,
        });
        expect(() => selectManagerBootstrapCycle("user", host)).toThrow("安装周期历史不完整");
        expect(readManagerMigrationOrigin).not.toHaveBeenCalled();
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
        vi.clearAllMocks();
    }
});
