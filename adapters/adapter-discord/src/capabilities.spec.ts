import { describe, expect, it } from "vitest";
import { listSupportedActions } from "onebots";
import { DiscordAdapter } from "./adapter.js";
import { discordCapabilities } from "./capabilities.js";

describe("Discord 能力清单", () => {
    it("区分 Guild 与 Channel，不公开错误的 Group 映射", () => {
        expect(discordCapabilities.actions.get_group_list).toBeUndefined();
        expect(discordCapabilities.actions.get_channel_member_list).toBeUndefined();
        expect(discordCapabilities.actions.get_guild_member_list?.support).toBe("native");
        expect(DiscordAdapter.prototype.isActionImplemented("get_group_list")).toBe(false);
    });

    it("所有声明动作均有真实入口", () => {
        for (const action of listSupportedActions(discordCapabilities)) {
            expect(DiscordAdapter.prototype.isActionImplemented(action), action).toBe(true);
        }
    });
});
