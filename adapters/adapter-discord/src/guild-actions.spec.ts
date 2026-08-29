import { describe, expect, it, vi } from "vitest";
import { DiscordGuildActions } from "./guild-actions.js";

function createActions(bot: object): DiscordGuildActions {
    const actions = Object.create(DiscordGuildActions.prototype) as DiscordGuildActions;
    Object.defineProperties(actions, {
        getAccount: { value: () => ({ client: bot }) },
        coerceId: { value: (value: { string: string }) => value },
    });
    return actions;
}

const id = (value: string) => ({ string: value, number: Number(value), source: value });

describe("Discord 群动作", () => {
    it("添加和删除 Unicode emoji 回应", async () => {
        const addReaction = vi.fn().mockResolvedValue(undefined);
        const removeReaction = vi.fn().mockResolvedValue(undefined);
        const actions = createActions({ addReaction, removeReaction });

        await actions.sendGroupMessageReaction("bot", {
            group_id: id("20001"),
            message_id: id("9001"),
            reaction: "👍",
            reaction_type: "emoji",
            is_add: true,
        });
        await actions.sendGroupMessageReaction("bot", {
            group_id: id("20001"),
            message_id: id("9001"),
            reaction: "👍",
            reaction_type: "emoji",
            is_add: false,
        });

        expect(addReaction).toHaveBeenCalledWith("20001", "9001", "👍");
        expect(removeReaction).toHaveBeenCalledWith("20001", "9001", "👍");
    });

    it("拒绝把 QQ face ID 伪装成 Discord emoji", async () => {
        const addReaction = vi.fn();
        const actions = createActions({ addReaction, removeReaction: vi.fn() });

        await expect(
            actions.sendGroupMessageReaction("bot", {
                group_id: id("20001"),
                message_id: id("9001"),
                reaction: "14",
                reaction_type: "face",
                is_add: true,
            }),
        ).rejects.toThrow("只支持 emoji");
        expect(addReaction).not.toHaveBeenCalled();
    });
});
