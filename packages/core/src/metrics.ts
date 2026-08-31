/**
 * 性能指标收集系统
 * 收集请求数、响应时间、错误率等指标
 */

import { createLogger } from './logger.js';

const logger = createLogger('Metrics');

export interface MetricValue {
    value: number;
    timestamp: number;
    labels?: Record<string, string>;
}

export interface Metric {
    name: string;
    type: 'counter' | 'gauge' | 'histogram';
    help: string;
    values: MetricValue[];
    labels?: Record<string, string>;
}

/**
 * 指标收集器
 */
export class MetricsCollector {
    private metrics: Map<string, Metric> = new Map();
    private readonly maxSamples = 1000; // 每个指标最多保留的样本数

    /**
     * 增加计数器
     */
    increment(name: string, value: number = 1, labels?: Record<string, string>): void {
        const metric = this.getOrCreateMetric(name, 'counter', labels);
        const lastValue = metric.values[metric.values.length - 1];
        const newValue = (lastValue?.value || 0) + value;
        
        metric.values.push({
            value: newValue,
            timestamp: Date.now(),
            labels,
        });
        
        this.trimSamples(metric);
    }

    /**
     * 设置仪表值
     */
    set(name: string, value: number, labels?: Record<string, string>): void {
        const metric = this.getOrCreateMetric(name, 'gauge', labels);
        metric.values.push({
            value,
            timestamp: Date.now(),
            labels,
        });
        
        this.trimSamples(metric);
    }

    /**
     * 记录直方图值
     */
    observe(name: string, value: number, labels?: Record<string, string>): void {
        const metric = this.getOrCreateMetric(name, 'histogram', labels);
        metric.values.push({
            value,
            timestamp: Date.now(),
            labels,
        });
        
        this.trimSamples(metric);
    }

    /**
     * 获取或创建指标
     */
    private getOrCreateMetric(
        name: string,
        type: 'counter' | 'gauge' | 'histogram',
        labels?: Record<string, string>
    ): Metric {
        const key = this.getMetricKey(name, labels);
        
        if (!this.metrics.has(key)) {
            this.metrics.set(key, {
                name,
                type,
                help: `${name} metric`,
                values: [],
                labels,
            });
        }
        
        return this.metrics.get(key)!;
    }

    /**
     * 获取指标键
     */
    private getMetricKey(name: string, labels?: Record<string, string>): string {
        if (!labels || Object.keys(labels).length === 0) {
            return name;
        }
        
        const labelStr = Object.entries(labels)
            .sort(([a], [b]) => a.localeCompare(b))
            .map(([k, v]) => `${k}="${v}"`)
            .join(',');
        
        return `${name}{${labelStr}}`;
    }

    /**
     * 修剪样本数量
     */
    private trimSamples(metric: Metric): void {
        if (metric.values.length > this.maxSamples) {
            metric.values = metric.values.slice(-this.maxSamples);
        }
    }

    /**
     * 获取指标
     */
    getMetric(name: string, labels?: Record<string, string>): Metric | undefined {
        const key = this.getMetricKey(name, labels);
        return this.metrics.get(key);
    }

    /**
     * 获取所有指标
     */
    getAllMetrics(): Metric[] {
        return Array.from(this.metrics.values());
    }

    /**
     * 获取最新值
     */
    getLatestValue(name: string, labels?: Record<string, string>): number | undefined {
        const metric = this.getMetric(name, labels);
        if (!metric || metric.values.length === 0) {
            return undefined;
        }
        
        return metric.values[metric.values.length - 1].value;
    }

    /**
     * 计算平均值
     */
    getAverage(name: string, labels?: Record<string, string>, windowMs?: number): number | undefined {
        const metric = this.getMetric(name, labels);
        if (!metric || metric.values.length === 0) {
            return undefined;
        }
        
        const now = Date.now();
        const cutoff = windowMs ? now - windowMs : 0;
        const relevantValues = metric.values.filter(v => v.timestamp >= cutoff);
        
        if (relevantValues.length === 0) {
            return undefined;
        }
        
        const sum = relevantValues.reduce((acc, v) => acc + v.value, 0);
        return sum / relevantValues.length;
    }

    /**
     * 计算总和
     */
    getSum(name: string, labels?: Record<string, string>, windowMs?: number): number | undefined {
        const metric = this.getMetric(name, labels);
        if (!metric || metric.values.length === 0) {
            return undefined;
        }
        
        const now = Date.now();
        const cutoff = windowMs ? now - windowMs : 0;
        const relevantValues = metric.values.filter(v => v.timestamp >= cutoff);
        
        if (relevantValues.length === 0) {
            return undefined;
        }
        
        return relevantValues.reduce((acc, v) => acc + v.value, 0);
    }

    /**
     * 导出为 Prometheus 格式
     */
    exportPrometheus(): string {
        const lines: string[] = [];
        const processed = new Set<string>();
        
        for (const metric of this.metrics.values()) {
            const baseKey = metric.name;
            if (processed.has(baseKey)) {
                continue;
            }
            processed.add(baseKey);
            
            // 添加 HELP 和 TYPE
            lines.push(`# HELP ${baseKey} ${metric.help}`);
            lines.push(`# TYPE ${baseKey} ${metric.type}`);
            
            // 添加所有相同名称的指标值
            for (const m of this.metrics.values()) {
                if (m.name === baseKey) {
                    const labelStr = m.labels && Object.keys(m.labels).length > 0
                        ? `{${Object.entries(m.labels).map(([k, v]) => `${k}="${v}"`).join(',')}}`
                        : '';
                    
                    const latestValue = m.values[m.values.length - 1];
                    if (latestValue) {
                        lines.push(`${baseKey}${labelStr} ${latestValue.value}`);
                    }
                }
            }
        }
        
        return lines.join('\n') + '\n';
    }

    /**
     * 清理过期数据
     */
    cleanup(maxAge: number = 3600000): void { // 默认 1 小时
        const now = Date.now();
        const cutoff = now - maxAge;
        
        for (const metric of this.metrics.values()) {
            metric.values = metric.values.filter(v => v.timestamp >= cutoff);
            
            // 如果指标没有值了，删除它
            if (metric.values.length === 0) {
                this.metrics.delete(this.getMetricKey(metric.name, metric.labels));
            }
        }
    }

    /**
     * 重置所有指标
     */
    reset(): void {
        this.metrics.clear();
        logger.info('All metrics reset');
    }
}

// 全局指标收集器实例
export const metrics = new MetricsCollector();

// 定期清理过期数据（每 10 分钟）
setInterval(() => {
    metrics.cleanup();
}, 10 * 60 * 1000);

