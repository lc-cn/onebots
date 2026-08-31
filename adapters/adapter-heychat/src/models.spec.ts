import { describe, expect, it } from "vitest";
import { flattenHeychatChannels, projectHeychatChannel } from "./models.js";

const createId = (value: string | number) => ({ string: String(value), source: value, number: 1 });

describe("黑盒语音资源模型", () => {
    it("展平嵌套频道并保留房间隔离的父子地址", () => {
        const channels = flattenHeychatChannels([
            {
                channel_id: "parent",
                channel_name: "分组",
                channel_list: [{ channel_id: "child", channel_name: "频道", parent_id: "parent" }],
            },
        ]);

        expect(channels.map(channel => channel.channel_id)).toEqual(["parent", "child"]);
        expect(projectHeychatChannel(createId, "room", channels[1]!)).toMatchObject({
            channel_id: { string: "room:child" },
            parent_id: { string: "room:parent" },
        });
    });
});
