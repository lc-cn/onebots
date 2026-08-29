import { describe, expect, it } from "vitest";
import { listSupportedActions } from "onebots";
import { TelegramAdapter } from "./adapter.js";
import { telegramCapabilities } from "./capabilities.js";
import { TELEGRAM_PLATFORM_ACTIONS } from "./platform-actions.js";

describe("Telegram 能力清单", () => {
    it("不把管理员列表伪装成完整成员目录", () => {
        expect(telegramCapabilities.actions.get_group_member_list).toBeUndefined();
        expect(TelegramAdapter.prototype.isActionImplemented("get_group_member_list")).toBe(false);
        expect(TELEGRAM_PLATFORM_ACTIONS.has("get_chat_administrators")).toBe(true);
        expect(TELEGRAM_PLATFORM_ACTIONS.has("get_chat_member_count")).toBe(true);
    });

    it("所有声明动作均有真实入口", () => {
        for (const action of listSupportedActions(telegramCapabilities)) {
            expect(TelegramAdapter.prototype.isActionImplemented(action), action).toBe(true);
        }
    });
});
