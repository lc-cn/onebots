import type { ImHelper } from "../imhelper.js";
import type { EventMap } from "../types.js";
import type { BaseEvent } from "./base.js";
import type { MessageEvent } from "./message/base.js";
import type { ChannelMessageEvent } from "./message/channel.js";
import type { GroupMessageEvent } from "./message/group.js";
import type { PrivateMessageEvent } from "./message/private.js";
import type { MetaEvent } from "./meta/base.js";
import type { NoticeEvent } from "./notice/base.js";
import type { RequestEvent } from "./request/base.js";

type EventName<Id extends string | number> = keyof EventMap<Id>;
type EventValue<Id extends string | number, Name extends EventName<Id>> = EventMap<Id>[Name][0];
type AnyEventValue<Id extends string | number> = EventValue<Id, EventName<Id>>;
type EventResult<Id extends string | number> = {
    type: EventName<Id>;
    event: AnyEventValue<Id>;
};

function subscribeOnce<Id extends string | number, Name extends EventName<Id>>(
    helper: ImHelper<Id>,
    eventName: Name,
    listener: (event: EventValue<Id, Name>) => void,
): () => void {
    helper.once(eventName, listener);
    return () => helper.off(eventName, listener);
}

/** 与标准事件对象相关的纯工具函数和类型守卫。 */
export class EventUtils {
    static formatTimestamp(timestamp: number): string {
        return new Date(timestamp * 1000).toLocaleString("zh-CN", {
            year: "numeric",
            month: "2-digit",
            day: "2-digit",
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
        });
    }

    static getTimeDiff<Id extends string | number>(event: BaseEvent<Id>): number {
        return Math.floor(Date.now() / 1000) - event.timestamp;
    }

    static getTimeDiffString<Id extends string | number>(event: BaseEvent<Id>): string {
        const diff = this.getTimeDiff(event);
        if (diff < 60) return `${diff}秒前`;
        if (diff < 3600) return `${Math.floor(diff / 60)}分钟前`;
        if (diff < 86400) return `${Math.floor(diff / 3600)}小时前`;
        return `${Math.floor(diff / 86400)}天前`;
    }

    static isMessageEvent<Id extends string | number>(
        event: BaseEvent<Id>,
    ): event is MessageEvent<Id> {
        return event.type === "message";
    }

    static isNoticeEvent<Id extends string | number>(
        event: BaseEvent<Id>,
    ): event is NoticeEvent<Id> {
        return event.type === "notice";
    }

    static isRequestEvent<Id extends string | number>(
        event: BaseEvent<Id>,
    ): event is RequestEvent<Id> {
        return event.type === "request";
    }

    static isMetaEvent<Id extends string | number>(event: BaseEvent<Id>): event is MetaEvent<Id> {
        return event.type === "meta";
    }

    static isPrivateMessage<Id extends string | number>(
        event: BaseEvent<Id>,
    ): event is PrivateMessageEvent<Id> {
        return this.isMessageEvent(event) && event.message_type === "private";
    }

    static isGroupMessage<Id extends string | number>(
        event: BaseEvent<Id>,
    ): event is GroupMessageEvent<Id> {
        return this.isMessageEvent(event) && event.message_type === "group";
    }

    static isChannelMessage<Id extends string | number>(
        event: BaseEvent<Id>,
    ): event is ChannelMessageEvent<Id> {
        return this.isMessageEvent(event) && event.message_type === "channel";
    }

    static compareTimestamp<Id extends string | number>(
        first: BaseEvent<Id>,
        second: BaseEvent<Id>,
    ): number {
        return first.timestamp - second.timestamp;
    }

    static isInTimeRange<Id extends string | number>(
        event: BaseEvent<Id>,
        startTime: number,
        endTime: number,
    ): boolean {
        return event.timestamp >= startTime && event.timestamp <= endTime;
    }

    static isFromBot<Id extends string | number>(event: BaseEvent<Id>, botId: Id): boolean {
        return event.bot_id === botId;
    }

    static formatEvent<Id extends string | number>(event: BaseEvent<Id>): string {
        const bot = event.bot_id === undefined ? "" : `[Bot: ${event.bot_id}]`;
        let details = "";
        if (this.isMessageEvent(event)) {
            details = `用户: ${event.user_id}, 消息ID: ${event.message_id}`;
        } else if (this.isNoticeEvent(event)) {
            details = `通知类型: ${event.notice_type}`;
        } else if (this.isRequestEvent(event)) {
            details = `请求类型: ${event.request_type}, 用户: ${event.user_id}`;
        } else if (this.isMetaEvent(event)) {
            details = `元类型: ${event.meta_type}`;
        }
        return `[${this.formatTimestamp(event.timestamp)}] ${event.type} ${bot} ${details}`.trim();
    }

