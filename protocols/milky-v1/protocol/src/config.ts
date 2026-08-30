import { App } from "onebots";
// Milky Protocol Configuration
// This file only exports configuration types
declare module "onebots" {
    namespace Protocol {
        interface Configs {
            "milky.v1": MilkyConfig.Config;
        }
    }
}
export namespace MilkyConfig {
    /**
     * HTTP reverse (webhook) configuration
     */
    export interface HttpReverseConfig {
        /** Webhook URL */
        url: string;
        /** Access token */
        access_token?: string;
        /** Secret for signature */
        secret?: string;
        /** POST timeout in seconds */
        post_timeout?: number;
    }

    /**
     * WebSocket reverse (client) configuration
     */
    export interface WsReverseConfig {
        /** WebSocket server URL */
        url: string;
        /** Access token */
        access_token?: string;
        /** Reconnect interval in seconds */
        reconnect_interval?: number;
    }

    /**
     * Main Milky protocol configuration
     */
    export interface Config {
        /** 在 OneBots 共享 HTTP Host 上启用 Milky API。 */
        use_http?: boolean;
        /** HTTP reverse (webhook) endpoints */
        http_reverse?: (string | HttpReverseConfig)[];
        /** 在 OneBots 共享 HTTP Host 上启用 Milky 正向 WebSocket。 */
        use_ws?: boolean;
        /** WebSocket reverse connections */
        ws_reverse?: (string | WsReverseConfig)[];
        /** Access token (global) */
        access_token?: string;
        /** Secret (global) */
        secret?: string;
        /** Event filters */
        filters?: Record<string, unknown>;
    }
}
App.registerGeneral("milky.v1", {
    use_http: true,
    use_ws: false,
});
