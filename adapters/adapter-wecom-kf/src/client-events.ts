import type { EventEmitter } from "node:events";
import type { WeComKfClientEvents } from "./client.js";
import type { WeComKfError } from "./errors.js";

type KfClientEmitter = EventEmitter<WeComKfClientEvents>;
type KfDataEventName = "raw_event" | "kf_item";

/** canonical 数据监听器异常必须向同步器传播，以阻止消息与游标确认。 */
export function emitKfDataEvent<K extends KfDataEventName>(
    emitter: KfClientEmitter,
    eventName: K,
    ...args: WeComKfClientEvents[K]
): void {
    for (const listener of emitter.rawListeners(eventName)) Reflect.apply(listener, emitter, args);
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
