const WEB_SOCKET_OPEN = 1;

export interface TerminalWebSocketLike {
    readonly readyState: number;
    onopen: ((event: Event) => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
    onerror: ((event: Event) => void) | null;
    onclose: ((event: CloseEvent) => void) | null;
    send(data: string): void;
    close(): void;
}

export interface TerminalWebSocketConnectionCallbacks {
    onConnecting?(): void;
    onOpen?(event: Event): void;
    onMessage?(event: MessageEvent): void;
    onError?(event: Event): void;
    onClose?(event: CloseEvent): void;
    shouldReconnect?(event: CloseEvent): boolean;
}

/** 服务端使用 1008 表示管理凭据已失效，继续携带同一凭据重试没有恢复意义。 */
export function shouldReconnectTerminalWebSocket(event: Pick<CloseEvent, "code">): boolean {
    return event.code !== 1008;
}

/** 保证终端页面至多持有一个当前连接和一个重连定时器。 */
export class TerminalWebSocketConnection {
    private socket: TerminalWebSocketLike | null = null;
    private reconnectTimer: ReturnType<typeof setTimeout> | undefined;
    private disposed = false;

    constructor(
        private readonly createSocket: () => TerminalWebSocketLike,
        private readonly callbacks: TerminalWebSocketConnectionCallbacks,
        private readonly reconnectDelayMs = 3000,
    ) {}

    connect(): void {
        if (this.disposed) return;
        this.clearReconnectTimer();
        this.releaseSocket();
        this.callbacks.onConnecting?.();

        const socket = this.createSocket();
        this.socket = socket;
        socket.onopen = event => {
            if (this.isCurrent(socket)) this.callbacks.onOpen?.(event);
        };
        socket.onmessage = event => {
            if (this.isCurrent(socket)) this.callbacks.onMessage?.(event);
        };
        socket.onerror = event => {
            if (this.isCurrent(socket)) this.callbacks.onError?.(event);
        };
        socket.onclose = event => {
            if (!this.isCurrent(socket)) return;
            this.detach(socket);
            this.socket = null;
            this.callbacks.onClose?.(event);
            if (this.callbacks.shouldReconnect?.(event) === false) return;
            this.reconnectTimer = setTimeout(() => {
                this.reconnectTimer = undefined;
                this.connect();
            }, this.reconnectDelayMs);
        };
    }

    sendJson(payload: unknown): boolean {
        if (!this.socket || this.socket.readyState !== WEB_SOCKET_OPEN) return false;
        this.socket.send(JSON.stringify(payload));
        return true;
    }

    dispose(): void {
        if (this.disposed) return;
        this.disposed = true;
        this.clearReconnectTimer();
        this.releaseSocket();
    }

    private isCurrent(socket: TerminalWebSocketLike): boolean {
        return !this.disposed && this.socket === socket;
    }

    private releaseSocket(): void {
        const socket = this.socket;
        if (!socket) return;
        this.socket = null;
        this.detach(socket);
        socket.close();
    }

    private detach(socket: TerminalWebSocketLike): void {
        socket.onopen = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.onclose = null;
    }

    private clearReconnectTimer(): void {
        if (this.reconnectTimer === undefined) return;
        clearTimeout(this.reconnectTimer);
        this.reconnectTimer = undefined;
    }
}
