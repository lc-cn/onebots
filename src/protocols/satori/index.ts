import { ProtocolRegistry } from "../registry";
import { SatoriProtocol } from "./v1";

// Register Satori protocol
ProtocolRegistry.register("satori", "v1", SatoriProtocol, {
    displayName: "Satori V1",
    description: "Satori 协议 V1 版本 - 跨平台聊天机器人协议",
    versions: ["v1"],
});

export * from "./v1";
