import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CliError, sendMessage } from "./command-application.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
    vi.unstubAllEnvs();
    for (const directory of temporaryDirectories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

describe("CLI send management boundary", () => {
    it("使用规范化的网关前缀和环境优先的 Bearer token", async () => {
        vi.stubEnv("ONEBOTS_ACCESS_TOKEN", "environment-token");
        vi.stubEnv("PORT", "7860");
        const config = writeConfig(`
port: 7788
path: gateway
access_token: file-token
timeout: 5
`);
        const fetcher = vi.fn(
            async () =>
                new Response(JSON.stringify({ success: true, message_id: "m1" }), { status: 200 }),
        );

        await expect(
            sendMessage(sendOptions(config), "user-1", "hello", { fetcher }),
        ).resolves.toEqual({
            output: JSON.stringify({ success: true, message_id: "m1" }),
        });
        expect(fetcher).toHaveBeenCalledOnce();
        expect(fetcher).toHaveBeenCalledWith(
            "http://127.0.0.1:7860/gateway/api/send",
            expect.objectContaining({
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    authorization: "Bearer environment-token",
                },
            }),
        );
    });

    it("通过用户名密码创建临时会话，并在发送完成后撤销", async () => {
        const config = writeConfig("username: operator\npassword: password\n");
        const calls: string[] = [];
        const fetcher = vi.fn(async (input: string, init?: RequestInit) => {
            calls.push(input);
            if (input.endsWith("/api/auth/login")) {
                expect(JSON.parse(String(init?.body))).toEqual({
                    username: "operator",
                    password: "password",
                });
                return new Response(JSON.stringify({ token: "session-token" }), { status: 200 });
            }
            expect(new Headers(init?.headers).get("authorization")).toBe("Bearer session-token");
            return input.endsWith("/api/auth/logout")
                ? new Response(null, { status: 200 })
                : new Response(null, { status: 200 });
        });

        await expect(
            sendMessage(sendOptions(config), "user-1", "hello", { fetcher }),
        ).resolves.toEqual({
            output: "发送成功",
        });
        expect(calls).toEqual([
            "http://127.0.0.1:6727/api/auth/login",
            "http://127.0.0.1:6727/api/send",
            "http://127.0.0.1:6727/api/auth/logout",
        ]);
    });

    it("发送失败后仍撤销临时会话并保留发送诊断", async () => {
        const config = writeConfig("username: operator\npassword: password\n");
        const fetcher = vi.fn(async (input: string) => {
            if (input.endsWith("/api/auth/login")) {
                return new Response(JSON.stringify({ token: "session-token" }), { status: 200 });
            }
            if (input.endsWith("/api/auth/logout")) return new Response(null, { status: 200 });
            return new Response("adapter offline", { status: 503 });
        });

        await expect(
            sendMessage(sendOptions(config), "user-1", "hello", { fetcher }),
        ).rejects.toThrow("发送失败 (503): adapter offline");
        expect(fetcher.mock.calls.map(([input]) => input)).toContain(
            "http://127.0.0.1:6727/api/auth/logout",
        );
    });

    it("发送成功但临时会话撤销失败时不隐瞒清理错误", async () => {
        const config = writeConfig("username: operator\npassword: password\n");
        const fetcher = vi.fn(async (input: string) => {
            if (input.endsWith("/api/auth/login")) {
                return new Response(JSON.stringify({ token: "session-token" }), { status: 200 });
            }
            return input.endsWith("/api/auth/logout")
                ? new Response(null, { status: 500 })
                : new Response(null, { status: 200 });
        });

        await expect(
            sendMessage(sendOptions(config), "user-1", "hello", { fetcher }),
        ).rejects.toThrow("管理会话撤销失败: HTTP 500");
    });

    it("在发送凭据前拒绝危险的显式管理地址和缺失凭据", async () => {
        const config = writeConfig("general: {}\n");
        const fetcher = vi.fn();

        await expect(
            sendMessage(
                { ...sendOptions(config), url: "https://token@example.com/gateway" },
                "user-1",
                "hello",
                { fetcher },
            ),
        ).rejects.toBeInstanceOf(CliError);
        await expect(
            sendMessage(sendOptions(config), "user-1", "hello", { fetcher }),
        ).rejects.toThrow("配置未提供 access_token 或完整用户名密码");
        expect(fetcher).not.toHaveBeenCalled();
    });
});

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
