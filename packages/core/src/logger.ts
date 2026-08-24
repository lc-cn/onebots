/**
 * 增强的日志系统
 * 提供结构化日志、错误追踪和上下文信息
 */

import { Logger as Log4jsLogger } from 'log4js';
import log4js from 'log4js';
import { OneBotsError, ErrorHandler } from './errors.js';
import type { LogLevel } from './types.js';
const { getLogger } = log4js;
export interface LogContext {
    [key: string]: unknown;
}


export interface LogEntry {
    level: string;
    message: string;
    context?: LogContext;
    error?: OneBotsError;
    timestamp: Date;
}

/**
 * 增强的 Logger 类
 */
export class Logger {
    private logger: Log4jsLogger;
    private context: LogContext = {};

    constructor(name: string, level?: LogLevel) {
        this.logger = getLogger(name);
        if (level) {
            this.logger.level = level;
        }
    }

    /**
     * 设置日志级别
     */
    setLevel(level: LogLevel): void {
        this.logger.level = level;
    }

    /**
     * 添加上下文信息
     */
    withContext(context: LogContext): Logger {
        const newLogger = new Logger(this.logger.category, this.logger.level as LogLevel);
        newLogger.context = { ...this.context, ...context };
        return newLogger;
    }

    /**
     * Trace 级别日志
     */
    trace(message: string, context?: LogContext): void {
        this.log('trace', message, context);
    }

    /**
     * Debug 级别日志
     */
    debug(message: string, context?: LogContext): void {
        this.log('debug', message, context);
    }

    /**
     * Info 级别日志
     */
    info(message: string, context?: LogContext): void {
        this.log('info', message, context);
    }

    /**
     * Warn 级别日志
     */
    warn(message: string, context?: LogContext): void {
        this.log('warn', message, context);
    }

    /**
     * Error 级别日志
     */
    error(message: string | Error | OneBotsError, context?: LogContext): void {
        if (typeof message === 'object' && message !== null) {
            if (message instanceof Error) {
                const error = ErrorHandler.wrap(message, context);
                this.log('error', error.message, {
                    ...context,
                    error: error.toJSON(),
                });
                return;
            }
        }
        this.log('error', message as string, context);
    }

    /**
     * Fatal 级别日志
     */
    fatal(message: string | Error | OneBotsError, context?: LogContext): void {
        if (typeof message === 'object' && message !== null) {
            if (message instanceof Error) {
                const error = ErrorHandler.wrap(message, context);
                this.log('fatal', error.message, {
                    ...context,
                    error: error.toJSON(),
                });
                return;
            }
        }
        this.log('fatal', message as string, context);
    }

    /**
     * Mark 级别日志
     */
    mark(message: string, context?: LogContext): void {
        this.log('mark', message, context);
    }

    /**
     * 记录性能指标
     */
    performance(operation: string, duration: number, context?: LogContext): void {
        this.info(`Performance: ${operation} took ${duration}ms`, {
            ...context,
            operation,
            duration,
            type: 'performance',
        });
    }

    /**
     * 记录操作开始
     */
    start(operation: string, context?: LogContext): () => void {
        const startTime = Date.now();
        this.debug(`Starting: ${operation}`, context);
        return () => {
            const duration = Date.now() - startTime;
            this.performance(operation, duration, context);
        };
    }

    /**
     * 内部日志方法
     */
    private log(level: string, message: string, context?: LogContext): void {
        const mergedContext = { ...this.context, ...context };
        const logMessage = mergedContext && Object.keys(mergedContext).length > 0
            ? `${message} ${JSON.stringify(mergedContext)}`
            : message;

        switch (level) {
            case 'trace':
                this.logger.trace(logMessage);
                break;
            case 'debug':
                this.logger.debug(logMessage);
                break;
            case 'info':
                this.logger.info(logMessage);
                break;
            case 'warn':
                this.logger.warn(logMessage);
                break;
            case 'error':
                this.logger.error(logMessage);
                break;
            case 'fatal':
                this.logger.fatal(logMessage);
                break;
            case 'mark':
                this.logger.mark(logMessage);
                break;
        }
    }
}

/**
 * 创建 Logger 实例
 */
export function createLogger(name: string, level?: LogLevel): Logger {
    return new Logger(name, level);
}

