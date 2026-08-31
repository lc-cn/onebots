import { describe, expect, it, vi } from "vitest";
import { ensureManagementCredentials } from "./management-credentials.js";

describe("management credential bootstrap", () => {
    it("preserves an explicit access token", () => {
        const config = { access_token: "configured-token" };
        const generator = vi.fn(() => "generated-token");

        expect(ensureManagementCredentials(config, generator)).toEqual({
            config,
            generated: false,
        });
        expect(generator).not.toHaveBeenCalled();
    });

    it("preserves a complete username and password pair", () => {
        const config = { username: "operator", password: "secret" };

        expect(ensureManagementCredentials(config)).toEqual({
            config,
            generated: false,
        });
    });

    it("adds a token without mutating an incomplete credential configuration", () => {
        const config = { username: "operator", port: 6727 };

        expect(ensureManagementCredentials(config, () => "generated-token")).toEqual({
            config: {
                username: "operator",
                port: 6727,
                access_token: "generated-token",
            },
            generated: true,
        });
        expect(config).toEqual({ username: "operator", port: 6727 });
    });

    it("rejects an empty token generator result", () => {
        expect(() => ensureManagementCredentials({}, () => "  ")).toThrow(
            "管理端鉴权码生成器返回了空值",
        );
    });
});
