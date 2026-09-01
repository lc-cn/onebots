import { describe, expect, it } from "vitest";
import {
    assertConfigurationMutationAcknowledgement,
    parseConfigurationSnapshot,
} from "./configuration-snapshot.js";

const response = (instanceId: string) =>
    new Response(null, {
        headers: {
            "X-OneBots-Application": "onebots",
            "X-OneBots-Version": "1.2.8",
            "X-OneBots-Instance-Id": instanceId,
            "X-OneBots-Runtime-Contract-Id": "sha256:contract",
            "X-OneBots-Config-Revision": `sha256:${"a".repeat(64)}`,
        },
    });

describe("configuration snapshot", () => {
    it("只原子采用同一实例的配置正文与 Schema", () => {
        expect(
            parseConfigurationSnapshot(
                response("instance-a"),
                response("instance-a"),
                "port: 6727\n",
                {
                    base: {},
                },
            ),
        ).toMatchObject({
            identity: { application: "onebots", instanceId: "instance-a" },
            configRevision: `sha256:${"a".repeat(64)}`,
            content: "port: 6727\n",
            schema: { base: {} },
        });
    });

    it("拒绝跨实例配置快照和缺失身份", () => {
        expect(() =>
            parseConfigurationSnapshot(
                response("instance-a"),
                response("instance-b"),
                "port: 6727\n",
                {},
            ),
        ).toThrow("来自不同的 OneBots 实例");
        expect(() =>
            parseConfigurationSnapshot(new Response(), response("instance-a"), "", {}),
        ).toThrow("缺少完整 OneBots 实例身份");
    });

    it("验证配置保存由预期实例处理", () => {
        expect(() =>
            assertConfigurationMutationAcknowledgement(
                {
                    success: true,
                    application: "onebots",
                    instance_id: "instance-a",
                    config_revision: `sha256:${"b".repeat(64)}`,
                },
                "instance-a",
            ),
        ).not.toThrow();
        expect(() =>
            assertConfigurationMutationAcknowledgement(
                {
                    success: true,
                    application: "onebots",
                    instance_id: "instance-b",
                    config_revision: `sha256:${"b".repeat(64)}`,
                },
                "instance-a",
            ),
        ).toThrow("配置保存回执实例不匹配");
    });
});
