import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { ControlTerminalService } from "./terminal-service.js";

const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

describe("control terminal service", () => {
    it("票据单次使用，独占 PTY 使用工作区和收敛环境，断连立即 kill", async () => {
        const terminal = fakeTerminal();
        const service = new ControlTerminalService({
            workspace: "/tmp/onebots-workspace",
            manager: { id: "manager-a", version: "1.2.12" },
            available: () => true,
            loadPty: async () => terminal.module,
        });
        cleanups.push(() => service.close());
        const server = await terminalServer(service);
        const ticket = service.issueTicket().ticket;
        const connection = await connect(server.port, ticket);
        const client = connection.socket;
        cleanups.push(() => client.terminate());
        expect(await connection.next()).toMatchObject({
            type: "identity",
            instance_id: "manager-a",
        });
        expect(await connection.next()).toEqual({ type: "ready" });
        expect(terminal.spawn).toHaveBeenCalledWith(
            expect.any(String),
            [],
            expect.objectContaining({
                cwd: "/tmp/onebots-workspace",
                env: expect.objectContaining({ TERM: "xterm-256color" }),
            }),
        );
        expect(terminal.spawn.mock.calls[0][2].env).not.toHaveProperty("ONEBOTS_CONTROL_BOOTSTRAP");

        client.send(JSON.stringify({ type: "input", data: "pwd\r" }));
        client.send(JSON.stringify({ type: "resize", cols: 120, rows: 40 }));
        await expect.poll(() => terminal.process.write).toHaveBeenCalledWith("pwd\r");
        expect(terminal.process.resize).toHaveBeenCalledWith(120, 40);

        await expect(rejected(server.port, ticket)).resolves.toBe(403);
        client.close();
        await expect.poll(() => terminal.process.kill).toHaveBeenCalledOnce();
        expect(service.status().activeSessions).toBe(0);
    });

    it("过期票据和宿主进入不可写状态后均拒绝升级", async () => {
        let now = 1_000;
        let available = true;
        const service = new ControlTerminalService({
            workspace: "/tmp/onebots-workspace",
            manager: { id: "manager-a", version: "1.2.12" },
            available: () => available,
            now: () => now,
            loadPty: async () => fakeTerminal().module,
        });
        cleanups.push(() => service.close());
        const server = await terminalServer(service);
        const expired = service.issueTicket().ticket;
        now += 30_001;
        await expect(rejected(server.port, expired)).resolves.toBe(403);
        const current = service.issueTicket().ticket;
        available = false;
        await expect(rejected(server.port, current)).resolves.toBe(403);
    });
});

function fakeTerminal() {
    const process = {
        write: vi.fn(),
        resize: vi.fn(),
        kill: vi.fn(),
        onData: vi.fn(() => ({ dispose: vi.fn() })),
        onExit: vi.fn(() => ({ dispose: vi.fn() })),
    };
    const spawn = vi.fn(() => process);
    return { module: { spawn }, spawn, process };
}

async function terminalServer(service: ControlTerminalService): Promise<{ port: number }> {
    const server = http.createServer((_request, response) => response.end());
    server.on("upgrade", (request, socket, head) => service.handleUpgrade(request, socket, head));
    await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
    cleanups.push(() => new Promise<void>(resolve => server.close(() => resolve())));
    return { port: (server.address() as AddressInfo).port };
}

function connect(
    port: number,
    ticket: string,
): Promise<{ socket: WebSocket; next: () => Promise<Record<string, unknown>> }> {
    return new Promise((resolve, reject) => {
        const client = new WebSocket(
            `ws://127.0.0.1:${port}/api/control/terminal?ticket=${ticket}`,
            { origin: `http://127.0.0.1:${port}` },
        );
        const values: Record<string, unknown>[] = [];
        const waiting: Array<(value: Record<string, unknown>) => void> = [];
        client.on("message", data => {
            const value = JSON.parse(data.toString()) as Record<string, unknown>;
            const receive = waiting.shift();
            if (receive) receive(value);
            else values.push(value);
        });
        const next = () =>
            new Promise<Record<string, unknown>>(receive => {
                const value = values.shift();
                if (value) receive(value);
                else waiting.push(receive);
            });
        client.once("open", () => resolve({ socket: client, next }));
        client.once("error", reject);
    });
}

function rejected(port: number, ticket: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const client = new WebSocket(
            `ws://127.0.0.1:${port}/api/control/terminal?ticket=${ticket}`,
            { origin: `http://127.0.0.1:${port}` },
        );
        client.once("unexpected-response", (_request, response) => {
            response.resume();
            client.terminate();
            resolve(response.statusCode);
        });
        client.once("open", () => reject(new Error("终端票据被重复接受")));
        client.once("error", () => undefined);
    });
}
