import type { StreamSession } from "@tencent-connect/qqbot-nodejs";
import { describe, expect, it, vi } from "vitest";
import { QQStreamSessions } from "./stream-sessions.js";

describe("QQStreamSessions", () => {
    it("通过 opaque 句柄更新并完成 SDK 流式会话", async () => {
        const update = vi.fn().mockResolvedValue(undefined);
        const complete = vi.fn().mockResolvedValue({ id: "message-1" });
        const cancel = vi.fn();
        const sessions = new QQStreamSessions();
        const streamId = sessions.create({ update, complete, cancel } as unknown as StreamSession);

        await sessions.update(streamId, "完整文本");
        await expect(sessions.complete(streamId)).resolves.toEqual({ id: "message-1" });

        expect(update).toHaveBeenCalledWith("完整文本");
        expect(complete).toHaveBeenCalledOnce();
        expect(cancel).not.toHaveBeenCalled();
        await expect(sessions.update(streamId, "迟到文本")).rejects.toMatchObject({
            code: "QQ_STREAM_NOT_FOUND",
        });
    });

    it("停止客户端时取消并清空全部活跃会话", async () => {
        const first = { cancel: vi.fn() };
        const second = { cancel: vi.fn() };
        const sessions = new QQStreamSessions();
        const firstId = sessions.create(first as unknown as StreamSession);
        const secondId = sessions.create(second as unknown as StreamSession);

        sessions.cancelAll();

        expect(first.cancel).toHaveBeenCalledOnce();
        expect(second.cancel).toHaveBeenCalledOnce();
        await expect(sessions.complete(firstId)).rejects.toMatchObject({
            code: "QQ_STREAM_NOT_FOUND",
        });
        expect(() => sessions.cancel(secondId)).toThrowError(/不存在或已结束/);
    });
});
