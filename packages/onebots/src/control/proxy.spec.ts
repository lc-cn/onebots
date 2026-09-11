import { afterEach, describe, expect, it } from "vitest";
import { createServer, request, type Server } from "node:http";
import { once } from "node:events";
import { WebSocket, WebSocketServer } from "ws";
import { proxyGatewayHttp, proxyGatewayUpgrade, type GatewayProxyHandle } from "./proxy.js";

const servers: Server[] = [];
const handles: GatewayProxyHandle[] = [];
const sockets: WebSocket[] = [];
afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    for (const handle of handles.splice(0)) handle.close();
    await Promise.all(
        servers.splice(0).map(
            server =>
                new Promise<void>(resolve => {
                    server.closeAllConnections();
                    server.close(() => resolve());
                }),
        ),
    );
});

async function listen(server: Server): Promise<number> {
    servers.push(server);
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("缺少测试地址");
    return address.port;
}

async function proxy(port?: number) {
    const address = port ? { host: "127.0.0.1" as const, port } : undefined;
    const server = createServer((req, res) => handles.push(proxyGatewayHttp(req, res, address)));
    server.on("upgrade", (req, socket, head) =>
        handles.push(proxyGatewayUpgrade(req, socket, head, address)),
    );
    return await listen(server);
}

describe("公共入口网关代理", () => {
    it("WS 保留上游 401 和挑战头，错误体固定且有界", async () => {
        const upstream = await listen(
            createServer((_req, res) => {
                res.writeHead(401, { "www-authenticate": 'Bearer realm="protocol"' });
                res.end("不应转发的巨大或敏感错误体".repeat(10000));
            }),
        );
        const port = await proxy(upstream);
        const client = new WebSocket(`ws://127.0.0.1:${port}/api`);
        sockets.push(client);
        client.on("error", () => {
            /* 预期协议鉴权拒绝。 */
        });
        const [, response] = await once(client, "unexpected-response");
        expect(response.statusCode).toBe(401);
        expect(response.headers["www-authenticate"]).toBe('Bearer realm="protocol"');
        const chunks: Buffer[] = [];
        for await (const chunk of response) chunks.push(Buffer.from(chunk));
        expect(Buffer.concat(chunks).toString()).toBe("网关拒绝 WebSocket 升级");
    });
    it("保留原始签名字节、路径查询、重复头和协议 Bearer，不转发管理专用头", async () => {
        const source = Buffer.from('{  "message": "中文", "n":1 }\r\n');
        const upstream = await listen(
            createServer(async (req, res) => {
                const chunks: Buffer[] = [];
                for await (const chunk of req) chunks.push(Buffer.from(chunk));
                expect(Buffer.concat(chunks)).toEqual(source);
                expect(req.url).toBe("/callback/a%2Fb?signature=a%2Bb&x=1&x=2");
                expect(req.headers.authorization).toBe("Bearer platform-token");
                expect(req.headers["x-signature"]).toBe("bytes-signature");
                expect(req.headers["x-onebots-control-token"]).toBeUndefined();
                res.setHeader("set-cookie", ["a=1", "b=2"]);
                res.end("ok");
            }),
        );
        const port = await proxy(upstream);
        const response = await fetch(
            `http://127.0.0.1:${port}/callback/a%2Fb?signature=a%2Bb&x=1&x=2`,
            {
                method: "POST",
                body: source,
                headers: {
                    authorization: "Bearer platform-token",
                    "x-signature": "bytes-signature",
                    "content-type": "application/json",
                    "x-onebots-control-token": "private",
                },
            },
        );
        expect(await response.text()).toBe("ok");
        expect(response.headers.getSetCookie()).toEqual(["a=1", "b=2"]);
    });

    it("SSE 第一帧立即送达，客户端取消会关闭上游", async () => {
        let markClosed!: () => void;
        const closed = new Promise<void>(resolve => {
            markClosed = resolve;
        });
        const upstream = await listen(
            createServer((_req, res) => {
                res.writeHead(200, { "content-type": "text/event-stream" });
                res.write("data: first\n\n");
                res.once("close", markClosed);
            }),
        );
        const port = await proxy(upstream);
        const response = await fetch(`http://127.0.0.1:${port}/events`);
        const reader = response.body!.getReader();
        expect(new TextDecoder().decode((await reader.read()).value)).toBe("data: first\n\n");
        await reader.cancel();
        await closed;
    });

    it("上传中断传播给上游，不继续留下挂起请求", async () => {
        let markStarted!: () => void;
        let markAborted!: () => void;
        const started = new Promise<void>(resolve => {
            markStarted = resolve;
        });
        const aborted = new Promise<void>(resolve => {
            markAborted = resolve;
        });
        const upstream = await listen(
            createServer(req => {
                req.once("data", markStarted);
                req.once("aborted", markAborted);
            }),
        );
        const port = await proxy(upstream);
        const upload = request({ host: "127.0.0.1", port, method: "POST", path: "/upload" });
        upload.on("error", () => {
            /* 预期客户端主动取消产生连接错误。 */
        });
        upload.write(Buffer.alloc(1024));
        await started;
        upload.destroy();
        await aborted;
    });

    it("网关不可用返回固定 503，连接失败返回固定 502", async () => {
        const empty = await proxy();
        expect((await fetch(`http://127.0.0.1:${empty}/protocol`)).status).toBe(503);
        const unavailable = createServer();
        const unavailablePort = await listen(unavailable);
        await new Promise<void>(resolve => unavailable.close(() => resolve()));
        const broken = await proxy(unavailablePort);
        const response = await fetch(`http://127.0.0.1:${broken}/protocol`);
        expect(response.status).toBe(502);
        expect(await response.text()).toBe("网关连接失败");
    });

    it("真实 WebSocket 保留鉴权、双向二进制与关闭，并可由宿主回收", async () => {
        const server = createServer();
        const wsServer = new WebSocketServer({ server });
        let remote!: WebSocket;
        wsServer.on("connection", (socket, req) => {
            remote = socket;
            sockets.push(socket);
            expect(req.headers.authorization).toBe("Bearer protocol-secret");
            socket.send("first");
            socket.on("message", bytes => socket.send(bytes));
        });
        const upstream = await listen(server);
        const port = await proxy(upstream);
        const client = new WebSocket(`ws://127.0.0.1:${port}/api?x=1`, {
            headers: { authorization: "Bearer protocol-secret" },
        });
        sockets.push(client);
        const first = once(client, "message");
        await once(client, "open");
        expect((await first)[0].toString()).toBe("first");
        const reply = once(client, "message");
        client.send(Buffer.from([0, 255, 128, 13, 10]));
        expect((await reply)[0]).toEqual(Buffer.from([0, 255, 128, 13, 10]));
        const clientClosed = once(client, "close");
        const remoteClosed = once(remote, "close");
        for (const handle of handles) handle.close();
        await Promise.all([clientClosed, remoteClosed]);
        wsServer.close();
    });

    it("未启动网关的 WebSocket 返回 HTTP 503 并关闭", async () => {
        const port = await proxy();
        const client = new WebSocket(`ws://127.0.0.1:${port}/api`);
        sockets.push(client);
        client.on("error", () => {
            /* 预期升级被明确拒绝。 */
        });
        const response = once(client, "unexpected-response");
        const [, received] = await response;
        expect(received.statusCode).toBe(503);
        received.resume();
    });
});
