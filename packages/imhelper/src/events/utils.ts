import type { BaseEvent } from './base.js';
import type { EventMap } from '../types.js';
import type { ImHelper } from '../imhelper.js';

/**
 * 事件工具函数
 */
export class EventUtils {
    /**
     * 格式化时间戳为可读字符串
     */
    static formatTimestamp(timestamp: number): string {
        return new Date(timestamp * 1000).toLocaleString('zh-CN', {
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
        });
    }

    /**
     * 获取事件的时间差（相对于当前时间，单位：秒）
     */
    static getTimeDiff(event: BaseEvent<any>): number {
        return Math.floor(Date.now() / 1000) - event.timestamp;
    }

    /**
     * 获取事件的时间差（格式化字符串）
     */
    static getTimeDiffString(event: BaseEvent<any>): string {
        const diff = this.getTimeDiff(event);
        if (diff < 60) {
            return `${diff}秒前`;
        } else if (diff < 3600) {
            return `${Math.floor(diff / 60)}分钟前`;
        } else if (diff < 86400) {
            return `${Math.floor(diff / 3600)}小时前`;
        } else {
            return `${Math.floor(diff / 86400)}天前`;
        }
    }

    /**
     * 检查事件是否为消息事件
     */
    static isMessageEvent<Id extends string | number>(
        event: BaseEvent<Id>
    ): event is import('./message/base.js').MessageEvent<Id> {
        return event.type === 'message';
    }

    /**
     * 检查事件是否为通知事件
     */
    static isNoticeEvent<Id extends string | number>(
        event: BaseEvent<Id>
    ): event is import('./notice/base.js').NoticeEvent<Id> {
        return event.type === 'notice';
    }

    /**
     * 检查事件是否为请求事件
     */
    static isRequestEvent<Id extends string | number>(
        event: BaseEvent<Id>
    ): event is import('./request/base.js').RequestEvent<Id> {
        return event.type === 'request';
    }

    /**
     * 检查事件是否为元事件
     */
    static isMetaEvent<Id extends string | number>(
        event: BaseEvent<Id>
    ): event is import('./meta/base.js').MetaEvent<Id> {
        return event.type === 'meta';
    }

    /**
     * 检查事件是否为私聊消息
     */
    static isPrivateMessage<Id extends string | number>(
        event: BaseEvent<Id>
    ): event is import('./message/private.js').PrivateMessageEvent<Id> {
        return event.type === 'message' && (event as any).message_type === 'private';
    }

    /**
     * 检查事件是否为群聊消息
     */
    static isGroupMessage<Id extends string | number>(
        event: BaseEvent<Id>
    ): event is import('./message/group.js').GroupMessageEvent<Id> {
        return event.type === 'message' && (event as any).message_type === 'group';
    }

    /**
     * 检查事件是否为频道消息
     */
    static isChannelMessage<Id extends string | number>(
        event: BaseEvent<Id>
    ): event is import('./message/channel.js').ChannelMessageEvent<Id> {
        return event.type === 'message' && (event as any).message_type === 'channel';
    }

    /**
     * 比较两个事件的时间戳
     * @returns 负数表示 event1 更早，正数表示 event1 更晚，0 表示相同
     */
    static compareTimestamp<Id extends string | number>(
        event1: BaseEvent<Id>,
        event2: BaseEvent<Id>
    ): number {
        return event1.timestamp - event2.timestamp;
    }

    /**
     * 检查事件是否在指定时间范围内
     */
    static isInTimeRange<Id extends string | number>(
        event: BaseEvent<Id>,
        startTime: number,
        endTime: number
    ): boolean {
        return event.timestamp >= startTime && event.timestamp <= endTime;
    }

    /**
     * 检查事件是否来自指定的 bot
     */
    static isFromBot<Id extends string | number>(
        event: BaseEvent<Id>,
        botId: Id
    ): boolean {
        return event.bot_id === botId;
    }

    /**
     * 将事件格式化为可读字符串
     */
    static formatEvent<Id extends string | number>(event: BaseEvent<Id>): string {
        const time = this.formatTimestamp(event.timestamp);
        const type = event.type;
        const botId = event.bot_id ? `[Bot: ${event.bot_id}]` : '';
        
        let details = '';
        if (this.isMessageEvent(event)) {
            details = `用户: ${event.user_id}, 消息ID: ${event.message_id}`;
        } else if (this.isNoticeEvent(event)) {
            details = `通知类型: ${(event as any).notice_type}`;
        } else if (this.isRequestEvent(event)) {
            details = `请求类型: ${(event as any).request_type}, 用户: ${event.user_id}`;
        } else if (this.isMetaEvent(event)) {
            details = `元类型: ${(event as any).meta_type}`;
        }

        return `[${time}] ${type} ${botId} ${details}`.trim();
    }

    /**
     * 从事件中提取关键信息
     */
    static extractKeyInfo<Id extends string | number>(
        event: BaseEvent<Id>
    ): Record<string, unknown> {
        const info: Record<string, unknown> = {
            type: event.type,
            timestamp: event.timestamp,
        };

        if (event.bot_id) {
            info.bot_id = event.bot_id;
        }

        if (this.isMessageEvent(event)) {
            info.message_id = event.message_id;
            info.user_id = event.user_id;
            info.message_type = (event as any).message_type;
        } else if (this.isNoticeEvent(event)) {
            info.notice_type = (event as any).notice_type;
            if ((event as any).user_id) {
                info.user_id = (event as any).user_id;
            }
        } else if (this.isRequestEvent(event)) {
            info.request_type = (event as any).request_type;
            info.user_id = event.user_id;
        } else if (this.isMetaEvent(event)) {
            info.meta_type = (event as any).meta_type;
        }

        return info;
    }
}

