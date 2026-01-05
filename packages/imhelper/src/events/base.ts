import type { ImHelper } from '../imhelper.js';

/**
 * 基础事件抽象类
 */
export abstract class BaseEvent<
    Id extends string | number = string | number,
> {
    abstract readonly type: string;
    readonly timestamp: number;
    readonly bot_id?: Id;
    readonly helper: ImHelper<Id>;

    constructor(
        helper: ImHelper<Id>,
        data: BaseEvent.Data<Id>
    ) {
        this.helper = helper;
        this.timestamp = data.timestamp;
        this.bot_id = data.bot_id;
        // 复制其他属性
        Object.assign(this, data);
    }

    /**
     * 序列化为 JSON，排除 helper 引用
     * 优化：直接访问已知属性，避免遍历所有属性
     */
    toJSON(): Record<string, unknown> {
        const result: Record<string, unknown> = {
            type: this.type,
            timestamp: this.timestamp,
        };
        
        if (this.bot_id !== undefined) {
            result.bot_id = this.bot_id;
        }

        // 获取对象的所有自有属性（包括不可枚举的）
        const keys = Object.getOwnPropertyNames(this);
        for (const key of keys) {
            // 跳过 helper、私有字段（#开头）和特殊属性
            if (key === 'helper' || key.startsWith('#') || key === 'constructor') {
                continue;
            }

            try {
                const descriptor = Object.getOwnPropertyDescriptor(this, key);
                if (descriptor && 'value' in descriptor) {
                    const value = descriptor.value;
                    // 跳过函数、helper 引用和 undefined
                    if (typeof value !== 'function' && value !== this.helper && value !== undefined) {
                        // 处理可序列化的值
                        if (value === null || 
                            typeof value === 'string' || 
                            typeof value === 'number' || 
                            typeof value === 'boolean' ||
                            Array.isArray(value) ||
                            (typeof value === 'object' && value.constructor === Object)) {
                            result[key] = value;
                        }
                    }
                } else if (descriptor && 'get' in descriptor) {
                    // 处理 getter，但跳过可能返回复杂对象的 getter
                    try {
                        const value = (this as any)[key];
                        if (value !== undefined && value !== this.helper) {
                            // 只序列化基本类型和简单对象
                            if (value === null || 
                                typeof value === 'string' || 
                                typeof value === 'number' || 
                                typeof value === 'boolean') {
                                result[key] = value;
                            }
                        }
                    } catch {
                        // 忽略 getter 错误
                    }
                }
            } catch {
                // 忽略属性访问错误
            }
        }

        return result;
    }
}

export namespace BaseEvent {
    export interface Data<Id extends string | number = string | number> {
        timestamp: number;
        bot_id?: Id;
        [key: string]: unknown;
    }
}
