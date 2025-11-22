import { App } from "@/server/app";

export namespace SatoriConfig {
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
        token?: string;
        /** Path prefix */
        path?: string;
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
        token?: string;
        /** Path */
        path?: string;
    }

    /**
     * Webhook configuration
     */
    export interface WebhookConfig {
        /** Webhook URL */
        url: string;
        /** Access token */
        token?: string;
    }

    /**
     * Main Satori protocol configuration
     */
    export interface Config {
        /** Enable HTTP server */
        use_http?: boolean | HttpConfig;
        /** Enable WebSocket server */
        use_ws?: boolean | WsConfig;
        /** Webhook endpoints */
        webhooks?: (string | WebhookConfig)[];
        /** Access token (global) */
        token?: string;
        /** Self ID */
        self_id?: string;
        /** Platform name */
        platform?: string;
        /** Event filters */
        filters?: any;
    }
    App.registerGeneral('satori.v1', {
        use_http: false,
        use_ws: true,
        webhooks: [],
        platform: 'satori',
    });
}
declare module '../base'{
    namespace Protocol {
        interface ConfigMaps {
            satori: {
                v1: SatoriConfig.Config;
            };
        }
    }
}
