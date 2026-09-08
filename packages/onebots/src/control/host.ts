import fs from "node:fs";
import path from "node:path";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import type { Duplex } from "node:stream";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { ControlAuth } from "./auth.js";
import { GatewayController } from "./gateway-controller.js";
import { NodeGatewayDriver } from "./gateway-driver.js";
import { GenerationActivationController } from "./generation-activation.js";
import { GenerationStore } from "../installation/generation-store.js";
import {
    readGenerationPlan,
    resolveGenerationRuntime,
} from "../installation/generation-runtime.js";
import { recoverDownloadCredentials } from "../installation/generation-download.js";
import {
    ControlInstallationService,
    type ControlInstallationOptions,
} from "./installation-service.js";
import { handleInstallationRequest, isInstallationPath } from "./installation-api.js";
import {
    acquireControlWorkspace,
    controlDirectory,
    controlSocket,
    prepareGatewayWorkspace,
    processExists,
} from "./workspace.js";
import { proxyGatewayHttp, proxyGatewayUpgrade } from "./proxy.js";
import packageMetadata from "../../package.json" with { type: "json" };

export interface ControlHostOptions {
    workspace: string;
    host?: string;
    port?: number;
    runtimeRoot?: string;
    webRoot?: string;
    gatewayEntrypoint?: string;
    installation?: Omit<ControlInstallationOptions, "directory" | "store" | "lifecycle">;
}

