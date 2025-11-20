import { Milky } from "./types";

export namespace MilkyConfig {
    /**
     * HTTP configuration
     */
    export interface HttpConfig {
        /** Enable HTTP server */
        enabled?: boolean;
        /** Server host */
        host?: string;
        /** Server port */
        port?: number;
        /** Access token for authentication */
        access_token?: string;
        /** Secret for signature verification */
        secret?: string;
        /** POST timeout in seconds */
        post_timeout?: number;
    }

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
     * WebSocket configuration
     */
    export interface WsConfig {
        /** Enable WebSocket server */
        enabled?: boolean;
        /** Server host */
        host?: string;
        /** Server port */
        port?: number;
        /** Access token */
        access_token?: string;
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
        /** Enable HTTP server */
        use_http?: boolean | HttpConfig;
        /** HTTP reverse (webhook) endpoints */
        http_reverse?: (string | HttpReverseConfig)[];
        /** Enable WebSocket server */
        use_ws?: boolean | WsConfig;
        /** WebSocket reverse connections */
        ws_reverse?: (string | WsReverseConfig)[];
        /** Access token (global) */
        access_token?: string;
        /** Secret (global) */
        secret?: string;
        /** Heartbeat interval in seconds */
        heartbeat?: number;
        /** POST message format */
        post_message_format?: "string" | "array";
        /** Event filters */
        filters?: any;
    }
}
