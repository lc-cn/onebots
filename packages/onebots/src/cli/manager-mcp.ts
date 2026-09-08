import path from "node:path";
import type { Readable, Writable } from "node:stream";
import { createLocalControlClient } from "../client/local-control.js";
export interface McpManagerClient {
    openMcp(account?: string): Promise<{ id: string; gatewayInstanceId: string }>;
    exchangeMcp(id: string, message: string): Promise<{ message: string | null }>;
    pollMcp(id: string): Promise<{ events: string[] }>;
    closeMcp(id: string): Promise<{ closed: true }>;
}
export interface McpSignalSource {
    once(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
    off(event: "SIGINT" | "SIGTERM", listener: () => void): unknown;
}
export const MCP_HELP =
    "onebots mcp [--data-dir 工作区] [--account 平台/账号]\n连接已有管理服务的 MCP 会话，不启动账号或网关。";
export function parseMcpOptions(args: string[]) {
    if (args.length === 1 && ["--help", "-h"].includes(args[0])) return null;
    const values = new Map<string, string>();
    for (let index = 0; index < args.length; index += 2) {
        const key = args[index],
            value = args[index + 1];
        if (
            !["--data-dir", "--account"].includes(key) ||
            values.has(key) ||
            !value ||
            value.startsWith("-") ||
            /[\0\r\n]/.test(value)
        )
            throw new Error("MCP 参数无效；请用 --data-dir 和 --account，不再接受旧配置或插件参数");
        values.set(key, value);
    }
    const account = values.get("--account");
    if (
        account &&
        (account.length > 1024 ||
            account.indexOf("/") < 1 ||
            account.endsWith("/") ||
            /[\u0000-\u001f\u007f]/.test(account))
    )
        throw new Error("--account 必须为平台/账号");
    return {
        workspace: path.resolve(
            values.get("--data-dir") ?? process.env.ONEBOTS_WORKSPACE ?? process.cwd(),
        ),
        account,
    };
}
const failure = () => new Error("MCP 管理连接或消息状态未确认，已退出且不会重放调用");
function bounded<T>(promise: Promise<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(failure()), 30_000);
        promise.then(
            value => {
                clearTimeout(timer);
                resolve(value);
            },
            () => {
                clearTimeout(timer);
                reject(failure());
            },
        );
    });
}
function frame(value: string): void {
    if (typeof value !== "string" || Buffer.byteLength(value) > 65536 || /[\r\n]/.test(value))
        throw failure();
    const parsed: unknown = JSON.parse(value);
    if (
        !parsed ||
        typeof parsed !== "object" ||
        Array.isArray(parsed) ||
        (parsed as { jsonrpc?: unknown }).jsonrpc !== "2.0"
    )
        throw failure();
}
export async function bridgeManagerMcp(
    client: McpManagerClient,
    input: Readable,
    output: Writable,
    account?: string,
    signals: McpSignalSource = process,
): Promise<void> {
    const session = await bounded(client.openMcp(account));
    let closing = false,
        failed = false,
        ended = false,
        busy = false,
        queuedBytes = 0;
    let pending = Buffer.alloc(0),
        timer: ReturnType<typeof setTimeout> | undefined;
    const queue: string[] = [];
    let writing = Promise.resolve();
    let complete!: () => void;
    const done = new Promise<void>(resolve => {
        complete = resolve;
    });
    const fail = () => {
        closing = true;
        failed = true;
        complete();
    };
    const finish = () => {
        if (ended && !busy && queue.length === 0) complete();
    };
    const send = (message: string) => {
        frame(message);
        writing = writing.then(() =>
            bounded(
                new Promise<void>((resolve, reject) => {
                    output.write(`${message}\n`, error => (error ? reject(error) : resolve()));
                }),
            ),
        );
        return writing;
    };
    async function drain() {
        if (busy || failed) return;
        busy = true;
        try {
            while (queue.length && !closing) {
                const message = queue.shift()!;
                const result = await bounded(client.exchangeMcp(session.id, message));
                queuedBytes -= Buffer.byteLength(message);
                if (!closing && result.message !== null) await send(result.message);
            }
        } catch {
            fail();
        } finally {
            busy = false;
            finish();
        }
    }
    const data = (chunk: Buffer | string) => {
        try {
            pending = Buffer.concat([pending, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
            if (pending.length + queuedBytes > 262144) throw failure();
            let newline: number;
            while ((newline = pending.indexOf(10)) >= 0) {
                const bytes = pending.subarray(0, newline);
                pending = pending.subarray(newline + 1);
                const message = new TextDecoder("utf-8", { fatal: true })
                    .decode(bytes)
                    .replace(/\r$/, "");
                frame(message);
                if (queue.length + (busy ? 1 : 0) >= 32) throw failure();
                queue.push(message);
                queuedBytes += Buffer.byteLength(message);
            }
            if (pending.length > 65536) throw failure();
            void drain();
        } catch {
            fail();
        }
    };
    const end = () => {
        if (pending.length) fail();
        else {
            ended = true;
            finish();
        }
    };
    const signal = () => {
        closing = true;
        ended = true;
        complete();
    };
    async function poll() {
        try {
            const result = await bounded(client.pollMcp(session.id));
            if (
                !Array.isArray(result.events) ||
                result.events.length > 32 ||
                result.events.reduce((size, value) => size + Buffer.byteLength(value), 0) > 262144
            )
                throw failure();
            for (const message of result.events) {
                if (ended || failed) break;
                await send(message);
            }
        } catch {
            fail();
        }
        if (!ended && !failed) timer = setTimeout(() => void poll(), 500);
    }
    input.on("data", data);
    input.once("end", end);
    input.once("error", fail);
    output.on("error", fail);
    signals.once("SIGINT", signal);
    signals.once("SIGTERM", signal);
    timer = setTimeout(() => void poll(), 500);
    if (input.readableEnded) end();
    try {
        await done;
    } finally {
        closing = true;
        ended = true;
        if (timer) clearTimeout(timer);
        input.pause();
        input.off("data", data);
        input.off("end", end);
        input.off("error", fail);
        signals.off("SIGINT", signal);
        signals.off("SIGTERM", signal);
        try {
            await bounded(client.closeMcp(session.id));
            await writing;
        } catch {
            failed = true;
        }
        output.off("error", fail);
    }
    if (failed) throw failure();
}
export async function runManagerMcp(args: string[]): Promise<void> {
    const options = parseMcpOptions(args);
    if (!options) {
        process.stdout.write(`${MCP_HELP}\n`);
        return;
    }
    try {
        await bridgeManagerMcp(
            createLocalControlClient(options.workspace),
            process.stdin,
            process.stdout,
            options.account,
        );
    } catch {
        process.stderr.write(`${failure().message}\n`);
        process.exitCode = 1;
    }
}
