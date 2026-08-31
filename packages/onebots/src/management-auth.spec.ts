import type { IncomingMessage } from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TokenManager } from "@onebots/core";
import {
    authorizeManagementUpgrade,
    extractManagementToken,
    managementAccessTokenMatches,
    managementCredentialsChanged,
    managementCredentialsMatch,
    validateManagementToken,
} from "./management-auth.js";

function request(url: string, authorization?: string): IncomingMessage {
    return { url, headers: { authorization } } as IncomingMessage;
}

describe("management authentication", () => {
    beforeEach(() => vi.stubEnv("ONEBOTS_ACCESS_TOKEN", ""));
    afterEach(() => vi.unstubAllEnvs());

    it("从 Bearer header 与 query 提取令牌", () => {
        expect(extractManagementToken(request("/", "Bearer header-token"))).toBe("header-token");
        expect(extractManagementToken(request("/?access_token=query-token"))).toBe("query-token");
    });

    it("配置 token 与会话 token 可同时授权 WebSocket upgrade", () => {
        const tokenManager = new TokenManager();
        const session = tokenManager.generateToken({ username: "admin" });
        const host = { config: { access_token: "configured-token" }, tokenManager };

        expect(authorizeManagementUpgrade(host, request("/", "Bearer configured-token"))).toBe(
            true,
        );
        expect(authorizeManagementUpgrade(host, request(`/?access_token=${session.token}`))).toBe(
            true,
        );
        expect(authorizeManagementUpgrade(host, request("/"))).toBe(false);
        expect(authorizeManagementUpgrade(host, request("/?access_token=wrong"))).toBe(false);
    });

    it("每次校验都读取热重载后的当前凭据", () => {
        const tokenManager = new TokenManager();
        const host = {
            config: {
                username: "old-user",
                password: "old-password",
                access_token: "old-token",
            },
            tokenManager,
        };

        expect(validateManagementToken(host, "old-token").valid).toBe(true);
        expect(managementCredentialsMatch(host.config, "old-user", "old-password")).toBe(true);
        host.config = {
            username: "new-user",
            password: "new-password",
            access_token: "new-token",
        };

        expect(validateManagementToken(host, "old-token").valid).toBe(false);
        expect(validateManagementToken(host, "new-token").valid).toBe(true);
        expect(managementCredentialsMatch(host.config, "old-user", "old-password")).toBe(false);
        expect(managementCredentialsMatch(host.config, "new-user", "new-password")).toBe(true);
        expect(managementAccessTokenMatches(host.config, "new-token")).toBe(true);
    });

    it("部署环境 token 覆盖配置 token 并保持热重载会话稳定", () => {
        vi.stubEnv("ONEBOTS_ACCESS_TOKEN", "deployment-token");
        const tokenManager = new TokenManager();
        const host = { config: { access_token: "file-token" }, tokenManager };

        expect(validateManagementToken(host, "deployment-token").valid).toBe(true);
        expect(validateManagementToken(host, "file-token").valid).toBe(false);
        expect(managementAccessTokenMatches(host.config, "deployment-token")).toBe(true);
        expect(
            managementCredentialsChanged(host.config, { access_token: "rotated-file-token" }),
        ).toBe(false);
    });

    it("只在认证材料变化时要求撤销既有会话", () => {
        const previous = {
            username: "admin",
            password: "secret",
            access_token: " token ",
            log_level: "info" as const,
        };
        expect(managementCredentialsChanged(previous, { ...previous, log_level: "debug" })).toBe(
            false,
        );
        expect(managementCredentialsChanged(previous, { ...previous, access_token: "token" })).toBe(
            false,
        );
        expect(managementCredentialsChanged(previous, { ...previous, password: "rotated" })).toBe(
            true,
        );
    });
});
