import type { WebhookEvent } from "./types.js";

/** LineBot 对外事件表，保留官方 Webhook 事件判别联合。 */
export interface LineBotEvents {
    event: [event: WebhookEvent];
}
