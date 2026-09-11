import type { Server, ListenOptions } from "node:net";

/** 监听与启动取消使用同一信号，覆盖尚未完成地址绑定的窗口。 */
export function listenHttpServer(
    server: Server,
    options: Omit<ListenOptions, "signal">,
    signal?: AbortSignal,
): Promise<void> {
    return new Promise((resolve, reject) => {
        const cleanup = () => {
            server.removeListener("error", onError);
            server.removeListener("listening", onListening);
            signal?.removeEventListener("abort", onAbort);
        };
        const onError = (error: Error) => {
            cleanup();
            reject(error);
        };
        const onAbort = () => {
            cleanup();
            reject(signal?.reason ?? new DOMException("HTTP 启动已取消", "AbortError"));
        };
        const onListening = () => {
            cleanup();
            resolve();
        };
        if (signal?.aborted) {
            onAbort();
            return;
        }
        server.once("error", onError);
        server.once("listening", onListening);
        signal?.addEventListener("abort", onAbort, { once: true });
        try {
            // Node 自身负责取消正在进行的 listen；只拒绝 Promise 不能阻止迟到绑定。
            server.listen({ ...options, signal });
        } catch (error) {
            cleanup();
            reject(error);
        }
    });
}
