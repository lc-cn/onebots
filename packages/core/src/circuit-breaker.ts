/**
 * 熔断器模式实现
 * 防止级联故障，提高系统稳定性
 */

import { createLogger } from './logger.js';

const logger = createLogger('CircuitBreaker');

export enum CircuitState {
    /** 关闭状态：正常处理请求 */
    CLOSED = 'CLOSED',
    /** 开启状态：拒绝所有请求 */
    OPEN = 'OPEN',
    /** 半开状态：尝试恢复，允许部分请求通过 */
    HALF_OPEN = 'HALF_OPEN',
}

export interface CircuitBreakerOptions {
    /** 失败阈值：连续失败多少次后开启熔断 */
    failureThreshold?: number;
    /** 成功阈值：半开状态下成功多少次后关闭熔断 */
    successThreshold?: number;
    /** 超时时间：开启状态持续多久后进入半开状态（毫秒） */
    timeout?: number;
    /** 监控窗口大小（毫秒） */
    monitoringPeriod?: number;
    /** 最小请求数：在监控窗口内至少需要多少请求才触发熔断 */
    minimumRequests?: number;
    /** 错误率阈值：错误率超过多少时开启熔断（0-1） */
    errorRateThreshold?: number;
}

interface RequestRecord {
    timestamp: number;
    success: boolean;
}

const DEFAULT_OPTIONS: Required<CircuitBreakerOptions> = {
    failureThreshold: 5,
    successThreshold: 2,
    timeout: 60000, // 1 分钟
    monitoringPeriod: 60000, // 1 分钟
    minimumRequests: 10,
    errorRateThreshold: 0.5, // 50%
};

/**
 * 熔断器类
 */
export class CircuitBreaker {
    private state: CircuitState = CircuitState.CLOSED;
    private failureCount = 0;
    private successCount = 0;
    private lastFailureTime: number | null = null;
    private records: RequestRecord[] = [];
    private options: Required<CircuitBreakerOptions>;

    constructor(options: CircuitBreakerOptions = {}) {
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    /**
     * 执行函数，带熔断保护
     */
    async execute<T>(fn: () => Promise<T>): Promise<T> {
        // 检查状态
        if (this.state === CircuitState.OPEN) {
            // 检查是否可以进入半开状态
            if (this.lastFailureTime && Date.now() - this.lastFailureTime >= this.options.timeout) {
                this.state = CircuitState.HALF_OPEN;
                this.successCount = 0;
                logger.info('Circuit breaker entering HALF_OPEN state');
            } else {
                throw new CircuitBreakerOpenError('Circuit breaker is OPEN');
            }
        }

        // 执行函数
        try {
            const result = await fn();
            this.onSuccess();
            return result;
        } catch (error) {
            this.onFailure();
            throw error;
        }
    }

    /**
     * 成功回调
     */
    private onSuccess(): void {
        const now = Date.now();
        this.records.push({ timestamp: now, success: true });
        this.cleanupOldRecords(now);

        if (this.state === CircuitState.HALF_OPEN) {
            this.successCount++;
            if (this.successCount >= this.options.successThreshold) {
                this.state = CircuitState.CLOSED;
                this.failureCount = 0;
                this.successCount = 0;
                logger.info('Circuit breaker CLOSED: recovery successful');
            }
        } else if (this.state === CircuitState.CLOSED) {
            // 重置失败计数
            this.failureCount = 0;
        }
    }

    /**
     * 失败回调
     */
    private onFailure(): void {
        const now = Date.now();
        this.records.push({ timestamp: now, success: false });
        this.cleanupOldRecords(now);

        if (this.state === CircuitState.HALF_OPEN) {
            // 半开状态下失败，立即开启
            this.state = CircuitState.OPEN;
            this.lastFailureTime = now;
            this.successCount = 0;
            logger.warn('Circuit breaker OPEN: failed in HALF_OPEN state');
        } else if (this.state === CircuitState.CLOSED) {
            this.failureCount++;
            this.lastFailureTime = now;

            // 检查是否应该开启熔断
            const shouldOpen = this.shouldOpen(now);
            if (shouldOpen) {
                this.state = CircuitState.OPEN;
                logger.warn('Circuit breaker OPEN: threshold exceeded', {
                    failureCount: this.failureCount,
                    errorRate: this.getErrorRate(now),
                });
            }
        }
    }

    /**
     * 判断是否应该开启熔断
     */
    private shouldOpen(now: number): boolean {
        // 检查连续失败次数
        if (this.failureCount >= this.options.failureThreshold) {
            return true;
        }

        // 检查错误率
        const errorRate = this.getErrorRate(now);
        if (errorRate >= this.options.errorRateThreshold) {
            const recentRequests = this.getRecentRequests(now);
            if (recentRequests.length >= this.options.minimumRequests) {
                return true;
            }
        }

        return false;
    }

    /**
     * 获取错误率
     */
    private getErrorRate(now: number): number {
        const recentRequests = this.getRecentRequests(now);
        if (recentRequests.length === 0) {
            return 0;
        }

        const failures = recentRequests.filter(r => !r.success).length;
        return failures / recentRequests.length;
    }

    /**
     * 获取最近的请求记录
     */
    private getRecentRequests(now: number): RequestRecord[] {
        const cutoff = now - this.options.monitoringPeriod;
        return this.records.filter(r => r.timestamp >= cutoff);
    }

    /**
     * 清理过期记录
     */
    private cleanupOldRecords(now: number): void {
        const cutoff = now - this.options.monitoringPeriod * 2;
        this.records = this.records.filter(r => r.timestamp >= cutoff);
    }

    /**
     * 获取当前状态
     */
    getState(): CircuitState {
        return this.state;
    }

    /**
     * 获取统计信息
     */
    getStats(): {
        state: CircuitState;
        failureCount: number;
        successCount: number;
        errorRate: number;
        totalRequests: number;
    } {
        const now = Date.now();
        const recentRequests = this.getRecentRequests(now);
        const failures = recentRequests.filter(r => !r.success).length;
        const errorRate = recentRequests.length > 0 ? failures / recentRequests.length : 0;

        return {
            state: this.state,
            failureCount: this.failureCount,
            successCount: this.successCount,
            errorRate,
            totalRequests: recentRequests.length,
        };
    }

    /**
     * 手动重置熔断器
     */
    reset(): void {
        this.state = CircuitState.CLOSED;
        this.failureCount = 0;
        this.successCount = 0;
        this.lastFailureTime = null;
        this.records = [];
        logger.info('Circuit breaker manually reset');
    }
}

/**
 * 熔断器开启错误
 */
export class CircuitBreakerOpenError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CircuitBreakerOpenError';
    }
}

/**
 * 创建带熔断器的函数包装器
 */
export function withCircuitBreaker<T extends (...args: any[]) => Promise<any>>(
    fn: T,
    breaker: CircuitBreaker
): T {
    return ((...args: Parameters<T>) => {
        return breaker.execute(() => fn(...args));
    }) as T;
}