    static extractKeyInfo<Id extends string | number>(
        event: BaseEvent<Id>,
    ): Record<string, unknown> {
        const info: Record<string, unknown> = {
            type: event.type,
            timestamp: event.timestamp,
        };
        if (event.bot_id !== undefined) info.bot_id = event.bot_id;

        if (this.isMessageEvent(event)) {
            Object.assign(info, {
                message_id: event.message_id,
                user_id: event.user_id,
                message_type: event.message_type,
            });
        } else if (this.isNoticeEvent(event)) {
            info.notice_type = event.notice_type;
            if ("user_id" in event) info.user_id = event.user_id;
        } else if (this.isRequestEvent(event)) {
            info.request_type = event.request_type;
            info.user_id = event.user_id;
        } else if (this.isMetaEvent(event)) {
            info.meta_type = event.meta_type;
        }
        return info;
    }
}

/** 为类型化事件提供 Promise 和条件监听语义，并统一清理定时器与监听器。 */
export class EventListenerUtils {
    static once<Id extends string | number, Name extends EventName<Id>>(
        helper: ImHelper<Id>,
        eventName: Name,
        timeout?: number,
    ): Promise<EventValue<Id, Name>> {
        return new Promise((resolve, reject) => {
            let timeoutId: NodeJS.Timeout | undefined;
            const dispose = subscribeOnce(helper, eventName, event => {
                if (timeoutId) clearTimeout(timeoutId);
                resolve(event);
            });

            if (timeout) {
                timeoutId = setTimeout(() => {
                    dispose();
                    reject(new Error(`事件 ${String(eventName)} 在 ${timeout}ms 内未触发`));
                }, timeout);
            }
        });
    }

    static race<Id extends string | number>(
        helper: ImHelper<Id>,
        eventNames: Array<EventName<Id>>,
        timeout?: number,
    ): Promise<EventResult<Id>> {
        if (eventNames.length === 0) {
            return Promise.reject(new TypeError("事件竞争至少需要一个事件名"));
        }
        return new Promise((resolve, reject) => {
            const disposers: Array<() => void> = [];
            let timeoutId: NodeJS.Timeout | undefined;
            const cleanup = (): void => {
                for (const dispose of disposers) dispose();
                if (timeoutId) clearTimeout(timeoutId);
            };

            for (const eventName of eventNames) {
                disposers.push(
                    subscribeOnce(helper, eventName, event => {
                        cleanup();
                        resolve({ type: eventName, event });
                    }),
                );
            }
            if (timeout) {
                timeoutId = setTimeout(() => {
                    cleanup();
                    reject(new Error(`事件竞争在 ${timeout}ms 内没有结果`));
                }, timeout);
            }
        });
    }

    static all<Id extends string | number>(
        helper: ImHelper<Id>,
        eventNames: Array<EventName<Id>>,
        timeout?: number,
    ): Promise<EventResult<Id>[]> {
        if (eventNames.length === 0) return Promise.resolve([]);
        return new Promise((resolve, reject) => {
            const results: EventResult<Id>[] = [];
            const disposers: Array<() => void> = [];
            let timeoutId: NodeJS.Timeout | undefined;
            const cleanup = (): void => {
                for (const dispose of disposers) dispose();
                if (timeoutId) clearTimeout(timeoutId);
            };

            for (const eventName of eventNames) {
                disposers.push(
                    subscribeOnce(helper, eventName, event => {
                        results.push({ type: eventName, event });
                        if (results.length === eventNames.length) {
                            cleanup();
                            resolve(results);
                        }
                    }),
                );
            }
            if (timeout) {
                timeoutId = setTimeout(() => {
                    cleanup();
                    reject(
                        new Error(
                            `等待全部事件超时：已收到 ${results.length}/${eventNames.length}`,
                        ),
                    );
                }, timeout);
            }
        });
    }

    static onCondition<Id extends string | number, Name extends EventName<Id>>(
        helper: ImHelper<Id>,
        eventName: Name,
        condition: (event: EventValue<Id, Name>) => boolean,
        listener: (event: EventValue<Id, Name>) => void,
    ): () => void {
        const guardedListener = (event: EventValue<Id, Name>): void => {
            if (condition(event)) listener(event);
        };
        helper.on(eventName, guardedListener);
        return () => helper.off(eventName, guardedListener);
    }
}
