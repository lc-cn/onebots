import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createServiceMigrationConfig } from "./service-migration-config.js";
import type { ServiceSpec } from "./service-definition.js";
const workspace = path.resolve("private workspace");
function legacy(): ServiceSpec {
    return {
        scope: "user",
        configPath: path.join(workspace, "custom.yaml"),
        adapters: ["cli-adapter"],
        protocols: ["cli-protocol"],
        applications: ["cli-app"],
        nodePath: process.execPath,
        binPath: path.resolve("bin.js"),
        workingDirectory: path.resolve("old-cwd"),
    };
}
const candidate = (document: unknown, spec = legacy()) =>
    createServiceMigrationConfig({ document, legacy: spec, workspace });
describe("旧服务纯配置迁移候选", () => {
    it("仅删除根管理凭据，深层平台与协议同名值完整保留", () => {
        const document = {
            username: "admin",
            password: "root-password",
            access_token: "root-token",
            database: "old.db",
            general: { "onebot.v11": { access_token: "protocol-token", username: "nested-user" } },
            "qq.account.with.dots": {
                password: "platform-password",
                access_token: "platform-token",
                username: "platform-user",
                "onebot.v11": { access_token: "account-protocol-token" },
            },
        };
        const result = candidate(document);
        for (const key of ["username", "password", "access_token"])
            expect(result.document).not.toHaveProperty(key);
        expect(result.document.general).toEqual(document.general);
        expect(result.document["qq.account.with.dots"]).toEqual(document["qq.account.with.dots"]);
        expect(result.document.database).toBe("old.db");
        expect(document.password).toBe("root-password");
    });
    it("配置plugins整体优先，与公开CLI非空参数优先不同", () => {
        const result = candidate({ plugins: { adapters: ["configured"], protocols: [] } });
        expect(result.selection).toEqual({
            adapters: ["configured"],
            protocols: [],
            applications: ["cli-app"],
        });
        expect(candidate({ plugins: { applications: [] } }).selection).toEqual({
            adapters: [],
            protocols: [],
            applications: [],
        });
        expect(candidate({ plugins: {} }).selection).toEqual({
            adapters: [],
            protocols: [],
            applications: ["cli-app"],
        });
        expect(
            candidate({ plugins: { applications: ["configured-app"] } }).selection.applications,
        ).toEqual(["configured-app"]);
    });
    it("无plugins才采用服务定义，不从账号或当前容器环境猜插件", () => {
        vi.stubEnv("ONEBOTS_CONTAINER", "1");
        try {
            expect(candidate({ "other.account": { "custom.v1": {} } }).selection).toEqual({
                adapters: ["cli-adapter"],
                protocols: ["cli-protocol"],
                applications: ["cli-app"],
            });
            const spec = legacy();
            delete spec.applications;
            expect(candidate({}, spec).selection.applications).toEqual([]);
        } finally {
            vi.unstubAllEnvs();
        }
    });
    it("自定义旧文件名仅给出明确目标，不搬数据、不按cwd改变路径", () => {
        const result = candidate({});
        expect(result.sourceConfigPath).toBe(path.join(workspace, "custom.yaml"));
        expect(result.targetConfigPath).toBe(path.join(workspace, "config.yaml"));
        expect(result.dataDirectory).toBe(path.join(workspace, "data"));
        expect(() =>
            createServiceMigrationConfig({
                document: {},
                legacy: legacy(),
                workspace: path.join(workspace, "other"),
            }),
        ).toThrow();
        expect(() =>
            createServiceMigrationConfig({ document: {}, legacy: legacy(), workspace: "relative" }),
        ).toThrow();
    });
    it("严格解析拒绝不完整值和getter，不回显敏感输入", () => {
        expect(() => candidate({ plugins: { adapters: "private-secret" } })).toThrow(
            /^旧服务配置迁移候选无效/,
        );
        expect(() => candidate({ plugins: { unknown: [] } })).toThrow();
        let read = false;
        expect(() =>
            candidate({
                get password() {
                    read = true;
                    return "private";
                },
            }),
        ).toThrow();
        expect(read).toBe(false);
        const result = candidate({});
        result.selection.adapters.push("extra");
        expect(result.document.plugins).toEqual({
            adapters: ["cli-adapter"],
            protocols: ["cli-protocol"],
            applications: ["cli-app"],
        });
    });
});
