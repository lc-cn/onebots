import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareServiceMigration } from "./service-migration-preparation.js";
import type { ServiceSpec } from "./service-definition.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
const roots: string[] = [];
afterEach(() => roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true })));
function fixture(content: string) {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-migration-"));
    roots.push(root);
    const file = path.join(root, "custom.yaml");
    fs.writeFileSync(file, content);
    const legacy: ServiceSpec = {
        scope: "user",
        configPath: file,
        adapters: [],
        protocols: [],
        nodePath: process.execPath,
        binPath: "/app/bin.js",
        workingDirectory: root,
    };
    const target: ManagerServiceSpec = {
        schemaVersion: 1,
        runtimeKind: "control",
        scope: "user",
        workspace: root,
        nodePath: process.execPath,
        binPath: "/app/bin.js",
        workingDirectory: root,
        host: "127.0.0.1",
        port: 6727,
    };
    return { root, file, legacy, target };
}
describe("旧服务迁移只读准备", () => {
    it("悬空目标链接仍是冲突，不当作空工作区", () => {
        const t = fixture("{}");
        fs.symlinkSync(path.join(t.root, "missing"), path.join(t.root, "config.yaml"));
        expect(() => prepareServiceMigration(t.legacy, t.target)).toThrow("目标配置已经存在");
    });
    it("剥离根管理认证但不写原文件或创建新配置", () => {
        const t = fixture("username: old\npassword: secret\ngeneral:\n  access_token: protocol\n");
        const before = fs.readFileSync(t.file);
        const result = prepareServiceMigration(t.legacy, t.target);
        expect(result.configuration?.document).toMatchObject({
            general: { access_token: "protocol" },
        });
        expect(result.configuration?.document).not.toHaveProperty("password");
        expect(result.originalBytes).toEqual(before);
        expect(fs.readFileSync(t.file)).toEqual(before);
        expect(fs.existsSync(result.targetConfigPath)).toBe(false);
    });
    it("坏YAML保留原文，不生成空配置候选", () => {
        const t = fixture('password: "broken\r\n');
        const result = prepareServiceMigration(t.legacy, t.target);
        expect(result.sourceState).toBe("damaged");
        expect(result.configuration).toBeNull();
        expect(result.originalBytes).toEqual(fs.readFileSync(t.file));
    });
    it.each(["config.yaml", ".control"])("既有%s禁止覆盖", name => {
        const t = fixture("{}");
        fs.writeFileSync(path.join(t.root, name), "preserved");
        expect(() => prepareServiceMigration(t.legacy, t.target)).toThrow();
        expect(fs.readFileSync(path.join(t.root, name), "utf8")).toBe("preserved");
    });
});
