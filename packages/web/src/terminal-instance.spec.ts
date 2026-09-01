import { describe, expect, it } from "vitest";
import {
    assertTerminalInstanceMatches,
    parseTerminalInstanceIdentity,
    readTerminalTargetIdentity,
} from "./terminal-instance.js";

describe("terminal instance identity", () => {
    it("共同采用系统响应头和正文中的目标实例", async () => {
        await expect(readTerminalTargetIdentity(systemResponse("instance-a"))).resolves.toEqual({
            application: "onebots",
            version: "1.2.8",
            instanceId: "instance-a",
            runtimeContractId: "sha256:contract-a",
        });
    });

    it("拒绝响应头和正文分属不同实例", async () => {
        await expect(
            readTerminalTargetIdentity(systemResponse("instance-a", "instance-b")),
        ).rejects.toThrow("终端目标探测正文与响应实例身份不一致");
    });

    it("解析终端首帧并拒绝残缺身份", () => {
        expect(
            parseTerminalInstanceIdentity({
                type: "identity",
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
        expect(() =>
            parseTerminalInstanceIdentity({
                type: "identity",
                application: "onebots",
                version: "1.2.8",
                instance_id: "instance-a",
            }),
        ).toThrow("终端 WebSocket 缺少完整 OneBots 实例身份");
    });

    it("拒绝 HTTP 页面目标与 WebSocket 实例漂移", () => {
        expect(() =>
            assertTerminalInstanceMatches(
                {
                    application: "onebots",
                    version: "1.2.8",
                    instanceId: "instance-a",
                    runtimeContractId: "sha256:contract-a",
                },
                {
                    application: "onebots",
                    version: "1.2.8",
                    instanceId: "instance-b",
                    runtimeContractId: "sha256:contract-a",
                },
            ),
        ).toThrow("页面期望 instance-a，WebSocket 连接到 instance-b");
    });
});

function systemResponse(headerInstance: string, bodyInstance = headerInstance): Response {
    return new Response(
        JSON.stringify({
            application_name: "onebots",
            application_version: "1.2.8",
            instance_id: bodyInstance,
            runtime_contract_id: "sha256:contract-a",
        }),
        {
            headers: {
                "Content-Type": "application/json",
                "X-OneBots-Application": "onebots",
                "X-OneBots-Version": "1.2.8",
                "X-OneBots-Instance-Id": headerInstance,
                "X-OneBots-Runtime-Contract-Id": "sha256:contract-a",
            },
        },
    );
}
