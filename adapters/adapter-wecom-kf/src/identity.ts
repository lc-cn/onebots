import type { KfMsgItem } from "./types.js";

/** 事件条目优先于同步回调决定客服账号身份；系统事件的 ID 位于 event 内层。 */
export function resolveKfOpenKfId(item: KfMsgItem, fallback = ""): string {
    const eventOpenKfId = item.event?.open_kfid;
    return item.open_kfid || (typeof eventOpenKfId === "string" ? eventOpenKfId : "") || fallback;
}
