import http from "node:http";
import { WebSocketServer } from "ws";
import type { Adapter } from "../adapter.js";
import { acceptWebSocketIngress } from "../ingress.js";
import { Receiver, type AuthenticatedReceiverOptions } from "../receiver.js";
import { readReceiverToken } from "./auth.js";

/** 在独立 HTTP 端口上接收反向 WebSocket；已有 Upgrade 宿主应使用 Client.acceptWebSocket。 */
export class WSSReceiver<
    Id extends string | number = string | number,
    TRawEvent = unknown,
> extends Receiver<Id, TRawEvent> {
    #server?: http.Server;
    #webSocketServer?: WebSocketServer;

    constructor(
        adapter: Adapter<Id, TRawEvent>,
        public readonly path: string,
        private readonly options: AuthenticatedReceiverOptions = {},
    ) {
        super(adapter, options.logger);
    }

    async connect(port = 8080): Promise<void> {
        if (this.#server) throw new Error("反向 WebSocket Receiver 已启动");

        const server = http.createServer();
        const webSocketServer = new WebSocketServer({ server, path: this.path });
        this.#server = server;
        this.#webSocketServer = webSocketServer;

        webSocketServer.on("connection", (socket, request) => {
            if (
                this.options.accessToken &&
                readReceiverToken(request.url, request.headers) !== this.options.accessToken
            ) {
                socket.close(1008, "鉴权失败");
                return;
            }

            const detach = acceptWebSocketIngress<TRawEvent>(socket, event => this.ingest(event));
            socket.once("close", detach);
            socket.on("error", error => this.logger.error("反向 WebSocket 连接错误", error));
        });

        await new Promise<void>((resolve, reject) => {
            server.once("error", reject);
            server.listen(port, () => {
                server.off("error", reject);
                resolve();
            });
        });
    }

    async disconnect(): Promise<void> {
        const webSocketServer = this.#webSocketServer;
        const server = this.#server;
        this.#webSocketServer = undefined;
        this.#server = undefined;

        if (webSocketServer) {
            for (const socket of webSocketServer.clients) socket.close(1001, "Receiver 已停止");
            await new Promise<void>((resolve, reject) => {
                webSocketServer.close(error => (error ? reject(error) : resolve()));
            });
        }
        if (server?.listening) {
            await new Promise<void>((resolve, reject) => {
                server.close(error => (error ? reject(error) : resolve()));
            });
        }
    }
}
