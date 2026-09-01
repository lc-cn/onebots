import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import packageMetadata from "../../package.json" with { type: "json" };
import { CliError, sendMessage } from "./command-application.js";

const temporaryDirectories: string[] = [];
const instanceId = "instance-a";

afterEach(() => {
    vi.unstubAllEnvs();
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("CLI send management boundary", () => {
    it("先以无凭据探针确认目标，再向同一实例发送 Bearer token", async () => {
        vi.stubEnv("ONEBOTS_ACCESS_TOKEN", "environment-token");
        vi.stubEnv("PORT", "7860");
        const config = writeConfig(
            "port: 7788\npath: gateway\naccess_token: file-token\ntimeout: 5\n",
        );
        const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
            if (input.endsWith("/health")) {
                expect(new Headers(init?.headers).has("authorization")).toBe(false);
                return healthResponse();
            }
            return sendResponse("m1");
        });

        await expect(
            sendMessage(sendOptions(config), "user-1", "hello", { fetcher }),
        ).resolves.toEqual({
            output: JSON.stringify(sendAcknowledgement("m1")),
        });
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(fetcher.mock.calls[0]?.[0]).toBe("http://127.0.0.1:7860/gateway/health");
        expect(fetcher).toHaveBeenLastCalledWith(
            "http://127.0.0.1:7860/gateway/api/send",
            expect.objectContaining({
                method: "POST",
                cache: "no-store",
                redirect: "error",
                headers: {
                    "content-type": "application/json",
                    authorization: "Bearer environment-token",
                    "X-OneBots-Expected-Instance-Id": instanceId,
                },
            }),
        );
    });

    it("通过绑定目标实例的用户名密码会话发送，并在完成后撤销", async () => {
        const config = writeConfig("username: operator\npassword: password\n");
        const calls: string[] = [];
        const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
            calls.push(input);
            if (input.endsWith("/health")) return healthResponse();
            if (input.endsWith("/api/auth/login")) {
                expect(JSON.parse(String(init?.body))).toEqual({
                    username: "operator",
                    password: "password",
                });
                expect(new Headers(init?.headers).get("X-OneBots-Expected-Instance-Id")).toBe(
                    instanceId,
                );
                return identifiedResponse({ token: "session-token" });
            }
            expect(new Headers(init?.headers).get("authorization")).toBe("Bearer session-token");
            return input.endsWith("/api/auth/logout")
                ? new Response(null, { status: 200 })
                : sendResponse(null);
        });

        await expect(
            sendMessage(sendOptions(config), "user-1", "hello", { fetcher }),
        ).resolves.toEqual({
            output: JSON.stringify(sendAcknowledgement(null)),
        });
        expect(calls).toEqual([
            "http://127.0.0.1:6727/health",
            "http://127.0.0.1:6727/api/auth/login",
            "http://127.0.0.1:6727/api/send",
            "http://127.0.0.1:6727/api/auth/logout",
        ]);
    });

    it("探针无法证明当前版本 OneBots 时不发送任何凭据", async () => {
        vi.stubEnv("ONEBOTS_ACCESS_TOKEN", "secret-token");
        const fetcher = vi.fn(async (_input: string, _init?: RequestInit) =>
            healthResponse({ application: "unknown-service" }),
        );

        await expect(
            sendMessage(sendOptions(writeConfig("general: {}\n")), "user-1", "hello", { fetcher }),
        ).rejects.toThrow("拒绝发送：无法确认目标是当前版本 OneBots");
        expect(fetcher).toHaveBeenCalledOnce();
        expect(new Headers(fetcher.mock.calls[0]?.[1]?.headers).has("authorization")).toBe(false);
    });

    it("登录响应实例与公开探针不一致时不采用会话 token", async () => {
        const config = writeConfig("username: operator\npassword: password\n");
        const fetcher = vi.fn(async (input: string) =>
            input.endsWith("/health")
                ? healthResponse()
                : identifiedResponse({ token: "session-token" }, 200, "instance-b"),
        );

        await expect(
            sendMessage(sendOptions(config), "user-1", "hello", { fetcher }),
        ).rejects.toThrow("管理登录响应身份与已探测的 OneBots 实例不一致");
        expect(fetcher).toHaveBeenCalledTimes(2);
    });

    it("发送响应身份或成功回执不一致时拒绝报告成功", async () => {
        const config = writeConfig("access_token: static-token\n");
        const mismatchedIdentity = vi
            .fn()
            .mockResolvedValueOnce(healthResponse())
            .mockResolvedValueOnce(sendResponse("m1", 200, "instance-b"));
        await expect(
            sendMessage(sendOptions(config), "user-1", "hello", { fetcher: mismatchedIdentity }),
        ).rejects.toThrow("发送响应身份与发送前探测的 OneBots 实例不一致");

        const malformedAck = vi
            .fn()
            .mockResolvedValueOnce(healthResponse())
            .mockResolvedValueOnce(identifiedResponse({ success: true, message_id: "m1" }));
        await expect(
            sendMessage(sendOptions(config), "user-1", "hello", { fetcher: malformedAck }),
        ).rejects.toThrow("发送响应缺少与目标实例一致的成功回执");
    });

    it("发送失败后仍撤销临时会话并保留发送诊断", async () => {
        const config = writeConfig("username: operator\npassword: password\n");
        const fetcher = vi.fn(async (input: string) => {
            if (input.endsWith("/health")) return healthResponse();
            if (input.endsWith("/api/auth/login"))
                return identifiedResponse({ token: "session-token" });
            if (input.endsWith("/api/auth/logout")) return new Response(null, { status: 200 });
            return identifiedResponse({ success: false, message: "adapter offline" }, 503);
        });

        await expect(
            sendMessage(sendOptions(config), "user-1", "hello", { fetcher }),
        ).rejects.toThrow("发送失败 (503)");
        expect(fetcher.mock.calls.map(([input]) => input)).toContain(
            "http://127.0.0.1:6727/api/auth/logout",
        );
    });

    it("发送成功但临时会话撤销失败时不隐瞒清理错误", async () => {
        const config = writeConfig("username: operator\npassword: password\n");
        const fetcher = vi.fn(async (input: string) => {
            if (input.endsWith("/health")) return healthResponse();
            if (input.endsWith("/api/auth/login"))
                return identifiedResponse({ token: "session-token" });
            return input.endsWith("/api/auth/logout")
                ? new Response(null, { status: 500 })
                : sendResponse(null);
        });

        await expect(
            sendMessage(sendOptions(config), "user-1", "hello", { fetcher }),
        ).rejects.toThrow("管理会话撤销失败: HTTP 500");
    });

    it("拒绝危险的显式管理地址；缺失凭据时仅执行公开探针", async () => {
        const config = writeConfig("general: {}\n");
        const fetcher = vi.fn(async () => healthResponse());
        await expect(
            sendMessage(
                { ...sendOptions(config), url: "https://token@example.com/gateway" },
                "user-1",
                "hello",
                { fetcher },
            ),
        ).rejects.toBeInstanceOf(CliError);
        expect(fetcher).not.toHaveBeenCalled();

        await expect(
            sendMessage(sendOptions(config), "user-1", "hello", { fetcher }),
        ).rejects.toThrow("配置未提供 access_token 或完整用户名密码");
        expect(fetcher).toHaveBeenCalledOnce();
    });
});

