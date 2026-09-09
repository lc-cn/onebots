import net from "node:net";
import { randomUUID } from "node:crypto";
import { parseWindowsNativeStatus, type WindowsNativeStatus } from "./service-platform-windows.js";

const MAX_MESSAGE_BYTES = 64 * 1024;
const REQUEST_ID = /^[A-Za-z0-9._:-]{1,64}$/;

export interface WindowsPublishedControlStatus {
    revision: number;
    manager: { id: string; version: string; pid: number };
    gateway: {
        desired: "running" | "stopped";
        actual: "starting" | "running" | "stopping" | "stopped" | "failed";
    };
}

interface PipeRequest {
    version: 2;
    requestId: string;
    operation: "status" | "publish_status" | "invalidate_status";
    control?: WindowsPublishedControlStatus;
    manager?: WindowsPublishedControlStatus["manager"];
    revision?: number;
}

export type WindowsPipeExchange = (
    pipeName: string,
    request: Buffer,
    timeoutMs: number,
) => Promise<Buffer>;

function defaultExchange(pipeName: string, request: Buffer, timeoutMs: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const socket = net.createConnection(pipeName);
        const chunks: Buffer[] = [];
        let size = 0;
        let settled = false;
        const finish = (error?: Error) => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            socket.destroy();
            if (error) reject(error);
            else resolve(Buffer.concat(chunks));
        };
        const timer = setTimeout(() => finish(new Error("Windows 管理管道请求超时")), timeoutMs);
        socket.once("connect", () => socket.end(request));
        socket.on("data", chunk => {
            size += chunk.length;
            if (size > MAX_MESSAGE_BYTES) {
                finish(new Error("Windows 管理管道响应超过 64KiB"));
                return;
            }
            chunks.push(Buffer.from(chunk));
        });
        socket.once("error", error => finish(error));
        socket.once("end", () => finish());
    });
}

function requestBytes(request: PipeRequest): Buffer {
    if (!REQUEST_ID.test(request.requestId)) throw new Error("Windows 管理管道 requestId 无效");
    const bytes = Buffer.from(JSON.stringify(request) + "\n");
    if (bytes.length > MAX_MESSAGE_BYTES) throw new Error("Windows 管理管道请求超过 64KiB");
    return bytes;
}

/** 仅承载只读status和服务SID的状态发布；不包含生命周期写操作。 */
export class WindowsHostControlClient {
    constructor(
        private readonly pipeName: string,
        private readonly exchange: WindowsPipeExchange = defaultExchange,
        private readonly timeoutMs = 5000,
    ) {
        if (
            !/^\\\\\.\\pipe\\[A-Za-z0-9._-]{1,128}$/.test(pipeName) ||
            !Number.isInteger(timeoutMs) ||
            timeoutMs < 1 ||
            timeoutMs > 5000
        )
            throw new Error("Windows 管理管道客户端配置无效");
    }

    async status(): Promise<WindowsNativeStatus> {
        return this.send({ version: 2, requestId: this.id("status"), operation: "status" });
    }

    async publish(control: WindowsPublishedControlStatus): Promise<WindowsNativeStatus> {
        return this.send({
            version: 2,
            requestId: this.id("publish"),
            operation: "publish_status",
            control: structuredClone(control),
        });
    }

    async invalidate(
        manager: WindowsPublishedControlStatus["manager"],
        revision: number,
    ): Promise<WindowsNativeStatus> {
        return this.send({
            version: 2,
            requestId: this.id("invalidate"),
            operation: "invalidate_status",
            manager: structuredClone(manager),
            revision,
        });
    }

    private id(prefix: string): string {
        return `${prefix}:${randomUUID()}`;
    }

    private async send(request: PipeRequest): Promise<WindowsNativeStatus> {
        const response = await this.exchange(this.pipeName, requestBytes(request), this.timeoutMs);
        const parsed = parseWindowsNativeStatus(response.toString("utf8"));
        if (parsed.requestId !== request.requestId)
            throw new Error("Windows 管理管道响应与请求不匹配");
        return parsed;
    }
}
