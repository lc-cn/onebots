import { describe, expect, it, vi } from "vitest";
import { executeEmailMailboxNativeCommand } from "./mailbox-native.js";

describe("Email IMAP 原生命令", () => {
    it("将 STATUS bigint 转成可序列化字符串", async () => {
        const status = vi.fn().mockResolvedValue({
            path: "INBOX",
            messages: 12,
            uidValidity: 123n,
            highestModseq: 456n,
        });
        await expect(
            executeEmailMailboxNativeCommand({ status } as never, {
                type: "status",
                path: "INBOX",
                query: { messages: true, uidValidity: true, highestModseq: true },
            }),
        ).resolves.toEqual({
            path: "INBOX",
            messages: 12,
            uidValidity: "123",
            highestModseq: "456",
        });
    });

    it("将 APPEND 结果转成可序列化结构", async () => {
        const append = vi.fn().mockResolvedValue({
            destination: "Sent",
            uidValidity: 789n,
            uid: 10,
        });
        await expect(
            executeEmailMailboxNativeCommand({ append } as never, {
                type: "append",
                path: "Sent",
                content: Buffer.from("Subject: test\r\n\r\nbody"),
            }),
        ).resolves.toEqual({ destination: "Sent", uidValidity: "789", uid: 10 });
    });

    it("NOOP 返回明确成功响应", async () => {
        const noop = vi.fn().mockResolvedValue(undefined);
        await expect(
            executeEmailMailboxNativeCommand({ noop } as never, { type: "noop" }),
        ).resolves.toEqual({ ok: true });
    });
});
