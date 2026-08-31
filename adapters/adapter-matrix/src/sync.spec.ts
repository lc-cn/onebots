import { describe, expect, it } from "vitest";
import { parseMatrixSync } from "./sync.js";

describe("Matrix /sync 展开", () => {
    it("完整保留 account_data、presence、to_device、join、invite 与 leave 区", () => {
        const message = {
            type: "m.room.message",
            content: { msgtype: "m.text", body: "hi" },
            event_id: "$m",
        };
        const batch = parseMatrixSync(
            {
                next_batch: "s1",
                account_data: {
                    events: [{ type: "m.direct", content: { "@a:hs": ["!direct:hs"] } }],
                },
                presence: {
                    events: [
                        { type: "m.presence", sender: "@a:hs", content: { presence: "online" } },
                    ],
                },
                to_device: { events: [{ type: "m.room_key", content: {} }] },
                rooms: {
                    join: {
                        "!direct:hs": {
                            state: {
                                events: [
                                    { type: "m.room.name", state_key: "", content: { name: "DM" } },
                                ],
                            },
                            timeline: { events: [message] },
                            ephemeral: {
                                events: [{ type: "m.typing", content: { user_ids: ["@a:hs"] } }],
                            },
                            account_data: { events: [{ type: "m.tag", content: {} }] },
                        },
                    },
                    invite: {
                        "!invite:hs": {
                            invite_state: {
                                events: [
                                    {
                                        type: "m.room.member",
                                        state_key: "@bot:hs",
                                        content: { membership: "invite" },
                                    },
                                ],
                            },
                        },
                    },
                    leave: {
                        "!left:hs": {
                            timeline: {
                                events: [
                                    { type: "m.room.member", content: { membership: "leave" } },
                                ],
                            },
                        },
                    },
                },
            },
            new Set(),
        );
        expect(batch.nextBatch).toBe("s1");
        expect(batch.directRooms).toContain("!direct:hs");
        expect(batch.envelopes.map(item => item.section)).toEqual([
            "account_data",
            "presence",
            "to_device",
            "state",
            "timeline",
            "ephemeral",
            "account_data",
            "invite_state",
            "leave",
        ]);
        expect(batch.envelopes.find(item => item.event.event_id === "$m")?.is_direct).toBe(true);
    });

    it("拒绝缺少 next_batch 或畸形事件", () => {
        expect(() => parseMatrixSync({}, new Set())).toThrow(/next_batch/u);
        expect(() =>
            parseMatrixSync(
                { next_batch: "s", presence: { events: [{ type: "m.presence" }] } },
                new Set(),
            ),
        ).toThrow(/content/u);
        expect(() => parseMatrixSync({ next_batch: "s", rooms: { join: [] } }, new Set())).toThrow(
            /rooms\.join/u,
        );
        expect(() =>
            parseMatrixSync({ next_batch: "s", account_data: { events: {} } }, new Set()),
        ).toThrow(/events 数组/u);
    });

    it("把 m.direct 当作完整快照，移除已解除的 Direct Room", () => {
        const batch = parseMatrixSync(
            {
                next_batch: "s2",
                account_data: {
                    events: [{ type: "m.direct", content: { "@new:hs": ["!new:hs"] } }],
                },
            },
            new Set(["!old:hs"]),
        );

        expect([...batch.directRooms]).toEqual(["!new:hs"]);
    });
});
