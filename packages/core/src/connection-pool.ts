/**
 * 连接池和资源管理
 * 管理 HTTP 连接、WebSocket 连接等资源
 */

import { createLogger } from './logger.js';
import { EventEmitter } from 'events';

const logger = createLogger('ConnectionPool');

export interface PoolConfig {
    /** 最大连接数 */
    maxConnections?: number;
    /** 最小连接数 */
    minConnections?: number;
    /** 连接超时时间（毫秒） */
    timeout?: number;
    /** 空闲连接超时时间（毫秒） */
    idleTimeout?: number;
    /** 连接创建函数 */
    create: () => Promise<any>;
    /** 连接销毁函数 */
    destroy: (connection: any) => Promise<void>;
    /** 连接验证函数 */
    validate?: (connection: any) => boolean | Promise<boolean>;
}

interface PooledConnection {
    connection: any;
    createdAt: number;
    lastUsedAt: number;
    inUse: boolean;
}

/**
 * 连接池类
 */
export class ConnectionPool extends EventEmitter {
    private pool: PooledConnection[] = [];
    private waiting: Array<{
        resolve: (connection: any) => void;
        reject: (error: Error) => void;
    }> = [];
    private config: Required<PoolConfig>;
    private cleanupInterval?: NodeJS.Timeout;

    constructor(config: PoolConfig) {
        super();
        
        this.config = {
            maxConnections: config.maxConnections || 10,
            minConnections: config.minConnections || 0,
            timeout: config.timeout || 30000,
            idleTimeout: config.idleTimeout || 60000,
            create: config.create,
            destroy: config.destroy,
            validate: config.validate || (() => true),
        };

        // 启动清理任务
        this.startCleanup();
    }

    /**
     * 获取连接
     */
    async acquire(): Promise<any> {
        // 尝试从池中获取可用连接
        const available = this.pool.find(c => !c.inUse);
        
        if (available) {
            // 验证连接
            const isValid = await this.config.validate(available.connection);
            if (isValid) {
                available.inUse = true;
                available.lastUsedAt = Date.now();
                return available.connection;
            } else {
                // 连接无效，移除它
                this.pool = this.pool.filter(c => c !== available);
                await this.config.destroy(available.connection);
            }
        }

        // 检查是否可以创建新连接
        if (this.pool.length < this.config.maxConnections) {
            try {
                const connection = await this.config.create();
                const pooled: PooledConnection = {
                    connection,
                    createdAt: Date.now(),
                    lastUsedAt: Date.now(),
                    inUse: true,
                };
                this.pool.push(pooled);
                this.emit('connection:created', connection);
                return connection;
            } catch (error) {
                logger.error('Failed to create connection', { error });
                throw error;
            }
        }

        // 等待可用连接
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                const index = this.waiting.findIndex(w => w.reject === reject);
                if (index !== -1) {
                    this.waiting.splice(index, 1);
                }
                reject(new Error('Connection acquisition timeout'));
            }, this.config.timeout);

            this.waiting.push({
                resolve: (connection) => {
                    clearTimeout(timeout);
                    resolve(connection);
                },
                reject: (error) => {
                    clearTimeout(timeout);
                    reject(error);
                },
            });
        });
    }

    /**
     * 释放连接
     */
    async release(connection: any): Promise<void> {
        const pooled = this.pool.find(c => c.connection === connection);
        
        if (!pooled) {
            logger.warn('Attempted to release connection not in pool');
            return;
        }

        if (!pooled.inUse) {
            logger.warn('Attempted to release connection that is not in use');
            return;
        }

        pooled.inUse = false;
        pooled.lastUsedAt = Date.now();

        // 检查是否有等待的请求
        if (this.waiting.length > 0) {
            const waiter = this.waiting.shift()!;
            waiter.resolve(connection);
            pooled.inUse = true;
            pooled.lastUsedAt = Date.now();
        }
    }

    /**
     * 销毁连接
     */
    async destroy(connection: any): Promise<void> {
        const pooled = this.pool.find(c => c.connection === connection);
        
        if (!pooled) {
            return;
        }

        this.pool = this.pool.filter(c => c !== connection);
        
        try {
            await this.config.destroy(connection);
            this.emit('connection:destroyed', connection);
        } catch (error) {
            logger.error('Failed to destroy connection', { error });
        }
    }

    /**
     * 启动清理任务
     */
    private startCleanup(): void {
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, 60000); // 每分钟清理一次
    }

    /**
     * 清理空闲连接
     */
    private async cleanup(): Promise<void> {
        const now = Date.now();
        const toRemove: PooledConnection[] = [];

        for (const pooled of this.pool) {
            if (!pooled.inUse) {
                const idleTime = now - pooled.lastUsedAt;
                if (idleTime > this.config.idleTimeout) {
                    // 检查是否超过最小连接数
                    if (this.pool.length > this.config.minConnections) {
                        toRemove.push(pooled);
                    }
                }
            }
        }

        // 移除过期连接
        for (const pooled of toRemove) {
            await this.destroy(pooled.connection);
        }

        if (toRemove.length > 0) {
            logger.debug(`Cleaned up ${toRemove.length} idle connections`);
        }
    }

    /**
     * 获取池状态
     */
    getStatus(): {
        total: number;
        inUse: number;
        idle: number;
        waiting: number;
    } {
        return {
            total: this.pool.length,
            inUse: this.pool.filter(c => c.inUse).length,
            idle: this.pool.filter(c => !c.inUse).length,
            waiting: this.waiting.length,
        };
    }

    /**
     * 清空连接池
     */
    async clear(): Promise<void> {
        // 取消所有等待的请求
        for (const waiter of this.waiting) {
            waiter.reject(new Error('Pool cleared'));
        }
        this.waiting = [];

        // 销毁所有连接
        const connections = [...this.pool];
        for (const pooled of connections) {
            await this.destroy(pooled.connection);
        }

        this.pool = [];
        logger.info('Connection pool cleared');
    }

    /**
     * 关闭连接池
     */
    async close(): Promise<void> {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = undefined;
        }

        await this.clear();
        this.emit('close');
    }
}

