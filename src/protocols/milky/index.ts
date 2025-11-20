import { ProtocolRegistry } from "../registry";
import { MilkyV1 } from "./v1";
import {MilkyConfig} from "./config";

// Register Milky protocol
ProtocolRegistry.register("milky", "v1", MilkyV1, {
    displayName: "Milky V1",
    description: "Milky 协议 V1 版本 - QQ 机器人协议",
    versions: ["v1"],
});
declare module '../base'{
    namespace Protocol {
        interface ConfigMaps {
            milky: {
                v1: MilkyConfig.Config;
            };
        }
    }
}
export * from "./v1";
export * from "./types";
export * from "./config";
