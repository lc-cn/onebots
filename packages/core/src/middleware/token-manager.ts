/**
 * 令牌管理器
 * 支持令牌过期、刷新、轮换等功能
 */

import { createLogger } from '../logger.js';
import crypto from 'crypto';

const logger = createLogger('TokenManager');

export interface TokenInfo {
    token: string;
    expiresAt?: number; // 过期时间戳（毫秒）
    refreshToken?: string;
    refreshExpiresAt?: number;
    metadata?: Record<string, any>;
}

export interface TokenManagerOptions {
    /** 默认令牌过期时间（毫秒） */
    defaultExpiration?: number;
    /** 刷新令牌过期时间（毫秒） */
    refreshExpiration?: number;
    /** 是否自动刷新 */
    autoRefresh?: boolean;
    /** 刷新阈值（在过期前多久刷新，毫秒） */
    refreshThreshold?: number;
}

/**
 * 令牌管理器
 */
export class TokenManager {
    private tokens: Map<string, TokenInfo> = new Map();
    private options: Required<TokenManagerOptions>;

    constructor(options: TokenManagerOptions = {}) {
        this.options = {
            defaultExpiration: options.defaultExpiration || 3600000, // 默认 1 小时
            refreshExpiration: options.refreshExpiration || 86400000 * 7, // 默认 7 天
            autoRefresh: options.autoRefresh ?? false,
            refreshThreshold: options.refreshThreshold || 300000, // 默认 5 分钟
        };
    }

    /**
     * 生成新令牌
     */
    generateToken(metadata?: Record<string, any>): TokenInfo {
        const token = crypto.randomBytes(32).toString('hex');
        const refreshToken = crypto.randomBytes(32).toString('hex');
        const now = Date.now();

        const tokenInfo: TokenInfo = {
            token,
            expiresAt: now + this.options.defaultExpiration,
            refreshToken,
            refreshExpiresAt: now + this.options.refreshExpiration,
            metadata,
        };

        this.tokens.set(token, tokenInfo);
        
        // 如果设置了刷新令牌，也存储
        if (refreshToken) {
            this.tokens.set(`refresh:${refreshToken}`, tokenInfo);
        }

        logger.debug('Token generated', {
            tokenPrefix: token.substring(0, 10) + '...',
            expiresAt: new Date(tokenInfo.expiresAt!).toISOString(),
        });

        return tokenInfo;
    }

    /**
     * 验证令牌
     */
    validateToken(token: string): { valid: boolean; expired?: boolean; info?: TokenInfo } {
        const info = this.tokens.get(token);
        
        if (!info) {
            return { valid: false };
        }

        // 检查是否过期
        if (info.expiresAt && Date.now() > info.expiresAt) {
            // 清理过期令牌
            this.tokens.delete(token);
            if (info.refreshToken) {
                this.tokens.delete(`refresh:${info.refreshToken}`);
            }
            return { valid: false, expired: true };
        }

        // 检查是否需要刷新
        if (this.options.autoRefresh && info.expiresAt) {
            const timeUntilExpiry = info.expiresAt - Date.now();
            if (timeUntilExpiry < this.options.refreshThreshold) {
                logger.debug('Token needs refresh', {
                    tokenPrefix: token.substring(0, 10) + '...',
                    timeUntilExpiry,
                });
            }
        }

        return { valid: true, info };
    }

    /**
     * 刷新令牌
     */
    refreshToken(refreshToken: string): TokenInfo | null {
        const key = `refresh:${refreshToken}`;
        const info = this.tokens.get(key);
        
        if (!info) {
            return null;
        }

        // 检查刷新令牌是否过期
        if (info.refreshExpiresAt && Date.now() > info.refreshExpiresAt) {
            this.tokens.delete(key);
            if (info.token) {
                this.tokens.delete(info.token);
            }
            return null;
        }

        // 生成新令牌
        const newToken = this.generateToken(info.metadata);
        
        // 删除旧令牌
        this.tokens.delete(info.token);
        this.tokens.delete(key);

        logger.info('Token refreshed', {
            oldTokenPrefix: info.token.substring(0, 10) + '...',
            newTokenPrefix: newToken.token.substring(0, 10) + '...',
        });

        return newToken;
    }

    /**
     * 撤销令牌
     */
    revokeToken(token: string): boolean {
        const info = this.tokens.get(token);
        
        if (!info) {
            return false;
        }

        this.tokens.delete(token);
        if (info.refreshToken) {
            this.tokens.delete(`refresh:${info.refreshToken}`);
        }

        logger.info('Token revoked', {
            tokenPrefix: token.substring(0, 10) + '...',
        });

        return true;
    }

    /**
     * 获取令牌信息
     */
    getTokenInfo(token: string): TokenInfo | undefined {
        return this.tokens.get(token);
    }

    /**
     * 清理过期令牌
     */
    cleanup(): number {
        const now = Date.now();
        let cleaned = 0;

        for (const [key, info] of this.tokens.entries()) {
            const expired = 
                (info.expiresAt && now > info.expiresAt) ||
                (info.refreshExpiresAt && now > info.refreshExpiresAt);

            if (expired) {
                this.tokens.delete(key);
                cleaned++;
            }
        }

        if (cleaned > 0) {
            logger.debug(`Cleaned up ${cleaned} expired tokens`);
        }

        return cleaned;
    }

    /**
     * 获取统计信息
     */
    getStats(): {
        total: number;
        active: number;
        expired: number;
    } {
        const now = Date.now();
        let active = 0;
        let expired = 0;

        for (const info of this.tokens.values()) {
            if (info.expiresAt && now > info.expiresAt) {
                expired++;
            } else {
                active++;
            }
        }

        return {
            total: this.tokens.size,
            active,
            expired,
        };
    }
}

// 全局令牌管理器实例（可选）
let globalTokenManager: TokenManager | null = null;

/**
 * 初始化全局令牌管理器
 */
export function initTokenManager(options?: TokenManagerOptions): TokenManager {
    globalTokenManager = new TokenManager(options);
    
    // 定期清理过期令牌（每 5 分钟）
    setInterval(() => {
        globalTokenManager?.cleanup();
    }, 5 * 60 * 1000);
    
    return globalTokenManager;
}

/**
 * 获取全局令牌管理器
 */
export function getTokenManager(): TokenManager | null {
    return globalTokenManager;
}

