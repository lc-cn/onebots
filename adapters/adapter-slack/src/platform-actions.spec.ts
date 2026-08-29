import { describe, expect, it, vi } from "vitest";
import { executeSlackPlatformAction } from "./platform-actions.js";

describe("executeSlackPlatformAction", () => {
    it("将结构化频道动作映射到 Slack Web API", async () => {
        const call = vi.fn().mockResolvedValue({ ok: true });
        await executeSlackPlatformAction({ call } as never, "invite_channel_members", {
            channel: "C1",
            users: "U1,U2",
        });
        expect(call).toHaveBeenCalledWith("conversations.invite", {
            channel: "C1",
            users: "U1,U2",
        });
    });

    it("通用入口拒绝非法方法名", async () => {
        await expect(
            executeSlackPlatformAction({ call: vi.fn() } as never, "call_slack_api", {
                method: "../../auth.revoke",
            }),
        ).rejects.toThrow("合法的 Web API 方法名");
    });
});
