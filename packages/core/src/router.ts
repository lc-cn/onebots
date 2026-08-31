import KoaRouter from "@koa/router";
import { WebSocketServer, WebSocket, ServerOptions } from "ws";
import { IncomingMessage, Server } from "http";
import type {RouterContext as KoaRouterContext} from "@koa/router";
import type { Request } from 'koa';

export type RouterContext = KoaRouterContext & {
    request: Request & {
        body: unknown;
    };
};
export type {Next} from "koa";
export class WsServer<
    T extends typeof WebSocket = typeof WebSocket,
    U extends typeof IncomingMessage = typeof IncomingMessage,
> extends WebSocketServer<T, U> {
    public readonly path: string = '';

    constructor(options: WsServer.Options<T, U>) {
        super(options);
        // 设置 path（基类可能不会自动设置，因为使用了 noServer: true）
        (this as unknown as { path: string }).path = options.path;
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

export class Router extends KoaRouter {
    private wsMap: Map<string, WsServer> = new Map();
    private upgradeHandler?: (request: IncomingMessage, socket: import('stream').Duplex, head: Buffer) => void;
    private readonly server: Server;

    constructor(server: Server, options?: ConstructorParameters<typeof KoaRouter>[0]) {
        super(options);
        this.server = server;
        this.setupUpgradeHandler();
    }

    /**
     * 设置 WebSocket upgrade 处理器
     */
    private setupUpgradeHandler(): void {
        this.upgradeHandler = (request: IncomingMessage, socket: import('stream').Duplex, head: Buffer) => {
            try {
                const url = new URL(request.url || "/", `http://localhost`);
                const pathname = url.pathname;

                // WebSocket upgrade 请求的路径是客户端直接请求的完整路径
                // 不受 Koa router prefix 影响，所以直接使用 pathname 进行匹配
                const wsServer = this.wsMap.get(pathname);

                if (!wsServer) {
                    // 没有找到匹配的 WebSocket 服务器，优雅地关闭连接
                    socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
                    socket.destroy();
                    return;
                }

                // 处理 WebSocket 升级
                wsServer.handleUpgrade(request, socket, head, (ws) => {
                    wsServer.emit("connection", ws, request);
                });
            } catch (error) {
                // 处理 URL 解析错误
                socket.write("HTTP/1.1 400 Bad Request\r\n\r\n");
                socket.destroy();
            }
        };

        this.server.on("upgrade", this.upgradeHandler);
    }

    /**
     * 创建并注册一个新的 WebSocket 服务器
     * @param path WebSocket 路径（客户端请求的完整路径，不受 router prefix 影响）
     * @returns WebSocket 服务器实例
     */
    ws(path: string): WsServer {
        // 规范化路径：确保以 / 开头
        const normalizedPath = path.startsWith("/") ? path : `/${path}`;
        
        // WebSocket 路径不受 Router prefix 影响
        // 因为 WebSocket upgrade 是直接处理 HTTP upgrade 请求的，使用原始 pathname
        // 所以直接使用传入的路径，不添加 prefix
        const fullPath = normalizedPath;

        // 检查路径是否已存在
        if (this.wsMap.has(fullPath)) {
            throw new Error(`WebSocket server already exists at path: ${fullPath}`);
        }

        // 创建 WebSocket 服务器
        const wsServer = new WsServer({ 
            noServer: true, 
            path: fullPath 
        });

        // 存储完整路径（客户端请求的路径，不受 prefix 影响）
        this.wsMap.set(fullPath, wsServer);

        return wsServer;
    }

    /**
     * 移除 WebSocket 服务器
     * @param path WebSocket 路径（客户端请求的完整路径）
     */
    removeWs(path: string): boolean {
        const normalizedPath = path.startsWith("/") ? path : `/${path}`;
        
        // 尝试匹配完整路径或相对路径
        let fullPath: string;
        if (this.opts.prefix && !normalizedPath.startsWith(this.opts.prefix)) {
            fullPath = `${this.opts.prefix}${normalizedPath}`;
        } else {
            fullPath = normalizedPath;
        }

        const wsServer = this.wsMap.get(fullPath) || this.wsMap.get(normalizedPath);
        if (wsServer) {
            // 关闭所有连接
            wsServer.close();
            this.wsMap.delete(fullPath);
            if (fullPath !== normalizedPath && this.wsMap.has(normalizedPath)) {
                this.wsMap.delete(normalizedPath);
            }
            return true;
        }
        return false;
    }

    /**
     * 清理所有 WebSocket 服务器和事件监听器
     */
    cleanup(): void {
        // 关闭所有 WebSocket 服务器
        for (const wsServer of this.wsMap.values()) {
            try {
                wsServer.close();
            } catch (error) {
                // 忽略关闭错误
            }
        }
        this.wsMap.clear();

        // 移除 upgrade 事件监听器
        if (this.upgradeHandler) {
            this.server.removeListener("upgrade", this.upgradeHandler);
            this.upgradeHandler = undefined;
        }
    }
    
    /**
     * 异步清理（返回 Promise）
     */
    async cleanupAsync(): Promise<void> {
        return new Promise<void>((resolve) => {
            // 关闭所有 WebSocket 服务器
            const closePromises: Promise<void>[] = [];
            for (const wsServer of this.wsMap.values()) {
                closePromises.push(
                    new Promise<void>((resolve) => {
                        try {
                            wsServer.close(() => resolve());
                        } catch {
                            resolve();
                        }
                    }),
                );
            }
            
            Promise.all(closePromises).then(() => {
                this.wsMap.clear();
                
                // 移除 upgrade 事件监听器
                if (this.upgradeHandler) {
                    this.server.removeListener("upgrade", this.upgradeHandler);
                    this.upgradeHandler = undefined;
                }
                
                resolve();
            });
        });
    }

    /**
     * 获取所有已注册的 WebSocket 路径
     */
    getWsPaths(): string[] {
        return Array.from(this.wsMap.keys());
    }
}
