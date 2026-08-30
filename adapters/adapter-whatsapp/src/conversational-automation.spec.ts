import { describe, expect, it, vi } from "vitest";
import { WhatsAppClient } from "./client.js";
import { executeWhatsAppPlatformAction } from "./platform-actions.js";
import type { WhatsAppConfig } from "./types.js";

const config: WhatsAppConfig = {
    account_id: "bot",
    business_account_id: "waba",
    phone_number_id: "123456",
    access_token: "token",
    api_version: "v23.0",
    receive_mode: "manual",
};

describe("WhatsAppConversationalAutomation", () => {
    it("配置欢迎消息、引导问题和唯一命令", async () => {
        const fetcher = jsonFetcher({ success: true });
        const client = new WhatsAppClient(config, fetcher);
        const settings = {
            enable_welcome_message: true,
            prompts: ["How can I help?", "Track an order"],
            commands: [
                { command_name: "help", command_description: "Get help" },
                { command_name: "order_status", command_description: "Track an order" },
            ],
        };
        await expect(client.automation.configure(settings)).resolves.toEqual({ success: true });
        expect(requestUrl(fetcher).pathname).toBe("/v23.0/123456/conversational_automation");
        expect(requestJson(fetcher)).toEqual(settings);
    });

    it("按受控字段读取独立 WABA Bot 配置", async () => {
        const fetcher = jsonFetcher({
            id: "987654",
            prompts: ["Welcome"],
            commands: [{ command_name: "help", command_description: "Get help" }],
            enable_welcome_message: true,
        });
        const client = new WhatsAppClient(config, fetcher);
        await expect(
            executeWhatsAppPlatformAction(client, "get_business_bot", {
                bot_id: "987654",
                fields: ["commands", "prompts", "enable_welcome_message", "commands"],
            }),
        ).resolves.toEqual({
            id: "987654",
            prompts: ["Welcome"],
            commands: [{ command_name: "help", command_description: "Get help" }],
            enable_welcome_message: true,
        });
        expect(requestUrl(fetcher).searchParams.get("fields")).toBe(
            "commands,prompts,enable_welcome_message",
        );
    });

    it("允许用空数组显式清空引导和命令", async () => {
        const fetcher = jsonFetcher({ success: true });
        const client = new WhatsAppClient(config, fetcher);
        await expect(
            executeWhatsAppPlatformAction(client, "configure_conversational_automation", {
                settings: { enable_welcome_message: false, prompts: [], commands: [] },
            }),
        ).resolves.toEqual({ success: true });
        expect(requestJson(fetcher)).toEqual({
            enable_welcome_message: false,
            prompts: [],
            commands: [],
        });
    });

    it.each([
        ["空设置", { settings: {} }],
        ["过多引导", { settings: { prompts: ["1", "2", "3", "4"] } }],
        ["超长引导", { settings: { prompts: ["x".repeat(81)] } }],
        [
            "重复命令",
            {
                settings: {
                    commands: [
                        { command_name: "help", command_description: "A" },
                        { command_name: "help", command_description: "B" },
                    ],
                },
            },
        ],
        [
            "非法命令名",
            { settings: { commands: [{ command_name: "/help", command_description: "A" }] } },
        ],
        ["未知设置", { settings: { prompts: [], locale: "en_US" } }],
    ])("拒绝%s", async (_label, params) => {
        const client = new WhatsAppClient(config, vi.fn<typeof fetch>());
        await expect(
            executeWhatsAppPlatformAction(client, "configure_conversational_automation", params),
        ).rejects.toMatchObject({ code: "WHATSAPP_INVALID_PARAMETER" });
    });

    it.each([
        { success: false },
        { id: "bot", prompts: [], commands: [], enable_welcome_message: true },
        { id: "123", prompts: ["x".repeat(81)], commands: [], enable_welcome_message: true },
        {
            id: "123",
            prompts: [],
            commands: [{ command_name: "bad-name", command_description: "Description" }],
            enable_welcome_message: true,
        },
    ])("拒绝畸形响应 %#", async response => {
        const client = new WhatsAppClient(config, jsonFetcher(response));
        const operation =
            "success" in response
                ? client.automation.configure({ prompts: [] })
                : client.automation.getBot("123");
        await expect(operation).rejects.toMatchObject({ code: "WHATSAPP_INVALID_RESPONSE" });
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
