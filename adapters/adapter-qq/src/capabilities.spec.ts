import { listSupportedActions } from "onebots";
import { describe, expect, it } from "vitest";
import { QQAdapter } from "./adapter.js";
import { describeQQCapabilities, qqCapabilities } from "./capabilities.js";
import { QQ_PLATFORM_ACTIONS } from "./platform-actions.js";

describe("QQ 能力清单", () => {
    it("所有平台动作均显式公开", () => {
        for (const action of QQ_PLATFORM_ACTIONS) {
            expect(qqCapabilities.actions[action]?.support, action).toBe("native");
        }
        expect(qqCapabilities.actions.send_typing?.scenes).toEqual(["private"]);
        expect(qqCapabilities.actions.mute_guild?.permissions).toEqual(["guild.manage"]);
        expect(qqCapabilities.actions.publish_bot_panel?.permissions).toEqual(["bot.ui.manage"]);
        expect(qqCapabilities.actions.start_c2c_stream).toMatchObject({
            scenes: ["private"],
            availability: "permission",
            permissions: ["c2c.stream_messages"],
        });
    });

    it("能力清单中的动作都有真实入口", () => {
        for (const action of listSupportedActions(qqCapabilities)) {
            expect(QQAdapter.prototype.isActionImplemented(action), action).toBe(true);
        }
    });

    it("只声明共享 Webhook 与正向 Gateway", () => {
        expect(qqCapabilities.transports.gateway?.mode).toBe("websocket");
        expect(qqCapabilities.transports.webhook?.mode).toBe("webhook");
    });

    it("按账号显式配置的 Gateway intents 收窄事件场景", () => {
        const capabilities = describeQQCapabilities({
            intents: ["GROUP_AND_C2C_EVENT", "GUILD_MEMBERS", "INTERACTION"],
        });

        expect(capabilities.events.message).toMatchObject({
            support: "native",
            scenes: ["private", "group"],
            availability: "permission",
            permissions: ["DIRECT_MESSAGE", "GUILD_MESSAGES", "PUBLIC_GUILD_MESSAGES"],
        });
        expect(capabilities.events.member_joined).toMatchObject({
            support: "native",
            scenes: ["channel"],
        });
        expect(capabilities.events.interaction?.support).toBe("native");
        expect(capabilities.events.reaction_added).toMatchObject({
            support: "unsupported",
            permissions: ["GUILD_MESSAGE_REACTIONS"],
        });
    });

    it("没有消息 intent 时明确标记账号无法接收消息", () => {
        const capabilities = describeQQCapabilities({ intents: ["INTERACTION"] });

        expect(capabilities.events.message).toMatchObject({
            support: "unsupported",
            availability: "permission",
        });
        expect(capabilities.events.message?.permissions).toContain("GROUP_AND_C2C_EVENT");
    });

    it("按 SDK 默认位图展示留空配置的实际事件范围", () => {
        const capabilities = describeQQCapabilities({});

        expect(capabilities.events.message).toStrictEqual(qqCapabilities.events.message);
        expect(capabilities.events.member_joined).toMatchObject({
            support: "native",
            scenes: ["channel"],
            permissions: ["GROUP_MEMBER"],
        });
        expect(capabilities.events.reaction_added).toMatchObject({
            support: "unsupported",
            permissions: ["GUILD_MESSAGE_REACTIONS"],
        });
    });

    it("非 Gateway 接收模式不使用本地 intents 推断回调范围", () => {
        expect(
            describeQQCapabilities({
                receive_mode: "webhook",
                intents: ["INTERACTION"],
            }),
        ).toBe(qqCapabilities);
    });

    it("适配器按目标账号配置返回动态清单", () => {
        const adapter = {
            getAccount: (accountId: string) =>
                accountId === "limited"
                    ? { config: { account_id: accountId, intents: ["INTERACTION"] } }
                    : undefined,
        } as unknown as QQAdapter;

        expect(
            QQAdapter.prototype.describeCapabilities.call(adapter, "limited").events.message
                ?.support,
        ).toBe("unsupported");
        expect(QQAdapter.prototype.describeCapabilities.call(adapter, "missing")).toBe(
            qqCapabilities,
        );
    });
});
