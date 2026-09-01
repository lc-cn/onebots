import * as fs from "fs";
import * as path from "path";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import type { ServerResponse } from "node:http";
import { ManagementStreamClients } from "./management-stream-clients.js";

export class LogCacheManager {
    public readonly cacheFile: string;
    private readonly streamClients = new ManagementStreamClients();
    private writeStream!: fs.WriteStream;
    private restoreStdio?: () => void;
    private cleanupPromise?: Promise<void>;
    private isClosing = false;

    get clients(): Set<ServerResponse> {
        return this.streamClients.clients;
    }

    constructor(cacheFile: string) {
        this.cacheFile = cacheFile;
        this.init();
    }

    private init() {
        const dataDir = path.dirname(this.cacheFile);
        if (!existsSync(dataDir)) {
            mkdirSync(dataDir, { recursive: true, mode: 0o700 });
        }
        writeFileSync(this.cacheFile, "", "utf-8");
        this.writeStream = fs.createWriteStream(this.cacheFile, { flags: "a", encoding: "utf-8" });
    }

    broadcast(message: string) {
        if (this.isClosing || this.clients.size === 0 || !message) return;
        const terminalMessage = message.replace(/\n/g, "\r\n");
        const data = `data: ${JSON.stringify({ message: terminalMessage })}\n\n`;
        for (const client of this.clients) {
            try {
                client.write(data);
            } catch {
                this.removeClient(client);
            }
        }
    }

    cache(message: string) {
        if (!this.isClosing && this.writeStream && message) {
            this.writeStream.write(message);
        }
    }

    registerClient(client: ServerResponse, dispose: () => void): void {
        if (this.isClosing) {
            try {
                dispose();
            } finally {
                try {
                    client.end();
                } catch {
                    // 停机期间到达的响应可能已由 HTTP 层关闭。
                }
            }
            return;
        }
        this.streamClients.register(client, dispose);
    }

    removeClient(client: ServerResponse): void {
        this.streamClients.remove(client);
    }

    disconnectClients(): unknown[] {
        return this.streamClients.disconnectAll();
    }

    cleanup(): Promise<void> {
        this.cleanupPromise ??= this.performCleanup();
        return this.cleanupPromise;
    }

    cleanupSync(): void {
        if (this.isClosing) return;
        this.beginCleanup();
        try {
            this.writeStream.end();
        } catch {
            // process exit 无法等待异步清理，完整错误传播由正常 close 生命周期负责。
        }
    }

    private async performCleanup(): Promise<void> {
        const failures = this.beginCleanup();
        try {
            await this.closeWriteStream();
        } catch (error) {
            failures.push(error);
        }
        try {
            if (existsSync(this.cacheFile)) {
                await fs.promises.writeFile(this.cacheFile, "", "utf8");
            }
        } catch (error) {
            failures.push(error);
        }
        if (failures.length === 1) throw failures[0];
        if (failures.length > 1) {
            throw new AggregateError(failures, `${failures.length} 个日志缓存清理操作失败`);
        }
    }

    private beginCleanup(): unknown[] {
        this.isClosing = true;
        this.restoreStdio?.();
        this.restoreStdio = undefined;
        return this.disconnectClients();
    }

    private closeWriteStream(): Promise<void> {
        if (this.writeStream.closed) return Promise.resolve();
        return new Promise<void>((resolve, reject) => {
            const onClose = () => {
                this.writeStream.off("error", onError);
                resolve();
            };
            const onError = (error: Error) => {
                this.writeStream.off("close", onClose);
                reject(error);
            };
            this.writeStream.once("close", onClose);
            this.writeStream.once("error", onError);
            this.writeStream.end();
        });
    }

    interceptStdio() {
        if (this.restoreStdio) return;
        const originalStdoutWrite = process.stdout.write;
        const originalStderrWrite = process.stderr.write;

        const intercept = (original: typeof originalStdoutWrite, stream: NodeJS.WriteStream) => {
            return ((
                chunk: Buffer | string,
                encoding?: BufferEncoding,
                callback?: (_error?: Error) => void,
            ) => {
                const message = chunk.toString();
                try {
                    this.cache(message);
                    this.broadcast(message);
                } catch (error) {
                    originalStderrWrite.call(
                        process.stderr,
                        `[onebots] Log interceptor error: ${String(error)}\n`,
                    );
                }
                return original.call(stream, chunk, encoding as BufferEncoding, callback);
            }) as typeof process.stdout.write;
        };

        const interceptedStdoutWrite = intercept(originalStdoutWrite, process.stdout);
        const interceptedStderrWrite = intercept(originalStderrWrite, process.stderr);
        process.stdout.write = interceptedStdoutWrite;
        process.stderr.write = interceptedStderrWrite;
        this.restoreStdio = () => {
            if (process.stdout.write === interceptedStdoutWrite) {
                process.stdout.write = originalStdoutWrite;
            }
            if (process.stderr.write === interceptedStderrWrite) {
                process.stderr.write = originalStderrWrite;
            }
        };
    }
}
