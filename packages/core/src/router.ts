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

/** 与 ws 既有默认值一致，保持未显式配置的协议路由向后兼容。 */
export const DEFAULT_WEBSOCKET_MAX_PAYLOAD_BYTES = 100 * 1024 * 1024;

export interface WebSocketRouteOptions {
    /** 在协议升级前授权请求；返回 false 或抛错时以 HTTP 401 拒绝。 */
    authorize?: WebSocketUpgradeAuthorizer;
    /** 单条入站 WebSocket 消息的最大字节数，超限连接以 1009 关闭。 */
    maxPayloadBytes?: number;
}

export interface RouterRegistrationOwner {
    readonly platform: string;
    /** 省略时表示平台 Adapter 自身拥有的全局路由。 */
    readonly account_id?: string;
}

export class HttpRouteConflictError extends Error {
    readonly path: string;
    readonly methods: string[];
    readonly registeringOwner?: RouterRegistrationOwner;
    readonly existingOwner?: RouterRegistrationOwner;

    constructor(
        path: string,
        methods: string[],
        registeringOwner?: RouterRegistrationOwner,
        existingOwner?: RouterRegistrationOwner,
    ) {
        super(
            `HTTP 路由冲突：${methods.join(", ")} ${path} 已注册${formatOwnerConflict(registeringOwner, existingOwner)}`,
        );
        this.name = "HttpRouteConflictError";
        this.path = path;
        this.methods = methods;
        this.registeringOwner = registeringOwner;
        this.existingOwner = existingOwner;
    }
}

export class WebSocketRouteConflictError extends Error {
    readonly path: string;
    readonly registeringOwner?: RouterRegistrationOwner;
    readonly existingOwner?: RouterRegistrationOwner;

    constructor(
        path: string,
        registeringOwner?: RouterRegistrationOwner,
        existingOwner?: RouterRegistrationOwner,
    ) {
        super(
            `WebSocket 路由冲突：${path} 已注册${formatOwnerConflict(registeringOwner, existingOwner)}`,
        );
        this.name = "WebSocketRouteConflictError";
        this.path = path;
        this.registeringOwner = registeringOwner;
        this.existingOwner = existingOwner;
    }
}

function formatOwnerConflict(
    registeringOwner?: RouterRegistrationOwner,
    existingOwner?: RouterRegistrationOwner,
): string {
    const registering = registeringOwner ? `；${formatOwner(registeringOwner)} 无法注册` : "";
    const existing = existingOwner ? `（现有注册者：${formatOwner(existingOwner)}）` : "";
    return `${registering}${existing}`;
}

