import { ProtocolRegistry } from "../registry";
import { MilkyV1 } from "./v1";

// Register Milky protocol
ProtocolRegistry.register("milky", "v1", MilkyV1 as any, {
    displayName: "Milky V1",
    description: "Milky 协议 V1 版本 - QQ 机器人协议",
    versions: ["v1"],
});

export * from "./v1";
export * from "./types";
export * from "./config";
