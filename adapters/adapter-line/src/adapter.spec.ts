import { randomUUID } from "node:crypto";
import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountStatus, SqliteDB } from "onebots";
import { describe, expect, it, vi } from "vitest";
import { LineAdapter } from "./adapter.js";

describe("LINE 标准消息动作", () => {
    it("账号启动取消后忽略迟到的身份响应", async () => {
        const file = join(tmpdir(), `onebots-line-adapter-${randomUUID()}.db`);
        const db = new SqliteDB(file);
        try {
            const adapter = createAdapter(db);
            const account = adapter.createAccount({
                account_id: "bot",
                channel_access_token: "token",
                receive_mode: "manual",
            });
            let resolveInfo:
                | ((value: { userId: string; displayName: string; pictureUrl: string }) => void)
                | undefined;
            const getBotInfo = vi.spyOn(account.client, "getBotInfo").mockImplementation(
                () =>
                    new Promise(resolve => {
                        resolveInfo = resolve;
                    }),
            );
            const start = account.rawListeners("start")[0] as (
                signal: AbortSignal,
            ) => Promise<void>;
            const controller = new AbortController();

            const starting = start(controller.signal);
            await vi.waitFor(() => expect(getBotInfo).toHaveBeenCalledOnce());
            controller.abort();
            resolveInfo?.({ userId: "U1", displayName: "Late Bot", pictureUrl: "avatar" });
            await starting;

            expect(account.status).toBe(AccountStatus.Pending);
            expect(account.nickname).toBeUndefined();
        } finally {
            db.close();
            rmSync(file, { force: true });
        }
    });

    it("按持久化 token 回复并标记指定消息已读", async () => {
        const file = join(tmpdir(), `onebots-line-adapter-${randomUUID()}.db`);
        const db = new SqliteDB(file);
        try {
            const adapter = createAdapter(db);
            const account = adapter.createAccount({
                account_id: "bot",
                channel_access_token: "token",
                receive_mode: "manual",
            });
            adapter.accounts.set("bot", account);
            const pushMessage = vi
                .spyOn(account.client, "pushMessage")
                .mockResolvedValue({ sentMessages: [{ id: "sent-1" }] });
            const markMessagesAsReadByToken = vi
                .spyOn(account.client.getClient(), "markMessagesAsReadByToken")
                .mockResolvedValue({});
            await account.client.ingest({
                destination: "U00000000000000000000000000000000",
                events: [
                    {
                        type: "message",
                        timestamp: 1,
                        mode: "active",
                        webhookEventId: "event-1",
                        deliveryContext: { isRedelivery: false },
                        source: { type: "user", userId: "U1" },
                        replyToken: "reply",
                        message: {
                            id: "M1",
                            type: "text",
                            text: "hello",
                            quoteToken: "quote",
                            markAsReadToken: "read",
                        },
                    },
                ],
            });

            await expect(
                adapter.sendMessage("bot", {
                    scene_type: "private",
                    scene_id: lineId("U1"),
                    message: [
                        { type: "reply", data: { message_id: lineId("M1") } },
                        { type: "text", data: { text: "reply" } },
                    ],
                }),
            ).resolves.toMatchObject({ message_id: { string: "sent-1" } });
            await adapter.markMessageAsRead("bot", {
                scene_type: "private",
                scene_id: lineId("U1"),
                message_id: lineId("M1"),
            });

            expect(pushMessage).toHaveBeenCalledWith(
                "U1",
                [{ type: "text", text: "reply", quoteToken: "quote" }],
                { retryKey: expect.any(String) },
            );
            expect(markMessagesAsReadByToken).toHaveBeenCalledWith({ markAsReadToken: "read" });
        } finally {
            db.close();
            rmSync(file, { force: true });
        }
    });
});

function createAdapter(db: SqliteDB): LineAdapter {
    return new LineAdapter({
        db,
        config: { general: {}, timeout: 30 },
        getLogger: () => ({
            debug: vi.fn(),
            info: vi.fn(),
            warn: vi.fn(),
            error: vi.fn(),
        }),
    } as never);
}

function lineId(value: string) {
    return { string: value, source: value, number: Number(value) };
}
