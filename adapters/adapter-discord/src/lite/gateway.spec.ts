import { afterEach, describe, expect, it, vi } from "vitest";
import { DiscordGateway, GatewayOpcodes } from "./gateway.js";
import { DiscordREST } from "./rest.js";

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
    heartbeatAcknowledged: boolean;
    isReady: boolean;
    connectionManager: {
        start(): Promise<void>;
        scheduleReconnect(error?: Error): void;
        stop(): void;
    };
    started: boolean;
    handleSocketClose(
        socket: NonNullable<GatewayHarness["ws"]>,
        code: number,
        reason: string,
    ): void;
    handleMessage(payload: unknown): void;
    sendHeartbeat(): void;
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe("DiscordGateway lifecycle", () => {
    it("复用宿主注入的 REST 传输和限流边界", () => {
        const rest = new DiscordREST({
            token: "token",
            apiBaseUrl: "https://discord.example/api/v10",
            transport: { request: vi.fn() },
        });
        const gateway = new DiscordGateway({ token: "token", intents: 1, rest });

        expect(gateway.getREST()).toBe(rest);
    });

    it("在网络连接前响应已取消的 AbortSignal", async () => {
        const abort = new AbortController();
        abort.abort();
        const gateway = new DiscordGateway({ token: "token", intents: 1 });

        await expect(gateway.connect(abort.signal)).rejects.toMatchObject({
            name: "DiscordError",
            code: "DISCORD_GATEWAY_ABORTED",
        });
    });

    it("并发 connect 共享同一启动过程，stop 时解除 AbortSignal 绑定", async () => {
        let release!: () => void;
        const pending = new Promise<void>(resolve => {
            release = resolve;
        });
        const gateway = new DiscordGateway({ token: "token", intents: 1 });
        const harness = gateway as unknown as GatewayHarness;
        const start = vi.fn(() => pending);
        harness.connectionManager = {
            start,
            scheduleReconnect: vi.fn(),
            stop: vi.fn(),
        };
        const abort = new AbortController();
        const removeEventListener = vi.spyOn(abort.signal, "removeEventListener");

        const first = gateway.connect(abort.signal);
        let secondSettled = false;
        const second = gateway.connect().then(() => {
            secondSettled = true;
        });
        await Promise.resolve();

        expect(start).toHaveBeenCalledOnce();
        expect(secondSettled).toBe(false);

        release();
        await Promise.all([first, second]);
        gateway.disconnect();

        expect(removeEventListener).toHaveBeenCalledWith("abort", expect.any(Function));
    });

    it("fatal close 结束当前生命周期并允许同一实例重新连接", async () => {
        const gateway = new DiscordGateway({ token: "token", intents: 1 });
        const harness = gateway as unknown as GatewayHarness;
        const socket = {
            readyState: 1,
            send: vi.fn(),
            close: vi.fn(),
            removeAllListeners: vi.fn(),
            on: vi.fn(),
        };
        const start = vi.fn(async () => undefined);
        const stop = vi.fn();
        harness.connectionManager = { start, scheduleReconnect: vi.fn(), stop };
        harness.ws = socket;
        harness.started = true;

        harness.handleSocketClose(socket, 4004, "Authentication failed");

        expect(stop).toHaveBeenCalledOnce();
        expect(harness.started).toBe(false);
        await gateway.connect();
        expect(start).toHaveBeenCalledOnce();
    });

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
        const dispatch = vi.fn();
        gateway.on("resumed", resumed);
        gateway.on("dispatch", dispatch);

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
        expect(dispatch).toHaveBeenCalledWith("RESUMED", {}, 1, "session");
        expect(send).toHaveBeenCalledOnce();
        expect(removeAllListeners).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledOnce();
    });

    it("未收到上一次心跳 ACK 时立即结束旧连接并安排重连", () => {
        const gateway = new DiscordGateway({ token: "token", intents: 1 });
        const harness = gateway as unknown as GatewayHarness;
        const scheduleReconnect = vi.fn();
        const removeAllListeners = vi.fn();
        const close = vi.fn();
        harness.connectionManager = {
            start: vi.fn(async () => undefined),
            scheduleReconnect,
            stop: vi.fn(),
        };
        harness.ws = {
            readyState: 1,
            send: vi.fn(),
            close,
            removeAllListeners,
            on: vi.fn(),
        };
        harness.heartbeatAcknowledged = false;
        const reconnecting = vi.fn();
        gateway.on("reconnecting", reconnecting);

        harness.sendHeartbeat();

        expect(removeAllListeners).toHaveBeenCalledOnce();
        expect(close).toHaveBeenCalledOnce();
        expect(scheduleReconnect).toHaveBeenCalledOnce();
        expect(reconnecting.mock.calls[0][0]).toMatchObject({
            code: "DISCORD_GATEWAY_HEARTBEAT_TIMEOUT",
        });
    });

    it("仅在 READY 后发送已编译的主动事件", () => {
        const gateway = new DiscordGateway({ token: "token", intents: 1 });
        const harness = gateway as unknown as GatewayHarness;
        const send = vi.fn();
        harness.ws = {
            readyState: 1,
            send,
            close: vi.fn(),
            removeAllListeners: vi.fn(),
            on: vi.fn(),
        };

        expect(() =>
            gateway.sendCommand({
                type: "request_soundboard_sounds",
                guild_ids: ["1"],
            }),
        ).toThrow("尚未就绪");

        harness.isReady = true;
        gateway.sendCommand({ type: "request_soundboard_sounds", guild_ids: ["1"] });
        expect(JSON.parse(send.mock.calls[0][0])).toEqual({
            op: GatewayOpcodes.RequestSoundboardSounds,
            d: { guild_ids: ["1"] },
        });
    });
});
