import { describe, expect, it, vi } from "vitest";
import {
    handleConfigurationRequest,
    isConfigurationPath,
    type ConfigurationApiService,
} from "./configuration-api.js";
import { ConfigurationConflictError } from "../configuration/configuration-store.js";
const uuid = "12345678-1234-1234-1234-123456789abc";
const revision = "a".repeat(64);
const root = "/api/control/configuration";
function fixture() {
    const service: ConfigurationApiService = {
        snapshot: vi.fn(async () => ({ projected: true })),
        create: vi.fn(async () => ({ id: uuid })),
        read: vi.fn(async () => ({})),
        edit: vi.fn(async () => ({})),
        addAccount: vi.fn(async () => ({})),
        removeAccount: vi.fn(async () => ({})),
        setProtocol: vi.fn(async () => ({})),
        validate: vi.fn(async () => ({ receiptId: uuid })),
        apply: vi.fn(async () => ({ status: "succeeded" })),
        operation: vi.fn(() => ({ status: "succeeded" })),
    };
    const request = (
        path: string,
        body: Record<string, unknown> = {},
        method = "POST",
        allowCredentials = true,
    ) =>
        handleConfigurationRequest({
            pathname: root + path,
            method,
            body: async () => body,
            service,
            allowCredentials,
        });
    return { service, request };
}
describe("配置管理 API 边界", () => {
    it("路由只接入指定命名空间，服务缺失返回503", async () => {
        expect(isConfigurationPath(root)).toBe(true);
        expect(isConfigurationPath(`${root}-evil`)).toBe(false);
        expect(
            (
                await handleConfigurationRequest({
                    pathname: root,
                    method: "GET",
                    body: async () => ({}),
                    allowCredentials: false,
                })
            ).status,
        ).toBe(503);
    });
    it("草稿创建必须携带闭合版本基线", async () => {
        const { request, service } = fixture();
        expect(
            (await request("/drafts", { base: { generationId: null, configRevision: revision } }))
                .status,
        ).toBe(201);
        expect(service.create).toHaveBeenCalledWith({
            generationId: null,
            configRevision: revision,
        });
        for (const base of [
            { configRevision: revision },
            { generationId: "latest", configRevision: revision },
            { generationId: null, configRevision: revision, document: {} },
        ])
            expect((await request("/drafts", { base })).status).toBe(400);
        expect(service.create).toHaveBeenCalledTimes(1);
    });
    it("应用只传操作ID和验证收据，拒绝原始配置绕过校验", async () => {
        const { request, service } = fixture();
        expect((await request("/apply", { id: "operation-1", receiptId: uuid })).status).toBe(202);
        expect(service.apply).toHaveBeenCalledWith({ id: "operation-1", receiptId: uuid });
        expect(
            (
                await request("/apply", {
                    id: "operation-2",
                    receiptId: uuid,
                    document: { password: "secret" },
                })
            ).status,
        ).toBe(400);
        expect((await request("/apply", { id: "../escape", receiptId: uuid })).status).toBe(400);
        expect(service.apply).toHaveBeenCalledTimes(1);
    });
    it("未保护传输禁止秘密set，但允许keep；普通字段错误不回显嵌套秘密", async () => {
        const { request, service } = fixture();
        const path = `/drafts/${uuid}/edit`;
        expect(
            (
                await request(
                    path,
                    {
                        expectedRevision: revision,
                        changes: [],
                        secrets: [{ op: "set", path: ["qq.a", "token"], value: "secret" }],
                    },
                    "POST",
                    false,
                )
            ).status,
        ).toBe(403);
        expect(service.edit).not.toHaveBeenCalled();
        expect(
            (
                await request(
                    path,
                    {
                        expectedRevision: revision,
                        changes: [],
                        secrets: [{ op: "keep", path: ["qq.a", "token"] }],
                    },
                    "POST",
                    false,
                )
            ).status,
        ).toBe(200);
        vi.mocked(service.edit).mockRejectedValue(new Error("raw-secret nested-password"));
        const result = await request(path, {
            expectedRevision: revision,
            changes: [{ op: "set", path: ["qq.a"], value: { password: "raw-secret" } }],
            secrets: [],
        });
        expect(result.status).toBe(400);
        expect(JSON.stringify(result)).not.toContain("raw-secret");
    });
    it("冲突返回409，草稿路径禁止穿越、额外字段与畸形patch", async () => {
        const { request, service } = fixture();
        vi.mocked(service.read).mockRejectedValue(new ConfigurationConflictError());
        expect((await request(`/drafts/${uuid}`, {}, "GET")).status).toBe(409);
        expect((await request("/drafts/%2e%2e", {}, "GET")).status).toBe(400);
        expect(
            (
                await request(`/drafts/${uuid}/validate`, {
                    expectedRevision: revision,
                    secret: "hidden",
                })
            ).status,
        ).toBe(400);
        expect(
            (
                await request(`/drafts/${uuid}/edit`, {
                    expectedRevision: revision,
                    changes: [{ op: "set", path: "qq.a", value: 1 }],
                    secrets: [],
                })
            ).status,
        ).toBe(400);
    });
    it("读取、账号创建、验证和操作查询按各自契约派发", async () => {
        const { request, service } = fixture();
        expect((await request("", {}, "GET")).body).toEqual({ projected: true });
        expect(
            (
                await request(`/drafts/${uuid}/accounts`, {
                    expectedRevision: revision,
                    platform: "qq",
                    accountId: "a.b",
                })
            ).status,
        ).toBe(200);
        expect(service.addAccount).toHaveBeenCalledWith({
            id: uuid,
            expectedRevision: revision,
            platform: "qq",
            accountId: "a.b",
        });
        expect(
            (await request(`/drafts/${uuid}/validate`, { expectedRevision: revision })).status,
        ).toBe(200);
        expect(service.validate).toHaveBeenCalledWith({ id: uuid, expectedRevision: revision });
        expect((await request("/operations/op-1", {}, "GET")).status).toBe(200);
        expect(service.operation).toHaveBeenCalledWith("op-1");
    });
});
