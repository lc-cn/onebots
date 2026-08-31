import { describe, expect, it, vi } from "vitest";
import { SlackAdapter } from "./adapter.js";

const id = (value: string) => ({ string: value, number: 1, source: value });

describe("Slack canonical 频道动作", () => {
    it("按频道实体返回完整分页后的目录", async () => {
        const getChannelList = vi.fn().mockResolvedValue([{ id: "C1", name: "general" }]);
        const adapter = Object.create(SlackAdapter.prototype) as SlackAdapter;
        Object.defineProperties(adapter, {
            getAccount: { value: () => ({ client: { getChannelList } }) },
            createId: { value: id },
        });

        await expect(adapter.getChannelList("bot")).resolves.toEqual([
            { channel_id: id("C1"), channel_name: "general" },
        ]);
    });

    it("通过标准频道动作重命名、归档和邀请成员", async () => {
        const call = vi.fn().mockResolvedValue({ ok: true });
        const adapter = Object.create(SlackAdapter.prototype) as SlackAdapter;
        Object.defineProperty(adapter, "getAccount", { value: () => ({ client: { call } }) });

        await adapter.updateChannel("bot", {
            channel_id: id("C1"),
            channel_name: "product",
        });
        await adapter.deleteChannel("bot", { channel_id: id("C1") });
        await adapter.inviteChannelMember("bot", {
            channel_id: id("C1"),
            user_id: id("U1"),
        });

        expect(call).toHaveBeenNthCalledWith(1, "conversations.rename", {
            channel: "C1",
            name: "product",
        });
        expect(call).toHaveBeenNthCalledWith(2, "conversations.archive", { channel: "C1" });
        expect(call).toHaveBeenNthCalledWith(3, "conversations.invite", {
            channel: "C1",
            users: "U1",
        });
    });
});
