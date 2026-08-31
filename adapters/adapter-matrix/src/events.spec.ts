import { describe, expect, it } from "vitest";
import { projectMatrixEvent } from "./events.js";
import type { MatrixEventEnvelope } from "./types.js";

const id = (value: string | number) => ({ string: String(value), source: value, number: 1 });
const context = { botId: id("@bot:hs"), botUserId: "@bot:hs", createId: id };
const envelope = (
    type: string,
    content: Record<string, unknown>,
    extra: Partial<MatrixEventEnvelope["event"]> = {},
): MatrixEventEnvelope => ({
    section: "timeline",
    room_id: "!room:hs",
    event: {
        type,
        content,
        event_id: "$event",
        sender: "@alice:hs",
        origin_server_ts: 1000,
        ...extra,
    },
});

describe("Matrix canonical 事件投影", () => {
    it("投影文本、富文本与线程关系且保留原始事件", () => {
        const [event] = projectMatrixEvent(
            envelope("m.room.message", {
                msgtype: "m.text",
                body: "hello",
                format: "org.matrix.custom.html",
                formatted_body: "<b>hello</b>",
                "m.relates_to": { rel_type: "m.thread", event_id: "$root" },
            }),
            context,
        );
        expect(event).toMatchObject({
            type: "message",
            message_type: "group",
            message_id: { string: "$event" },
            message: [{ type: "text", data: { text: "hello", html: "<b>hello</b>" } }],
            raw_event: { type: "m.room.message" },
            extensions: { matrix: { thread_root: "$root" } },
        });
    });

    it("把 m.replace 投影为 message_updated", () => {
        const [event] = projectMatrixEvent(
            envelope("m.room.message", {
                msgtype: "m.text",
                body: "* edited",
                "m.new_content": { msgtype: "m.text", body: "edited" },
                "m.relates_to": { rel_type: "m.replace", event_id: "$original" },
            }),
            context,
        );
        expect(event).toMatchObject({
            type: "notice",
            notice_type: "message_updated",
            message_id: { string: "$original" },
            message: [{ type: "text", data: { text: "edited" } }],
        });
    });

    it("投影 reaction、redaction、成员变更和机器人邀请", () => {
        expect(
            projectMatrixEvent(
                envelope("m.reaction", {
                    "m.relates_to": { rel_type: "m.annotation", event_id: "$m", key: "👍" },
                }),
                context,
            )[0],
        ).toMatchObject({ notice_type: "reaction_added", message_id: { string: "$m" } });
        expect(
            projectMatrixEvent(
                envelope("m.room.redaction", { reason: "spam" }, { redacts: "$m" }),
                context,
            )[0],
        ).toMatchObject({ notice_type: "message_deleted", message_id: { string: "$m" } });
        expect(
            projectMatrixEvent(
                envelope(
                    "m.room.member",
                    { membership: "join", displayname: "Alice" },
                    { state_key: "@alice:hs" },
                ),
                context,
            )[0],
        ).toMatchObject({ notice_type: "member_joined", user: { name: "Alice" } });
        expect(
            projectMatrixEvent(
                envelope("m.room.member", { membership: "invite" }, { state_key: "@bot:hs" }),
                context,
            )[0],
        ).toMatchObject({ type: "request", request_type: "group", sub_type: "invitation" });
    });

    it("不伪装解密 m.room.encrypted，使用 custom 并保留密文", () => {
        const [event] = projectMatrixEvent(
            envelope("m.room.encrypted", {
                algorithm: "m.megolm.v1.aes-sha2",
                ciphertext: "secret",
            }),
            context,
        );
        expect(event).toMatchObject({
            type: "notice",
            notice_type: "custom",
            sub_type: "m.room.encrypted",
            extensions: { matrix: { encrypted: true } },
            raw_event: { content: { ciphertext: "secret" } },
        });
    });

    it("仅在 Client 提供已观察 reaction 上下文时投影 reaction_removed", () => {
        const redaction = envelope("m.room.redaction", {}, { redacts: "$reaction" });
        redaction.redacted_reaction = { event_id: "$message", key: "👍" };
        expect(projectMatrixEvent(redaction, context)[0]).toMatchObject({
            notice_type: "reaction_removed",
            message_id: { string: "$message" },
            extensions: { matrix: { reaction: "👍", redacted_event_id: "$reaction" } },
        });
    });

    it("按 Client 计算的 typing 增量同时投影开始和停止", () => {
        const typing = envelope("m.typing", { user_ids: ["@bob:hs"] });
        typing.typing_delta = { started: ["@bob:hs"], stopped: ["@alice:hs"] };

        expect(projectMatrixEvent(typing, context)).toMatchObject([
            { notice_type: "typing_started", users: [{ id: { string: "@bob:hs" } }] },
            { notice_type: "typing_stopped", users: [{ id: { string: "@alice:hs" } }] },
        ]);
    });
});
