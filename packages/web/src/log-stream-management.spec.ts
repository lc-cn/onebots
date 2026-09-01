import { describe, expect, it } from "vitest";
import { parseLogStreamIdentity, parseLogStreamMessage } from "./log-stream-management.js";

describe("log stream management", () => {
    it("解析连接身份与日志消息", () => {
        expect(
            parseLogStreamIdentity({
                event: "identity",
                application: "onebots",
                version: "1.2.8",
                instance_id: "instance-a",
                runtime_contract_id: "sha256:contract-a",
            }),
        ).toEqual({
            application: "onebots",
            version: "1.2.8",
            instanceId: "instance-a",
            runtimeContractId: "sha256:contract-a",
        });
        expect(parseLogStreamMessage({ message: "[INFO] ready\r\n" })).toBe("[INFO] ready\r\n");
    });

    it("拒绝身份声明前无法归属的畸形事件", () => {
        expect(() => parseLogStreamIdentity({ event: "identity", application: "onebots" })).toThrow(
            "日志事件流缺少完整 OneBots 实例身份",
        );
        expect(() => parseLogStreamMessage({ data: "wrong field" })).toThrow(
            "日志事件流包含无效消息",
        );
    });
});
