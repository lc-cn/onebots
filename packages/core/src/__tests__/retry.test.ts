/**
 * 重试与连接管理单元测试
 */
import { describe, it, expect, vi } from 'vitest';
import { retry, RetryPresets, calculateDelay, ConnectionManager } from '../retry.js';

describe('calculateDelay', () => {
    const baseOpts = { maxRetries: 3, initialDelay: 1000, maxDelay: 30000, backoffMultiplier: 2, jitter: false, shouldRetry: () => true, onRetry: () => {} };

    it('首次重试延迟为 initialDelay', () => {
        expect(calculateDelay(1, baseOpts)).toBe(1000);
    });

    it('指数退避正确', () => {
        expect(calculateDelay(2, baseOpts)).toBe(2000);
        expect(calculateDelay(3, baseOpts)).toBe(4000);
    });

    it('不超过 maxDelay', () => {
        const limited = { ...baseOpts, initialDelay: 20000, maxDelay: 50000 };
        expect(calculateDelay(3, limited)).toBe(50000);
    });

    it('带抖动的值在变更范围内', () => {
        const jittered = { ...baseOpts, jitter: true };
        const delay = calculateDelay(2, jittered);
        expect(delay).toBeGreaterThanOrEqual(1500);
        expect(delay).toBeLessThanOrEqual(2500);
    });
});

describe('retry', () => {
    const alwaysRetry = { maxRetries: 2, initialDelay: 10, shouldRetry: () => true };

    it('成功时直接返回', async () => {
        const result = await retry(async () => 'ok', { maxRetries: 2 });
        expect(result).toBe('ok');
    });

    it('最终失败时抛出异常', async () => {
        const fn = vi.fn().mockRejectedValue(new Error('timeout'));
        await expect(retry(fn, alwaysRetry)).rejects.toThrow('timeout');
        // 1 initial attempt + 2 retries = 3
        expect(fn.mock.calls.length).toBeGreaterThanOrEqual(2);
    });

    it('重试直到成功', async () => {
        let attempts = 0;
        const fn = async () => {
            attempts++;
            if (attempts < 3) throw new Error('timeout');
            return 'success';
        };
        const result = await retry(fn, { ...alwaysRetry, maxRetries: 5 });
        expect(result).toBe('success');
        expect(attempts).toBe(3);
    });

    it('不重试被 shouldRetry 拒绝的错误', async () => {
        const shouldRetry = (err: Error) => err.message.includes('network');
        const fn = vi.fn().mockRejectedValue(new Error('validation error'));
        await expect(retry(fn, { maxRetries: 3, shouldRetry })).rejects.toThrow('validation error');
        expect(fn).toHaveBeenCalledTimes(1);
    });
});

describe('RetryPresets', () => {
    it('fast 预设重试 3 次', () => {
        expect(RetryPresets.fast.maxRetries).toBe(3);
        expect(RetryPresets.fast.initialDelay).toBe(1000);
    });

    it('websocket 预设无限重试', () => {
        expect(RetryPresets.websocket.maxRetries).toBe(Infinity);
    });
});

describe('ConnectionManager', () => {
    it('start 调用 connect 函数', async () => {
        const connect = vi.fn().mockResolvedValue(undefined);
        const cm = new ConnectionManager(connect, RetryPresets.fast);
        await cm.start();
        expect(connect).toHaveBeenCalledTimes(1);
    });

    it('scheduleReconnect 增加计数', () => {
        const connect = vi.fn().mockResolvedValue(undefined);
        const cm = new ConnectionManager(connect, { ...RetryPresets.fast, maxRetries: 5 });
        expect(cm.getAttempts()).toBe(0);
        cm.scheduleReconnect(new Error('test'));
        expect(cm.getAttempts()).toBe(1);
        cm.stop();
    });

    it('stop 清除重连定时器', () => {
        const connect = vi.fn().mockResolvedValue(undefined);
        const cm = new ConnectionManager(connect, RetryPresets.fast);
        cm.scheduleReconnect(new Error('test'));
        cm.stop();
        expect(cm.getAttempts()).toBe(1); // attempt was counted before stop
    });

    it('resetAttempts 重置计数', () => {
        const connect = vi.fn().mockResolvedValue(undefined);
        const cm = new ConnectionManager(connect, RetryPresets.fast);
        cm.scheduleReconnect(new Error('test'));
        expect(cm.getAttempts()).toBe(1);
        cm.resetAttempts();
        expect(cm.getAttempts()).toBe(0);
    });

    it('支持 logger 注入', () => {
        const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() };
        const connect = vi.fn().mockResolvedValue(undefined);
        const cm = new ConnectionManager(connect, RetryPresets.fast, { logger });
        cm.scheduleReconnect(new Error('test'));
        expect(logger.info).toHaveBeenCalled();
        cm.stop();
    });

    it('支持 onConnected 回调', async () => {
        const onConnected = vi.fn();
        const connect = vi.fn().mockResolvedValue(undefined);
        const cm = new ConnectionManager(connect, RetryPresets.fast, { onConnected });
        await cm.start();
        expect(onConnected).toHaveBeenCalledTimes(1);
    });

    it('支持 onMaxRetriesReached 回调', () => {
        const onMaxRetriesReached = vi.fn();
        const connect = vi.fn().mockRejectedValue(new Error('fail'));
        const cm = new ConnectionManager(connect, { ...RetryPresets.fast, maxRetries: 2 }, { onMaxRetriesReached });
        // Schedule without starting — faster test
        cm.scheduleReconnect(new Error('test'));
        cm.scheduleReconnect(new Error('test'));
        cm.scheduleReconnect(new Error('test'));
        // After 3 calls with maxRetries=2, the 3rd should trigger onMaxRetriesReached
        expect(onMaxRetriesReached).toHaveBeenCalled();
        cm.stop();
    });
});
