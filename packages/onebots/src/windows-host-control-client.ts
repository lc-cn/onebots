import net from "node:net";
import { randomUUID } from "node:crypto";
import { parseWindowsNativeStatus, type WindowsNativeStatus } from "./service-platform-windows.js";

const MAX_STATUS_BYTES = 64 * 1024;
const MAX_CONTROL_RESULT_BYTES = 1024 * 1024;
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
    operation: "status" | "publish_status" | "invalidate_status" | "control_request";
    control?: WindowsPublishedControlStatus;
    manager?: WindowsPublishedControlStatus["manager"];
    revision?: number;
    binding?: Pick<WindowsPublishedControlStatus, "revision" | "manager">;
    method?: "GET" | "POST";
    route?: string;
    body?: unknown;
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
            if (size > MAX_CONTROL_RESULT_BYTES) {
                finish(new Error("Windows 管理管道控制响应超过 1MiB"));
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
    if (bytes.length > MAX_STATUS_BYTES) throw new Error("Windows 管理管道请求超过 64KiB");
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

    async request<T>(
        method: "GET" | "POST",
        route: string,
        body?: unknown,
    ): Promise<{
        status: number;
        body: T;
    }> {
        if (!/^\/api\/control\/[\x21-\x7e]{1,2035}$/.test(route) || /[\\\r\n]/.test(route))
            throw new Error("Windows 管理管道路由无效");
        const status = await this.status();
        if (!status.state.control) throw new Error("Windows 管理服务尚未发布可用控制状态");
        const request: PipeRequest = {
            version: 2,
            requestId: this.id("control"),
            operation: "control_request",
            binding: {
                revision: status.state.control.revision,
                manager: structuredClone(status.state.control.manager),
            },
            method,
            route,
            ...(body === undefined ? {} : { body }),
        };
        const timeout = method === "POST" ? 120_000 : 60_000;
        const response = await this.exchange(this.pipeName, requestBytes(request), timeout);
        const parsed = parsePipeResponse(response, request.requestId);
        if (!parsed.result) throw new Error("Windows 管理管道缺少控制响应");
        return { status: parsed.result.status, body: parsed.result.body as T };
    }

    private id(prefix: string): string {
        return `${prefix}:${randomUUID()}`;
    }

    private async send(request: PipeRequest): Promise<WindowsNativeStatus> {
        const response = await this.exchange(this.pipeName, requestBytes(request), this.timeoutMs);
        if (response.length > MAX_STATUS_BYTES)
            throw new Error("Windows 管理管道状态响应超过 64KiB");
        const parsed = parseWindowsNativeStatus(response.toString("utf8"));
        if (parsed.requestId !== request.requestId)
            throw new Error("Windows 管理管道响应与请求不匹配");
        return parsed;
    }
}

function parsePipeResponse(
    bytes: Buffer,
    requestId: string,
): {
    result?: { status: number; body: unknown };
} {
    if (bytes.length === 0 || bytes.length > MAX_CONTROL_RESULT_BYTES)
        throw new Error("Windows 管理管道响应大小无效");
    let value: unknown;
    try {
        value = JSON.parse(bytes.toString("utf8"));
    } catch {
        throw new Error("Windows 管理管道响应不是有效 JSON");
    }
    if (!value || typeof value !== "object" || Array.isArray(value))
        throw new Error("Windows 管理管道响应无效");
    const response = value as Record<string, unknown>;
    if (
        response.version !== 2 ||
        response.requestId !== requestId ||
        typeof response.ok !== "boolean"
    )
        throw new Error("Windows 管理管道响应与请求不匹配");
    if (!response.ok) {
        const error = response.error;
        if (!error || typeof error !== "object" || Array.isArray(error))
            throw new Error("Windows 管理管道请求失败");
        const message = (error as Record<string, unknown>).message;
        throw new Error(typeof message === "string" ? message : "Windows 管理管道请求失败");
    }
    const result = response.result;
    if (!result || typeof result !== "object" || Array.isArray(result)) return {};
    const control = result as Record<string, unknown>;
    if (
        typeof control.status !== "number" ||
        !Number.isInteger(control.status) ||
        control.status < 100 ||
        control.status > 599 ||
        !("body" in control)
    )
        throw new Error("Windows 管理管道控制响应无效");
    return { result: { status: control.status, body: control.body } };
}
