import { describe, expect, it } from "vitest";
import { TeamsBot } from "./bot.js";
import { allowedServiceUrlHosts } from "./bot-utils.js";
import { TeamsConversationReferenceError } from "./errors.js";
import type { TeamsConversationReference } from "./types.js";

describe("TeamsBot 会话引用契约", () => {
    it("只接受 HTTPS Connector 地址", () => {
        expect(allowedServiceUrlHosts(["https://connector.example.com/path"])).toEqual([
            "connector.example.com",
        ]);
        expect(() => allowedServiceUrlHosts(["http://connector.example.com"])).toThrow(
            /HTTPS URL/u,
        );
    });

    it("缺少真实引用时明确拒绝主动发送", async () => {
        const bot = createBot();
        await expect(bot.withConversation("unknown", async () => undefined)).rejects.toBeInstanceOf(
            TeamsConversationReferenceError,
        );
    });

    it("允许导入并隔离返回的可信引用", () => {
        const bot = createBot();
        const reference: TeamsConversationReference = {
            conversation: { id: "c1", name: "General", isGroup: true },
            channelId: "msteams",
            serviceUrl: "https://smba.trafficmanager.net/teams/",
            agent: { id: "bot-channel-id", name: "Agent" },
        };
        bot.registerConversationReference(reference);
        const result = bot.getConversationReference("c1");
        expect(result).toEqual(reference);
        if (result) result.conversation.name = "changed";
        expect(bot.getConversationReference("c1")?.conversation.name).toBe("General");
    });

    it("拒绝非 HTTPS 的外部会话引用", () => {
        const bot = createBot();
        expect(() =>
            bot.registerConversationReference({
                conversation: { id: "c1" },
                channelId: "msteams",
                serviceUrl: "http://127.0.0.1/internal",
            }),
        ).toThrow(/HTTPS/u);
    });

    it("初始化时拒绝非 HTTPS 的 Graph 与 Entra 端点", () => {
        expect(() => createBot({ graph_base_url: "http://127.0.0.1/v1.0" })).toThrow(
            /graph_base_url.*HTTPS/u,
        );
        expect(() => createBot({ authority_endpoint: "http://127.0.0.1" })).toThrow(
            /authority_endpoint.*HTTPS/u,
        );
    });
});

function createBot(
    overrides: Partial<ConstructorParameters<typeof TeamsBot>[0]> = {},
): TeamsBot {
    const references = new Map<string, TeamsConversationReference>();
    return new TeamsBot(
        {
            account_id: "test",
            app_id: "00000000-0000-0000-0000-000000000000",
            app_password: "secret",
            tenant_id: "organizations",
            ...overrides,
        },
        {
            get: id => references.get(id),
            list: () => [...references.values()],
            save: reference => references.set(reference.conversation.id, reference),
            saveMessage: () => undefined,
        },
    );
}
