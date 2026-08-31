import { describe, expect, it } from "vitest";
import {
    decodeICQQGuildMessageId,
    encodeICQQGuildMessageId,
    requireICQQGuildMessageId,
} from "./guild-message-id.js";

describe("ICQQ 频道消息 ID", () => {
    it("无歧义保存频道路由与撤回 seq", () => {
        const source = {
            guild_id: "guild:一",
            channel_id: "channel/二",
            seq: 12,
            rand: 34,
            time: 56,
        };
        const encoded = encodeICQQGuildMessageId(source);

        expect(encoded).toMatch(/^icqq-guild\./u);
        expect(decodeICQQGuildMessageId(encoded)).toEqual(source);
    });

    it("拒绝普通消息 ID 与损坏编码", () => {
        expect(decodeICQQGuildMessageId("private-message")).toBeUndefined();
        expect(decodeICQQGuildMessageId("icqq-guild.invalid.channel.seq.2.3")).toBeUndefined();
        expect(() => requireICQQGuildMessageId("broken")).toThrow("频道 message_id");
    });
});