/**
 * 事件监听器辅助函数
 */
export class EventListenerUtils {
    /**
     * 创建一次性事件监听器
     * @param helper ImHelper 实例
     * @param eventType 事件类型
     * @param timeout 超时时间（毫秒），可选
     * @returns Promise，解析为事件对象
     */
    static once<Id extends string | number, T extends keyof EventMap<Id>>(
        helper: ImHelper<Id>,
        eventType: T,
        timeout?: number
    ): Promise<EventMap<Id>[T][0]> {
        return new Promise((resolve, reject) => {
            let timeoutId: NodeJS.Timeout | undefined;

            const handler = (...args: EventMap<Id>[T]) => {
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
                resolve(args[0]);
            };

            helper.once(eventType, handler as any);

            if (timeout) {
                timeoutId = setTimeout(() => {
                    helper.off(eventType, handler as any);
                    reject(new Error(`Event ${String(eventType)} timeout after ${timeout}ms`));
                }, timeout);
            }
        });
    }

    /**
     * 等待多个事件中的任意一个
     * @param helper ImHelper 实例
     * @param eventTypes 事件类型数组
     * @param timeout 超时时间（毫秒），可选
     * @returns Promise，解析为 { type: 事件类型, event: 事件对象 }
     */
    static race<Id extends string | number>(
        helper: ImHelper<Id>,
        eventTypes: Array<keyof EventMap<Id>>,
        timeout?: number
    ): Promise<{ type: keyof EventMap<Id>; event: EventMap<Id>[keyof EventMap<Id>][0] }> {
        return new Promise((resolve, reject) => {
            const handlers: Array<{ type: keyof EventMap<Id>; handler: (...args: any[]) => void }> = [];
            let timeoutId: NodeJS.Timeout | undefined;

            const cleanup = () => {
                handlers.forEach(({ type, handler }) => {
                    helper.off(type, handler);
                });
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
            };

            eventTypes.forEach(eventType => {
                const handler = (event: any) => {
                    cleanup();
                    resolve({ type: eventType, event });
                };
                handlers.push({ type: eventType, handler });
                helper.once(eventType, handler);
            });

            if (timeout) {
                timeoutId = setTimeout(() => {
                    cleanup();
                    reject(new Error(`Event race timeout after ${timeout}ms`));
                }, timeout);
            }
        });
    }

    /**
     * 等待所有指定事件都触发
     * @param helper ImHelper 实例
     * @param eventTypes 事件类型数组
     * @param timeout 超时时间（毫秒），可选
     * @returns Promise，解析为事件对象数组
     */
    static all<Id extends string | number>(
        helper: ImHelper<Id>,
        eventTypes: Array<keyof EventMap<Id>>,
        timeout?: number
    ): Promise<Array<{ type: keyof EventMap<Id>; event: EventMap<Id>[keyof EventMap<Id>][0] }>> {
        return new Promise((resolve, reject) => {
            const results: Array<{ type: keyof EventMap<Id>; event: EventMap<Id>[keyof EventMap<Id>][0] }> = [];
            const handlers: Array<{ type: keyof EventMap<Id>; handler: (...args: any[]) => void }> = [];
            let timeoutId: NodeJS.Timeout | undefined;

            const cleanup = () => {
                handlers.forEach(({ type, handler }) => {
                    helper.off(type, handler);
                });
                if (timeoutId) {
                    clearTimeout(timeoutId);
                }
            };

            const checkComplete = () => {
                if (results.length === eventTypes.length) {
                    cleanup();
                    resolve(results);
                }
            };

            eventTypes.forEach(eventType => {
                const handler = (event: any) => {
                    results.push({ type: eventType, event });
                    checkComplete();
                };
                handlers.push({ type: eventType, handler });
                helper.once(eventType, handler);
            });

            if (timeout) {
                timeoutId = setTimeout(() => {
                    cleanup();
                    reject(new Error(`Event all timeout after ${timeout}ms, received ${results.length}/${eventTypes.length} events`));
                }, timeout);
            }
        });
    }

    /**
     * 创建带条件的事件监听器
     * @param helper ImHelper 实例
     * @param eventType 事件类型
     * @param condition 条件函数
     * @param handler 处理函数
     * @returns 取消监听的函数
     */
    static onCondition<Id extends string | number, T extends keyof EventMap<Id>>(
        helper: ImHelper<Id>,
        eventType: T,
        condition: (event: EventMap<Id>[T][0]) => boolean,
        handler: (event: EventMap<Id>[T][0]) => void
    ): () => void {
        const wrappedHandler = (...args: EventMap<Id>[T]) => {
            const event = args[0];
            if (condition(event)) {
                handler(event);
            }
        };

        helper.on(eventType, wrappedHandler as any);

        // 返回取消监听的函数
        return () => {
            helper.off(eventType, wrappedHandler as any);
        };
    }
}

