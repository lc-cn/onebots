import http from "node:http";
import type { Duplex } from "node:stream";
import { connectWindowsManagerRPC } from "../windows-manager-rpc.js";
import { proxyGatewayUpgrade } from "./proxy.js";
import type { GatewayProxyAddress } from "./proxy.js";
import type { ControlTerminalService } from "./terminal-service.js";

/** 只在来源通过后构造：同一模块拥有监听、升级与原生反向连接的清理。 */
export function createAdmittedHostTransports(options: {
    handle(
        request: http.IncomingMessage,
        response: http.ServerResponse,
        local: boolean,
    ): Promise<void>;
    windowsNativeMode: boolean;
    windowsHostRpcPipe?: string;
    terminal: Pick<ControlTerminalService, "handleUpgrade">;
    activeAddress(): GatewayProxyAddress | undefined;
}) {
    const sockets = new Set<Duplex>();
    let reconnect: NodeJS.Timeout | undefined;
    let closed = false;
    const server = http.createServer(
        (request, response) => void options.handle(request, response, false),
    );
    const local = http.createServer(
        (request, response) => void options.handle(request, response, true),
    );
    for (const listener of options.windowsNativeMode ? [server] : [server, local]) {
        listener.on("connection", socket => {
            sockets.add(socket);
            socket.once("close", () => sockets.delete(socket));
        });
        listener.requestTimeout = 30_000;
        listener.headersTimeout = 10_000;
    }
    local.keepAliveTimeout = 0;
    server.on("upgrade", (request, socket, head) => {
        try {
            if (options.terminal.handleUpgrade(request, socket, head)) return;
            if (new URL(request.url ?? "/", "http://localhost").pathname.startsWith("/api/")) {
                socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
                return;
            }
            proxyGatewayUpgrade(request, socket, head, options.activeAddress());
        } catch {
            socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        }
    });
    async function attach(): Promise<void> {
        if (!options.windowsHostRpcPipe) return;
        try {
            const socket = await connectWindowsManagerRPC(options.windowsHostRpcPipe);
            if (closed) {
                socket.destroy();
                return;
            }
            local.emit("connection", socket);
            socket.once("close", () => {
                if (!closed) {
                    reconnect = setTimeout(() => void attach(), 25);
                    reconnect.unref();
                }
            });
        } catch {
            if (!closed) {
                reconnect = setTimeout(() => void attach(), 25);
                reconnect.unref();
            }
        }
    }
    function stopReconnect() {
        closed = true;
        if (reconnect) clearTimeout(reconnect);
    }
    return {
        server,
        local,
        attach,
        stopReconnect,
        async closeListeners() {
            stopReconnect();
            for (const socket of sockets) socket.destroy();
            await Promise.all(
                [server, local].map(
                    listener => new Promise<void>(resolve => listener.close(() => resolve())),
                ),
            );
        },
    };
}
