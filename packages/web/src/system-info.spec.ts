import { describe, expect, it } from "vitest";
import { parseSystemInfoSnapshot } from "./system-info.js";

const headers = {
    "X-OneBots-Application": "onebots",
    "X-OneBots-Version": "1.2.8",
    "X-OneBots-Instance-Id": "instance-a",
    "X-OneBots-Runtime-Contract-Id": "sha256:contract-a",
};

function systemInfo(overrides: Record<string, unknown> = {}) {
    return {
        application_name: "onebots",
        application_version: "1.2.8",
        instance_id: "instance-a",
        runtime_contract_id: "sha256:contract-a",
        configState: {
            status: "in_sync",
            appliedAt: "2026-09-02T00:00:00.000Z",
            message: "已同步",
        },
        plugins: [],
        ...overrides,
    };
}

describe("system info snapshot", () => {
    it("接受响应头与正文身份一致的系统快照", () => {
        expect(
            parseSystemInfoSnapshot(new Response(null, { headers }), systemInfo()),
        ).toMatchObject({
            identity: {
                application: "onebots",
                version: "1.2.8",
                instanceId: "instance-a",
                runtimeContractId: "sha256:contract-a",
            },
        });
    });

    it("拒绝正文身份漂移、畸形配置状态和重复插件", () => {
        expect(() =>
            parseSystemInfoSnapshot(
                new Response(null, { headers }),
                systemInfo({ instance_id: "instance-b" }),
            ),
        ).toThrow("身份不一致");
        expect(() =>
            parseSystemInfoSnapshot(
                new Response(null, { headers }),
                systemInfo({ configState: { status: "invented" } }),
            ),
        ).toThrow("配置状态");
        const plugin = {
            type: "adapter",
            name: "mock",
            packageName: "@onebots/adapter-mock",
            version: "1.0.0",
            entryPath: "/runtime/mock.js",
        };
        expect(() =>
            parseSystemInfoSnapshot(
                new Response(null, { headers }),
                systemInfo({ plugins: [plugin, plugin] }),
            ),
        ).toThrow("重复运行时插件");
    });
});
