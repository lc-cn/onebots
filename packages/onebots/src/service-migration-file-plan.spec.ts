import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDefaultServiceHost } from "./service-host.js";
import { getServiceFiles } from "./service-files.js";
import { createServiceMigrationFilePlan } from "./service-migration-file-plan.js";
import { ServiceMigrationFiles } from "./service-migration-files.js";
import type { ServiceMigrationBackup, ServiceMigrationFile } from "./service-migration-types.js";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
function fixture(
    content = "username: old\npassword: old\ngeneral:\n  access_token: protocol-secret\n",
) {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-migration-plan-"));
    roots.push(root);
    const host = {
        ...createDefaultServiceHost(),
        platform: "linux" as const,
        homedir: root,
        env: {},
    };
    const paths = getServiceFiles("user", host);
    const workspace = path.join(root, "workspace");
    const legacy = {
        scope: "user",
        configPath: path.join(workspace, "old.yaml"),
        adapters: [],
        protocols: [],
        nodePath: process.execPath,
        binPath: "/app/bin.js",
        workingDirectory: workspace,
    };
    const files = (
        [
            ["definition", paths.definition, "old unit"],
            ["metadata", paths.metadata, JSON.stringify(legacy)],
            ["configuration", legacy.configPath, content],
        ] as const
    ).map(([role, file, text]): ServiceMigrationFile => {
        fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
        fs.writeFileSync(file, text, { mode: 0o600 });
        return {
            role,
            path: file,
            mode: 0o600,
            contentBase64: Buffer.from(text).toString("base64"),
        };
    });
    const backup: ServiceMigrationBackup = {
        schemaVersion: 1,
        previousRunning: false,
        previousEnabled: false,
        files,
        target: {
            schemaVersion: 1,
            runtimeKind: "control",
            scope: "user",
            workspace,
            workingDirectory: workspace,
            nodePath: process.execPath,
            binPath: "/app/bin.js",
            host: "127.0.0.1",
            port: 6727,
        },
    };
    return { root, host, paths, workspace, backup };
}
describe("真实迁移文件计划", () => {
    it("串联候选生成与逐文件事务，保留深层凭据并可精确恢复旧文件名", () => {
        const t = fixture();
        const plan = createServiceMigrationFilePlan(t.backup, t.host);
        const files = new ServiceMigrationFiles(t.backup, plan.files);
        expect(files.matchesOriginal()).toBe(true);
        files.apply();
        expect(files.matchesTarget()).toBe(true);
        const content = fs.readFileSync(path.join(t.workspace, "config.yaml"), "utf8");
        expect(content).toContain("protocol-secret");
        expect(content).not.toContain("password");
        expect(fs.readFileSync(t.paths.definition, "utf8")).toContain('"serve"');
        expect(JSON.parse(fs.readFileSync(t.paths.metadata, "utf8")).runtimeKind).toBe("control");
        files.restore();
        expect(files.matchesOriginal()).toBe(true);
        expect(fs.existsSync(path.join(t.workspace, "config.yaml"))).toBe(false);
    });
    it("损坏文件原字节传递，错误插件声明不能降级为损坏来源绕过迁移验证", () => {
        const t = fixture('password: "broken\r\n');
        const plan = createServiceMigrationFilePlan(t.backup, t.host);
        expect(plan.sourceState).toBe("damaged");
        expect(plan.files[0].bytes).toEqual(Buffer.from('password: "broken\r\n'));
        t.backup.files.find(file => file.role === "configuration")!.contentBase64 = Buffer.from(
            "plugins:\n  adapters: wrong\n",
        ).toString("base64");
        expect(() => createServiceMigrationFilePlan(t.backup, t.host)).toThrow();
    });
    it("备份不属于当前系统服务路径时拒绝生成写入目标", () => {
        const t = fixture();
        t.backup.files[0].path = path.join(t.root, "unrelated.service");
        expect(() => createServiceMigrationFilePlan(t.backup, t.host)).toThrow();
        expect(fs.readFileSync(t.paths.definition, "utf8")).toBe("old unit");
    });
});
