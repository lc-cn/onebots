import type { EventEmitter } from "node:events";
import type { WeComKfClientEvents } from "./client.js";
import { WeComKfError } from "./errors.js";

type KfClientEmitter = EventEmitter<WeComKfClientEvents>;
type KfDataEventName = "raw_event" | "kf_item";

/** 逐个调用数据监听器，避免单个业务异常阻断同批消息与游标提交。 */
export function emitKfDataEvent<K extends KfDataEventName>(
    emitter: KfClientEmitter,
    eventName: K,
    ...args: WeComKfClientEvents[K]
): void {
    for (const listener of emitter.rawListeners(eventName)) {
        try {
            Reflect.apply(listener, emitter, args);
        } catch (error) {
            reportKfClientError(emitter, WeComKfError.wrap(error, "WECOM_KF_EVENT_LISTENER_ERROR"));
        }
    }
}

/** 错误观察器同样隔离，保证诊断回调不能破坏客户端状态机。 */
export function reportKfClientError(emitter: KfClientEmitter, error: WeComKfError): void {
    for (const listener of emitter.rawListeners("client_error")) {
        try {
            Reflect.apply(listener, emitter, [error]);
        } catch {
            // 错误观察器不得反向破坏同步状态机。
        }
    }
}
