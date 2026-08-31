import { describe, expect, it, vi } from "vitest";
import type { ValidationRule } from "onebots";
import { materializeGoogleChatUpload } from "./adapter-support.js";
import { describeGoogleChatCapabilities, googleChatCapabilities } from "./capabilities.js";
import { GoogleChatTransport } from "./transport.js";
import { GOOGLE_CHAT_PLATFORM_ACTIONS } from "./platform-actions.js";
import { googleChatSchema } from "./index.js";
import { assertGoogleChatConfig } from "./validation.js";

describe("Google Chat 配置与能力契约", () => {
    it("用结构化表单表达三种接收模式和动态列表", () => {
        expect(rule("receive_mode").choices?.map(item => item.value)).toEqual([
            "interaction-http",
            "pubsub-push",
            "manual",
        ]);
        expect(rule("event_types")).toMatchObject({
            type: "array",
            ui: { widget: "choice-list", section: "filter" },
        });
        expect(rule("pubsub_service_account_email").ui?.visibleWhen).toEqual({
            path: "receive_mode",
            oneOf: ["pubsub-push"],
        });
        for (const field of ["service_account_private_key", "access_token"]) {
            expect(rule(field).sensitive).toBe(true);
        }
    });

    it("运行时配置闭合身份、Audience 与稳定事件枚举", () => {
        expect(() =>
            assertGoogleChatConfig({
                account_id: "bot",
                auth_mode: "access-token",
                access_token: "token",
                receive_mode: "manual",
                event_types: ["preview.event"],
            }),
        ).toThrow(/event_types/u);
        expect(() =>
            assertGoogleChatConfig({
                account_id: "bot",
                auth_mode: "access-token",
                access_token: "token",
                receive_mode: "interaction-http",
                verification_mode: "project-number",
                verification_audience: "not-a-project-number",
            }),
        ).toThrow(/项目编号/u);
    });

    it("平台动作全部来自可执行注册表，事件筛选收窄账号能力", () => {
        for (const action of GOOGLE_CHAT_PLATFORM_ACTIONS) {
            expect(googleChatCapabilities.actions[action]?.support).toBe("native");
        }
        const restricted = describeGoogleChatCapabilities({
            auth_mode: "access-token",
            receive_mode: "pubsub-push",
            event_types: ["google.workspace.chat.message.v1.created"],
        });
        expect(restricted.events.message?.support).toBe("native");
        expect(restricted.events.reaction_added?.support).toBe("unsupported");
        expect(restricted.events.custom?.support).toBe("unsupported");
    });

    it("接收模式和已声明 OAuth scopes 都会收窄账号能力", () => {
        const interaction = describeGoogleChatCapabilities({
            auth_mode: "service-account",
            receive_mode: "interaction-http",
        });
        expect(interaction.events.message?.support).toBe("native");
        expect(interaction.events.message_updated?.support).toBe("unsupported");
        expect(interaction.actions.send_message?.support).toBe("native");
        expect(interaction.actions.mark_message_as_read?.support).toBe("unsupported");

        const user = describeGoogleChatCapabilities({
            auth_mode: "access-token",
            receive_mode: "manual",
            oauth_scopes: ["https://www.googleapis.com/auth/chat.users.readstate"],
        });
        expect(user.actions.mark_message_as_read?.support).toBe("native");
        expect(user.actions.send_message?.support).toBe("unsupported");
    });

    it("上传只接受宿主已读取的 base64，拒绝越权 I/O", () => {
        expect(materializeGoogleChatUpload({ data: "aGVsbG8=" })).toEqual(
            new Uint8Array(Buffer.from("hello")),
        );
        expect(() => materializeGoogleChatUpload({ path: "/etc/passwd" })).toThrow(/本地路径/u);
        expect(() => materializeGoogleChatUpload({ url: "https://metadata.internal" })).toThrow(
            /远程 URL/u,
        );
    });

    it("Transport 拒绝绝对 URL/路径穿越并保留 Google 结构化错误", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
            new Response(
                JSON.stringify({
                    error: { code: 403, status: "PERMISSION_DENIED", message: "denied" },
                }),
                { status: 403 },
            ),
        );
        const transport = new GoogleChatTransport(
            { account_id: "bot", auth_mode: "access-token", access_token: "token" },
            { accessToken: async () => "token" },
            fetcher,
        );
        await expect(transport.call("GET", "https://evil.example/v1/spaces")).rejects.toThrow(
            /pathname/u,
        );
        await expect(transport.call("GET", "/v1/../token")).rejects.toThrow(/pathname/u);
        await expect(transport.call("GET", "/v1/spaces/AAA")).rejects.toMatchObject({
            code: "PERMISSION_DENIED",
            status: 403,
        });
    });

    it("Media upload 发送官方要求的 filename metadata 与二进制 multipart", async () => {
        const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({}));
        const transport = new GoogleChatTransport(
            { account_id: "bot", auth_mode: "access-token", access_token: "token" },
            { accessToken: async () => "token" },
            fetcher,
        );
        await transport.call("POST", "/upload/v1/spaces/AAA/attachments:upload", {
            query: { uploadType: "multipart" },
            upload: new Uint8Array(Buffer.from("file-body")),
            uploadMetadata: { filename: "photo.png" },
            contentType: "image/png",
        });

        const [url, init] = fetcher.mock.calls[0];
        expect(String(url)).toContain("uploadType=multipart");
        const headers = new Headers(init?.headers);
        expect(headers.get("content-type")).toMatch(/^multipart\/related; boundary=/u);
        const body = init?.body as Blob;
        expect(await body.text()).toContain('{"filename":"photo.png"}');
        expect(await body.text()).toContain("file-body");
    });

    it("重复 query 参数与媒体二进制响应保持原始语义", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(Response.json({ spaces: [] }))
            .mockResolvedValueOnce(
                new Response(new Uint8Array([1, 2, 3]), {
                    headers: { "content-type": "image/png" },
                }),
            );
        const transport = new GoogleChatTransport(
            { account_id: "bot", auth_mode: "access-token", access_token: "token" },
            { accessToken: async () => "token" },
            fetcher,
        );
        await transport.call("GET", "/v1/spaces:findGroupChats", {
            query: { users: ["users/a", "users/b"] },
        });
        expect(String(fetcher.mock.calls[0][0])).toContain("users=users%2Fa&users=users%2Fb");

        const media = await transport.downloadMedia("spaces/A/attachments/file");
        expect(media).toMatchObject({ data: new Uint8Array([1, 2, 3]), contentType: "image/png" });
        await expect(transport.downloadMedia("../token")).rejects.toThrow(/resourceName/u);
    });
});

function rule(name: string): ValidationRule {
    const value = googleChatSchema[name] as ValidationRule | undefined;
    if (!value || !("type" in value)) throw new Error(`Schema 字段不存在: ${name}`);
    return value;
}
