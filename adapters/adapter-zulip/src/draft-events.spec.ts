import { describe, expect, it } from "vitest";
import { projectZulipEvents } from "./events.js";

const createId = (value: string | number) => ({
    string: String(value),
    source: value,
    number: Number(value) || 1,
});
const context = { botId: createId(1), botUserId: 1, createId };
const draft = {
    id: 17,
    type: "stream" as const,
    to: [7],
    topic: "release",
    content: "Ship it",
    timestamp: 2_000_000_000,
};

describe("Zulip 草稿事件投影", () => {
    it("投影批量创建、更新和删除", () => {
        const created = projectZulipEvents(
            { id: 1, type: "drafts", op: "add", drafts: [draft, { ...draft, id: 18 }] },
            context,
        );
        const updated = projectZulipEvents(
            { id: 2, type: "drafts", op: "update", draft: { ...draft, content: "Updated" } },
            context,
        )[0];
        const removed = projectZulipEvents(
            { id: 3, type: "drafts", op: "remove", draft_id: 17 },
            context,
        )[0];
        expect(created).toHaveLength(2);
        expect(created[0]).toMatchObject({
            notice_type: "draft_created",
            resource: { type: "draft", id: { string: "17" } },
        });
        expect(updated).toMatchObject({
            notice_type: "draft_updated",
            resource: { content: "Updated" },
        });
        expect(removed).toMatchObject({
            notice_type: "draft_removed",
            resource: { id: { string: "17" } },
        });
    });

    it("异常报文退回 custom", () => {
        expect(
            projectZulipEvents({ id: 4, type: "drafts", op: "update", draft: {} }, context)[0],
        ).toMatchObject({ notice_type: "custom" });
    });
});
