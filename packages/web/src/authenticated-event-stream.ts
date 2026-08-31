import { authFetch } from "./composables/useAuth.js";

export interface AuthenticatedEventStream {
    close(): void;
}

export interface AuthenticatedEventStreamOptions {
    onMessage(data: string): void;
    onOpen?(): void;
    onError?(error: unknown): void;
    retryMs?: number;
}

type AuthenticatedFetcher = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

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

    const connect = async () => {
        controller = new AbortController();
        try {
            const response = await fetcher(url, {
                headers: { Accept: "text/event-stream" },
                signal: controller.signal,
            });
            if (!response.ok) throw new Error(`事件流请求失败（HTTP ${response.status}）`);
            if (!response.body) throw new Error("事件流响应缺少可读正文");
            const contentType = response.headers.get("content-type") ?? "";
            if (!contentType.toLowerCase().includes("text/event-stream")) {
                throw new Error(`事件流响应类型无效：${contentType || "未声明"}`);
            }
            options.onOpen?.();
            await consumeEventStream(response.body, options.onMessage, controller.signal);
            if (!closed) throw new Error("事件流连接已结束");
        } catch (error) {
            if (closed || controller.signal.aborted) return;
            options.onError?.(error);
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
): Promise<void> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let dataLines: string[] = [];

    const processLine = (line: string) => {
        if (line === "") {
            if (dataLines.length) onMessage(dataLines.join("\n"));
            dataLines = [];
            return;
        }
        if (!line.startsWith("data:")) return;
        const value = line.slice(5);
        dataLines.push(value.startsWith(" ") ? value.slice(1) : value);
    };

    const processBuffer = (final: boolean) => {
        while (buffer && !signal.aborted) {
            const match = /\r\n|\r|\n/u.exec(buffer);
            if (!match) break;
            if (!final && match[0] === "\r" && match.index === buffer.length - 1) break;
            processLine(buffer.slice(0, match.index));
            buffer = buffer.slice(match.index + match[0].length);
        }
        if (final && buffer) {
            processLine(buffer);
            buffer = "";
        }
    };

    try {
        while (true) {
            if (signal.aborted) return;
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });
            processBuffer(false);
        }
        buffer += decoder.decode();
        processBuffer(true);
    } finally {
        reader.releaseLock();
    }
}
