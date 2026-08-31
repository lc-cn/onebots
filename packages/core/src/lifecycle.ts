/**
 * 生命周期管理
 * 提供资源管理和优雅关闭机制
 */

import { EventEmitter } from "node:events";
import { ResourceError } from "./errors.js";
import type { Dispose } from "./types.js";
import { FailureCollector } from "./async-utils.js";

export interface LifecycleHook {
    /** 初始化钩子 */
    onInit?(): void | Promise<void>;
    /** 启动钩子 */
    onStart?(): void | Promise<void>;
    /** 停止钩子 */
    onStop?(): void | Promise<void>;
    /** 清理钩子 */
    onCleanup?(): void | Promise<void>;
}

export interface LifecycleCleanupOptions {
    /** 完成全部清理后传播钩子、资源与事件监听器错误。 */
    throwOnFailure?: boolean;
}

/**
 * 生命周期管理器
 */
export class LifecycleManager extends EventEmitter {
    private resources: Map<string, Dispose> = new Map();
    private hooks: LifecycleHook[] = [];
    private isShuttingDown = false;
    private shutdownTimeout = 30000; // 30秒超时

    /**
     * 注册资源
     */
    register(name: string, dispose: Dispose): void {
        if (this.resources.has(name)) {
            throw new ResourceError(`Resource ${name} already registered`);
        }
        this.resources.set(name, dispose);
    }

    /**
     * 注销资源
     */
    unregister(name: string): boolean {
        return this.resources.delete(name);
    }

    /**
     * 注册生命周期钩子
     */
    addHook(hook: LifecycleHook): void {
        this.hooks.push(hook);
    }

    /**
     * 移除生命周期钩子
     */
    removeHook(hook: LifecycleHook): void {
        const index = this.hooks.indexOf(hook);
        if (index !== -1) {
            this.hooks.splice(index, 1);
        }
    }

    /**
     * 初始化所有钩子
     */
    async init(): Promise<void> {
        this.emit("beforeInit");
        for (const hook of this.hooks) {
            if (hook.onInit) {
                await hook.onInit();
            }
        }
        this.emit("afterInit");
    }

    /**
     * 启动所有钩子
     */
    async start(): Promise<void> {
        this.emit("beforeStart");
        for (const hook of this.hooks) {
            if (hook.onStart) {
                await hook.onStart();
            }
        }
        this.emit("afterStart");
    }

    /**
     * 停止所有钩子
     */
    async stop(): Promise<void> {
        const failures = new FailureCollector();
        await failures.capture(() => {
            this.emit("beforeStop");
        });
        for (const hook of this.hooks) {
            if (hook.onStop) {
                await failures.capture(() => hook.onStop!());
            }
        }
        await failures.capture(() => {
            this.emit("afterStop");
        });
        failures.throwIfAny(`${failures.size} 个生命周期停止操作失败`);
    }

    /**
     * 清理所有资源
     * 默认保持尽力清理兼容行为；宿主停机应启用 throwOnFailure 以获得可验证结果。
     */
    async cleanup(options: LifecycleCleanupOptions = {}): Promise<void> {
        if (this.isShuttingDown) {
            return;
        }

        this.isShuttingDown = true;
        const failures = new FailureCollector();
        await failures.capture(
            () => {
                this.emit("beforeCleanup");
            },
            error => this.emit("cleanupError", { phase: "beforeCleanup", error }),
        );

        // 执行清理钩子
        for (const hook of this.hooks) {
            if (hook.onCleanup) {
                await failures.capture(
                    () => hook.onCleanup!(),
                    error => this.emit("cleanupError", { hook: "onCleanup", error }),
                );
            }
        }

        // 清理所有资源
        const cleanupPromises: Promise<void>[] = [];
        for (const [name, dispose] of this.resources.entries()) {
            cleanupPromises.push(
                (async () => {
                    await failures.capture(
                        async () => {
                            const result = dispose();
                            if (result instanceof Promise) {
                                await result;
                            }
                        },
                        error => this.emit("cleanupError", { name, error }),
                    );
                })(),
            );
        }

        await Promise.all(cleanupPromises);
        this.resources.clear();
        this.hooks = [];

        await failures.capture(
            () => {
                this.emit("afterCleanup");
            },
            error => this.emit("cleanupError", { phase: "afterCleanup", error }),
        );
        if (options.throwOnFailure) {
            failures.throwIfAny(`${failures.size} 个生命周期清理操作失败`);
        }
    }

    /**
     * 优雅关闭
     */
    async gracefulShutdown(signal?: string, options?: { exitOnTimeout?: boolean }): Promise<void> {
        if (this.isShuttingDown) {
            return;
        }

        this.emit("shutdown", signal);

        // 设置超时
        let timeout: NodeJS.Timeout | null = null;
        if (this.shutdownTimeout > 0) {
            timeout = setTimeout(() => {
                this.emit("shutdownTimeout");
                if (options?.exitOnTimeout !== false) {
                    process.exit(1);
                }
            }, this.shutdownTimeout);
        }

        const failures = new FailureCollector();
        await failures.capture(() => this.stop());
        await failures.capture(() => this.cleanup({ throwOnFailure: true }));
        if (timeout) {
            clearTimeout(timeout);
        }
        try {
            failures.throwIfAny(`${failures.size} 个优雅关闭操作失败`);
            this.emit("shutdownComplete");
        } catch (error) {
            this.emit("shutdownError", error);
            throw error;
        }
    }

    /**
     * 设置关闭超时时间
     */
    setShutdownTimeout(timeout: number): void {
        this.shutdownTimeout = timeout;
    }

    /**
     * 获取资源数量
     */
    getResourceCount(): number {
        return this.resources.size;
    }

    /**
     * 获取所有资源名称
     */
    getResourceNames(): string[] {
        return Array.from(this.resources.keys());
    }
}
