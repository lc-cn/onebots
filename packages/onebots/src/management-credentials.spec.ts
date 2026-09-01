import { afterEach, describe, expect, it, vi } from "vitest";
import {
    ensureManagementCredentials,
    hasManagementCredentials,
    inspectPersistedManagementCredentials,
} from "./management-credentials.js";

afterEach(() => {
    vi.unstubAllEnvs();
});

describe("management credential bootstrap", () => {
    it("distinguishes complete credentials from incomplete or empty values", () => {
        expect(hasManagementCredentials({ access_token: "token" }, "")).toBe(true);
        expect(hasManagementCredentials({ username: "operator", password: "secret" }, "")).toBe(
            true,
        );
        expect(hasManagementCredentials({ username: "operator" }, "")).toBe(false);
        expect(hasManagementCredentials({ access_token: "  " }, "")).toBe(false);
        expect(hasManagementCredentials({}, "deployment-token")).toBe(true);
    });

    it("preserves an explicit access token", () => {
        const config = { access_token: "configured-token" };
        const generator = vi.fn(() => "generated-token");

        expect(ensureManagementCredentials(config, generator, "")).toEqual({
            config,
            generated: false,
            source: "config",
        });
        expect(generator).not.toHaveBeenCalled();
    });

    it("preserves a complete username and password pair", () => {
        const config = { username: "operator", password: "secret" };

        expect(ensureManagementCredentials(config, undefined, "")).toEqual({
            config,
            generated: false,
            source: "config",
        });
    });

    it("adds a token without mutating an incomplete credential configuration", () => {
        const config = { username: "operator", port: 6727 };

        expect(ensureManagementCredentials(config, () => "generated-token", "")).toEqual({
            config: {
                username: "operator",
                port: 6727,
                access_token: "generated-token",
            },
            generated: true,
            source: "generated",
        });
        expect(config).toEqual({ username: "operator", port: 6727 });
    });

    it("rejects an empty token generator result", () => {
        expect(() => ensureManagementCredentials({}, () => "  ", "")).toThrow(
            "管理端鉴权码生成器返回了空值",
        );
    });

    it("uses the deployment token without writing a competing generated secret", () => {
        const config = { port: 7860 };
        const generator = vi.fn(() => "generated-token");

        expect(ensureManagementCredentials(config, generator, " space-secret ")).toEqual({
            config,
            generated: false,
            source: "environment",
        });
        expect(generator).not.toHaveBeenCalled();
        expect(config).not.toHaveProperty("access_token");
    });

    it("持久化凭据证据忽略当前 shell 的临时 token", () => {
        vi.stubEnv("ONEBOTS_ACCESS_TOKEN", "shell-only-secret");

        expect(inspectPersistedManagementCredentials({})).toEqual({
            name: "service-credentials",
            level: "error",
            message: expect.stringContaining("服务配置缺少持久化管理凭据"),
        });
        expect(inspectPersistedManagementCredentials({ access_token: "saved-secret" })).toEqual({
            name: "service-credentials",
            level: "ok",
            message: "服务配置包含持久化管理凭据",
        });
    });
});
