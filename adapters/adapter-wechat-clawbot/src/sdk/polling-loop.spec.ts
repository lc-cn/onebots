import { describe, expect, it, vi } from "vitest";
import { IlinkJsonTransport } from "./transport/ilink-json-transport.js";
import { GatewayFault } from "./internal/errors.js";
import { runPollingLoop } from "./polling-loop.js";
import type { CredentialBlob } from "./protocol/chat-event.js";

describe("iLink 长轮询批处理", () => {
    it("仅隔离无法恢复的毒事件，并在其余事件成功后提交游标", async () => {
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
                if (event.message_id === 1) {
                    throw new GatewayFault("INVALID_EVENT", "bad event");
                }
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

    it("业务投递失败时保留游标并在重拉后提交", async () => {
        const transport = new IlinkJsonTransport({ baseUrl: "https://example.test" });
        let current = true;
        let pulls = 0;
        vi.spyOn(transport, "pullUnreadBatch").mockImplementation(async () => {
            pulls += 1;
            if (pulls === 2) current = false;
            return {
                msgs: [{ message_id: 1, message_type: 1, from_user_id: "peer" }],
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
        let attempts = 0;
        const persisted: string[] = [];
        await runPollingLoop({
            transport,
            session,
            options: { retryInitialDelayMs: 1, retryMaxDelayMs: 1 },
            signal: new AbortController().signal,
            isCurrent: () => current,
            ingest: async () => {
                attempts += 1;
                if (attempts === 1) throw new Error("temporary failure");
            },
            persist: async () => {
                persisted.push(session.syncBuffer || "");
            },
            credentialStale: async () => undefined,
            reportError: vi.fn(),
        });

        expect(pulls).toBe(2);
        expect(attempts).toBe(2);
        expect(persisted).toEqual(["next"]);
        expect(session.syncBuffer).toBe("next");
    });

    it("会话持久化失败时回滚内存游标", async () => {
        const transport = new IlinkJsonTransport({ baseUrl: "https://example.test" });
        let current = true;
        vi.spyOn(transport, "pullUnreadBatch").mockImplementation(async () => {
            current = false;
            return { msgs: [], get_updates_buf: "next" };
        });
        const session: CredentialBlob = {
            token: "token",
            accountId: "bot",
            baseUrl: "https://example.test",
            cdnBaseUrl: "https://cdn.example.test",
            syncBuffer: "previous",
        };
        await runPollingLoop({
            transport,
            session,
            options: { retryInitialDelayMs: 1, retryMaxDelayMs: 1 },
            signal: new AbortController().signal,
            isCurrent: () => current,
            ingest: async () => undefined,
            persist: async () => {
                throw new Error("disk full");
            },
            credentialStale: async () => undefined,
            reportError: vi.fn(),
        });

        expect(session.syncBuffer).toBe("previous");
    });
});
