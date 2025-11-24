import { ProtocolRegistry } from "../registry.js";
import { SatoriV1 } from "./v1.js";

// Register Satori protocol
ProtocolRegistry.register("satori", "v1", SatoriV1, {
    displayName: "Satori V1",
    description: "Satori 协议 V1 版本 - 跨平台聊天机器人协议",
    versions: ["v1"],
});

export * from "./v1.js";
export * from "./types.js";
export * from "./config.js";