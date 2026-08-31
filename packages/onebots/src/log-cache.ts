import * as fs from "fs";
import * as path from "path";
import { existsSync, writeFileSync, mkdirSync } from "fs";
import type { ServerResponse } from "node:http";

export class LogCacheManager {
    public readonly cacheFile: string;
    public readonly clients: Set<ServerResponse> = new Set();
    private writeStream!: fs.WriteStream;

    constructor(cacheFile: string) {
        this.cacheFile = cacheFile;
        this.init();
    }

    private init() {
        const dataDir = path.dirname(this.cacheFile);
        if (!existsSync(dataDir)) {
            mkdirSync(dataDir, { recursive: true });
        }
        writeFileSync(this.cacheFile, "", "utf-8");
        this.writeStream = fs.createWriteStream(this.cacheFile, { flags: "a", encoding: "utf-8" });
    }

    broadcast(message: string) {
        if (this.clients.size === 0 || !message) return;
        const terminalMessage = message.replace(/\n/g, "\r\n");
        const data = `data: ${JSON.stringify({ message: terminalMessage })}\n\n`;
        for (const client of this.clients) {
            try {
                client.write(data);
            } catch {
                this.clients.delete(client);
            }
        }
    }

    cache(message: string) {
        if (this.writeStream && message) {
            this.writeStream.write(message);
        }
    }

    cleanup() {
        if (this.writeStream) {
            this.writeStream.end();
        }
        try {
            if (existsSync(this.cacheFile)) {
                writeFileSync(this.cacheFile, "", "utf-8");
            }
        } catch {
            // best-effort cleanup
        }
    }

    interceptStdio() {
        const originalStdoutWrite = process.stdout.write.bind(process.stdout);
        const originalStderrWrite = process.stderr.write.bind(process.stderr);

        const intercept = (original: typeof originalStdoutWrite) => {
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
                    originalStderrWrite(`[onebots] Log interceptor error: ${String(error)}\n`);
                }
                return original(chunk, encoding as BufferEncoding, callback);
            }) as typeof process.stdout.write;
        };

        process.stdout.write = intercept(originalStdoutWrite);
        process.stderr.write = intercept(originalStderrWrite);
    }
}
