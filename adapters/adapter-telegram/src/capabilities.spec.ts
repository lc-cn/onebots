import { describe, expect, it } from "vitest";
import { listSupportedActions } from "onebots";
import { TelegramAdapter } from "./adapter.js";
import { telegramCapabilities } from "./capabilities.js";
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
});
