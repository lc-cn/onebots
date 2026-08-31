import { App } from 'onebots'

// OneBot V11 Protocol Configuration
declare module 'onebots' {
    namespace Protocol {
        interface Configs {
            "onebot.v11": OneBotV11Config.Config;
        }
    }
}

export namespace OneBotV11Config {
    export interface Config {
        use_http?: boolean;
        use_ws?: boolean;
        http_reverse?: string[];
        ws_reverse?: string[];
        enable_cors?: boolean;
        access_token?: string;
        secret?: string;
        post_timeout?: number;
        post_message_format?: "string" | "array";
        serve_data_files?: boolean;
        heartbeat_interval?: number;
    }
}

App.registerGeneral('onebot.v11', {
    use_http: true,
    use_ws: false,
    post_message_format: "array",
});
