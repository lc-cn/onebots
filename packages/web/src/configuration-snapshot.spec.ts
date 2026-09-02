import { describe, expect, it } from "vitest";
import {
    parseConfigurationMutationResponse,
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

const mutationResponse = (
    instanceId: string,
    payload: unknown,
    options: { status?: number; revision?: string } = {},
) =>
    new Response(typeof payload === "string" ? payload : JSON.stringify(payload), {
        status: options.status ?? 200,
        headers: {
            "Content-Type": "application/json",
            "X-OneBots-Application": "onebots",
            "X-OneBots-Version": "1.2.8",
            "X-OneBots-Instance-Id": instanceId,
            "X-OneBots-Runtime-Contract-Id": "sha256:contract",
            ...(options.revision ? { "X-OneBots-Config-Revision": options.revision } : {}),
        },
    });

const expectedIdentity = {
    application: "onebots",
    version: "1.2.8",
    instanceId: "instance-a",
    runtimeContractId: "sha256:contract",
};

describe("configuration snapshot", () => {
    it("只原子采用同一实例的配置正文与 Schema", () => {
        expect(
            parseConfigurationSnapshot(
                response("instance-a"),
                response("instance-a"),
                "port: 6727\n",
                { base: {} },
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

    it("验证配置保存由预期实例处理并闭合应用状态", async () => {
        const nextRevision = `sha256:${"b".repeat(64)}`;
        await expect(
            parseConfigurationMutationResponse(
                mutationResponse(
                    "instance-a",
                    {
                        success: true,
                        operation: "save",
                        application: "onebots",
                        instance_id: "instance-a",
                        config_revision: nextRevision,
                        applied: true,
                        restartRequired: false,
                        changedHostFields: [],
                        message: "配置已保存并生效",
                    },
                    { revision: nextRevision },
                ),
                expectedIdentity,
            ),
        ).resolves.toEqual({
            success: true,
            configRevision: nextRevision,
            applied: true,
            restartRequired: false,
            changedHostFields: [],
            message: "配置已保存并生效",
        });
        await expect(
            parseConfigurationMutationResponse(
                mutationResponse(
                    "instance-a",
                    {
                        success: true,
                        operation: "save",
                        application: "onebots",
                        instance_id: "instance-a",
                        config_revision: nextRevision,
                        applied: false,
                        restartRequired: true,
                        changedHostFields: ["port"],
                        message: "配置已保存；port 需要重启后生效",
                    },
                    { revision: nextRevision },
                ),
                expectedIdentity,
            ),
        ).resolves.toMatchObject({
            success: true,
            applied: false,
            restartRequired: true,
            changedHostFields: ["port"],
        });
    });

    it("实例不匹配时在读取正文前返回本地诊断", async () => {
        await expect(
            parseConfigurationMutationResponse(
                mutationResponse("instance-b", "{broken-json"),
                expectedIdentity,
            ),
        ).resolves.toMatchObject({
            success: false,
            code: "CONFIG_INSTANCE_MISMATCH",
            refreshRequired: true,
        });
    });

    it("拒绝没有闭合保存操作、修订或应用状态的成功回执", async () => {
        const nextRevision = `sha256:${"b".repeat(64)}`;
        const success = (overrides: Record<string, unknown> = {}) => ({
            success: true,
            operation: "save",
            application: "onebots",
            instance_id: "instance-a",
            config_revision: nextRevision,
            applied: true,
            restartRequired: false,
            changedHostFields: [],
            ...overrides,
        });

        await expect(
            parseConfigurationMutationResponse(
                mutationResponse("instance-a", success({ operation: "reload" }), {
                    revision: nextRevision,
                }),
                expectedIdentity,
            ),
        ).rejects.toThrow("与请求操作不一致");
        await expect(
            parseConfigurationMutationResponse(
                mutationResponse("instance-a", success(), {
                    revision: `sha256:${"c".repeat(64)}`,
                }),
                expectedIdentity,
            ),
        ).rejects.toThrow("缺少一致的配置修订号");
        await expect(
            parseConfigurationMutationResponse(
                mutationResponse(
                    "instance-a",
                    success({ applied: false, restartRequired: false }),
                    { revision: nextRevision },
                ),
                expectedIdentity,
            ),
        ).rejects.toThrow("应用状态无效");
        await expect(
            parseConfigurationMutationResponse(
                mutationResponse(
                    "instance-a",
                    success({
                        applied: false,
                        restartRequired: true,
                        changedHostFields: ["port", "port"],
                    }),
                    { revision: nextRevision },
                ),
                expectedIdentity,
            ),
        ).rejects.toThrow("宿主字段重复");
    });

    it("只采用同一实例发布的稳定失败码与限长诊断", async () => {
        const result = await parseConfigurationMutationResponse(
            mutationResponse(
                "instance-a",
                {
                    success: false,
                    application: "onebots",
                    instance_id: "instance-a",
                    code: "CONFIG_DRIFT",
                    message: `配置冲突\n${"x".repeat(700)}`,
                },
                { status: 409 },
            ),
            expectedIdentity,
        );
        expect(result).toMatchObject({
            success: false,
            code: "CONFIG_DRIFT",
            refreshRequired: true,
        });
        expect(result.message).toHaveLength(500);
        expect(result.message).not.toContain("\n");

        await expect(
            parseConfigurationMutationResponse(
                mutationResponse(
                    "instance-a",
                    {
                        success: false,
                        application: "onebots",
                        instance_id: "instance-a",
                        code: "UNKNOWN",
                    },
                    { status: 500 },
                ),
                expectedIdentity,
            ),
        ).rejects.toThrow("缺少有效错误码");
        await expect(
            parseConfigurationMutationResponse(
                mutationResponse(
                    "instance-a",
                    {
                        success: false,
                        application: "onebots",
                        instance_id: "instance-a",
                        code: "CONFIG_BUSY",
                        message: "另一项配置保存正在进行",
                    },
                    { status: 409 },
                ),
                expectedIdentity,
            ),
        ).resolves.toEqual({
            success: false,
            code: "CONFIG_BUSY",
            refreshRequired: false,
            message: "另一项配置保存正在进行",
        });
    });
});
