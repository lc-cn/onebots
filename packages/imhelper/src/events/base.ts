import type { ImHelper } from "../imhelper.js";

/**
 * 基础事件抽象类
 */
export abstract class BaseEvent<Id extends string | number = string | number> {
    abstract readonly type: string;
    readonly timestamp: number;
    readonly bot_id?: Id;
    readonly helper: ImHelper<Id>;

    constructor(helper: ImHelper<Id>, data: BaseEvent.Data<Id>) {
        this.helper = helper;
        this.timestamp = data.timestamp;
        this.bot_id = data.bot_id;
        // 子类只复制自己声明的字段，禁止外部数据覆盖 helper 或在实例上注入任意属性。
    }

    /** 序列化事件自身数据；helper 和 #private 缓存不属于协议事件。 */
    toJSON(): Record<string, unknown> {
        const result = { ...this } as Record<string, unknown>;
        delete result.helper;
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
