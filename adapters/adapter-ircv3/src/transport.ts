import { connect as connectTcp, isIP } from "node:net";
import { connect as connectTls } from "node:tls";
import { readFile } from "node:fs/promises";
import { Ircv3LineDecoder, parseIrcv3Message } from "./codec.js";
import { Ircv3Error } from "./errors.js";
import type {
    Ircv3ConnectOptions,
    Ircv3Message,
    Ircv3Socket,
    Ircv3SocketAttachOptions,
} from "./types.js";

export async function connectIrcv3Socket(options: Ircv3ConnectOptions): Promise<Ircv3Socket> {
    options.signal.throwIfAborted();
    const [cert, key] = options.tls
        ? await Promise.all([
              readOptionalFile(options.tlsOptions.clientCertPath),
              readOptionalFile(options.tlsOptions.clientKeyPath),
          ])
        : [undefined, undefined];
    options.signal.throwIfAborted();
    return new Promise<Ircv3Socket>((resolve, reject) => {
        let settled = false;
        const socket = options.tls
            ? connectTls({
                  host: options.host,
                  port: options.port,
                  servername: options.tlsOptions.servername,
                  rejectUnauthorized: options.tlsOptions.rejectUnauthorized,
                  cert,
                  key,
                  passphrase: options.tlsOptions.clientKeyPassphrase,
              })
            : connectTcp({ host: options.host, port: options.port });
        const readyEvent = options.tls ? "secureConnect" : "connect";
        const finish = (error?: Error): void => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            options.signal.removeEventListener("abort", abort);
            socket.off(readyEvent, ready);
            socket.off("error", failed);
            if (error) {
                socket.destroy();
                reject(error);
            } else resolve(socket);
        };
        const ready = (): void => finish();
        const failed = (error: Error): void => finish(error);
        const abort = (): void =>
            finish(new Ircv3Error("IRC 连接已取消", { code: "IRCV3_ABORTED" }));
        const timer = setTimeout(
            () => finish(new Ircv3Error("IRC 连接超时", { code: "IRCV3_CONNECT_TIMEOUT" })),
            options.timeoutMs,
        );
        timer.unref?.();
        socket.once(readyEvent, ready);
        socket.once("error", failed);
        options.signal.addEventListener("abort", abort, { once: true });
        if (options.signal.aborted) abort();
    });
}

async function readOptionalFile(path: string | undefined): Promise<Buffer | undefined> {
    if (!path) return undefined;
    try {
        return await readFile(path);
    } catch (error) {
        throw new Ircv3Error(`无法读取 TLS 文件 ${path}`, {
            code: "IRCV3_TLS_FILE_ERROR",
            cause: error,
        });
    }
}

export interface Ircv3SocketBindingOptions {
    maxLineBytes: number;
    onMessage(message: Ircv3Message): void | Promise<void>;
    onClose(): void | Promise<void>;
    onError(error: Error): void | Promise<void>;
}

export function assertIrcv3SocketAttachment(
    socket: unknown,
    options: unknown,
): asserts socket is Ircv3Socket {
    if (typeof socket !== "object" || socket === null) {
        throw Ircv3Error.invalid("IRC socket 必须是对象", "IRCV3_INVALID_SOCKET");
    }
    const candidate = socket as Partial<Ircv3Socket>;
    if (
        typeof candidate.on !== "function" ||
        typeof candidate.off !== "function" ||
        (typeof candidate.write !== "function" && typeof candidate.send !== "function")
    ) {
        throw Ircv3Error.invalid(
            "IRC socket 必须提供 on/off 以及 write 或 send",
            "IRCV3_INVALID_SOCKET",
        );
    }
    if (typeof options !== "object" || options === null || Array.isArray(options)) {
        throw Ircv3Error.invalid("socket attach options 必须是对象");
    }
    const attachment = options as Ircv3SocketAttachOptions;
    for (const field of ["owned", "registered"] as const) {
        if (attachment[field] !== undefined && typeof attachment[field] !== "boolean") {
            throw Ircv3Error.invalid(`socket attach ${field} 必须是布尔值`);
        }
    }
    for (const field of ["nickname", "account", "server"] as const) {
        const value = attachment[field];
        if (value !== undefined && (typeof value !== "string" || /[\0\r\n]/u.test(value))) {
            throw Ircv3Error.invalid(`socket attach ${field} 必须是安全字符串`);
        }
    }
    assertStateRecord(attachment.enabledCapabilities, "enabledCapabilities");
    assertStateRecord(attachment.isupport, "isupport");
}

