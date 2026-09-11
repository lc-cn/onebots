import fs from "node:fs";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createRequire } from "node:module";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocket, WebSocketServer } from "ws";
import { parseTerminalClientMessage, TERMINAL_MAX_INPUT_BYTES } from "./terminal-message.js";
import { isLocalTerminalRequest } from "./terminal-request.js";

const TICKET_TTL_MS = 30_000;
const MAX_CONNECTIONS = 2;
const MAX_BUFFERED_BYTES = 1024 * 1024;
const MAX_MESSAGE_BYTES = 256 * 1024;
const MAX_PENDING_TICKETS = 16;

interface PtyProcess {
    write(data: string): void;
    resize(columns: number, rows: number): void;
    kill(signal?: string): void;
    onData(listener: (data: string) => void): { dispose(): void };
    onExit(listener: (event: { exitCode: number; signal?: number }) => void): { dispose(): void };
}

interface PtyModule {
    spawn(
        file: string,
        args: string[],
        options: { name: string; cols: number; rows: number; cwd: string; env: NodeJS.ProcessEnv },
    ): PtyProcess;
}

interface TerminalServiceOptions {
    workspace: string;
    manager: { id: string; version: string };
    available: () => boolean;
    now?: () => number;
    loadPty?: () => Promise<PtyModule>;
}

interface Ticket {
    digest: Buffer;
    expiresAt: number;
}

interface Session {
    socket: WebSocket;
    process?: PtyProcess;
    close(): void;
}

/** 管理服务拥有 PTY；每个已授权的本机 WebSocket 独占一个 shell，断线即销毁。 */
export class ControlTerminalService {
    private readonly server = new WebSocketServer({
        noServer: true,
        clientTracking: false,
        maxPayload: TERMINAL_MAX_INPUT_BYTES + 1024,
    });
    private readonly tickets = new Map<string, Ticket>();
    private readonly sessions = new Set<Session>();
    private readonly now: () => number;
    private readonly ptyPresent: boolean;
    private closed = false;

    constructor(private readonly options: TerminalServiceOptions) {
        this.now = options.now ?? Date.now;
        this.ptyPresent =
            Number(process.versions.node.split(".")[0]) === 24 &&
            (Boolean(options.loadPty) || dependencyAvailable());
    }

    status(): { available: boolean; localOnly: true; activeSessions: number } {
        return {
            available: !this.closed && this.options.available() && this.ptyPresent,
            localOnly: true,
            activeSessions: this.sessions.size,
        };
    }

    issueTicket(): { ticket: string; expiresAt: number } {
        if (this.closed || !this.options.available() || !this.ptyPresent)
            throw new Error("本地终端当前不可用");
        this.sweepTickets();
        if (this.tickets.size >= MAX_PENDING_TICKETS) throw new Error("本地终端连接请求过多");
        const ticket = randomBytes(32).toString("base64url");
        const expiresAt = this.now() + TICKET_TTL_MS;
        this.tickets.set(randomBytes(12).toString("hex"), {
            digest: Buffer.from(ticket),
            expiresAt,
        });
        return { ticket, expiresAt };
    }

