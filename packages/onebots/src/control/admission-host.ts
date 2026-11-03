import fs from "node:fs";
import http from "node:http";
import type { Duplex } from "node:stream";
import { serveControlWeb } from "./web-assets.js";
import { jsonResponse, listen } from "./http-utils.js";
import { connectWindowsManagerRPC } from "../windows-manager-rpc.js";
import { WindowsManagerStatusPublisher } from "../windows-manager-status-publisher.js";
import type { AdmissionInspection } from "../workspace-admission/types.js";
import type { ControlHostOptions } from "./host-options.js";
import { admissionMaintenancePage } from "./admission-page.js";
import { publishWindowsManagerStartup } from "../windows-manager-startup.js";

interface RejectedHostOptions {
    options: ControlHostOptions;
    inspection: AdmissionInspection;
    manager: { id: string; version: string; pid: number };
    socketPath: string;
    webRoot: string;
    release(): void;
}

/** 来源未知时不构造任何业务 store/auth/controller；本地传输亦无配对/写入后门。 */
export async function startAdmissionRejectedHost(input: RejectedHostOptions) {
    const { options, inspection, manager, socketPath, webRoot } = input;
    const sockets = new Set<Duplex>();
    let closed = false;
    let heartbeat: NodeJS.Timeout | undefined;
    let reconnect: NodeJS.Timeout | undefined;
    const publisher = options.windowsHostPipe
        ? new WindowsManagerStatusPublisher(options.windowsHostPipe, manager)
        : undefined;
    const handle = (
        request: http.IncomingMessage,
        response: http.ServerResponse,
        local: boolean,
    ) => {
        try {
            const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
            if (request.method === "GET" && ["/ready", "/healthz"].includes(pathname)) {
                jsonResponse(response, 200, {
                    application: "onebots",
                    version: manager.version,
                    instance_id: manager.id,
                    ready: true,
                    admission: inspection,
                });
            } else if (
                request.method === "GET" &&
                pathname === "/api/control/manager-readiness" &&
                local
            ) {
                jsonResponse(response, 200, {
                    schemaVersion: 1,
                    manager,
                    admission: inspection,
                    gateway: null,
                });
            } else if (
                request.method === "GET" &&
                pathname === "/api/control/workspace-admission"
            ) {
                jsonResponse(response, 200, inspection);
            } else if (
                request.method === "GET" &&
                (pathname === "/" || pathname === "/console" || pathname.startsWith("/console/"))
            ) {
                response.writeHead(200, {
                    "Content-Type": "text/html; charset=utf-8",
                    "Cache-Control": "no-store",
                    "Content-Security-Policy":
                        "default-src 'none'; style-src 'unsafe-inline'; form-action 'none'; frame-ancestors 'none'",
                    "X-Content-Type-Options": "nosniff",
                    "Referrer-Policy": "no-referrer",
                });
                response.end(admissionMaintenancePage(inspection));
            } else if (!serveControlWeb(request, response, pathname, webRoot)) {
                jsonResponse(response, 503, {
                    code: "WORKSPACE_ADMISSION_REQUIRED",
                    message:
                        "工作区来源尚未验证。请停止管理服务，在本机执行 onebots workspace plan/register；请勿删除或改写证明文件。",
                    admission: inspection,
                });
            }
        } catch {
            jsonResponse(response, 400, { message: "诊断请求无效" });
        }
    };
    const server = http.createServer((request, response) => handle(request, response, false));
    const local = http.createServer((request, response) => handle(request, response, true));
    for (const listener of [server, local]) {
        listener.requestTimeout = 30_000;
        listener.headersTimeout = 10_000;
        listener.on("connection", socket => {
            sockets.add(socket);
            socket.once("close", () => sockets.delete(socket));
        });
        listener.on("upgrade", (_request, socket) => socket.destroy());
    }
    // 与正常host相同：原生反向通道由宿主拥有，不能被Node默认idle reap关闭。
    local.keepAliveTimeout = 0;
    const close = async () => {
        if (closed) return;
        closed = true;
        if (heartbeat) clearInterval(heartbeat);
        if (reconnect) clearTimeout(reconnect);
        for (const socket of sockets) socket.destroy();
        const ownedSocket = local.address();
        try {
            await Promise.all(
                [server, local].map(
                    listener => new Promise<void>(resolve => listener.close(() => resolve())),
                ),
            );
            await publisher?.flush();
            // 只移除本次监听资源，不写 stopped/closed、日志、认证或业务状态。
            if (
                !options.windowsHostPipe &&
                typeof ownedSocket === "string" &&
                fs.existsSync(socketPath)
            )
                fs.unlinkSync(socketPath);
        } finally {
            input.release();
        }
    };
    const attach = async (): Promise<void> => {
        if (closed || !options.windowsHostRpcPipe) return;
        try {
            const socket = await connectWindowsManagerRPC(options.windowsHostRpcPipe);
            if (closed) {
                socket.destroy();
                return;
            }
            local.emit("connection", socket);
            socket.once("close", () => {
                if (!closed) reconnect = setTimeout(() => void attach(), 25);
            });
        } catch {
            if (!closed) reconnect = setTimeout(() => void attach(), 25);
        }
        reconnect?.unref();
    };
    try {
        if (!options.windowsHostPipe && socketPath) {
            // 工作区锁已排除其他合法 manager；不把 socket 存在当进程已关闭的证明。
            if (fs.existsSync(socketPath)) {
                if (!fs.lstatSync(socketPath).isSocket())
                    throw new Error("本地诊断套接字存在未知文件");
                fs.unlinkSync(socketPath);
            }
            await listen(local, socketPath);
            fs.chmodSync(socketPath, 0o600);
        }
        if (options.windowsHostRpcPipe) await attach();
        await listen(server, options.port ?? 6727, options.host ?? "127.0.0.1");
        if (publisher) await publishWindowsManagerStartup(() => publisher.publishRejected());
        if (publisher) {
            heartbeat = setInterval(() => {
                void publisher.publishRejected().catch(() => {
                    process.stderr.write("[onebots] 来源拒绝状态发布未确认\n");
                });
            }, 10_000);
            heartbeat.unref();
        }
        return {
            id: manager.id,
            admission: inspection,
            controller: undefined,
            server,
            socketPath,
            close,
        };
    } catch (error) {
        await close();
        throw error;
    }
}
