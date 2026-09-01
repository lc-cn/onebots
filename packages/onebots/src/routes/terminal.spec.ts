import { describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import type { Router, RouterContext } from "@onebots/core";
import type { App } from "../app.js";
import {
    handleTerminalProcessExit,
    registerTerminalRoutes,
    sendTerminalIdentity,
} from "./terminal.js";

type RouteHandler = (ctx: RouterContext) => void | Promise<void>;

describe("terminal PTY lifecycle", () => {
    it("在接受终端命令前发送完整实例身份", () => {
        const connection = client();
        const app = {
            info: {
                application_name: "onebots",
                application_version: "1.2.8",
                instance_id: "instance-a",
            },
            runtimeContractId: "sha256:contract-a",
            terminalClients: new Set(),
            logger: { error: vi.fn(), warn: vi.fn() },
        } as unknown as App;

        expect(sendTerminalIdentity(app, connection as unknown as WebSocket)).toBe(true);
        expect(JSON.parse(connection.send.mock.calls[0][0])).toEqual({
            type: "identity",
            application: "onebots",
            version: "1.2.8",
            instance_id: "instance-a",
            runtime_contract_id: "sha256:contract-a",
        });
    });

    it("notifies and closes every client when the PTY exits", () => {
        const first = client();
        const second = client();
        const app = {
            ptyTerminal: { kill: vi.fn() },
            terminalClients: new Set([first, second]),
            logger: { error: vi.fn(), warn: vi.fn() },
        } as unknown as App;

        handleTerminalProcessExit(app);

        expect(app.ptyTerminal).toBeNull();
        expect(app.terminalClients.size).toBe(0);
        for (const connection of [first, second]) {
            expect(connection.send).toHaveBeenCalledOnce();
            expect(JSON.parse(connection.send.mock.calls[0][0])).toEqual({ type: "exit" });
            expect(connection.close).toHaveBeenCalledWith(1000, "Terminal exited");
        }
    });
});

describe("log stream route", () => {
    it("在缓存和实时日志前发布完整实例身份", () => {
        const gets = new Map<string, RouteHandler>();
        const registerLogClient = vi.fn();
        const app = {
            info: {
                application_name: "onebots",
                application_version: "1.2.8",
                instance_id: "instance-a",
            },
            runtimeContractId: "sha256:contract-a",
            logCacheFile: "/path/that/does/not/exist/terminal-logs.txt",
            registerLogClient,
            removeLogClient: vi.fn(),
            logger: { error: vi.fn(), warn: vi.fn() },
        } as unknown as App;
        registerTerminalRoutes(app, {
            ws: vi.fn(() => ({ on: vi.fn() })),
            get: vi.fn((route: string, handler: RouteHandler) => gets.set(route, handler)),
        } as unknown as Router);
        const write = vi.fn();
        const ctx = logStreamContext(write);

        gets.get("/api/logs")!(ctx);

        expect(ctx.set).toHaveBeenCalledWith("X-OneBots-Application", "onebots");
        expect(ctx.set).toHaveBeenCalledWith("X-OneBots-Instance-Id", "instance-a");
        expect(ctx.set).toHaveBeenCalledWith("X-OneBots-Runtime-Contract-Id", "sha256:contract-a");
        expect(write).toHaveBeenCalledOnce();
        expect(String(write.mock.calls[0]?.[0])).toContain(
            '"event":"identity","application":"onebots","version":"1.2.8","instance_id":"instance-a"',
        );
        expect(registerLogClient).toHaveBeenCalledOnce();
        vi.mocked(registerLogClient).mock.calls[0]?.[1]();
    });

    it("身份事件发送失败时不注册日志客户端", () => {
        const gets = new Map<string, RouteHandler>();
        const registerLogClient = vi.fn();
        const end = vi.fn();
        const app = {
            info: {
                application_name: "onebots",
                application_version: "1.2.8",
                instance_id: "instance-a",
            },
            logCacheFile: "/path/that/does/not/exist/terminal-logs.txt",
            registerLogClient,
            logger: { error: vi.fn(), warn: vi.fn() },
        } as unknown as App;
        registerTerminalRoutes(app, {
            ws: vi.fn(() => ({ on: vi.fn() })),
            get: vi.fn((route: string, handler: RouteHandler) => gets.set(route, handler)),
        } as unknown as Router);
        const ctx = logStreamContext(
            vi.fn(() => {
                throw new Error("socket closed");
            }),
            end,
        );

        gets.get("/api/logs")!(ctx);

        expect(end).toHaveBeenCalledOnce();
        expect(registerLogClient).not.toHaveBeenCalled();
        expect(app.logger.error).toHaveBeenCalledWith("发送日志流身份失败", {
            error: expect.any(Error),
        });
    });
});

function client() {
    return {
        readyState: WebSocket.OPEN,
        bufferedAmount: 0,
        send: vi.fn(),
        close: vi.fn(),
    };
}

function logStreamContext(
    write: ReturnType<typeof vi.fn>,
    end: ReturnType<typeof vi.fn> = vi.fn(),
): RouterContext {
    return {
        state: { token: undefined },
        set: vi.fn(),
        request: {
            socket: { setTimeout: vi.fn(), setNoDelay: vi.fn(), setKeepAlive: vi.fn() },
        },
        req: {
            socket: { setNoDelay: vi.fn(), setKeepAlive: vi.fn() },
            on: vi.fn(),
        },
        res: { write, end },
    } as unknown as RouterContext;
}
