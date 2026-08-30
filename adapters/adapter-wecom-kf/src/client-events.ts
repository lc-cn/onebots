import type { EventEmitter } from "node:events";
import { emitAllAwaited } from "onebots";
import type { WeComKfClientEvents } from "./client.js";
import type { WeComKfError } from "./errors.js";
import type { KfCallbackEvent, KfMsgItem } from "./types.js";

type KfClientEmitter = EventEmitter<WeComKfClientEvents>;
/** 两个数据视图全部完成后才允许同步器提交消息与游标。 */
export async function deliverKfItem(
    emitter: KfClientEmitter,
    openKfid: string,
    item: KfMsgItem,
): Promise<void> {
    const failures: unknown[] = [];
    try {
        await emitAllAwaited(emitter, "raw_event", item);
    } catch (error) {
        failures.push(error);
    }
    try {
        await emitAllAwaited(emitter, "kf_item", { open_kfid: openKfid, item });
    } catch (error) {
        failures.push(error);
    }
    if (failures.length === 1) throw failures[0];
    if (failures.length > 1) {
        throw new AggregateError(failures, "微信客服消息存在多个投递失败");
    }
}

/** 回调事件也遵循可等待的 typed Client 契约。 */
export function deliverKfCallback(emitter: KfClientEmitter, event: KfCallbackEvent): Promise<void> {
    return emitAllAwaited(emitter, "callback", event);
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