function formatOwner(owner: RouterRegistrationOwner): string {
    return owner.account_id
        ? `账号 ${owner.platform}/${owner.account_id}`
        : `适配器 ${owner.platform}`;
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

    constructor(
        private readonly router: Router,
        /** @internal 供 Router 生成冲突诊断。 */
        readonly owner?: RouterRegistrationOwner,
    ) {}

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
        this.router.assignScopedHttpOwner(layer, this.owner);
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
    private readonly wsOwners = new Map<string, RouterRegistrationOwner>();
    private readonly registrationScope = new AsyncLocalStorage<RouterRegistrationScope>();
    private readonly httpOwners = new WeakMap<Layer, RouterRegistrationOwner>();
    private registrationDepth = 0;
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
                // 路由消费方仍可注册自己的 error 监听器；该兜底避免协议错误成为未处理异常。
                ws.on("error", () => undefined);
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

    createRegistrationScope(owner?: RouterRegistrationOwner): RouterRegistrationScope {
        return new RouterRegistrationScope(this, owner);
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
        if (this.registrationDepth > 0) {
            return super.register(path, methods, middleware, additionalOptions);
        }

        const previousLayers = new Set(this.stack);
        this.registrationDepth += 1;
        try {
            const result = super.register(path, methods, middleware, additionalOptions);
            const addedLayers = this.stack.filter(layer => !previousLayers.has(layer));
            const scope = this.registrationScope.getStore();
            this.assertNoHttpRouteConflicts(addedLayers, previousLayers, scope?.owner);
            if (scope) {
                for (const layer of addedLayers) scope.trackHttp(layer);
            }
            return result;
        } catch (error) {
            for (let index = this.stack.length - 1; index >= 0; index -= 1) {
                if (!previousLayers.has(this.stack[index])) this.stack.splice(index, 1);
            }
            throw error;
        } finally {
            this.registrationDepth -= 1;
        }
    }

    private assertNoHttpRouteConflicts(
        addedLayers: Layer[],
        previousLayers: ReadonlySet<Layer>,
        registeringOwner?: RouterRegistrationOwner,
    ): void {
        const checkedLayers = [...previousLayers];
        for (const layer of addedLayers) {
            for (const existing of checkedLayers) {
                if (!this.isSameHttpPath(layer.path, existing.path)) continue;
                const methods = layer.methods.filter(method => existing.methods.includes(method));
                if (methods.length === 0) continue;
                throw new HttpRouteConflictError(
                    this.formatHttpPath(layer.path),
                    [...new Set(methods)].sort(),
                    registeringOwner,
                    previousLayers.has(existing) ? this.httpOwners.get(existing) : registeringOwner,
                );
            }
            checkedLayers.push(layer);
        }
    }

    private isSameHttpPath(left: string | RegExp, right: string | RegExp): boolean {
        if (typeof left === "string" || typeof right === "string") return left === right;
        return left.source === right.source && left.flags === right.flags;
    }

    private formatHttpPath(path: string | RegExp): string {
        return typeof path === "string" ? path : path.toString();
    }

    /** 注册不受 Koa prefix 影响的 WebSocket pathname。 */
    ws(path: string, options: WebSocketRouteOptions = {}): WsServer {
        const normalized = this.normalizeWsPath(path);
        const maxPayloadBytes = options.maxPayloadBytes ?? DEFAULT_WEBSOCKET_MAX_PAYLOAD_BYTES;
        if (
            !Number.isSafeInteger(maxPayloadBytes) ||
            maxPayloadBytes <= 0 ||
            maxPayloadBytes > DEFAULT_WEBSOCKET_MAX_PAYLOAD_BYTES
        ) {
            throw new RangeError("WebSocket maxPayloadBytes 必须是 1 到 100 MiB 之间的安全整数");
        }
        const scope = this.registrationScope.getStore();
        if (this.wsMap.has(normalized)) {
            throw new WebSocketRouteConflictError(
                normalized,
                scope?.owner,
                this.wsOwners.get(normalized),
            );
        }

        const wsServer = new WsServer({
            noServer: true,
            path: normalized,
            maxPayload: maxPayloadBytes,
        });
        this.wsMap.set(normalized, wsServer);
        if (options.authorize) this.wsAuthorizers.set(normalized, options.authorize);
        if (scope?.owner) this.wsOwners.set(normalized, scope.owner);
        scope?.trackWs(normalized, wsServer);
        return wsServer;
    }

    /** @internal 仅撤销作用域实际创建的 Layer。 */
    removeScopedHttpLayer(layer: Layer): void {
        this.httpOwners.delete(layer);
        const index = this.stack.indexOf(layer);
        if (index >= 0) this.stack.splice(index, 1);
    }

    /** @internal 记录账号作用域拥有的 HTTP Layer。 */
    assignScopedHttpOwner(layer: Layer, owner?: RouterRegistrationOwner): void {
        if (owner) this.httpOwners.set(layer, owner);
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
        this.wsOwners.delete(normalized);
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
        this.wsOwners.clear();
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
        this.wsOwners.clear();
        await Promise.all(servers.map(wsServer => this.closeWsServer(wsServer)));
    }

    getWsPaths(): string[] {
        return [...this.wsMap.keys()];
    }
}
