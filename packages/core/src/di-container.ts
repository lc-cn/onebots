/**
 * 依赖注入容器
 * 提供依赖注入和生命周期管理
 */

import type { Class } from './utils.js';

export type Token<T = unknown> = string | symbol | Class<T>;
export type Factory<T = unknown> = (container: Container) => T;
export type Provider<T = unknown> = Class<T> | Factory<T>;

export interface ServiceOptions {
    /** 是否单例 */
    singleton?: boolean;
    /** 依赖的token列表 */
    deps?: Token[];
}

/**
 * 依赖注入容器
 */
export class Container {
    private services = new Map<Token, {
        provider: Provider;
        instance?: unknown;
        options: ServiceOptions;
    }>();

    /**
     * 注册服务
     */
    register<T>(
        token: Token<T>,
        provider: Provider<T>,
        options: ServiceOptions = {},
    ): void {
        this.services.set(token, {
            provider,
            options: {
                singleton: true,
                ...options,
            },
        });
    }

    /**
     * 注册单例服务
     */
    registerSingleton<T>(
        token: Token<T>,
        provider: Provider<T>,
        deps?: Token[],
    ): void {
        this.register(token, provider, {
            singleton: true,
            deps,
        });
    }

    /**
     * 注册瞬态服务（每次获取都创建新实例）
     */
    registerTransient<T>(
        token: Token<T>,
        provider: Provider<T>,
        deps?: Token[],
    ): void {
        this.register(token, provider, {
            singleton: false,
            deps,
        });
    }

    /**
     * 获取服务实例
     */
    get<T>(token: Token<T>): T {
        const service = this.services.get(token);
        if (!service) {
            throw new Error(`Service not found: ${String(token)}`);
        }

        // 如果是单例且已有实例，直接返回
        if (service.options.singleton && service.instance !== undefined) {
            return service.instance as T;
        }

        // 创建实例
        let instance: T;
        if (this.isClass(service.provider)) {
            // 类构造函数
            const deps = this.resolveDependencies(service.options.deps || []);
            instance = new service.provider(...deps) as T;
        } else {
            // 工厂函数
            instance = service.provider(this) as T;
        }

        // 如果是单例，保存实例
        if (service.options.singleton) {
            service.instance = instance;
        }

        return instance;
    }

    /**
     * 检查服务是否已注册
     */
    has(token: Token): boolean {
        return this.services.has(token);
    }

    /**
     * 解析依赖
     */
    private resolveDependencies(tokens: Token[]): unknown[] {
        return tokens.map(token => this.get(token));
    }

    /**
     * 判断是否为类
     */
    private isClass(provider: Provider): provider is Class {
        return typeof provider === 'function' && provider.prototype && provider.prototype.constructor === provider;
    }

    /**
     * 清除所有服务
     */
    clear(): void {
        this.services.clear();
    }

    /**
     * 移除服务
     */
    remove(token: Token): boolean {
        return this.services.delete(token);
    }
}

/**
 * 全局容器实例
 */
export const container = new Container();

