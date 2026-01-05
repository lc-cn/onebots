/**
 * 安全审计日志中间件
 * 记录所有安全相关事件
 */

import type { Context, Next } from 'koa';
import { createLogger } from '../logger.js';
import * as fs from 'fs';
import * as path from 'path';

interface SecurityEvent {
    timestamp: number;
    type: 'auth_success' | 'auth_failure' | 'rate_limit' | 'invalid_token' | 'suspicious_request' | 'error';
    ip: string;
    path: string;
    method: string;
    userAgent?: string;
    details?: Record<string, any>;
}

class SecurityAuditLogger {
    private logger = createLogger('SecurityAudit');
    private auditLogFile: string;
    private writeStream?: fs.WriteStream;

    constructor(auditLogDir: string) {
        // 确保目录存在
        if (!fs.existsSync(auditLogDir)) {
            fs.mkdirSync(auditLogDir, { recursive: true });
        }
        
        // 使用日期作为日志文件名
        const today = new Date().toISOString().split('T')[0];
        this.auditLogFile = path.join(auditLogDir, `security-audit-${today}.log`);
        
        // 创建写入流
        this.writeStream = fs.createWriteStream(this.auditLogFile, { flags: 'a', encoding: 'utf-8' });
    }

    /**
     * 记录安全事件
     */
    log(event: SecurityEvent): void {
        const logEntry = JSON.stringify(event) + '\n';
        
        // 写入文件
        if (this.writeStream) {
            this.writeStream.write(logEntry);
        }
        
        // 根据事件类型选择日志级别
        const logData = {
            type: event.type,
            ip: event.ip,
            path: event.path,
            method: event.method,
            ...event.details,
        };
        
        switch (event.type) {
            case 'auth_failure':
            case 'invalid_token':
            case 'suspicious_request':
                this.logger.warn('Security event', logData);
                break;
            case 'rate_limit':
                this.logger.warn('Rate limit triggered', logData);
                break;
            case 'auth_success':
                this.logger.debug('Security event', logData);
                break;
            default:
                this.logger.info('Security event', logData);
        }
    }

    /**
     * 关闭写入流
     */
    close(): void {
        if (this.writeStream) {
            this.writeStream.end();
            this.writeStream = undefined;
        }
    }
}

let auditLogger: SecurityAuditLogger | null = null;

/**
 * 初始化安全审计日志
 */
export function initSecurityAudit(auditLogDir: string): void {
    auditLogger = new SecurityAuditLogger(auditLogDir);
}

/**
 * 安全审计中间件
 */
export function securityAudit() {
    return async (ctx: Context, next: Next) => {
        if (!auditLogger) {
            return next();
        }

        const startTime = Date.now();
        const ip = ctx.ip || ctx.request.ip || 'unknown';
        const userAgent = ctx.get('user-agent');
        
        try {
            await next();
            
            const duration = Date.now() - startTime;
            
            // 记录认证成功
            if (ctx.status === 200 && ctx.path.includes('/api/')) {
                auditLogger.log({
                    timestamp: Date.now(),
                    type: 'auth_success',
                    ip,
                    path: ctx.path,
                    method: ctx.method,
                    userAgent,
                    details: {
                        status: ctx.status,
                        duration,
                    },
                });
            }
            
            // 记录错误
            if (ctx.status >= 400) {
                auditLogger.log({
                    timestamp: Date.now(),
                    type: 'error',
                    ip,
                    path: ctx.path,
                    method: ctx.method,
                    userAgent,
                    details: {
                        status: ctx.status,
                        error: (ctx.body && typeof ctx.body === 'object' && 'error' in ctx.body) 
                            ? String(ctx.body.error) 
                            : ctx.message || 'Unknown error',
                        duration,
                    },
                });
            }
        } catch (error: unknown) {
            // 记录异常
            const err = error instanceof Error ? error : new Error(String(error));
            auditLogger.log({
                timestamp: Date.now(),
                type: 'error',
                ip,
                path: ctx.path,
                method: ctx.method,
                userAgent,
                details: {
                    error: err.message,
                    stack: err.stack,
                },
            });
            
            throw err;
        }
    };
}

/**
 * 记录认证失败
 */
export function logAuthFailure(ctx: Context, reason: string): void {
    if (!auditLogger) return;
    
    auditLogger.log({
        timestamp: Date.now(),
        type: 'auth_failure',
        ip: ctx.ip || ctx.request.ip || 'unknown',
        path: ctx.path,
        method: ctx.method,
        userAgent: ctx.get('user-agent'),
        details: {
            reason,
        },
    });
}

/**
 * 记录无效令牌
 */
export function logInvalidToken(ctx: Context, token?: string): void {
    if (!auditLogger) return;
    
    auditLogger.log({
        timestamp: Date.now(),
        type: 'invalid_token',
        ip: ctx.ip || ctx.request.ip || 'unknown',
        path: ctx.path,
        method: ctx.method,
        userAgent: ctx.get('user-agent'),
        details: {
            tokenPrefix: token ? token.substring(0, 10) + '...' : 'missing',
        },
    });
}

/**
 * 记录可疑请求
 */
export function logSuspiciousRequest(ctx: Context, reason: string, details?: Record<string, any>): void {
    if (!auditLogger) return;
    
    auditLogger.log({
        timestamp: Date.now(),
        type: 'suspicious_request',
        ip: ctx.ip || ctx.request.ip || 'unknown',
        path: ctx.path,
        method: ctx.method,
        userAgent: ctx.get('user-agent'),
        details: {
            reason,
            ...details,
        },
    });
}

/**
 * 记录速率限制触发
 */
export function logRateLimit(ctx: Context, key: string, count: number, max: number): void {
    if (!auditLogger) return;
    
    auditLogger.log({
        timestamp: Date.now(),
        type: 'rate_limit',
        ip: ctx.ip || ctx.request.ip || 'unknown',
        path: ctx.path,
        method: ctx.method,
        userAgent: ctx.get('user-agent'),
        details: {
            key,
            count,
            max,
        },
    });
}

/**
 * 关闭审计日志
 */
export function closeSecurityAudit(): void {
    if (auditLogger) {
        auditLogger.close();
        auditLogger = null;
    }
}

