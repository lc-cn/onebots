import { request, type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";

export interface GatewayProxyAddress {
    host: "127.0.0.1";
    port: number;
}

/** 宿主在退出或切换实例时回收正在进行的请求和隧道。 */
export interface GatewayProxyHandle {
    close(): void;
}

function validAddress(address: GatewayProxyAddress | undefined): address is GatewayProxyAddress {
    return (
        !!address &&
        address.host === "127.0.0.1" &&
        Number.isInteger(address.port) &&
        address.port > 0 &&
        address.port <= 65535
    );
}

function headers(req: IncomingMessage): string[] {
    const result: string[] = [];
    for (let index = 0; index < req.rawHeaders.length; index += 2) {
        const name = req.rawHeaders[index];
        if (/^(?:x-onebots-(?:control|management)-token|proxy-authorization)$/i.test(name))
            continue;
        result.push(name, req.rawHeaders[index + 1]);
    }
    return result;
}

function unavailable(res: ServerResponse, code: 502 | 503): void {
    if (res.headersSent) {
        res.destroy();
        return;
    }
    res.writeHead(code, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
    });
    res.end(code === 503 ? "网关暂不可用" : "网关连接失败");
}

/** 不读取或重新编码请求体；保留签名依赖的路径、头和字节，pipe 提供背压。 */
export function proxyGatewayHttp(
    req: IncomingMessage,
    res: ServerResponse,
    address?: GatewayProxyAddress,
): GatewayProxyHandle {
    if (!validAddress(address)) {
        unavailable(res, 503);
        return { close() {} };
    }
    const upstream = request({
        hostname: address.host,
        port: address.port,
        method: req.method,
        path: req.url,
        headers: headers(req),
        agent: false,
    });
    let response: IncomingMessage | undefined;
    const close = () => {
        upstream.destroy();
        response?.destroy();
        if (!res.writableFinished) res.destroy();
    };
    req.once("aborted", close);
    req.once("error", close);
    res.once("close", close);
    res.once("error", close);
    upstream.once("error", () => unavailable(res, 502));
    upstream.once("response", received => {
        response = received;
        received.once("error", () => res.destroy());
        received.once("aborted", () => res.destroy());
        if (res.destroyed) {
            received.destroy();
            return;
        }
        res.writeHead(received.statusCode ?? 502, received.statusMessage, received.rawHeaders);
        received.pipe(res);
    });
    req.pipe(upstream);
    return { close };
}

function rejectUpgrade(socket: Duplex, code: 502 | 503): void {
    if (socket.destroyed) return;
    socket.end(
        `HTTP/1.1 ${code} ${code === 503 ? "Service Unavailable" : "Bad Gateway"}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`,
        () => socket.destroy(),
    );
}

function rejectFromGateway(socket: Duplex, response: IncomingMessage): void {
    if (socket.destroyed) return;
    const body = Buffer.from("网关拒绝 WebSocket 升级");
    const lines = [
        `HTTP/1.1 ${response.statusCode ?? 502} ${response.statusMessage || "Gateway Response"}`,
        "Connection: close",
        "Content-Type: text/plain; charset=utf-8",
        `Content-Length: ${body.length}`,
    ];
    // 保留协议认证/重试所需字段，错误体固定且有界，不转发任意大错误页面。
    for (let index = 0; index < response.rawHeaders.length; index += 2) {
        if (
            /^(?:www-authenticate|retry-after|sec-websocket-version|location)$/i.test(
                response.rawHeaders[index],
            )
        ) {
            lines.push(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}`);
        }
    }
    socket.end(Buffer.concat([Buffer.from(lines.join("\r\n") + "\r\n\r\n"), body]), () =>
        socket.destroy(),
    );
}

/** 网关决定 WS 鉴权与路由；控制宿主只向已验证的子进程地址转发。 */
export function proxyGatewayUpgrade(
    req: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    address?: GatewayProxyAddress,
): GatewayProxyHandle {
    socket.once("error", () => socket.destroy());
    if (!validAddress(address)) {
        rejectUpgrade(socket, 503);
        return { close: () => socket.destroy() };
    }
    const upstream = request({
        hostname: address.host,
        port: address.port,
        method: req.method,
        path: req.url,
        headers: headers(req),
        agent: false,
    });
    let peer: Duplex | undefined;
    let upgraded = false;
    const close = () => {
        upstream.destroy();
        peer?.destroy();
        socket.destroy();
    };
    socket.once("error", close);
    socket.once("close", close);
    upstream.once("error", () => {
        if (upgraded) close();
        else rejectUpgrade(socket, 502);
    });
    upstream.once("upgrade", (response, remote, remoteHead) => {
        upgraded = true;
        peer = remote;
        if (socket.destroyed) {
            close();
            return;
        }
        remote.once("error", close);
        remote.once("close", close);
        const lines = [`HTTP/1.1 ${response.statusCode} ${response.statusMessage}`];
        for (let index = 0; index < response.rawHeaders.length; index += 2) {
            lines.push(`${response.rawHeaders[index]}: ${response.rawHeaders[index + 1]}`);
        }
        socket.write(lines.join("\r\n") + "\r\n\r\n");
        if (remoteHead.length) socket.write(remoteHead);
        if (head.length) remote.write(head);
        remote.pipe(socket);
        socket.pipe(remote);
    });
    upstream.once("response", response => {
        // 合法 HTTP 拒绝是协议结果；只有连接错误才映射为 502。
        rejectFromGateway(socket, response);
        response.destroy();
    });
    upstream.end();
    return { close };
}