export async function startControlHost(options: ControlHostOptions) {
    fs.mkdirSync(options.workspace, { recursive: true });
    const workspace = fs.realpathSync(options.workspace);
    const socketPath = controlSocket(workspace);
    const webRoot =
        options.webRoot ??
        path.join(
            path.dirname(createRequire(import.meta.url).resolve("@onebots/web/package.json")),
            "dist",
        );
    const release = acquireControlWorkspace(workspace);
    const id = randomUUID();
    let auth: ControlAuth | undefined;
    let authAvailable = true;
    let storageError = false;
    let currentStartFailed = false;
    let lifecycle: GenerationActivationController;
    let generations: GenerationStore | undefined;
    try {
        generations = new GenerationStore({
            root: path.join(controlDirectory(workspace), "generations"),
            isActive: generationId => lifecycle?.status().active?.id === generationId,
        });
    } catch {
        storageError = true;
        process.stderr.write("[onebots] 运行版本仓库不可读取，保持管理端用于诊断\n");
    }
    try {
        auth = new ControlAuth({ statePath: path.join(controlDirectory(workspace), "auth.json") });
    } catch {
        authAvailable = false;
        process.stderr.write("[onebots] 控制认证存储不可用，远程管理已禁用\n");
    }
    const driver = new NodeGatewayDriver({
        controlInstanceId: id,
        prepare: async () => {
            const prepared = prepareGatewayWorkspace(workspace, options.runtimeRoot);
            const generation = lifecycle.activeGeneration();
            return {
                ...prepared,
                ...(generation
                    ? resolveGenerationRuntime(generation, prepared.selection)
                    : options.gatewayEntrypoint
                      ? { entrypoint: options.gatewayEntrypoint }
                      : {}),
            };
        },
        onExit: (instanceId, error) => {
            void controller.observeExit(instanceId, error).catch(() => {
                process.stderr.write("[onebots] 网关退出状态无法持久化，请检查工作区存储\n");
            });
        },
    });
    const controller = new GatewayController({
        statePath: path.join(controlDirectory(workspace), "gateway.json"),
        driver,
        initialDesired: "running",
    });
    lifecycle = new GenerationActivationController({
        statePath: path.join(controlDirectory(workspace), "active-generation.json"),
        gateway: controller,
        readVerified: generationId => {
            if (!generations) throw new Error("运行版本仓库不可用");
            return generations.readVerified(generationId);
        },
        hasLiveChildren: () => driver.hasLiveChildren(),
    });
    let installation: ControlInstallationService | undefined;
    try {
        const recovered = await recoverDownloadCredentials(
            path.join(controlDirectory(workspace), "downloads"),
        );
        if (recovered.blocked.length) throw new Error("下载进程或凭据归属尚待核实");
        if (generations)
            installation = new ControlInstallationService({
                ...options.installation,
                directory: controlDirectory(workspace),
                store: generations,
                lifecycle,
                currentGenerationId: () => lifecycle.status().active?.id ?? null,
                currentSelection: () => {
                    const active = lifecycle.activeGeneration();
                    return active
                        ? readGenerationPlan(active).selection
                        : prepareGatewayWorkspace(workspace, options.runtimeRoot).selection;
                },
            });
    } catch {
        process.stderr.write("[onebots] 安装服务恢复未完成，保持管理端用于诊断\n");
    }
    const sockets = new Set<Duplex>();
    let closed = false;
    function activeAddress() {
        const state = controller.status();
        return state.actual === "running" &&
            !state.recoveryRequired &&
            !lifecycle.status().recoveryRequired &&
            driver.hasLiveChildren()
            ? state.instance?.address
            : undefined;
    }

    function json(response: ServerResponse, status: number, value: unknown) {
        response.writeHead(status, {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
        });
        response.end(JSON.stringify(value));
    }

    async function handle(request: IncomingMessage, response: ServerResponse, local: boolean) {
        try {
            const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
            if (request.method === "GET" && ["/ready", "/healthz"].includes(pathname)) {
                json(response, 200, {
                    application: "onebots",
                    version: packageMetadata.version,
                    instance_id: id,
                    ready: true,
                });
                return;
            }
            if (pathname.startsWith("/api/")) {
                if (closed && request.method === "POST") {
                    json(response, 503, { message: "管理服务正在关闭" });
                    return;
                }
                if (request.method !== "GET" && request.method !== "POST") {
                    json(response, 405, { message: "不支持此方法" });
                    return;
                }
                if (
                    !local &&
                    request.headers.origin &&
                    new URL(request.headers.origin).host !== request.headers.host
                ) {
                    json(response, 403, { message: "控制请求来源无效" });
                    return;
                }
                if (
                    pathname === "/api/control/auth/bootstrap" &&
                    local &&
                    request.method === "POST"
                ) {
                    if (!auth) throw new Error("控制认证存储不可用，请检查本地认证文件");
                    json(response, 200, { code: auth.issueBootstrap() });
                    return;
                }
                if (pathname === "/api/control/auth/pair" && request.method === "POST") {
                    const body = await readBody(request);
                    try {
                        if (!auth || typeof body.code !== "string") throw new Error("认证失败");
                        json(response, 200, { token: auth.pair(body.code) });
                    } catch {
                        json(response, 401, { message: "控制认证失败" });
                    }
                    return;
                }
                if (!local) {
                    let authorized = false;
                    try {
                        authorized =
                            auth?.verify(
                                (request.headers.authorization ?? "").replace(/^Bearer\s+/i, ""),
                            ) ?? false;
                    } catch {
                        if (authAvailable)
                            process.stderr.write(
                                "[onebots] 控制认证存储不可读取，远程请求已拒绝\n",
                            );
                        authAvailable = false;
                    }
                    if (!authorized) {
                        json(response, 401, { message: "控制认证失败" });
                        return;
                    }
                }
                if (pathname === "/api/control/status" && request.method === "GET") {
                    json(response, 200, {
                        schemaVersion: 1,
                        manager: { id, version: packageMetadata.version },
                        gateway: storageError
                            ? {
                                  ...controller.status(),
                                  actual: "failed",
                                  recoveryRequired: true,
                                  error: "控制状态不可读取，请检查本地工作区",
                              }
                            : controller.status(),
                        authAvailable,
                        generation: lifecycle.status(),
                        installationAvailable: Boolean(installation),
                    });
                    return;
                }
                if (isInstallationPath(pathname)) {
                    const address = request.socket.remoteAddress;
                    const result = await handleInstallationRequest({
                        pathname,
                        method: request.method,
                        body: () => readBody(request),
                        service: installation,
                        allowCredentials:
                            local ||
                            address === "127.0.0.1" ||
                            address === "::1" ||
                            address === "::ffff:127.0.0.1",
                    });
                    json(response, result.status, result.body);
                    return;
                }
                const action = /^\/api\/control\/gateway\/(start|stop|restart)$/.exec(
                    pathname,
                )?.[1];
                if (action && request.method === "POST") {
                    await readBody(request);
                    if (storageError) {
                        json(response, 503, { message: "控制状态不可读取，禁止修改" });
                        return;
                    }
                    if (controller.status().recoveryRequired && !driver.hasLiveChildren()) {
                        const prior = controller.status().instance;
                        if (prior?.pid && processExists(prior.pid))
                            throw new Error("旧实例仍存在，拒绝重复启动");
                        if (!prior && !currentStartFailed)
                            throw new Error("前次启动结果未知，不能认定旧进程已退出");
                        if (prior && !prior.pid)
                            throw new Error("旧实例身份无法核实，需检查本地运行状态");
                        await lifecycle.reconcileStopped(state => {
                            if (driver.hasLiveChildren()) return false;
                            return state.instance?.pid
                                ? !processExists(state.instance.pid)
                                : !state.instance && currentStartFailed;
                        });
                    }
                    const operation = await (action === "start"
                        ? lifecycle.start()
                        : action === "stop"
                          ? lifecycle.stop()
                          : lifecycle.restart());
                    currentStartFailed = operation.status === "failed" && !driver.hasLiveChildren();
                    json(response, 200, operation);
                    return;
                }
                json(response, 404, { message: "控制接口不存在" });
                return;
            }
            if (local) {
                json(response, 404, { message: "本地控制接口不存在" });
                return;
            }
            if (request.method === "GET" && (pathname === "/" || pathname.startsWith("/assets/"))) {
                const relative =
                    pathname === "/" ? "index.html" : decodeURIComponent(pathname.slice(1));
                const file = path.resolve(webRoot, relative);
                if (
                    !file.startsWith(`${path.resolve(webRoot)}${path.sep}`) ||
                    !fs.existsSync(file)
                ) {
                    json(response, 404, { message: "管理端产物不存在，请完成 Web 构建" });
                    return;
                }
                const contentType = file.endsWith(".html")
                    ? "text/html; charset=utf-8"
                    : file.endsWith(".js")
                      ? "text/javascript"
                      : file.endsWith(".css")
                        ? "text/css"
                        : file.endsWith(".woff2")
                          ? "font/woff2"
                          : "application/octet-stream";
                response.writeHead(200, {
                    "Content-Type": contentType,
                    "Referrer-Policy": "no-referrer",
                    "X-Content-Type-Options": "nosniff",
                });
                fs.createReadStream(file)
                    .on("error", () => response.destroy())
                    .pipe(response);
                return;
            }
            proxyGatewayHttp(request, response, activeAddress());
        } catch {
            if (!response.headersSent)
                json(response, 500, { message: "控制操作失败，请检查本地状态与日志" });
            else response.destroy();
        }
    }

    const server = http.createServer((req, res) => {
        void handle(req, res, false);
    });
    const local = http.createServer((req, res) => {
        void handle(req, res, true);
    });
    for (const listener of [server, local]) {
        listener.on("connection", socket => {
            sockets.add(socket);
            socket.once("close", () => sockets.delete(socket));
        });
        listener.requestTimeout = 30_000;
        listener.headersTimeout = 10_000;
    }
    server.on("upgrade", (req, socket, head) => {
        try {
            if (new URL(req.url ?? "/", "http://localhost").pathname.startsWith("/api/")) {
                socket.end("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
                return;
            }
            proxyGatewayUpgrade(req, socket, head, activeAddress());
        } catch {
            socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
        }
    });
    async function close() {
        if (closed) return;
        closed = true;
        await installation?.close();
        try {
            if (!storageError || driver.hasLiveChildren()) await lifecycle.shutdown();
        } catch {
            if (driver.hasLiveChildren()) {
                closed = false;
                throw new Error("网关尚未确认退出，保留管理锁");
            }
        }
        if (driver.hasLiveChildren()) {
            closed = false;
            throw new Error("网关尚未确认退出，保留管理锁");
        }
        for (const socket of sockets) socket.destroy();
        await Promise.all(
            [server, local].map(
                listener => new Promise<void>(resolve => listener.close(() => resolve())),
            ),
        );
        try {
            if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
        } finally {
            release();
        }
    }
    try {
        let state = controller.status();
        try {
            await lifecycle.initialize();
            state = controller.status();
        } catch {
            storageError = true;
            process.stderr.write("[onebots] 控制状态不可读取，保持管理端用于诊断\n");
        }
        if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
        await listen(local, socketPath);
        fs.chmodSync(socketPath, 0o600);
        await listen(server, options.port ?? 6727, options.host ?? "127.0.0.1");
        try {
            if (
                !storageError &&
                !lifecycle.status().recoveryRequired &&
                state.recoveryRequired &&
                state.instance?.pid
            ) {
                const previousPid = state.instance.pid;
                for (let attempt = 0; attempt < 30 && processExists(previousPid); attempt++)
                    await new Promise(resolve => setTimeout(resolve, 100));
                if (!processExists(previousPid)) {
                    await lifecycle.reconcileStopped(
                        current =>
                            current.instance?.pid === previousPid &&
                            !driver.hasLiveChildren() &&
                            !processExists(previousPid),
                    );
                    state = controller.status();
                }
            }
            if (
                !storageError &&
                !lifecycle.status().recoveryRequired &&
                !state.recoveryRequired &&
                state.desired === "running"
            ) {
                const operation = await lifecycle.start();
                currentStartFailed = operation.status === "failed" && !driver.hasLiveChildren();
            }
        } catch {
            storageError = true;
            process.stderr.write("[onebots] 网关启动或恢复状态无法持久化，管理端保留用于诊断\n");
        }
        return { id, controller: { status: () => controller.status() }, server, socketPath, close };
    } catch (error) {
        await close();
        throw error;
    }
}

function listen(server: http.Server, port: number | string, host?: string): Promise<void> {
    return new Promise((resolve, reject) => {
        const error = (cause: Error) => reject(cause);
        server.once("error", error);
        const ready = () => {
            server.off("error", error);
            resolve();
        };
        if (typeof port === "string") server.listen(port, ready);
        else server.listen(port, host, ready);
    });
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const value of request) {
        const chunk = Buffer.from(value);
        size += chunk.length;
        if (size > 16_384) throw new Error("控制请求过大");
        chunks.push(chunk);
    }
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
        throw new Error("控制请求无效");
    return parsed as Record<string, unknown>;
}
