export * from "./adapter.js";
export * from "./adapter-error.js";
export * from "./imhelper.js";
export * from "./message.js";
export * from "./instances/user.js";
export * from "./instances/group.js";
export * from "./instances/channel.js";
export * from "./instances/friend.js";
export * from "./instances/groupMember.js";
export * from "./instances/channelMember.js";
export * from "./receiver.js";
export * from "./receive-transport.js";
export * from "./ingress.js";
export * from "./protocol-error.js";
export * from "./types.js";
export * from "./receivers/ws.js";
export * from "./receivers/wss.js";
export * from "./receivers/webhook.js";
export * from "./receivers/sse.js";
export * from "./events/index.js";

import { Adapter } from "./adapter.js";
import { ImHelper, type ImHelperOptions } from "./imhelper.js";
import type { EventMap } from "./types.js";

/**
 * 创建统一的消息助手
 */
type ConcreteAdapter<TAdapter extends Adapter.Type> = TAdapter &
    Adapter<Adapter.IdOf<TAdapter>, Adapter.RawEventOf<TAdapter>>;

export function createImHelper<TAdapter extends Adapter.Type>(
    adapter: TAdapter,
    options?: ImHelperOptions,
): ImHelper<
    Adapter.IdOf<TAdapter>,
    Adapter.RawEventOf<TAdapter>,
    EventMap<Adapter.IdOf<TAdapter>>,
    ConcreteAdapter<TAdapter>
>;
export function createImHelper<Id extends string | number>(
    adapter: Adapter<Id>,
    options?: ImHelperOptions,
): ImHelper<Id>;
export function createImHelper(adapter: Adapter.Type, options?: ImHelperOptions): ImHelper {
    return new ImHelper(adapter as unknown as Adapter, options);
}
