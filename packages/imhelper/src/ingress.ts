export interface BufferedHttpIngressRequest {
    readonly method?: string;
    readonly body: unknown;
}

export interface StreamingHttpIngressRequest {
    readonly method?: string;
    readonly body?: undefined;
    [Symbol.asyncIterator](): AsyncIterator<unknown>;
}

export type HttpIngressRequest = BufferedHttpIngressRequest | StreamingHttpIngressRequest;

export interface HttpIngressResponseWriter {
    writeHead(status: number, headers: Record<string, string>): unknown;
    end(body: string): unknown;
}

export interface HttpIngressResult {
    status: number;
    headers: Record<string, string>;
    body: {
        status: "ok" | "error";
        message?: string;
    };
}

export interface UpgradedWebSocket {
    on(event: "message", listener: (data: unknown) => void): unknown;
    off?(event: "message", listener: (data: unknown) => void): unknown;
    removeListener?(event: "message", listener: (data: unknown) => void): unknown;
    close?(code?: number, reason?: string): unknown;
}

export const DEFAULT_MAX_INGRESS_BYTES = 1024 * 1024;

const jsonHeaders = { "content-type": "application/json; charset=utf-8" };

class PayloadTooLargeError extends Error {}

function assertPayloadSize(byteLength: number): void {
    if (byteLength > DEFAULT_MAX_INGRESS_BYTES) {
        throw new PayloadTooLargeError("事件载荷过大");
    }
}

function parseJson(value: string): unknown {
    return JSON.parse(value) as unknown;
}

function parseBufferedBody(body: unknown): unknown {
    if (typeof body === "string") {
        assertPayloadSize(Buffer.byteLength(body));
        return parseJson(body);
    }
    if (Buffer.isBuffer(body)) {
        assertPayloadSize(body.byteLength);
        return parseJson(body.toString("utf8"));
    }
    if (body instanceof Uint8Array) {
        assertPayloadSize(body.byteLength);
        return parseJson(Buffer.from(body).toString("utf8"));
    }
    assertPayloadSize(Buffer.byteLength(JSON.stringify(body)));
    return body;
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
    return (
        typeof value === "object" &&
        value !== null &&
        "getReader" in value &&
        typeof value.getReader === "function"
    );
}

async function readWebStream(stream: ReadableStream<Uint8Array>): Promise<unknown> {
    const reader = stream.getReader();
    const chunks: Buffer[] = [];
    let byteLength = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            if (!(value instanceof Uint8Array)) {
                throw new TypeError("HTTP 事件请求体必须是二进制数据");
            }
            byteLength += value.byteLength;
            assertPayloadSize(byteLength);
            chunks.push(Buffer.from(value));
        }
    } finally {
        reader.releaseLock();
    }
    return parseJson(Buffer.concat(chunks).toString("utf8"));
}

async function readRequestBody(request: HttpIngressRequest): Promise<unknown> {
    if (isReadableStream(request.body)) {
        return readWebStream(request.body);
    }
    if (request.body !== undefined) {
        return parseBufferedBody(request.body);
    }

    if (!(Symbol.asyncIterator in request)) {
        return request.body;
    }

    const chunks: Buffer[] = [];
    let byteLength = 0;
    for await (const chunk of request) {
        let buffer: Buffer;
        if (typeof chunk === "string") {
            buffer = Buffer.from(chunk);
        } else if (Buffer.isBuffer(chunk) || chunk instanceof Uint8Array) {
            buffer = Buffer.from(chunk);
        } else {
            throw new TypeError("HTTP 事件请求体必须是字符串或二进制数据");
        }
        byteLength += buffer.byteLength;
        assertPayloadSize(byteLength);
        chunks.push(buffer);
    }
    return parseJson(Buffer.concat(chunks).toString("utf8"));
}

function createHttpResult(status: number, body: HttpIngressResult["body"]): HttpIngressResult {
    return { status, headers: jsonHeaders, body };
}

function writeHttpResult(
    response: HttpIngressResponseWriter | undefined,
    result: HttpIngressResult,
): void {
    if (!response) {
        return;
    }
    response.writeHead(result.status, result.headers);
    response.end(JSON.stringify(result.body));
}

export async function acceptHttpIngress<TRawEvent = unknown>(
    request: HttpIngressRequest,
    response: HttpIngressResponseWriter | undefined,
    ingest: (rawEvent: TRawEvent) => void,
): Promise<HttpIngressResult> {
    let result: HttpIngressResult;

    if (request.method && request.method.toUpperCase() !== "POST") {
        result = createHttpResult(405, { status: "error", message: "仅支持 POST 请求" });
    } else {
        let rawEvent: unknown;
        try {
            rawEvent = await readRequestBody(request);
        } catch (error) {
            const tooLarge = error instanceof PayloadTooLargeError;
            result = createHttpResult(tooLarge ? 413 : 400, {
                status: "error",
                message: tooLarge ? "事件载荷过大" : "JSON 事件载荷无效",
            });
            writeHttpResult(response, result);
            return result;
        }

        try {
            ingest(rawEvent as TRawEvent);
            result = createHttpResult(200, { status: "ok" });
        } catch {
            result = createHttpResult(500, {
                status: "error",
                message: "事件摄取失败",
            });
        }
    }

    writeHttpResult(response, result);
    return result;
}

function parseWebSocketData(data: unknown): unknown {
    if (typeof data === "string") {
        assertPayloadSize(Buffer.byteLength(data));
        return parseJson(data);
    }
    if (Buffer.isBuffer(data)) {
        assertPayloadSize(data.byteLength);
        return parseJson(data.toString("utf8"));
    }
    if (data instanceof ArrayBuffer) {
        assertPayloadSize(data.byteLength);
        return parseJson(Buffer.from(data).toString("utf8"));
    }
    if (ArrayBuffer.isView(data)) {
        assertPayloadSize(data.byteLength);
        return parseJson(
            Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8"),
        );
    }
    if (Array.isArray(data) && data.every(Buffer.isBuffer)) {
        assertPayloadSize(data.reduce((total, item) => total + item.byteLength, 0));
        return parseJson(Buffer.concat(data).toString("utf8"));
    }
    throw new TypeError("WebSocket 事件必须是 JSON 文本或二进制数据");
}

export function acceptWebSocketIngress<TRawEvent = unknown>(
    socket: UpgradedWebSocket,
    ingest: (rawEvent: TRawEvent) => void,
): () => void {
    const listener = (data: unknown): void => {
        try {
            ingest(parseWebSocketData(data) as TRawEvent);
        } catch (error) {
            if (error instanceof PayloadTooLargeError) {
                socket.close?.(1009, "事件载荷过大");
            } else {
                socket.close?.(1007, "事件载荷无效");
            }
        }
    };

    socket.on("message", listener);
    return () => {
        if (socket.off) {
            socket.off("message", listener);
        } else {
            socket.removeListener?.("message", listener);
        }
    };
}
