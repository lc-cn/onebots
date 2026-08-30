import { describe, expect, it } from "vitest";
import { listSupportedActions } from "onebots";
import { KookAdapter } from "./adapter.js";
import { kookCapabilities } from "./capabilities.js";
import { KOOK_PLATFORM_ACTIONS } from "./platform-actions.js";

describe("KOOK 能力清单", () => {
    it("使用 Guild/Channel 模型，不再重复投影 Group", () => {
        expect(kookCapabilities.actions.get_group_list).toBeUndefined();
        expect(kookCapabilities.actions.get_guild_list?.support).toBe("native");
        expect(KookAdapter.prototype.isActionImplemented("get_group_list")).toBe(false);
        expect(KOOK_PLATFORM_ACTIONS.has("leave_guild")).toBe(true);
        expect(KOOK_PLATFORM_ACTIONS.has("kick_guild_member")).toBe(true);
        expect(KOOK_PLATFORM_ACTIONS.has("set_guild_member_nickname")).toBe(true);
        expect(KOOK_PLATFORM_ACTIONS.has("list_invitees")).toBe(true);
        expect(KOOK_PLATFORM_ACTIONS.has("get_intimacy")).toBe(true);
        expect(KOOK_PLATFORM_ACTIONS.has("list_user_chats")).toBe(true);
        expect(KOOK_PLATFORM_ACTIONS.has("send_friend_request")).toBe(true);
        expect(KOOK_PLATFORM_ACTIONS.has("block_user")).toBe(true);
        expect(kookCapabilities.actions.get_friend_list?.support).toBe("native");
        expect(kookCapabilities.actions.handle_friend_request?.support).toBe("native");
        expect(kookCapabilities.events.group_increase?.support).toBe("native");
        expect(kookCapabilities.events.group_ban?.support).toBe("native");
    });

    it("所有声明动作均有真实入口", () => {
        for (const action of listSupportedActions(kookCapabilities)) {
            expect(KookAdapter.prototype.isActionImplemented(action), action).toBe(true);
        }
    });
});
