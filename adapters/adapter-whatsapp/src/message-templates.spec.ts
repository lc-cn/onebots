import { describe, expect, it, vi } from "vitest";
import { WhatsAppClient } from "./client.js";
import { executeWhatsAppPlatformAction } from "./platform-actions.js";
import type { WhatsAppConfig } from "./types.js";

const config: WhatsAppConfig = {
    account_id: "bot",
    business_account_id: "waba",
    phone_number_id: "phone",
    access_token: "token",
    api_version: "v23.0",
    receive_mode: "manual",
};

const template = {
    id: "920070352646140",
    name: "seasonal_promotion",
    language: "en_US",
    status: "APPROVED",
    category: "MARKETING",
    components: [
        { type: "BODY", text: "Hi {{1}}", example: { body_text: [["Mark"]] } },
        { type: "BUTTONS", buttons: [{ type: "QUICK_REPLY", text: "Stop" }] },
    ],
};

describe("WhatsAppMessageTemplates", () => {
    it("默认查询返回并校验完整模板类型", async () => {
        const client = new WhatsAppClient(config, jsonFetcher({ data: [template] }));
        const response = await client.messageTemplates.list();
        expect(response.data[0]?.components[0]?.type).toBe("BODY");
        expect(response.data[0]?.status).toBe("APPROVED");
    });

    it("用字段数组、名称过滤和 cursor 查询模板", async () => {
        const fetcher = jsonFetcher({
            data: [template],
            paging: {
                cursors: { before: "before", after: "next" },
                next: "https://graph.facebook.com/v23.0/waba/message_templates?after=next",
            },
        });
        const client = new WhatsAppClient(config, fetcher);

        await expect(
            client.messageTemplates.list({
                fields: ["id", "name", "status", "category", "language", "components"],
                name: "seasonal_promotion",
                limit: 25,
                after: "current",
            }),
        ).resolves.toMatchObject({
            data: [{ id: template.id }],
            paging: { cursors: { after: "next" } },
        });
        const url = requestUrl(fetcher);
        expect(url.pathname).toBe("/v23.0/waba/message_templates");
        expect(url.searchParams.get("fields")).toBe("id,name,status,category,language,components");
        expect(url.searchParams.get("name")).toBe("seasonal_promotion");
        expect(url.searchParams.get("limit")).toBe("25");
        expect(url.searchParams.get("after")).toBe("current");
    });

    it("按模板 ID 读取稀疏 Graph fields 投影", async () => {
        const fetcher = jsonFetcher({ id: template.id, status: "PAUSED" });
        const client = new WhatsAppClient(config, fetcher);
        await expect(
            client.messageTemplates.get(template.id, { fields: ["id", "status"] }),
        ).resolves.toEqual({
            id: template.id,
            status: "PAUSED",
        });
        const url = requestUrl(fetcher);
        expect(url.pathname).toBe(`/v23.0/${template.id}`);
        expect(url.searchParams.get("fields")).toBe("id,status");
    });

    it("读取 WABA 模板 namespace", async () => {
        const fetcher = jsonFetcher({ id: "waba", message_template_namespace: "namespace" });
        const client = new WhatsAppClient(config, fetcher);
        await expect(client.messageTemplates.getNamespace()).resolves.toEqual({
            id: "waba",
            message_template_namespace: "namespace",
        });
        expect(requestUrl(fetcher).searchParams.get("fields")).toBe(
            "id,message_template_namespace",
        );
    });

    it("创建时保留 OTP 等可扩展组件并校验创建响应", async () => {
        const fetcher = jsonFetcher({
            id: template.id,
            status: "PENDING",
            category: "AUTHENTICATION",
        });
        const client = new WhatsAppClient(config, fetcher);
        await expect(
            client.messageTemplates.create({
                name: "authentication_code",
                language: "en_US",
                category: "AUTHENTICATION",
                parameter_format: "POSITIONAL",
                components: [
                    { type: "BODY", add_security_recommendation: true },
                    {
                        type: "BUTTONS",
                        buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copy Code" }],
                    },
                ],
            }),
        ).resolves.toEqual({ id: template.id, status: "PENDING", category: "AUTHENTICATION" });
        expect(requestJson(fetcher)).toMatchObject({
            name: "authentication_code",
            parameter_format: "POSITIONAL",
            components: expect.arrayContaining([
                { type: "BODY", add_security_recommendation: true },
                {
                    type: "BUTTONS",
                    buttons: [{ type: "OTP", otp_type: "COPY_CODE", text: "Copy Code" }],
                },
            ]),
        });
    });

    it("固定动作补齐按 ID 编辑", async () => {
        const fetcher = jsonFetcher({ success: true });
        const client = new WhatsAppClient(config, fetcher);
        await expect(
            executeWhatsAppPlatformAction(client, "update_message_template", {
                template_id: template.id,
                template: { category: "UTILITY", components: [{ type: "BODY", text: "Updated" }] },
            }),
        ).resolves.toEqual({ success: true });
        expect(requestUrl(fetcher).pathname).toBe(`/v23.0/${template.id}`);
        expect(requestJson(fetcher)).toEqual({
            category: "UTILITY",
            components: [{ type: "BODY", text: "Updated" }],
        });
    });

    it("区分按名称删除全部语言和按 ID 删除单一模板", async () => {
        const fetcher = vi
            .fn<typeof fetch>()
            .mockResolvedValueOnce(Response.json({ success: true }))
            .mockResolvedValueOnce(Response.json({ success: true }));
        const client = new WhatsAppClient(config, fetcher);
        await executeWhatsAppPlatformAction(client, "delete_message_template", {
            name: template.name,
        });
        await executeWhatsAppPlatformAction(client, "delete_message_template_by_id", {
            name: template.name,
            template_id: template.id,
        });
        const byName = new URL(String(fetcher.mock.calls[0]?.[0]));
        const byId = new URL(String(fetcher.mock.calls[1]?.[0]));
        expect(byName.searchParams.get("name")).toBe(template.name);
        expect(byName.searchParams.has("hsm_id")).toBe(false);
        expect(byId.searchParams.get("hsm_id")).toBe(template.id);
    });

    it.each([
        { label: "字符串 fields", action: "list_message_templates", params: { fields: "id" } },
        { label: "未知 fields", action: "list_message_templates", params: { fields: ["quality"] } },
        { label: "非法名称", action: "delete_message_template", params: { name: "Bad-Name" } },
        {
            label: "非法 locale",
            action: "create_message_template",
            params: {
                template: {
                    name: "invalid_locale",
                    language: "english",
                    category: "UTILITY",
                    components: [{ type: "BODY", text: "Hello" }],
                },
            },
        },
        {
            label: "空组件",
            action: "create_message_template",
            params: {
                template: { name: "empty", language: "en_US", category: "UTILITY", components: [] },
            },
        },
        {
            label: "不可序列化组件",
            action: "create_message_template",
            params: {
                template: {
                    name: "invalid",
                    language: "en_US",
                    category: "UTILITY",
                    components: [{ type: "BODY", text: undefined }],
                },
            },
        },
        {
            label: "空更新",
            action: "update_message_template",
            params: { template_id: template.id, template: {} },
        },
        {
            label: "附加顶层字段",
            action: "delete_message_template",
            params: { name: template.name, template_id: template.id },
        },
    ])("拒绝非法模板动作：$label", async ({ action, params }) => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(executeWhatsAppPlatformAction(client, action, params)).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_PARAMETER",
        });
    });

    it("拒绝组件循环引用", async () => {
        const component: Record<string, unknown> = { type: "BODY" };
        component.self = component;
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            executeWhatsAppPlatformAction(client, "create_message_template", {
                template: {
                    name: "cyclic",
                    language: "en_US",
                    category: "UTILITY",
                    components: [component],
                },
            }),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_PARAMETER" });
    });

    it("将畸形响应组件归类为响应错误", async () => {
        const client = new WhatsAppClient(
            config,
            jsonFetcher({ data: [{ id: template.id, components: [{ type: "" }] }] }),
        );
        await expect(
            client.messageTemplates.list({ fields: ["id", "components"] }),
        ).rejects.toMatchObject({
            code: "WHATSAPP_INVALID_RESPONSE",
        });
    });

    it.each([
        { id: template.id, status: "UNKNOWN", category: "UTILITY" },
        { id: template.id, status: "PENDING", category: "ACCOUNT_UPDATE" },
        { id: template.id, status: "PENDING" },
        { success: false },
    ])("拒绝畸形模板响应 %#", async response => {
        const client = new WhatsAppClient(config, jsonFetcher(response));
        if ("success" in response) {
            await expect(
                client.messageTemplates.update(template.id, { category: "UTILITY" }),
            ).rejects.toMatchObject({
                code: "WHATSAPP_INVALID_RESPONSE",
            });
            return;
        }
        await expect(
            client.messageTemplates.create({
                name: "valid",
                language: "en_US",
                category: "UTILITY",
                components: [{ type: "BODY", text: "Hello" }],
            }),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_RESPONSE" });
    });
});

function jsonFetcher(value: unknown): ReturnType<typeof vi.fn<typeof fetch>> {
    return vi.fn<typeof fetch>().mockImplementation(async () => Response.json(value));
}

function requestUrl(fetcher: ReturnType<typeof vi.fn<typeof fetch>>): URL {
    return new URL(String(fetcher.mock.calls[0]?.[0]));
}

function requestJson(fetcher: ReturnType<typeof vi.fn<typeof fetch>>): unknown {
    return JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body));
}
