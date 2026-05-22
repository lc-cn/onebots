/**
 * API 速率限制器
 * 防止触发平台的速率限制
 */

export interface RateLimiterOptions {
    /** 时间窗口内允许的最大请求数 */
    maxRequests: number;
    /** 时间窗口大小（毫秒） */
    windowMs: number;
    /** 请求之间的最小间隔（毫秒） */
    minInterval?: number;
    /** 超出限制时是否排队等待 */
    queueExcess?: boolean;
    /** 队列最大长度 */
    maxQueueSize?: number;
    /** 队列中请求的最大等待时间（毫秒），默认 30000 */
    requestTimeout?: number;
}

interface QueuedRequest<T> {
    execute: () => Promise<T>;
    resolve: (value: T) => void;
    reject: (error: Error) => void;
    enqueueTime: number;
}

/**
 * 令牌桶速率限制器
 */
export class RateLimiter {
    private tokens: number;
    private lastRefill: number;
    private queue: QueuedRequest<any>[] = [];
    private processing = false;
    private lastRequest = 0;
    
    private readonly maxRequests: number;
    private readonly windowMs: number;
    private readonly minInterval: number;
    private readonly queueExcess: boolean;
    private readonly maxQueueSize: number;
    private readonly requestTimeout: number;
    
    constructor(options: RateLimiterOptions) {
        this.maxRequests = options.maxRequests;
        this.windowMs = options.windowMs;
        this.minInterval = options.minInterval ?? 0;
        this.queueExcess = options.queueExcess ?? true;
        this.maxQueueSize = options.maxQueueSize ?? 100;
        this.requestTimeout = options.requestTimeout ?? 30000;
        
        this.tokens = this.maxRequests;
        this.lastRefill = Date.now();
    }
    
    /**
     * 补充令牌
     */
    private refillTokens(): void {
        const now = Date.now();
        const elapsed = now - this.lastRefill;
        const tokensToAdd = (elapsed / this.windowMs) * this.maxRequests;
        
        this.tokens = Math.min(this.maxRequests, this.tokens + tokensToAdd);
        this.lastRefill = now;
    }
    
    /**
     * 尝试获取令牌
     */
    private tryAcquire(): boolean {
        this.refillTokens();
        
        if (this.tokens >= 1) {
            this.tokens -= 1;
            return true;
        }
        
        return false;
    }
    
    /**
     * 计算需要等待的时间
     */
    private getWaitTime(): number {
        this.refillTokens();
        
        if (this.tokens >= 1) {
            return 0;
        }
        
        // 计算获得一个令牌需要的时间
        const tokensNeeded = 1 - this.tokens;
        return (tokensNeeded / this.maxRequests) * this.windowMs;
    }
    
    /**
     * 执行受限函数
     */
    async execute<T>(fn: () => Promise<T>): Promise<T> {
        // 检查最小间隔
        const now = Date.now();
        const timeSinceLastRequest = now - this.lastRequest;
        if (timeSinceLastRequest < this.minInterval) {
            await this.sleep(this.minInterval - timeSinceLastRequest);
        }
        
        // 尝试获取令牌
        if (this.tryAcquire()) {
            this.lastRequest = Date.now();
            return fn();
        }
        
        // 如果不排队，直接抛出错误
        if (!this.queueExcess) {
            throw new RateLimitError('Rate limit exceeded');
        }
        
        // 检查队列大小
        if (this.queue.length >= this.maxQueueSize) {
            throw new RateLimitError('Rate limit queue is full');
        }
        
        // 加入队列
        return new Promise((resolve, reject) => {
            this.queue.push({ execute: fn, resolve, reject, enqueueTime: Date.now() });
            this.processQueue();
        });
    }
    
    /**
     * 处理队列
     */
    private async processQueue(): Promise<void> {
        if (this.processing || this.queue.length === 0) {
            return;
        }
        
        this.processing = true;
        
        while (this.queue.length > 0) {
            const waitTime = this.getWaitTime();
            
            if (waitTime > 0) {
                await this.sleep(waitTime);
            }
            
            // 检查最小间隔
            const timeSinceLastRequest = Date.now() - this.lastRequest;
            if (timeSinceLastRequest < this.minInterval) {
                await this.sleep(this.minInterval - timeSinceLastRequest);
            }
            
            if (this.tryAcquire()) {
                const request = this.queue.shift();
                if (request) {
                    // Check if request has timed out
                    if (Date.now() - request.enqueueTime > this.requestTimeout) {
                        request.reject(new RateLimitError('Request timeout in rate limiter queue'));
                        continue;
                    }
                    this.lastRequest = Date.now();
                    try {
                        const result = await request.execute();
                        request.resolve(result);
                    } catch (error) {
                        request.reject(error instanceof Error ? error : new Error(String(error)));
                    }
                }
            }
        }
        
        this.processing = false;
    }
    
    /**
     * 获取当前状态
     */
    getStatus(): {
        availableTokens: number;
        queueLength: number;
        isProcessing: boolean;
    } {
        this.refillTokens();
        return {
            availableTokens: Math.floor(this.tokens),
            queueLength: this.queue.length,
            isProcessing: this.processing,
        };
    }
    
    /**
     * 清空队列
     */
    clearQueue(): void {
        const error = new RateLimitError('Queue cleared');
        this.queue.forEach(request => request.reject(error));
        this.queue = [];
    }
    
    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

/**
 * 速率限制错误
 */
export class RateLimitError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'RateLimitError';
    }
}

/**
 * 平台速率限制预设
 */
export const RateLimitPresets = {
    /** Discord - 50 请求/秒 */
    discord: {
        maxRequests: 50,
        windowMs: 1000,
        minInterval: 50,
        queueExcess: true,
    } as RateLimiterOptions,
    
    /** Telegram - 30 消息/秒（群组 20/分钟） */
    telegram: {
        maxRequests: 30,
        windowMs: 1000,
        minInterval: 50,
        queueExcess: true,
    } as RateLimiterOptions,
    
    /** QQ - 5 消息/秒 */
    qq: {
        maxRequests: 5,
        windowMs: 1000,
        minInterval: 200,
        queueExcess: true,
    } as RateLimiterOptions,
    
    /** 通用 - 10 请求/秒 */
    default: {
        maxRequests: 10,
        windowMs: 1000,
        minInterval: 100,
        queueExcess: true,
    } as RateLimiterOptions,
};

/**
 * 创建带速率限制的函数包装器
 */
export function withRateLimit<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    limiter: RateLimiter
): T {
    return ((...args: Parameters<T>) => {
        return limiter.execute(() => fn(...args));
    }) as T;
}

