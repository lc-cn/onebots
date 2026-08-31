/**
 * 生命周期管理测试
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { LifecycleManager } from '../lifecycle.js';

describe('Lifecycle Manager', () => {
    let lifecycle: LifecycleManager;

    beforeEach(() => {
        lifecycle = new LifecycleManager();
    });

    describe('Resource Management', () => {
        it('should register and cleanup resources', async () => {
            let cleaned = false;
            lifecycle.register('test-resource', () => {
                cleaned = true;
            });

            expect(lifecycle.getResourceCount()).toBe(1);
            expect(lifecycle.getResourceNames()).toContain('test-resource');

            await lifecycle.cleanup();
            expect(cleaned).toBe(true);
            expect(lifecycle.getResourceCount()).toBe(0);
        });

        it('should handle multiple resources', async () => {
            const cleaned: string[] = [];
            lifecycle.register('resource1', () => {
                cleaned.push('resource1');
            });
            lifecycle.register('resource2', () => {
                cleaned.push('resource2');
            });

            await lifecycle.cleanup();
            expect(cleaned).toContain('resource1');
            expect(cleaned).toContain('resource2');
        });

        it('should handle resource cleanup errors', async () => {
            const errorHandler = vi.fn();
            lifecycle.on('cleanupError', errorHandler);

            lifecycle.register('error-resource', () => {
                throw new Error('Cleanup failed');
            });

            // 清理不应该抛出错误，应该触发事件
            await expect(lifecycle.cleanup()).resolves.not.toThrow();
            expect(errorHandler).toHaveBeenCalled();
        });

        it('should unregister resource', () => {
            lifecycle.register('resource1', () => {});
            lifecycle.register('resource2', () => {});

            expect(lifecycle.unregister('resource1')).toBe(true);
            expect(lifecycle.getResourceCount()).toBe(1);
            expect(lifecycle.getResourceNames()).not.toContain('resource1');
        });
    });

    describe('Lifecycle Hooks', () => {
        it('should execute init hooks', async () => {
            const initHook = vi.fn();
            lifecycle.addHook({ onInit: initHook });

            await lifecycle.init();
            expect(initHook).toHaveBeenCalled();
        });

        it('should execute start hooks', async () => {
            const startHook = vi.fn();
            lifecycle.addHook({ onStart: startHook });

            await lifecycle.start();
            expect(startHook).toHaveBeenCalled();
        });

        it('should execute stop hooks', async () => {
            const stopHook = vi.fn();
            lifecycle.addHook({ onStop: stopHook });

            await lifecycle.stop();
            expect(stopHook).toHaveBeenCalled();
        });

        it('should execute cleanup hooks', async () => {
            const cleanupHook = vi.fn();
            lifecycle.addHook({ onCleanup: cleanupHook });

            await lifecycle.cleanup();
            expect(cleanupHook).toHaveBeenCalled();
        });

        it('should execute all hooks in order', async () => {
            const order: string[] = [];
            lifecycle.addHook({
                onInit: () => {
                    order.push('init');
                },
                onStart: () => {
                    order.push('start');
                },
                onStop: () => {
                    order.push('stop');
                },
                onCleanup: () => {
                    order.push('cleanup');
                },
            });

            await lifecycle.init();
            await lifecycle.start();
            await lifecycle.stop();
            await lifecycle.cleanup();

            expect(order).toEqual(['init', 'start', 'stop', 'cleanup']);
        });
    });

    describe('Graceful Shutdown', () => {
        it('should perform graceful shutdown', async () => {
            const stopHook = vi.fn();
            const cleanupHook = vi.fn();
            lifecycle.addHook({
                onStop: stopHook,
                onCleanup: cleanupHook,
            });

            await lifecycle.gracefulShutdown('SIGTERM');
            expect(stopHook).toHaveBeenCalled();
            expect(cleanupHook).toHaveBeenCalled();
        });

        it('should emit shutdown events', async () => {
            const shutdownHandler = vi.fn();
            const shutdownCompleteHandler = vi.fn();
            lifecycle.on('shutdown', shutdownHandler);
            lifecycle.on('shutdownComplete', shutdownCompleteHandler);

            await lifecycle.gracefulShutdown('SIGTERM');
            expect(shutdownHandler).toHaveBeenCalledWith('SIGTERM');
            expect(shutdownCompleteHandler).toHaveBeenCalled();
        });

        it('should handle shutdown timeout', async () => {
            lifecycle.setShutdownTimeout(100);
            const timeoutHandler = vi.fn();
            lifecycle.on('shutdownTimeout', timeoutHandler);

            // 添加一个永远不会完成的钩子
            lifecycle.addHook({
                onStop: () => new Promise(() => {}), // 永远pending
            });

            // 使用 vi.useFakeTimers 来测试超时
            vi.useFakeTimers();
            
            // 启动关闭流程
            const shutdownPromise = lifecycle.gracefulShutdown(undefined, { exitOnTimeout: false });
            
            // 等待超时事件触发
            const timeoutPromise = new Promise<void>((resolve) => {
                lifecycle.once('shutdownTimeout', () => {
                    timeoutHandler();
                    resolve();
                });
            });
            
            // 推进时间
            vi.advanceTimersByTime(150);
            
            // 等待超时事件
            await timeoutPromise;
            
            expect(timeoutHandler).toHaveBeenCalled();
            
            // 清理
            vi.useRealTimers();
            // 取消关闭流程（避免测试挂起）
            lifecycle.removeHook(lifecycle['hooks'][0]);
        });
    });

    describe('Event Emission', () => {
        it('should emit lifecycle events', async () => {
            const beforeInit = vi.fn();
            const afterInit = vi.fn();
            lifecycle.on('beforeInit', beforeInit);
            lifecycle.on('afterInit', afterInit);

            await lifecycle.init();
            expect(beforeInit).toHaveBeenCalled();
            expect(afterInit).toHaveBeenCalled();
        });
    });
});

