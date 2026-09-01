import { authFetch } from "./composables/useAuth.js";

export interface AuthenticatedEventStream {
    close(): void;
}

export interface AuthenticatedEventStreamOptions {
    onMessage(data: string): void;
    onOpen?(): void;
    onError?(error: unknown): void;
    retryMs?: number;
    maxEventBytes?: number;
}

type AuthenticatedFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export const AUTHENTICATED_EVENT_STREAM_EVENT_LIMIT_BYTES = 1024 * 1024;

export class EventStreamEventTooLargeError extends Error {
    constructor(limitBytes: number) {
        super(`事件流单个事件超过 ${formatByteLimit(limitBytes)} 上限`);
        this.name = "EventStreamEventTooLargeError";
    }
}

/** 使用 Authorization 请求头建立可取消、可重连的管理 SSE，避免把长期令牌写进 URL。 */
export function openAuthenticatedEventStream(
    url: string,
    options: AuthenticatedEventStreamOptions,
    fetcher: AuthenticatedFetcher = authFetch,
): AuthenticatedEventStream {
    let closed = false;
    let controller: AbortController | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    const retryMs = options.retryMs ?? 5_000;
    const maxEventBytes = options.maxEventBytes ?? AUTHENTICATED_EVENT_STREAM_EVENT_LIMIT_BYTES;
    if (
        !Number.isSafeInteger(maxEventBytes) ||
        maxEventBytes <= 0 ||
        maxEventBytes > AUTHENTICATED_EVENT_STREAM_EVENT_LIMIT_BYTES
    ) {
        throw new RangeError("事件流单事件上限必须是 1 到 1 MiB 之间的安全整数");
    }

    const connect = async () => {
        controller = new AbortController();
        try {
            const response = await fetcher(url, {
                headers: { Accept: "text/event-stream" },
                signal: controller.signal,
            });
            if (!response.ok) {
                await cancelResponseBody(response.body);
                throw new Error(`事件流请求失败（HTTP ${response.status}）`);
            }
            if (!response.body) throw new Error("事件流响应缺少可读正文");
            const contentType = response.headers.get("content-type") ?? "";
            if (!contentType.toLowerCase().includes("text/event-stream")) {
                await cancelResponseBody(response.body);
                throw new Error(`事件流响应类型无效：${contentType || "未声明"}`);
            }
            options.onOpen?.();
            await consumeEventStream(
                response.body,
                options.onMessage,
                controller.signal,
                maxEventBytes,
            );
            if (!closed) throw new Error("事件流连接已结束");
        } catch (error) {
            if (closed || controller.signal.aborted) return;
            options.onError?.(error);
            if (error instanceof EventStreamEventTooLargeError) {
                closed = true;
                return;
            }
            retryTimer = setTimeout(() => void connect(), retryMs);
        }
    };

    void connect();
    return {
        close() {
            if (closed) return;
            closed = true;
            if (retryTimer) clearTimeout(retryTimer);
            controller?.abort();
        },
    };
}

async function consumeEventStream(
    stream: ReadableStream<Uint8Array>,
    onMessage: (data: string) => void,
    signal: AbortSignal,
    maxEventBytes: number,
): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    const lineBuffer = new Uint8Array(maxEventBytes);
    let lineLength = 0;
    let eventBytes = 0;
    let pendingCarriageReturn = false;
    let dataLines: string[] = [];

    const processLine = () => {
        const line = decoder.decode(lineBuffer.subarray(0, lineLength));
        lineLength = 0;
        if (line === "") {
            if (dataLines.length) onMessage(dataLines.join("\n"));
            dataLines = [];
            eventBytes = 0;
            return;
        }
        if (!line.startsWith("data:")) return;
        const value = line.slice(5);
        dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
    };

    const assertCapacity = (additionalBytes: number) => {
        if (eventBytes + lineLength + additionalBytes > maxEventBytes) {
            throw new EventStreamEventTooLargeError(maxEventBytes);
        }
    };

    const finishLine = (delimiterBytes: number) => {
        assertCapacity(delimiterBytes);
        eventBytes += lineLength + delimiterBytes;
        processLine();
    };

    const appendByte = (byte: number) => {
        assertCapacity(1);
        lineBuffer[lineLength] = byte;
        lineLength += 1;
    };

    const processByte = (byte: number) => {
        if (pendingCarriageReturn) {
            pendingCarriageReturn = false;
            if (byte === 0x0a) {
                finishLine(2);
                return;
            }
            finishLine(1);
        }

        if (byte === 0x0d) {
            pendingCarriageReturn = true;
            assertCapacity(1);
            return;
        }
        if (byte === 0x0a) {
            finishLine(1);
            return;
        }
        appendByte(byte);
    };

    try {
        while (true) {
            if (signal.aborted) return;
            const { done, value } = await reader.read();
            if (done) break;
            for (const byte of value) {
                if (signal.aborted) return;
                processByte(byte);
            }
        }
        if (pendingCarriageReturn) finishLine(1);
        else if (lineLength > 0) finishLine(0);
    } catch (error) {
        await Promise.allSettled([reader.cancel(error)]);
        throw error;
    } finally {
        reader.releaseLock();
    }
}

function formatByteLimit(bytes: number): string {
    if (bytes % (1024 * 1024) === 0) return `${bytes / (1024 * 1024)} MiB`;
    if (bytes % 1024 === 0) return `${bytes / 1024} KiB`;
    return `${bytes} 字节`;
}

async function cancelResponseBody(body: ReadableStream<Uint8Array> | null): Promise<void> {
    if (!body) return;
    await Promise.allSettled([body.cancel()]);
}
