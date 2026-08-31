/**
 * 速率限制中间件
 * 防止 API 滥用，保护服务器资源
 */

import type { Context, Next } from 'koa';
import { createLogger } from '../logger.js';
import { logRateLimit } from './security-audit.js';

interface RateLimitConfig {
    /** 时间窗口（毫秒） */
    windowMs: number;
    /** 每个 IP 在时间窗口内的最大请求数 */
    max: number;
    /** 是否跳过成功请求（只限制失败请求） */
    skipSuccessfulRequests?: boolean;
    /** 是否跳过失败请求（只限制成功请求） */
    skipFailedRequests?: boolean;
    /** 自定义键生成函数 */
    keyGenerator?: (ctx: Context) => string;
    /** 跳过函数 */
    skip?: (ctx: Context) => boolean;
    /** 自定义错误消息 */
    message?: string;
    /** 自定义状态码 */
    statusCode?: number;
}

interface RateLimitStore {
    [key: string]: {
        count: number;
        resetTime: number;
    };
}

/**
 * 速率限制存储（内存实现）
 * 生产环境建议使用 Redis
 */
class MemoryStore {
    private store: RateLimitStore = {};
    private cleanupInterval: NodeJS.Timeout;

    constructor() {
        // 每 5 分钟清理一次过期记录
        this.cleanupInterval = setInterval(() => {
            const now = Date.now();
            for (const key in this.store) {
                if (this.store[key].resetTime < now) {
                    delete this.store[key];
                }
            }
        }, 5 * 60 * 1000);
    }

    /**
     * 获取当前计数
     */
    get(key: string): { count: number; resetTime: number } | null {
        const record = this.store[key];
        if (!record) {
            return null;
        }
        
        // 如果已过期，删除记录
        if (record.resetTime < Date.now()) {
            delete this.store[key];
            return null;
        }
        
        return record;
    }

    /**
     * 增加计数
     */
    increment(key: string, windowMs: number): { count: number; resetTime: number } {
        const now = Date.now();
        const record = this.store[key];
        
        if (!record || record.resetTime < now) {
            // 创建新记录
            this.store[key] = {
                count: 1,
                resetTime: now + windowMs,
            };
            return this.store[key];
        }
        
        // 增加计数
        record.count++;
        return record;
    }

    /**
     * 重置计数
     */
    reset(key: string): void {
        delete this.store[key];
    }

    /**
     * 清理所有记录
     */
    cleanup(): void {
        this.store = {};
    }

    /**
     * 销毁存储
     */
    destroy(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
        }
        this.cleanup();
    }
}

/**
 * 创建速率限制中间件
 */
export function createRateLimit(config: RateLimitConfig) {
    const logger = createLogger('RateLimit');
    const store = new MemoryStore();
    
    const {
        windowMs = 60 * 1000, // 默认 1 分钟
        max = 100, // 默认 100 次请求
        skipSuccessfulRequests = false,
        skipFailedRequests = false,
        keyGenerator = (ctx: Context) => {
            // 默认使用 IP 地址作为键
            return ctx.ip || ctx.request.ip || 'unknown';
        },
        skip = () => false,
        message = 'Too many requests, please try again later.',
        statusCode = 429,
    } = config;

    return async (ctx: Context, next: Next) => {
        // 检查是否跳过
        if (skip(ctx)) {
            return next();
        }

        // 生成键
        const key = keyGenerator(ctx);
        
        // 获取当前记录
        const record = store.get(key);
        
        if (record) {
            // 检查是否超过限制
            if (record.count >= max) {
                logger.warn('Rate limit exceeded', {
                    key,
                    count: record.count,
                    max,
                    path: ctx.path,
                    method: ctx.method,
                });
                
                // 记录安全审计日志
                logRateLimit(ctx, key, record.count, max);
                
                ctx.status = statusCode;
                ctx.body = {
                    error: 'RateLimitExceeded',
                    message,
                    retryAfter: Math.ceil((record.resetTime - Date.now()) / 1000),
                };
                
                // 设置响应头
                ctx.set('X-RateLimit-Limit', String(max));
                ctx.set('X-RateLimit-Remaining', '0');
                ctx.set('X-RateLimit-Reset', String(Math.ceil(record.resetTime / 1000)));
                ctx.set('Retry-After', String(Math.ceil((record.resetTime - Date.now()) / 1000)));
                
                return;
            }
        }

        // 执行下一个中间件
        await next();

        // 根据配置决定是否记录
        const shouldSkip = 
            (skipSuccessfulRequests && ctx.status < 400) ||
            (skipFailedRequests && ctx.status >= 400);

        if (!shouldSkip) {
            // 增加计数
            const newRecord = store.increment(key, windowMs);
            
            // 设置响应头
            ctx.set('X-RateLimit-Limit', String(max));
            ctx.set('X-RateLimit-Remaining', String(Math.max(0, max - newRecord.count)));
            ctx.set('X-RateLimit-Reset', String(Math.ceil(newRecord.resetTime / 1000)));
        }
    };
}

/**
 * 默认速率限制配置
 */
export const defaultRateLimit = createRateLimit({
    windowMs: 60 * 1000, // 1 分钟
    max: 100, // 100 次请求
    message: 'Too many requests, please try again later.',
});

