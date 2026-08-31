import { describe, expect, it } from "vitest";
import { listSupportedActions } from "onebots";
import { TelegramAdapter } from "./adapter.js";
import { describeTelegramCapabilities, telegramCapabilities } from "./capabilities.js";
import { TELEGRAM_PLATFORM_ACTIONS } from "./platform-actions.js";

describe("Telegram 能力清单", () => {
    it("不把管理员列表伪装成完整成员目录", () => {
        expect(telegramCapabilities.actions.get_group_member_list).toBeUndefined();
        expect(telegramCapabilities.events.group_increase?.support).toBe("native");
        expect(telegramCapabilities.events.group_decrease?.support).toBe("native");
        expect(TelegramAdapter.prototype.isActionImplemented("get_group_member_list")).toBe(false);
        expect(TELEGRAM_PLATFORM_ACTIONS.has("get_chat_administrators")).toBe(true);
        expect(TELEGRAM_PLATFORM_ACTIONS.has("get_chat_member_count")).toBe(true);
        expect(telegramCapabilities.actions.create_forum_topic?.support).toBe("native");
        expect(telegramCapabilities.actions.answer_callback_query?.support).toBe("native");
        expect(telegramCapabilities.actions.send_rich_message?.support).toBe("native");
        expect(telegramCapabilities.segments.telegram_rich_message?.direction).toBe("both");
        expect(telegramCapabilities.actions.send_live_photo?.support).toBe("native");
        expect(telegramCapabilities.actions.delete_message_reaction?.permissions).toEqual([
            "can_delete_messages",
        ]);
        expect(telegramCapabilities.segments.telegram_live_photo?.direction).toBe("receive");
    });

    it("所有声明动作均有真实入口", () => {
        for (const action of listSupportedActions(telegramCapabilities)) {
            expect(TelegramAdapter.prototype.isActionImplemented(action), action).toBe(true);
        }
    });

    it("按 polling allowed_updates 展示真实可达事件", () => {
        const capabilities = describeTelegramCapabilities({
            receive_mode: "polling",
            polling: { allowed_updates: ["message", "chat_join_request"] },
        });

        expect(capabilities.events.message?.support).toBe("native");
        expect(capabilities.events.member_joined?.support).toBe("native");
        expect(capabilities.events.group_request?.support).toBe("native");
        expect(capabilities.events.interaction).toMatchObject({
            support: "unsupported",
            availability: "context",
        });
        expect(capabilities.events.interaction?.note).toContain("polling.allowed_updates");
        expect(capabilities.events.reaction_added?.support).toBe("unsupported");
    });

    it("空白名单使用完整集合，manual 不推断外部订阅", () => {
        expect(
            describeTelegramCapabilities({
                receive_mode: "webhook",
                webhook: { allowed_updates: [] },
            }),
        ).toBe(telegramCapabilities);
        expect(
            describeTelegramCapabilities({
                receive_mode: "manual",
                polling: { allowed_updates: ["message"] },
            }),
        ).toBe(telegramCapabilities);
    });

    it("适配器按账号配置返回动态清单", () => {
        const adapter = {
            getAccount: (accountId: string) =>
                accountId === "messages"
                    ? {
                          config: {
                              account_id: accountId,
                              receive_mode: "polling",
                              polling: { allowed_updates: ["message"] },
                          },
                      }
                    : undefined,
        } as unknown as TelegramAdapter;

        expect(
            TelegramAdapter.prototype.describeCapabilities.call(adapter, "messages").events.message
                ?.support,
        ).toBe("native");
        expect(
            TelegramAdapter.prototype.describeCapabilities.call(adapter, "messages").events
                .interaction?.support,
        ).toBe("unsupported");
        expect(TelegramAdapter.prototype.describeCapabilities.call(adapter, "missing")).toBe(
            telegramCapabilities,
        );
    });
});
