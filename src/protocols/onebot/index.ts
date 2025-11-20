import { ProtocolRegistry } from "../registry";
import { OneBotV11Protocol } from "./v11";
import { OneBotV12Protocol } from "./v12";

// Register OneBot protocols
ProtocolRegistry.register("onebot", "v11", OneBotV11Protocol, {
    displayName: "OneBot V11",
    description: "OneBot 协议 V11 版本",
    versions: ["v11"],
});

ProtocolRegistry.register("onebot", "v12", OneBotV12Protocol, {
    displayName: "OneBot V12",
    description: "OneBot 协议 V12 版本",
    versions: ["v12"],
});

export * from "./v11";
export * from "./v12";
export * from "./utils";
export * from "./filters";
