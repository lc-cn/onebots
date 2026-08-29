import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscordGateway, GatewayOpcodes } from "./gateway.js";

interface GatewayHarness {
    ws: {
        readyState: number;
        send(data: string): void;
        close(): void;
        removeAllListeners(): void;
        on(): void;
    } | null;
    sequence: number | null;
    sessionId: string | null;
    resumeOnHello: boolean;
    handleMessage(payload: unknown): void;
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe("DiscordGateway lifecycle", () => {
    it("HELLO 后恢复会话，并在 stop 时清除心跳与会话延迟任务", async () => {
        vi.useFakeTimers();
        vi.spyOn(Math, "random").mockReturnValue(0);
        const send = vi.fn();
        const close = vi.fn();
        const removeAllListeners = vi.fn();
        const gateway = new DiscordGateway({ token: "token", intents: 1 });
        const harness = gateway as unknown as GatewayHarness;
        harness.ws = {
            readyState: 1,
            send,
            close,
            removeAllListeners,
            on: vi.fn(),
        };
        harness.sessionId = "session";
        harness.sequence = 0;
        harness.resumeOnHello = true;
        const resumed = vi.fn();
        gateway.on("resumed", resumed);

        harness.handleMessage({
            op: GatewayOpcodes.Hello,
            d: { heartbeat_interval: 30_000 },
            s: null,
            t: null,
        });
        expect(JSON.parse(send.mock.calls[0][0])).toEqual({
            op: GatewayOpcodes.Resume,
            d: { token: "token", session_id: "session", seq: 0 },
        });

        harness.handleMessage({
            op: GatewayOpcodes.Dispatch,
            d: {},
            s: 1,
            t: "RESUMED",
        });
        harness.handleMessage({
            op: GatewayOpcodes.InvalidSession,
            d: true,
            s: null,
            t: null,
        });
        gateway.disconnect();
        await vi.runAllTimersAsync();

        expect(resumed).toHaveBeenCalledOnce();
        expect(send).toHaveBeenCalledOnce();
        expect(removeAllListeners).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledOnce();
    });
});
