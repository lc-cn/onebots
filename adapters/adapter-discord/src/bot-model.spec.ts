import { describe, expect, it } from "vitest";
import { wrapDiscordMember } from "./bot-model.js";
import type { DiscordApiGuildMember } from "./types.js";

describe("wrapDiscordMember", () => {
    it("在客户端边界拒绝缺少 user 的成员负载", () => {
        const member: DiscordApiGuildMember = {
            deaf: false,
            mute: false,
            roles: [],
            joined_at: "2026-01-01T00:00:00.000Z",
        };

        expect(() => wrapDiscordMember(member)).toThrow("Discord 成员负载缺少 user");
    });

    it("返回 user 已闭合的成员模型", () => {
        const member = wrapDiscordMember({
            deaf: false,
            mute: false,
            roles: [],
            joined_at: "2026-01-01T00:00:00.000Z",
            user: { id: "1", username: "alice", discriminator: "0", avatar: null },
        });

        expect(member.user.id).toBe("1");
        expect(member.user.tag).toBe("alice#0");
    });
});
