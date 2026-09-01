import KoaRouter from "@koa/router";
import type {
    Layer,
    LayerOptions,
    RouterContext as KoaRouterContext,
    RouterMiddleware,
} from "@koa/router";
import { AsyncLocalStorage } from "node:async_hooks";
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

export type WebSocketUpgradeAuthorizer = (request: IncomingMessage) => boolean;

export interface WebSocketRouteOptions {
    /** 在协议升级前授权请求；返回 false 或抛错时以 HTTP 401 拒绝。 */
    authorize?: WebSocketUpgradeAuthorizer;
}

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
 * 归属一个账号构造与启动周期的 Router 注册。
 * close 后出现的迟到注册会被立即撤销，避免旧扩展在回滚后重新占用路径。
 */
export class RouterRegistrationScope {
    private readonly httpLayers = new Set<Layer>();
    private readonly wsServers = new Map<string, WsServer>();
    private closed = false;

    constructor(private readonly router: Router) {}

    run<T>(operation: () => T): T {
        return this.router.runInRegistrationScope(this, operation);
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        for (const layer of this.httpLayers) this.router.removeScopedHttpLayer(layer);
        this.httpLayers.clear();
        for (const [path, server] of this.wsServers) {
            this.router.removeScopedWs(path, server);
        }
        this.wsServers.clear();
    }

    /** @internal 仅由 Router.register 调用。 */
    trackHttp(layer: Layer): void {
        if (this.closed) {
            this.router.removeScopedHttpLayer(layer);
            return;
        }
        this.httpLayers.add(layer);
    }

    /** @internal 仅由 Router.ws 调用。 */
    trackWs(path: string, server: WsServer): void {
        if (this.closed) {
            this.router.removeScopedWs(path, server);
            return;
        }
        this.wsServers.set(path, server);
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
    private readonly wsAuthorizers = new Map<string, WebSocketUpgradeAuthorizer>();
    private readonly registrationScope = new AsyncLocalStorage<RouterRegistrationScope>();
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

            const authorize = this.wsAuthorizers.get(pathname);
            if (authorize) {
                let authorized = false;
                try {
                    authorized = authorize(request);
                } catch {
                    // 授权器异常时安全地拒绝升级，避免把内部错误暴露给客户端。
                }
                if (!authorized) {
                    this.rejectUpgrade(socket, 401, "Unauthorized", {
                        "WWW-Authenticate": "Bearer",
                    });
                    return;
                }
            }

            wsServer.handleUpgrade(request, socket, head, ws => {
                wsServer.emit("connection", ws, request);
            });
        };
        this.server.on("upgrade", this.upgradeHandler);
    }

    private rejectUpgrade(
        socket: Duplex,
        status: number,
        reason: string,
        headers: Readonly<Record<string, string>> = {},
    ): void {
        const serializedHeaders = Object.entries(headers)
            .map(([name, value]) => `${name}: ${value}\r\n`)
            .join("");
        socket.end(`HTTP/1.1 ${status} ${reason}\r\n${serializedHeaders}Connection: close\r\n\r\n`);
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

    createRegistrationScope(): RouterRegistrationScope {
        return new RouterRegistrationScope(this);
    }

    /** @internal 由 RouterRegistrationScope.run 建立异步注册归属。 */
    runInRegistrationScope<T>(scope: RouterRegistrationScope, operation: () => T): T {
        return this.registrationScope.run(scope, operation);
    }

    override register(
        path: string | RegExp | string[],
        methods: string[],
        middleware: RouterMiddleware | RouterMiddleware[],
        additionalOptions?: LayerOptions,
    ): Layer | KoaRouter {
        const previousLayers = new Set(this.stack);
        const result = super.register(path, methods, middleware, additionalOptions);
        const scope = this.registrationScope.getStore();
        if (scope) {
            for (const layer of this.stack) {
                if (!previousLayers.has(layer)) scope.trackHttp(layer);
            }
        }
        return result;
    }

    /** 注册不受 Koa prefix 影响的 WebSocket pathname。 */
    ws(path: string, options: WebSocketRouteOptions = {}): WsServer {
        const normalized = this.normalizeWsPath(path);
        if (this.wsMap.has(normalized)) {
            throw new Error(`WebSocket server already exists at path: ${normalized}`);
        }

        const wsServer = new WsServer({ noServer: true, path: normalized });
        this.wsMap.set(normalized, wsServer);
        if (options.authorize) this.wsAuthorizers.set(normalized, options.authorize);
        this.registrationScope.getStore()?.trackWs(normalized, wsServer);
        return wsServer;
    }

    /** @internal 仅撤销作用域实际创建的 Layer。 */
    removeScopedHttpLayer(layer: Layer): void {
        const index = this.stack.indexOf(layer);
        if (index >= 0) this.stack.splice(index, 1);
    }

    /** @internal 路径已被新作用域接管时，不允许旧作用域误删新服务。 */
    removeScopedWs(path: string, expected: WsServer): void {
        if (this.wsMap.get(path) !== expected) return;
        this.removeWs(path);
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
        this.wsAuthorizers.delete(normalized);
        this.terminateClients(wsServer);
        wsServer.close();
        return true;
    }

    /** 同步发起全部连接关闭；需要等待完成时使用 cleanupAsync。 */
    cleanup(): void {
        this.detachUpgradeHandler();
        const servers = [...this.wsMap.values()];
        this.wsMap.clear();
        this.wsAuthorizers.clear();
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
        this.wsAuthorizers.clear();
        await Promise.all(servers.map(wsServer => this.closeWsServer(wsServer)));
    }

    getWsPaths(): string[] {
        return [...this.wsMap.keys()];
    }
}
