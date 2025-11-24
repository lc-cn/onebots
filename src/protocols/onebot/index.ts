import { ProtocolRegistry } from "../registry.js";
import { App } from "@/server/app.js";
import { OneBotV11Protocol } from "./v11.js";
import { OneBotV12Protocol } from "./v12.js";

// Register OneBot protocols
ProtocolRegistry.register("onebot", "v11", OneBotV11Protocol, {
    displayName: "OneBot V11",
    description: "OneBot 协议 V11 版本，基于 OneBot 11 标准",
    versions: ["v11"],
});

ProtocolRegistry.register("onebot", "v12", OneBotV12Protocol, {
    displayName: "OneBot V12",
    description: "OneBot 协议 V12 版本，基于 OneBot 12 标准",
    versions: ["v12"],
});
App.registerGeneral('onebot.v11', {
    access_token: '',
    use_ws: false,
    use_http: true,
});
App.registerGeneral('onebot.v12', {
    access_token: '',
    use_ws: false,
    use_http: true,
});
declare module '../base.js'{
    namespace Protocol {
        interface ConfigMaps {
            onebot: {
                v11: OneBotV11Protocol.Config;
                v12: OneBotV12Protocol.Config;
            };
        }
    }
}

export * from "./v11.js";
export * from "./v12.js";
export * from "./utils.js";
export * from "./types.js";
export * from "./types-v12.js";
export * from "./cqcode.js";
