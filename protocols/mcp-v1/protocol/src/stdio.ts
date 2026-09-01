/**
 * MCP v1 stdio 传输
 *
 * 通过 stdin/stdout 提供 JSON-RPC 通信，供 Cursor / Claude Code 等 Agent 使用。
 * 用法: onebots mcp --config config.yaml --account qq/my-bot
 */
import * as readline from "node:readline";
import type { Readable, Writable } from "node:stream";

interface StdioProtocol {
    handleStdioMessage(line: string): Promise<string | null>;
    sendStdioNotification(notification: Record<string, unknown>): string;
    on(event: "dispatch", listener: (event: Record<string, unknown>) => void): unknown;
    off(event: "dispatch", listener: (event: Record<string, unknown>) => void): unknown;
}

export interface StdioOptions {
    protocol: StdioProtocol;
    onClose?: () => void | Promise<void>;
    onError?: (error: unknown) => void;
    input?: Readable;
    output?: Pick<Writable, "write">;
}

/** 启动顺序化的 stdio 传输；输入关闭会等待已接收请求处理完毕后再清理。 */
export function startStdioTransport(options: StdioOptions): void {
    const { protocol, onClose, onError, input = process.stdin, output = process.stdout } = options;
    let initialized = false;
    let processing = Promise.resolve();
    let closePromise: Promise<void> | undefined;

    const reportError = (error: unknown) => {
        if (!onError) {
            process.stderr.write("[onebots:mcp] stdio 消息处理失败\n");
            return;
        }
        try {
            onError(error);
        } catch {
            process.stderr.write("[onebots:mcp] stdio 错误回调执行失败\n");
        }
    };
    const writeResponse = (data: string) => {
        try {
            output.write(`${data}\n`);
        } catch (error) {
            reportError(error);
        }
    };

    const rl = readline.createInterface({ input, terminal: false });
    rl.on("line", line => {
        const trimmed = line.trim();
        if (!trimmed) return;
        processing = processing.then(async () => {
            try {
                const response = await protocol.handleStdioMessage(trimmed);
                if (!initialized && isInitializeRequest(trimmed)) initialized = true;
                if (response !== null) writeResponse(response);
            } catch (error) {
                reportError(error);
                const response = internalErrorResponse(trimmed);
                if (response) writeResponse(response);
            }
        });
    });

    const onDispatch = (event: Record<string, unknown>) => {
        if (!initialized) return;
        try {
            writeResponse(
                protocol.sendStdioNotification({
                    method: "notifications/message",
                    params: event,
                }),
            );
        } catch (error) {
            reportError(error);
        }
    };
    protocol.on("dispatch", onDispatch);

    const close = () => {
        closePromise ??= processing.then(async () => {
            protocol.off("dispatch", onDispatch);
            await onClose?.();
        });
        void closePromise.catch(reportError);
    };
    rl.once("close", close);
    input.once("end", close);
}

function isInitializeRequest(line: string): boolean {
    try {
        const request: unknown = JSON.parse(line);
        return (
            typeof request === "object" &&
            request !== null &&
            "method" in request &&
            request.method === "initialize"
        );
    } catch {
        // JSON 解析错误由协议处理器生成标准响应，不能建立 initialized 状态。
        return false;
    }
}

function internalErrorResponse(line: string): string | null {
    let id: string | number | null | undefined;
    try {
        const request: unknown = JSON.parse(line);
        if (typeof request === "object" && request !== null && "id" in request) {
            const candidate = request.id;
            if (typeof candidate === "string" || typeof candidate === "number") id = candidate;
            else if (candidate === null) id = null;
        }
    } catch {
        return null;
    }
    if (id === undefined || id === null) return null;
    return JSON.stringify({
        jsonrpc: "2.0",
        id,
        error: { code: -32603, message: "内部错误" },
    });
}
