import { describe, expect, it } from "vitest";
import {
    assertConfigurationMutationAcknowledgement,
    configurationMutationFailureMessage,
    parseConfigurationSnapshot,
} from "./configuration-snapshot.js";

const response = (instanceId: string, revision = `sha256:${"a".repeat(64)}`) =>
    new Response(null, {
        headers: {
            "X-OneBots-Application": "onebots",
            "X-OneBots-Version": "1.2.8",
            "X-OneBots-Instance-Id": instanceId,
            "X-OneBots-Runtime-Contract-Id": "sha256:contract",
            "X-OneBots-Config-Revision": revision,
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
        const expectedIdentity = {
            application: "onebots",
            version: "1.2.8",
            instanceId: "instance-a",
            runtimeContractId: "sha256:contract",
        };
        const nextRevision = `sha256:${"b".repeat(64)}`;
        expect(() =>
            assertConfigurationMutationAcknowledgement(
                response("instance-a", nextRevision),
                {
                    success: true,
                    application: "onebots",
                    instance_id: "instance-a",
                    config_revision: nextRevision,
                },
                expectedIdentity,
            ),
        ).not.toThrow();
        expect(() =>
            assertConfigurationMutationAcknowledgement(
                response("instance-b", nextRevision),
                {
                    success: true,
                    application: "onebots",
                    instance_id: "instance-b",
                    config_revision: nextRevision,
                },
                expectedIdentity,
            ),
        ).toThrow("配置保存响应实例不匹配");
        expect(() =>
            assertConfigurationMutationAcknowledgement(
                response("instance-a"),
                {
                    success: true,
                    application: "onebots",
                    instance_id: "instance-a",
                    config_revision: nextRevision,
                },
                expectedIdentity,
            ),
        ).toThrow("配置保存回执缺少一致的配置修订号");
    });

    it("只采用同一实例的限长配置保存失败诊断", () => {
        const expectedIdentity = {
            application: "onebots",
            version: "1.2.8",
            instanceId: "instance-a",
            runtimeContractId: "sha256:contract",
        };
        const payload = {
            success: false,
            application: "onebots",
            instance_id: "instance-a",
            message: `配置冲突\n${"x".repeat(700)}`,
        };

        const message = configurationMutationFailureMessage(
            response("instance-a"),
            payload,
            expectedIdentity,
        );
        expect(message).toHaveLength(500);
        expect(message).not.toContain("\n");
        expect(() =>
            configurationMutationFailureMessage(
                response("instance-b"),
                payload,
                expectedIdentity,
            ),
        ).toThrow("配置保存响应实例不匹配");
    });
});
