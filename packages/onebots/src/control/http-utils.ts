import type http from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

export function jsonResponse(response: ServerResponse, status: number, value: unknown): void {
    response.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
    });
    response.end(JSON.stringify(value));
}

export function listen(server: http.Server, port: number | string, host?: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const error = (cause: Error) => reject(cause);
        server.once("error", error);
        const ready = () => {
            server.off("error", error);
            resolve();
        };
        if (typeof port === "string") server.listen(port, ready);
        else server.listen(port, host, ready);
    });
}

export async function readBody(
    request: IncomingMessage,
    limit = 16_384,
): Promise<Record<string, unknown>> {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const value of request) {
        const chunk = Buffer.from(value);
        size += chunk.length;
        if (size > limit) throw new Error("控制请求过大");
        chunks.push(chunk);
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("控制请求无效");
    return parsed as Record<string, unknown>;
}