    handleUpgrade(request: IncomingMessage, socket: Duplex, head: Buffer): boolean {
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.pathname !== "/api/control/terminal") return false;
        if (
            this.closed ||
            !this.options.available() ||
            !this.ptyPresent ||
            !isLocalTerminalRequest(request) ||
            this.sessions.size >= MAX_CONNECTIONS ||
            !this.consumeTicket(url.searchParams.get("ticket"))
        ) {
            socket.end("HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n");
            return true;
        }
        this.server.handleUpgrade(request, socket, head, client => void this.open(client));
        return true;
    }

    close(): void {
        if (this.closed) return;
        this.closed = true;
        this.tickets.clear();
        for (const session of [...this.sessions]) session.close();
        this.server.close();
    }

    private async open(socket: WebSocket): Promise<void> {
        let ended = false;
        let dataSubscription: { dispose(): void } | undefined;
        let exitSubscription: { dispose(): void } | undefined;
        const session: Session = {
            socket,
            close: () => {
                if (ended) return;
                ended = true;
                this.sessions.delete(session);
                dataSubscription?.dispose();
                exitSubscription?.dispose();
                try {
                    session.process?.kill();
                } catch {
                    // PTY 已退出或原生句柄已释放，无需再次处理。
                }
                if (socket.readyState === WebSocket.OPEN) socket.close(1000, "Terminal closed");
                else if (socket.readyState !== WebSocket.CLOSED) socket.terminate();
            },
        };
        this.sessions.add(session);
        socket.once("close", session.close);
        socket.once("error", session.close);
        this.send(socket, {
            type: "identity",
            application: "onebots",
            version: this.options.manager.version,
            instance_id: this.options.manager.id,
            cwd: path.resolve(this.options.workspace),
        });
        try {
            const pty = await (this.options.loadPty ?? loadPty)();
            if (ended || !this.options.available()) return session.close();
            const process = pty.spawn(shell(), [], {
                name: "xterm-256color",
                cols: 80,
                rows: 30,
                cwd: path.resolve(this.options.workspace),
                env: terminalEnvironment(),
            });
            session.process = process;
            dataSubscription = process.onData(data => {
                if (!this.send(socket, { type: "output", data })) session.close();
            });
            exitSubscription = process.onExit(event => {
                this.send(socket, { type: "exit", exitCode: event.exitCode });
                session.close();
            });
            socket.on("message", data => {
                const parsed = parseTerminalClientMessage(data.toString());
                if ("error" in parsed) {
                    this.send(socket, parsed.error);
                    return;
                }
                if (parsed.command.type === "input") process.write(parsed.command.data);
                else process.resize(parsed.command.cols, parsed.command.rows);
            });
            this.send(socket, { type: "ready" });
        } catch {
            this.send(socket, {
                type: "error",
                code: "TERMINAL_UNAVAILABLE",
                message: "本机终端组件不可用，请运行 onebots doctor 检查安装",
            });
            session.close();
        }
    }

    private consumeTicket(candidate: string | null): boolean {
        if (!candidate || !/^[A-Za-z0-9_-]{43}$/.test(candidate)) return false;
        this.sweepTickets();
        const supplied = Buffer.from(candidate);
        for (const [id, ticket] of this.tickets) {
            if (
                ticket.digest.length === supplied.length &&
                timingSafeEqual(ticket.digest, supplied)
            ) {
                this.tickets.delete(id);
                return ticket.expiresAt > this.now();
            }
        }
        return false;
    }

    private sweepTickets(): void {
        const now = this.now();
        for (const [id, ticket] of this.tickets)
            if (ticket.expiresAt <= now) this.tickets.delete(id);
    }

    private send(socket: WebSocket, payload: unknown): boolean {
        if (socket.readyState !== WebSocket.OPEN || socket.bufferedAmount > MAX_BUFFERED_BYTES)
            return false;
        try {
            const message = JSON.stringify(payload);
            if (Buffer.byteLength(message, "utf8") > MAX_MESSAGE_BYTES) return false;
            socket.send(message);
            return true;
        } catch {
            return false;
        }
    }
}

async function loadPty(): Promise<PtyModule> {
    return import("@karinjs/node-pty");
}

function shell(): string {
    if (process.platform === "win32") {
        const command = process.env.ComSpec;
        return command && path.isAbsolute(command) && fs.existsSync(command)
            ? command
            : "powershell.exe";
    }
    const command = process.env.SHELL;
    return command && path.isAbsolute(command) && fs.existsSync(command) ? command : "/bin/sh";
}

function terminalEnvironment(): NodeJS.ProcessEnv {
    const names = [
        "PATH",
        "HOME",
        "USER",
        "LOGNAME",
        "SHELL",
        "TMPDIR",
        "LANG",
        "SystemRoot",
        "ComSpec",
        "PATHEXT",
        "USERPROFILE",
        "HOMEDRIVE",
        "HOMEPATH",
        "APPDATA",
        "LOCALAPPDATA",
    ];
    const env: NodeJS.ProcessEnv = { TERM: "xterm-256color" };
    for (const name of names) if (process.env[name] !== undefined) env[name] = process.env[name];
    for (const [name, value] of Object.entries(process.env))
        if (name.startsWith("LC_") && value !== undefined) env[name] = value;
    return env;
}

function dependencyAvailable(): boolean {
    try {
        createRequire(import.meta.url).resolve("@karinjs/node-pty");
        return true;
    } catch {
        return false;
    }
}
