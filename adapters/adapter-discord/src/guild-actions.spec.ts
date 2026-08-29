import { describe, expect, it, vi } from "vitest";
import { DiscordActionAdapter } from "./channel-actions.js";

const id = (value: string) => ({ string: value, number: Number(value), source: value });

describe("Discord canonical Guild 动作", () => {
    it("以 Guild 成员实体返回目录，不再伪装群或频道成员", async () => {
        const getGuildMembers = vi.fn().mockResolvedValue(
            new Map([
                [
                    "42",
                    {
                        user: { id: "42", username: "Alice" },
                        nick: "管理员",
                        roles: ["everyone", "member", "admin"],
                    },
                ],
            ]),
        );
        const adapter = Object.create(DiscordActionAdapter.prototype) as DiscordActionAdapter;
        Object.defineProperties(adapter, {
            getAccount: { value: () => ({ client: { getGuildMembers } }) },
            createId: { value: id },
        });

        await expect(adapter.getGuildMemberList("bot", { guild_id: id("100") })).resolves.toEqual([
            {
                guild_id: id("100"),
                user_id: id("42"),
                user_name: "Alice",
                nickname: "管理员",
                role: "admin",
            },
        ]);
    });
});
