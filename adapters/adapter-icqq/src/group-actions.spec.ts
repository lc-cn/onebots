import type { Client } from "@icqqjs/icqq";
import { describe, expect, it, vi } from "vitest";
import { ICQQGroupActions } from "./group-actions.js";

const id = (value: string | number) => ({
    string: String(value),
    source: value,
    number: Number(value) || 0,
});

function createActions(client: Client): ICQQGroupActions {
    const actions = Object.create(ICQQGroupActions.prototype) as ICQQGroupActions;
    Object.defineProperties(actions, {
        requireNativeClient: { value: () => client },
        numericId: { value: (value: string) => Number(value) },
    });
    return actions;
}

describe("ICQQ 群动作", () => {
    it("按表态类型添加和删除群消息回应", async () => {
        const setReaction = vi.fn().mockResolvedValue({});
        const delReaction = vi.fn().mockResolvedValue({});
        const client = {
            getMsg: vi.fn().mockResolvedValue({
                message_type: "group",
                group_id: 20001,
                seq: 9001,
            }),
            pickGroup: vi.fn(() => ({ setReaction, delReaction })),
        } as unknown as Client;
        const actions = createActions(client);

        await actions.sendGroupMessageReaction("bot", {
            group_id: id(20001),
            message_id: id("message-id"),
            reaction: "14",
            reaction_type: "face",
            is_add: true,
        });
        await actions.sendGroupMessageReaction("bot", {
            group_id: id(20001),
            message_id: id("message-id"),
            reaction: "128077",
            reaction_type: "emoji",
            is_add: false,
        });

        expect(setReaction).toHaveBeenCalledWith(9001, "14", 1);
        expect(delReaction).toHaveBeenCalledWith(9001, "128077", 2);
    });
});