function assertStateRecord(value: unknown, field: string): void {
    if (value === undefined) return;
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw Ircv3Error.invalid(`socket attach ${field} 必须是对象`);
    }
    for (const [key, item] of Object.entries(value)) {
        if (!key || /[\0\r\n ]/u.test(key) || (item !== null && typeof item !== "string")) {
            throw Ircv3Error.invalid(`socket attach ${field}.${key || "<empty>"} 无效`);
        }
        if (typeof item === "string" && /[\0\r\n]/u.test(item)) {
            throw Ircv3Error.invalid(`socket attach ${field}.${key} 包含控制字符`);
        }
    }
}

/** 将 byte-stream 或 message-framed socket 适配为严格 IRC message 流。 */
export class Ircv3SocketBinding {
    private readonly decoder: Ircv3LineDecoder;
    private deliveryQueue: Promise<void> = Promise.resolve();
    private detached = false;

    constructor(
        readonly socket: Ircv3Socket,
        private readonly options: Ircv3SocketBindingOptions,
    ) {
        this.decoder = new Ircv3LineDecoder(options.maxLineBytes);
        socket.on("data", this.onData);
        socket.on("message", this.onFrame);
        socket.on("close", this.onClose);
        socket.on("error", this.onError);
    }

    write(line: string): void {
        if (this.detached)
            throw new Ircv3Error("IRC socket 未连接", { code: "IRCV3_NOT_CONNECTED" });
        if (this.socket.write) this.socket.write(line);
        else if (this.socket.send) this.socket.send(line);
        else throw new Ircv3Error("IRC socket 不支持写入", { code: "IRCV3_SOCKET_NOT_WRITABLE" });
    }

    detach(close = false): void {
        if (this.detached) return;
        this.detached = true;
        this.socket.off("data", this.onData);
        this.socket.off("message", this.onFrame);
        this.socket.off("close", this.onClose);
        this.socket.off("error", this.onError);
        if (!close) return;
        if (this.socket.end) this.socket.end();
        else if (this.socket.close) this.socket.close();
        else this.socket.destroy?.();
    }

    drain(): Promise<void> {
        return this.deliveryQueue;
    }

    private readonly onData = (value: unknown): void => {
        try {
            const chunk = toChunk(value);
            for (const line of this.decoder.push(chunk)) this.deliver(parseIrcv3Message(line));
        } catch (error) {
            this.fail(error);
        }
    };

    private readonly onFrame = (value: unknown): void => {
        try {
            const frame = toChunk(value);
            const text = typeof frame === "string" ? frame : Buffer.from(frame).toString("utf8");
            const lines = text.includes("\r\n") ? this.decoder.push(text) : [text];
            for (const line of lines) {
                if (line) this.deliver(parseIrcv3Message(line, this.options.maxLineBytes));
            }
        } catch (error) {
            this.fail(error);
        }
    };

    private readonly onClose = (): void => {
        if (this.detached) return;
        this.detach();
        try {
            this.decoder.finish();
        } catch (error) {
            this.fail(error);
        }
        void this.deliveryQueue.then(() => this.options.onClose()).catch(error => this.fail(error));
    };

    private readonly onError = (error: Error): void => this.fail(error);

    private deliver(message: Ircv3Message): void {
        this.deliveryQueue = this.deliveryQueue
            .then(() => this.options.onMessage(message))
            .catch(error => this.fail(error));
    }

    private fail(error: unknown): void {
        const wrapped = Ircv3Error.wrap(error, "IRC socket 处理失败", "IRCV3_SOCKET_ERROR");
        void Promise.resolve(this.options.onError(wrapped)).catch(() => undefined);
    }
}

export function defaultIrcv3Servername(host: string): string | undefined {
    return isIP(host) === 0 ? host : undefined;
}

function toChunk(value: unknown): Uint8Array | string {
    if (typeof value === "string" || value instanceof Uint8Array) return value;
    if (value instanceof ArrayBuffer) return new Uint8Array(value);
    if (
        typeof value === "object" &&
        value !== null &&
        "data" in value &&
        (typeof value.data === "string" || value.data instanceof Uint8Array)
    ) {
        return value.data;
    }
    throw Ircv3Error.invalid("IRC socket 收到不支持的帧类型", "IRCV3_INVALID_FRAME");
}
