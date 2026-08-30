import KoaRouter from "@koa/router";
import type { RouterContext as KoaRouterContext } from "@koa/router";
import type { Request } from "koa";
import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer, type ServerOptions } from "ws";

export type RouterContext = KoaRouterContext & {
    request: Request & {
        body: unknown;
    };
};
export type { Next } from "koa";

export class WsServer<
    T extends typeof WebSocket = typeof WebSocket,
    U extends typeof IncomingMessage = typeof IncomingMessage,
> extends WebSocketServer<T, U> {
    declare public readonly path: string;

    constructor(options: WsServer.Options<T, U>) {
        super(options);
        (this as { path: string }).path = options.path;
    }
}

export namespace WsServer {
    export interface Options<
        T extends typeof WebSocket = typeof WebSocket,
        U extends typeof IncomingMessage = typeof IncomingMessage,
    > extends ServerOptions<T, U> {
        path: string;
    }
}

/**
 * Koa HTTP Router 与同一 Server 上的 WebSocket upgrade 注册表。
 *
 * WebSocket 路径始终是客户端请求的绝对 pathname，不继承 Koa Router prefix。
 * Router 拥有所有 WsServer，并负责在宿主停止时先拒绝新 upgrade、再终止现有连接。
 */
export class Router extends KoaRouter {
    private readonly wsMap = new Map<string, WsServer>();
    private upgradeHandler?: (request: IncomingMessage, socket: Duplex, head: Buffer) => void;

    constructor(
        private readonly server: Server,
        options?: ConstructorParameters<typeof KoaRouter>[0],
    ) {
        super(options);
        this.attachUpgradeHandler();
    }

    private attachUpgradeHandler(): void {
        this.upgradeHandler = (request, socket, head) => {
            let pathname: string;
            try {
                pathname = new URL(request.url ?? "/", "http://localhost").pathname;
            } catch {
                this.rejectUpgrade(socket, 400, "Bad Request");
                return;
            }

            const wsServer = this.wsMap.get(pathname);
            if (!wsServer) {
                this.rejectUpgrade(socket, 404, "Not Found");
                return;
            }

            wsServer.handleUpgrade(request, socket, head, ws => {
                wsServer.emit("connection", ws, request);
            });
        };
        this.server.on("upgrade", this.upgradeHandler);
    }

    private rejectUpgrade(socket: Duplex, status: number, reason: string): void {
        socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
    }

    private detachUpgradeHandler(): void {
        if (!this.upgradeHandler) return;
        this.server.removeListener("upgrade", this.upgradeHandler);
        this.upgradeHandler = undefined;
    }

    private normalizeWsPath(value: string): string {
        const path = value.startsWith("/") ? value : `/${value}`;
        if (path.startsWith("//") || path.includes("?") || path.includes("#")) {
            throw new TypeError(`WebSocket 路径必须是绝对 pathname: ${value}`);
        }
        return path;
    }

    /** 注册不受 Koa prefix 影响的 WebSocket pathname。 */
    ws(path: string): WsServer {
        const normalized = this.normalizeWsPath(path);
        if (this.wsMap.has(normalized)) {
            throw new Error(`WebSocket server already exists at path: ${normalized}`);
        }

        const wsServer = new WsServer({ noServer: true, path: normalized });
        this.wsMap.set(normalized, wsServer);
        return wsServer;
    }

    private terminateClients(wsServer: WsServer): void {
        for (const client of wsServer.clients) client.terminate();
    }

    private closeWsServer(wsServer: WsServer): Promise<void> {
        this.terminateClients(wsServer);
        return new Promise((resolve, reject) => {
            wsServer.close(error => {
                if (
                    !error ||
                    (error as NodeJS.ErrnoException).code === "WS_ERR_SERVER_NOT_RUNNING"
                ) {
                    resolve();
                    return;
                }
                reject(error);
            });
        });
    }

    /** 移除一个 WebSocket pathname，并立即终止其现有连接。 */
    removeWs(path: string): boolean {
        const normalized = this.normalizeWsPath(path);
        const wsServer = this.wsMap.get(normalized);
        if (!wsServer) return false;

        this.wsMap.delete(normalized);
        this.terminateClients(wsServer);
        wsServer.close();
        return true;
    }

    /** 同步发起全部连接关闭；需要等待完成时使用 cleanupAsync。 */
    cleanup(): void {
        this.detachUpgradeHandler();
        const servers = [...this.wsMap.values()];
        this.wsMap.clear();
        for (const wsServer of servers) {
            this.terminateClients(wsServer);
            wsServer.close();
        }
    }

    /** 拒绝新 upgrade、终止现有连接，并等待所有 WebSocketServer 完成关闭。 */
    async cleanupAsync(): Promise<void> {
        this.detachUpgradeHandler();
        const servers = [...this.wsMap.values()];
        this.wsMap.clear();
        await Promise.all(servers.map(wsServer => this.closeWsServer(wsServer)));
    }

    getWsPaths(): string[] {
        return [...this.wsMap.keys()];
    }
}
