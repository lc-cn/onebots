import { EventEmitter } from "node:events";
import type WebSocket from "ws";
import { describe, expect, it, vi } from "vitest";
import { HeychatBot } from "./bot.js";

function envelope(sequence: number) {
    return { sequence, type: "50", timestamp: 1_700_000_000, data: {} };
}

class HostSocket extends EventEmitter {
    close = vi.fn();
}

describe("HeychatBot manual ingress", () => {
    it("不创建正向连接，并让 raw 与已升级 socket 共用同一去重管线", async () => {
        const bot = new HeychatBot({
            account_id: "bot",
            token: "token",
            receive_mode: "manual",
        });
        const ready = vi.fn();
        const events = vi.fn();
        const errors = vi.fn();
        bot.on("ready", ready);
        bot.on("event", events);
        bot.on("error", errors);

        await bot.start();
        expect(bot.isConnected()).toBe(true);
        expect(ready).toHaveBeenCalledOnce();
        expect((await bot.ingest(envelope(8))).duplicate).toBe(false);
        expect((await bot.ingest(envelope(8))).duplicate).toBe(true);

        const socket = new HostSocket();
        const detach = bot.acceptWebSocket(socket as unknown as WebSocket);
        socket.emit("message", Buffer.from("pong"));
        socket.emit("message", Buffer.from("{"));
        expect(socket.close).toHaveBeenCalledWith(1007, "HEYCHAT_INVALID_WS_EVENT");
        expect(errors).toHaveBeenCalledOnce();
        socket.emit("message", Buffer.from(JSON.stringify(envelope(1))));
        await vi.waitFor(() => expect(events).toHaveBeenCalledTimes(2));
        expect(events).toHaveBeenCalledTimes(2);
        detach();
        socket.emit("message", Buffer.from(JSON.stringify(envelope(2))));
        expect(events).toHaveBeenCalledTimes(2);
        await bot.stop();
    });

    it("正向连接模式拒绝同时接管宿主 socket", () => {
        const bot = new HeychatBot({ account_id: "bot", token: "token" });
        expect(() => bot.acceptWebSocket(new HostSocket() as unknown as WebSocket)).toThrowError(
            expect.objectContaining({ code: "HEYCHAT_MANUAL_MODE_REQUIRED" }),
        );
    });

    it("从命令与卡片交互维护精确频道上下文但不猜测房间目标", async () => {
        const bot = new HeychatBot({
            account_id: "bot",
            token: "token",
            receive_mode: "manual",
        });
        await bot.ingest({
            sequence: 1,
            type: "50",
            timestamp: 1_700_000_000,
            data: {
                bot_id: 99,
                room_base_info: { room_id: "r1", room_name: "房间" },
                channel_base_info: { channel_id: "c1", channel_name: "频道一" },
            },
        });
        await bot.ingest({
            sequence: 2,
            type: "card_message_btn_click",
            timestamp: 1_700_000_001,
            data: {
                msg_id: "m2",
                room_base_info: { room_id: "r1", room_name: "房间" },
                channel_base_info: { channel_id: "c2", channel_name: "频道二" },
            },
        });

        expect(bot.getBotId()).toBe(99);
        expect(bot.resolveSendTarget("c1")).toEqual({ room_id: "r1", channel_id: "c1" });
        expect(bot.resolveSendTarget("r1:c2")).toEqual({ room_id: "r1", channel_id: "c2" });
        expect(bot.getMessageContext("m2")).toMatchObject({ channel_id: "c2" });
        expect(() => bot.resolveSendTarget("r1")).toThrowError(
            expect.objectContaining({ code: "HEYCHAT_SCENE_CONTEXT_REQUIRED" }),
        );
    });

    it("显式 ingest 只在监听器成功后确认事件", async () => {
        const bot = new HeychatBot({
            account_id: "bot",
            token: "token",
            receive_mode: "manual",
        });
        let attempts = 0;
        bot.on("event", () => {
            attempts += 1;
            if (attempts === 1) throw new Error("consumer failed");
        });

        await expect(bot.ingest(envelope(12))).rejects.toMatchObject({
            code: "HEYCHAT_EVENT_DELIVERY_FAILED",
        });
        await expect(bot.ingest(envelope(12))).resolves.toMatchObject({ duplicate: false });
        await expect(bot.ingest(envelope(12))).resolves.toMatchObject({ duplicate: true });
        expect(attempts).toBe(2);
    });

    it("已升级 socket 的业务失败会按序留在本地并退避重试", async () => {
        const bot = new HeychatBot({
            account_id: "bot",
            token: "token",
            receive_mode: "manual",
            reconnect_initial_delay_ms: 100,
            reconnect_max_delay_ms: 100,
        });
        const errors = vi.fn();
        let attempts = 0;
        bot.on("error", errors);
        bot.on("event", () => {
            attempts += 1;
            if (attempts === 1) throw new Error("consumer failed");
        });
        await bot.start();
        const socket = new HostSocket();
        bot.acceptWebSocket(socket as unknown as WebSocket);

        socket.emit("message", Buffer.from(JSON.stringify(envelope(20))));
        await vi.waitFor(() => expect(attempts).toBe(2), { timeout: 500 });

        expect(errors).toHaveBeenCalledWith(
            expect.objectContaining({ code: "HEYCHAT_EVENT_DELIVERY_FAILED" }),
        );
        expect(socket.close).not.toHaveBeenCalled();
        await bot.stop();
    });
});
