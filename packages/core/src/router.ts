import KoaRouter from "@koa/router";
import { WebSocketServer, WebSocket, ServerOptions } from "ws";
import { IncomingMessage, Server } from "http";

export class WsServer<
    T extends typeof WebSocket.WebSocket = typeof WebSocket.WebSocket,
    U extends typeof IncomingMessage = typeof IncomingMessage,
> extends WebSocketServer<T, U> {
    constructor(options?: WsServer.Options<T, U>) {
        super(options);
        this.path = options.path;
    }
}
export namespace WsServer {
    export interface Options<
        T extends typeof WebSocket.WebSocket = typeof WebSocket.WebSocket,
        U extends typeof IncomingMessage = typeof IncomingMessage,
    > extends ServerOptions<T, U> {
        path: string;
    }
}
export class Router extends KoaRouter {
    wsStack: WsServer[] = [];
    constructor(server: Server, options?: KoaRouter.RouterOptions) {
        super(options);
        server.on("upgrade", (request, socket, head) => {
            const { pathname } = new URL(request.url, `wss://localhost`);
            const wsServer = this.wsStack.find(wss => wss.path === pathname);
            if (!wsServer) return socket.destroy();
            wsServer.handleUpgrade(request, socket, head, function done(ws) {
                wsServer.emit("connection", ws, request);
            });
        });
    }
    ws(path: string) {
        const wsServer = new WsServer({ noServer: true, path });
        this.wsStack.push(wsServer);
        return wsServer;
    }
}