function healthResponse(
    overrides: Partial<{ application: string; version: string; instance_id: string }> = {},
): Response {
    return new Response(
        JSON.stringify({
            status: "ok",
            application: "onebots",
            version: packageMetadata.version,
            instance_id: instanceId,
            ...overrides,
        }),
        { status: 200 },
    );
}

function identifiedResponse(
    body: unknown,
    status = 200,
    responseInstanceId = instanceId,
): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: {
            "X-OneBots-Application": "onebots",
            "X-OneBots-Version": packageMetadata.version,
            "X-OneBots-Instance-Id": responseInstanceId,
        },
    });
}

function sendAcknowledgement(messageId: string | null) {
    return {
        success: true,
        application: "onebots",
        instance_id: instanceId,
        message_id: messageId,
    };
}

function sendResponse(
    messageId: string | null,
    status = 200,
    responseInstanceId = instanceId,
): Response {
    return identifiedResponse(
        {
            success: true,
            application: "onebots",
            instance_id: responseInstanceId,
            message_id: messageId,
        },
        status,
        responseInstanceId,
    );
}

function writeConfig(content: string): string {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-send-"));
    temporaryDirectories.push(directory);
    const config = path.join(directory, "config.yaml");
    fs.writeFileSync(config, content.trimStart(), { mode: 0o600 });
    return config;
}

function sendOptions(config: string) {
    return {
        config,
        register: [],
        protocol: [],
        target_type: "private" as const,
        channel: "mock.bot",
    };
}
