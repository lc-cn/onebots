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
        reconcile: vi.fn(async () => ({ status: "failed", rolledBack: true })),
        sourceState: vi.fn(() => ({
            state: "damaged",
            base: { generationId: null, configRevision: revision },
        })),
        createRepair: vi.fn(async () => ({ draft: { id: uuid }, schemas: {} })),
        readContext: vi.fn(async () => ({ draft: { id: uuid }, schemas: {} })),
        snapshot: vi.fn(async () => ({ projected: true })),
        create: vi.fn(async () => ({ id: uuid })),
        read: vi.fn(async () => ({})),
        edit: vi.fn(async () => ({})),
        editList: vi.fn(async () => ({})),
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
        local?: boolean,
    ) =>
        handleConfigurationRequest({
            pathname: root + path,
            method,
            body: async () => body,
            service,
            allowCredentials,
            local,
        });
    return { service, request };
}
describe("配置管理 API 边界", () => {
    it("来源状态只查询sourceState，不读取snapshot或创建草稿", async () => {
        const { request, service } = fixture();
        const result = await request("/source", {}, "GET");
        expect(result).toEqual({
            status: 200,
            body: { state: "damaged", base: { generationId: null, configRevision: revision } },
        });
        expect(service.sourceState).toHaveBeenCalledOnce();
        expect(service.snapshot).not.toHaveBeenCalled();
        expect(service.createRepair).not.toHaveBeenCalled();
        expect(service.create).not.toHaveBeenCalled();
    });
    it("修复草稿必须显式strategy与完整base，禁止客户端提供raw备份或mode", async () => {
        const { request, service } = fixture();
        const base = { generationId: null, configRevision: revision };
        expect((await request("/repair-drafts", { base, strategy: "new-empty" })).status).toBe(201);
        expect(service.createRepair).toHaveBeenCalledExactlyOnceWith(base);
        for (const body of [
            { base },
            { strategy: "new-empty" },
            { base, strategy: "auto" },
            ...["raw", "bytes", "backupId", "backup", "mode", "document"].map(key => ({
                base,
                strategy: "new-empty",
                [key]: "private-secret",
            })),
            { base: { ...base, backupId: uuid }, strategy: "new-empty" },
            { base: { configRevision: revision }, strategy: "new-empty" },
            { base: { ...base, generationId: "../unknown" }, strategy: "new-empty" },
            { base: { ...base, configRevision: "bad" }, strategy: "new-empty" },
        ])
            expect((await request("/repair-drafts", body)).status).toBe(400);
        expect(service.createRepair).toHaveBeenCalledOnce();
        expect(service.apply).not.toHaveBeenCalled();
    });
    it("草稿context只读取指定既有草稿，拒绝非法路径ID", async () => {
        const { request, service } = fixture();
        expect((await request(`/drafts/${uuid}/context`, {}, "GET")).status).toBe(200);
        expect(service.readContext).toHaveBeenCalledExactlyOnceWith(uuid);
        for (const id of ["%2e%2e", "latest", "123", "a".repeat(129)])
            expect((await request(`/drafts/${id}/context`, {}, "GET")).status).toBe(400);
        expect(service.readContext).toHaveBeenCalledOnce();
        expect(service.createRepair).not.toHaveBeenCalled();
        expect(service.create).not.toHaveBeenCalled();
        expect(service.snapshot).not.toHaveBeenCalled();
    });
    it("reconcile只接受严格local=true，受保护HTTP不能代替本地权限", async () => {
        const { request, service } = fixture();
        const body = { id: "repair-operation", expectedRevision: revision };
        for (const local of [
            undefined,
            false,
            "true" as unknown as boolean,
            1 as unknown as boolean,
        ]) {
            expect((await request("/reconcile", body, "POST", true, local)).status).toBe(403);
        }
        expect(service.reconcile).not.toHaveBeenCalled();
        expect((await request("/reconcile", body, "POST", false, true)).status).toBe(200);
        expect(service.reconcile).toHaveBeenCalledExactlyOnceWith(body);
    });
    it("reconcile严格校验操作ID与原始摘要，不接受额外策略或正文", async () => {
        const { request, service } = fixture();
        for (const body of [
            { id: "../escape", expectedRevision: revision },
            { id: "a".repeat(129), expectedRevision: revision },
            { id: "repair", expectedRevision: "A".repeat(64) },
            { id: "repair", expectedRevision: "a".repeat(63) },
            { id: "repair" },
            { id: "repair", expectedRevision: revision, raw: "secret" },
            { id: "repair", expectedRevision: revision, mode: "force" },
        ])
            expect((await request("/reconcile", body, "POST", true, true)).status).toBe(400);
        expect(service.reconcile).not.toHaveBeenCalled();
    });
    it("修复相关服务失败只返回固定诊断，冲突为409且不回显原文", async () => {
        const { request, service } = fixture();
        vi.mocked(service.sourceState).mockImplementation(() => {
            throw new Error("raw-secret-yaml");
        });
        vi.mocked(service.createRepair).mockRejectedValue(new Error("raw-secret-yaml"));
        vi.mocked(service.readContext).mockRejectedValue(new Error("raw-secret-yaml"));
        vi.mocked(service.reconcile).mockRejectedValue(new Error("raw-secret-yaml"));
        const results = await Promise.all([
            request("/source", {}, "GET"),
            request("/repair-drafts", {
                base: { generationId: null, configRevision: revision },
                strategy: "new-empty",
            }),
            request(`/drafts/${uuid}/context`, {}, "GET"),
            request("/reconcile", { id: "repair", expectedRevision: revision }, "POST", true, true),
        ]);
        expect(results.every(result => result.status === 400)).toBe(true);
        expect(JSON.stringify(results)).not.toContain("raw-secret-yaml");
        vi.mocked(service.reconcile).mockRejectedValue(new ConfigurationConflictError());
        expect(
            (
                await request(
                    "/reconcile",
                    { id: "repair", expectedRevision: revision },
                    "POST",
                    true,
                    true,
                )
            ).status,
        ).toBe(409);
    });
    it("列表接口只接受空行追加或精确索引删除，拒绝夹带值", async () => {
        const { request, service } = fixture();
        const body = { expectedRevision: revision, path: ["mock.001.a", "rows"], action: "append" };
        expect((await request(`/drafts/${uuid}/list`, body)).status).toBe(200);
        expect(service.editList).toHaveBeenCalledWith({ id: uuid, ...body });
        for (const input of [
            { ...body, value: { token: "secret" } },
            { ...body, index: 0 },
            { ...body, action: "remove", index: -1 },
            { ...body, path: ["__proto__"] },
        ])
            expect((await request(`/drafts/${uuid}/list`, input)).status).toBe(400);
        expect(service.editList).toHaveBeenCalledTimes(1);
    });
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
