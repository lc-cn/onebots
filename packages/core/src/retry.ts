/**
 * 重试策略和网络请求重试机制
 * 提供统一的重试逻辑，支持指数退避
 */

export interface RetryOptions {
    /** 最大重试次数 */
    maxRetries?: number;
    /** 初始延迟时间（毫秒） */
    initialDelay?: number;
    /** 最大延迟时间（毫秒） */
    maxDelay?: number;
    /** 退避倍数 */
    backoffMultiplier?: number;
    /** 是否添加随机抖动 */
    jitter?: boolean;
    /** 判断是否应该重试的函数 */
    shouldRetry?: (error: Error, attempt: number) => boolean;
    /** 重试前的回调 */
    onRetry?: (error: Error, attempt: number, delay: number) => void;
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 30000,
    backoffMultiplier: 2,
    jitter: true,
    shouldRetry: (error: Error) => {
        // 默认对网络错误和超时错误进行重试
        const message = error.message.toLowerCase();
        return (
            message.includes('timeout') ||
            message.includes('network') ||
            message.includes('econnreset') ||
            message.includes('econnrefused') ||
            message.includes('socket') ||
            message.includes('fetch failed')
        );
    },
    onRetry: () => {},
};

/**
 * 计算下一次重试的延迟时间
 */
export function calculateDelay(
    attempt: number,
    options: Required<RetryOptions>
): number {
    let delay = options.initialDelay * Math.pow(options.backoffMultiplier, attempt - 1);

    // 添加随机抖动（±25%）
    if (options.jitter) {
        const jitterFactor = 0.75 + Math.random() * 0.5;
        delay *= jitterFactor;
    }

    return Math.min(delay, options.maxDelay);
}

/**
 * 等待指定时间
 */
function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 带重试的异步函数执行器
 *
 * @example
 * ```typescript
 * const result = await retry(
 *     () => fetch('https://api.example.com/data'),
 *     { maxRetries: 3, initialDelay: 1000 }
 * );
 * ```
 */
export async function retry<T>(
    fn: () => Promise<T>,
    options: RetryOptions = {}
): Promise<T> {
    const opts: Required<RetryOptions> = { ...DEFAULT_OPTIONS, ...options };
    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= opts.maxRetries + 1; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));

            // 检查是否还有重试机会
            if (attempt > opts.maxRetries) {
                break;
            }

            // 检查是否应该重试
            if (!opts.shouldRetry(lastError, attempt)) {
                break;
            }

            // 计算延迟并等待
            const delay = calculateDelay(attempt, opts);
            opts.onRetry(lastError, attempt, delay);
            await sleep(delay);
        }
    }

    throw lastError;
}

/**
 * 创建一个带重试功能的函数包装器
 *
 * @example
 * ```typescript
 * const fetchWithRetry = withRetry(fetch, { maxRetries: 3 });
 * const response = await fetchWithRetry('https://api.example.com/data');
 * ```
 */
export function withRetry<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    options: RetryOptions = {}
): T {
    return ((...args: Parameters<T>) => {
        return retry(() => fn(...args), options);
    }) as T;
}

/**
 * 重试策略预设
 */
export const RetryPresets = {
    /** 快速重试：3次，1秒起始 */
    fast: {
        maxRetries: 3,
        initialDelay: 1000,
        maxDelay: 5000,
        backoffMultiplier: 1.5,
    } as RetryOptions,

    /** 标准重试：5次，2秒起始 */
    standard: {
        maxRetries: 5,
        initialDelay: 2000,
        maxDelay: 30000,
        backoffMultiplier: 2,
    } as RetryOptions,

    /** 持久重试：10次，5秒起始 */
    persistent: {
        maxRetries: 10,
        initialDelay: 5000,
        maxDelay: 60000,
        backoffMultiplier: 2,
    } as RetryOptions,

    /** WebSocket 重连：无限重试 */
    websocket: {
        maxRetries: Infinity,
        initialDelay: 1000,
        maxDelay: 30000,
        backoffMultiplier: 2,
        jitter: true,
    } as RetryOptions,
};

/**
 * 日志接口（兼容 log4js Logger 和 console）
 */
export interface LoggerLike {
    info(...args: unknown[]): void;
    warn(...args: unknown[]): void;
    error(...args: unknown[]): void;
    debug?(...args: unknown[]): void;
}

/**
 * ConnectionManager 回调选项
 */
export interface ConnectionManagerCallbacks {
    /** 连接成功时回调（可用于 resetAttempts 后执行后续初始化） */
    onConnected?: () => void;
    /** 达到最大重试次数时回调 */
    onMaxRetriesReached?: (lastError?: Error) => void;
}

/**
 * 连接管理器 - 用于 WebSocket 等长连接的重连管理
 *
 * @example
 * ```typescript
 * const manager = new ConnectionManager(
 *     () => connectWebSocket(),
 *     RetryPresets.websocket,
 *     { logger: myLogger, onConnected: () => console.log('已连接') }
 * );
 * await manager.start();
 * ```
 */
export class ConnectionManager {
    private reconnectAttempt = 0;
    private reconnectTimer: NodeJS.Timeout | null = null;
    private isConnecting = false;
    private options: Required<RetryOptions>;
    private logger: LoggerLike;
    private callbacks: ConnectionManagerCallbacks;

    constructor(
        private connect: () => Promise<void>,
        options: RetryOptions = RetryPresets.websocket,
        { logger, ...callbacks }: { logger?: LoggerLike } & ConnectionManagerCallbacks = {}
    ) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
        this.logger = logger ?? console;
        this.callbacks = callbacks;
    }

    /**
     * 开始连接
     */
    async start(): Promise<void> {
        this.stop();
        this.reconnectAttempt = 0;
        await this.tryConnect();
    }

    /**
     * 停止连接和重连
     */
    stop(): void {
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        this.isConnecting = false;
    }

    /**
     * 触发重连
     */
    scheduleReconnect(error?: Error): void {
        if (this.isConnecting) return;

        this.reconnectAttempt++;

        if (this.reconnectAttempt > this.options.maxRetries) {
            this.logger.error('[ConnectionManager] 达到最大重试次数，停止重连');
            this.callbacks.onMaxRetriesReached?.(error);
            return;
        }

        const delay = calculateDelay(this.reconnectAttempt, this.options);

        this.logger.info(
            `[ConnectionManager] 将在 ${Math.round(delay / 1000)}s 后进行第 ${this.reconnectAttempt} 次重连`
        );

        if (error) {
            this.options.onRetry(error, this.reconnectAttempt, delay);
        }

        this.reconnectTimer = setTimeout(() => {
            this.tryConnect();
        }, delay);
    }

    /**
     * 重置重连计数（连接成功时调用）
     */
    resetAttempts(): void {
        this.reconnectAttempt = 0;
    }

    /**
     * 获取当前重连次数
     */
    getAttempts(): number {
        return this.reconnectAttempt;
    }

    private async tryConnect(): Promise<void> {
        if (this.isConnecting) return;

        this.isConnecting = true;

        try {
            await this.connect();
            this.resetAttempts();
            this.callbacks.onConnected?.();
        } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            this.logger.error('[ConnectionManager] 连接失败:', err.message);
            this.scheduleReconnect(err);
        } finally {
            this.isConnecting = false;
        }
    }
}
