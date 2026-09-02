import type { Account } from "onebots";
import type { TwitchConfig } from "./types.js";

/** 将宿主账号配置收敛为独立 Client 可消费的 Twitch 配置。 */
export function normalizeTwitchConfig(config: Account.Config<"twitch">): TwitchConfig {
    return {
        account_id: config.account_id,
        client_id: config.client_id,
        access_token: config.access_token,
        broadcaster_user_id: config.broadcaster_user_id,
        bot_user_id: config.bot_user_id,
        moderator_user_id: config.moderator_user_id,
        receive_mode: config.receive_mode || "websocket",
        subscriptions: config.subscriptions?.map(subscription => ({ ...subscription })),
        auto_subscribe: config.auto_subscribe !== false,
        webhook_callback_url: config.webhook_callback_url,
        webhook_secret: config.webhook_secret,
        http_path:
            config.http_path || inferCallbackPath(config.webhook_callback_url, config.account_id),
        api_base_url: config.api_base_url,
        eventsub_websocket_url: config.eventsub_websocket_url,
        keepalive_timeout_seconds: config.keepalive_timeout_seconds,
        reconnect_initial_delay_ms: config.reconnect_initial_delay_ms,
        reconnect_max_delay_ms: config.reconnect_max_delay_ms,
        connect_timeout_ms: config.connect_timeout_ms,
        max_response_bytes: config.max_response_bytes,
        webhook_tolerance_seconds: config.webhook_tolerance_seconds,
    };
}

function inferCallbackPath(callbackUrl: string | undefined, accountId: string): string {
    if (callbackUrl) {
        try {
            return new URL(callbackUrl).pathname;
        } catch {
            // Client 的配置边界会给出准确 URL 错误；这里不掩盖原始配置。
        }
    }
    return `/twitch/${encodeURIComponent(accountId)}/eventsub`;
}
