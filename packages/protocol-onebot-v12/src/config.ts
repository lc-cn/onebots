import { App } from 'onebots'

// OneBot V12 Protocol Configuration
declare module 'onebots' {
    namespace Protocol {
        interface Configs {
            "onebot.v12": OneBotV12Config.Config;
        }
    }
}

export namespace OneBotV12Config {
    export interface Config {
        use_http?: boolean;
        use_ws?: boolean;
        http_webhook?: string[];
        ws_reverse?: string[];
        request_timeout?: number;
        access_token?: string;
        heartbeat_interval?: number;
        enable_cors?: boolean;
    }
}

App.registerGeneral('onebot.v12', {
    use_http: true,
    use_ws: false,
});
