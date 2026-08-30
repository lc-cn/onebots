import { describe, expect, it } from "vitest";
import { ZulipClient } from "./client.js";
import { projectZulipEvents } from "./events.js";
import type { ZulipConfig } from "./types.js";

const createId = (value: string | number) => ({
    string: String(value),
    source: value,
    number: Number(value) || 1,
});
const context = { botId: createId(1), botUserId: 1, createId };
const snippet = {
    id: 17,
    title: "Welcome",
    content: "Hello **team**",
    date_created: 1_681_662_420,
};

describe("Zulip 保存片段事件投影", () => {
    it("Client 监听器保留 add/update/remove 判别联合类型", () => {
        const config: ZulipConfig = {
            account_id: "bot",
            server_url: "https://example.zulipchat.com",
            email: "bot@example.com",
            api_key: "secret",
            receive_mode: "manual",
        };
        const client = new ZulipClient(config, { transport: async () => ({}) });
        client.on("saved_snippets", event => {
            if (event.op === "update") expect(event.saved_snippet.title).toBe("Welcome");
        });
        client.emit("saved_snippets", {
            id: 1,
            type: "saved_snippets",
            op: "update",
            saved_snippet: snippet,
        });
    });

    it("投影保存片段创建、更新和删除", () => {
        const created = projectZulipEvents(
            { id: 2, type: "saved_snippets", op: "add", saved_snippet: snippet },
            context,
        )[0];
        const updated = projectZulipEvents(
            {
                id: 3,
                type: "saved_snippets",
                op: "update",
                saved_snippet: { ...snippet, content: "Updated" },
            },
            context,
        )[0];
        const removed = projectZulipEvents(
            { id: 4, type: "saved_snippets", op: "remove", saved_snippet_id: 17 },
            context,
        )[0];

        expect(created).toMatchObject({
            notice_type: "saved_snippet_created",
            resource: { type: "saved_snippet", id: { string: "17" }, title: "Welcome" },
        });
        expect(updated).toMatchObject({
            notice_type: "saved_snippet_updated",
            resource: { content: "Updated" },
        });
        expect(removed).toMatchObject({
            notice_type: "saved_snippet_removed",
            resource: { id: { string: "17" } },
        });
    });

    it("异常报文退回 custom 且保留原始事件", () => {
        const raw = { id: 5, type: "saved_snippets", op: "update", saved_snippet: {} };
        expect(projectZulipEvents(raw, context)[0]).toMatchObject({
            notice_type: "custom",
            raw_event: raw,
        });
    });
});
