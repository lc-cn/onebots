import { ProtocolRegistry } from "../registry.js";
import { MilkyV1 } from "./v1.js";
import {MilkyConfig} from "./config.js";

// Register Milky protocol
ProtocolRegistry.register("milky", "v1", MilkyV1, {
    displayName: "Milky V1",
    description: "Milky 协议 V1 版本 - QQ 机器人协议",
    versions: ["v1"],
});
declare module '../base.js'{
    namespace Protocol {
        interface ConfigMaps {
            milky: {
                v1: MilkyConfig.Config;
            };
        }
    }
}
export * from "./v1.js";
export * from "./types.js";
export * from "./config.js";