/**
 * 性能指标收集中间件
 * 自动收集请求数、响应时间、错误率等指标
 */

import type { Context, Next } from 'koa';
import { metrics } from '../metrics.js';

/**
 * 性能指标收集中间件
 */
export function metricsCollector() {
    return async (ctx: Context, next: Next) => {
        const startTime = Date.now();
        const method = ctx.method;
        const path = ctx.path;
        
        // 增加请求计数
        metrics.increment('http_requests_total', 1, {
            method,
            path: path.split('?')[0], // 移除查询参数
        });
        
        try {
            await next();
            
            const duration = Date.now() - startTime;
            const status = ctx.status;
            
            // 记录响应时间
            metrics.observe('http_request_duration_ms', duration, {
                method,
                path: path.split('?')[0],
                status: String(status),
            });
            
            // 记录状态码
            metrics.increment('http_responses_total', 1, {
                method,
                path: path.split('?')[0],
                status: String(status),
            });
            
            // 记录错误
            if (status >= 400) {
                metrics.increment('http_errors_total', 1, {
                    method,
                    path: path.split('?')[0],
                    status: String(status),
                });
            }
        } catch (error: any) {
            const duration = Date.now() - startTime;
            const status = ctx.status || 500;
            
            // 记录错误响应时间
            metrics.observe('http_request_duration_ms', duration, {
                method,
                path: path.split('?')[0],
                status: String(status),
                error: 'true',
            });
            
            // 记录错误
            metrics.increment('http_errors_total', 1, {
                method,
                path: path.split('?')[0],
                status: String(status),
                error_type: error.name || 'Unknown',
            });
            
            throw error;
        }
    };
}

