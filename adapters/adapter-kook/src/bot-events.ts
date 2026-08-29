import type { KookEvent, KookSignal } from "./types.js";

/** KookBot 对外事件表，供 SDK 用户获得完整监听器推断。 */
export interface KookBotEvents {
    ready: [];
    stopped: [];
    close: [];
    debug: [message: string];
    error: [error: unknown];
    reconnecting: [state: { attempt: number; delay: number }];
    event: [event: KookEvent, signal: KookSignal];
}
