import { describe, expect, it, vi } from "vitest";
import { IlinkJsonTransport } from "./transport/ilink-json-transport.js";
import { runPollingLoop } from "./polling-loop.js";
import type { CredentialBlob } from "./protocol/chat-event.js";

describe("iLink 长轮询批处理", () => {
    it("隔离单条坏事件，并在整批尝试完成后提交游标", async () => {
        const transport = new IlinkJsonTransport({ baseUrl: "https://example.test" });
        let current = true;
        vi.spyOn(transport, "pullUnreadBatch").mockImplementation(async () => {
            current = false;
            return {
                msgs: [
                    { message_id: 1, message_type: 1, from_user_id: "bad" },
                    { message_id: 2, message_type: 1, from_user_id: "good" },
                ],
                get_updates_buf: "next",
            };
        });
        const session: CredentialBlob = {
            token: "token",
            accountId: "bot",
            baseUrl: "https://example.test",
            cdnBaseUrl: "https://cdn.example.test",
            syncBuffer: "previous",
        };
        const order: string[] = [];
        const reportError = vi.fn();
        await runPollingLoop({
            transport,
            session,
            options: {},
            signal: new AbortController().signal,
            isCurrent: () => current,
            ingest: async event => {
                order.push(`event:${event.message_id}`);
                if (event.message_id === 1) throw new Error("bad event");
            },
            persist: async () => {
                order.push(`persist:${session.syncBuffer}`);
            },
            credentialStale: async () => undefined,
            reportError,
        });
        expect(order).toEqual(["event:1", "event:2", "persist:next"]);
        expect(reportError).toHaveBeenCalledOnce();
        expect(session.syncBuffer).toBe("next");
    });
});
