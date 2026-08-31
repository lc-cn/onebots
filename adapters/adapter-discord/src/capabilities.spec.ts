import { describe, expect, it } from "vitest";
import { listSupportedActions } from "onebots";
import { DiscordAdapter } from "./adapter.js";
import { describeDiscordCapabilities, discordCapabilities } from "./capabilities.js";
import { DISCORD_PLATFORM_ACTIONS } from "./platform-actions.js";

describe("Discord 能力清单", () => {
    it("区分 Guild 与 Channel，不公开错误的 Group 映射", () => {
        expect(discordCapabilities.actions.get_group_list).toBeUndefined();
        expect(discordCapabilities.actions.get_channel_member_list).toBeUndefined();
        expect(discordCapabilities.actions.get_guild_member_list?.support).toBe("native");
        expect(DiscordAdapter.prototype.isActionImplemented("get_group_list")).toBe(false);
    });

    it("所有声明动作均有真实入口", () => {
        for (const action of DISCORD_PLATFORM_ACTIONS) {
            expect(discordCapabilities.actions[action]?.support, action).toBe("native");
        }
        for (const action of listSupportedActions(discordCapabilities)) {
            expect(DiscordAdapter.prototype.isActionImplemented(action), action).toBe(true);
        }
    });

    it("保留平台动作的权限与上下文约束", () => {
        expect(discordCapabilities.actions.call_discord_api?.availability).toBe("context");
        expect(discordCapabilities.actions.ban_member?.permissions).toEqual(["BAN_MEMBERS"]);
        expect(discordCapabilities.actions.create_thread?.permissions).toEqual(["MANAGE_THREADS"]);
        expect(discordCapabilities.actions.create_auto_moderation_rule?.permissions).toEqual([
            "MANAGE_GUILD",
        ]);
        expect(discordCapabilities.actions.create_scheduled_event?.availability).toBe("permission");
        expect(discordCapabilities.actions.create_guild_emoji?.availability).toBe("permission");
        expect(discordCapabilities.actions.list_scheduled_events?.availability).toBeUndefined();
        expect(discordCapabilities.actions.search_guild_messages?.permissions).toEqual([
            "READ_MESSAGE_HISTORY",
            "MESSAGE_CONTENT intent",
        ]);
        expect(discordCapabilities.actions.set_voice_channel_status?.permissions).toContain(
            "SET_VOICE_CHANNEL_STATUS",
        );
        expect(discordCapabilities.actions.create_guild_soundboard_sound?.permissions).toEqual([
            "CREATE_GUILD_EXPRESSIONS / MANAGE_GUILD_EXPRESSIONS",
        ]);
    });

    it("按 Gateway intents 收窄消息、成员与 Reaction 场景", () => {
        const capabilities = describeDiscordCapabilities({
            intents: ["GuildMessages", "GuildMessagePolls"],
        });

        expect(capabilities.events.message).toMatchObject({
            support: "native",
            scenes: ["channel"],
            permissions: ["DirectMessages"],
        });
        expect(capabilities.events.member_joined).toMatchObject({
            support: "unsupported",
            permissions: ["GuildMembers"],
        });
        expect(capabilities.events.reaction_added).toMatchObject({
            support: "native",
            scenes: ["channel"],
        });
        expect(capabilities.events.reaction_added?.permissions).toEqual([
            "DirectMessageReactions",
            "DirectMessagePolls",
            "GuildMessageReactions",
        ]);
    });

    it("缺少 MessageContent 时展示 Guild 消息内容限制", () => {
        const capabilities = describeDiscordCapabilities({ intents: ["GuildMessages"] });

        expect(capabilities.events.message?.support).toBe("native");
        expect(capabilities.segments.text).toMatchObject({
            support: "native",
            direction: "both",
            availability: "permission",
            permissions: ["MessageContent"],
        });
        expect(capabilities.segments.embed?.note).toContain("Guild 消息");
    });

    it("区分 Gateway、Interactions 与 Webhook Events 的事件入口", () => {
        const interactions = describeDiscordCapabilities({ receive_mode: "interactions" });
        const webhookEvents = describeDiscordCapabilities({ receive_mode: "webhook_events" });

        expect(interactions.events.interaction?.support).toBe("native");
        expect(interactions.events.message?.support).toBe("unsupported");
        expect(interactions.events.native_dispatch?.support).toBe("unsupported");
        expect(webhookEvents.events.interaction?.support).toBe("unsupported");
        expect(webhookEvents.events.native_dispatch?.support).toBe("native");
    });

    it("适配器按目标账号配置返回动态清单", () => {
        const adapter = {
            getAccount: (accountId: string) =>
                accountId === "interactions"
                    ? { config: { account_id: accountId, receive_mode: "interactions" } }
                    : undefined,
        } as unknown as DiscordAdapter;

        expect(
            DiscordAdapter.prototype.describeCapabilities.call(adapter, "interactions").events
                .message?.support,
        ).toBe("unsupported");
        expect(DiscordAdapter.prototype.describeCapabilities.call(adapter, "missing")).toBe(
            discordCapabilities,
        );
    });
});
