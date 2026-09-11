import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigurationDrafts } from "./configuration-drafts.js";
import { ConfigurationStore, ConfigurationConflictError } from "./configuration-store.js";
import { normalizeConfigurationSchema } from "./configuration-schema.js";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-drafts-"));
    roots.push(root);
    const store = new ConfigurationStore(root);
    const context = {
        base: { generationId: null as string | null, configRevision: "a".repeat(64) },
        document: {
            "mock.001.with.dot": {
                token: "private-token",
                nickname: "before",
                extra: "unknown-private",
            },
        },
        schemas: normalizeConfigurationSchema({
            schemas: {
                schemaVersion: 1,
                adapters: {
                    mock: {
                        token: { type: "string", sensitive: true },
                        nickname: { type: "string" },
                    },
                },
                protocols: {},
                applications: {},
            },
            protocols: [],
        }),
    };
    return { store, context, service: new ConfigurationDrafts({ store, current: () => context }) };
}

describe("管理配置草稿应用服务", () => {
    it("显式repair从空plugins创建，不读取损坏源；后续编辑保留修复引用", () => {
        const { store, context } = fixture();
        let revision = context.base.configRevision;
        const service = new ConfigurationDrafts({
            store,
            current: () => {
                throw new Error("damaged source");
            },
            repairCurrent: () => ({
                base: { ...context.base, configRevision: revision },
                schemas: context.schemas,
            }),
        });
        expect(() => service.create(context.base)).toThrow();
        expect(() => service.snapshot()).toThrow();
        const repair = {
            backupId: "11111111-1111-4111-8111-111111111111",
            originalRevision: context.base.configRevision,
        };
        const created = service.createRepair(context.base, repair);
        expect(created.mode).toBe("repair");
        expect(created).not.toHaveProperty("repair");
        expect(store.read(created.id).repair).toEqual(repair);
        expect(created.document).toEqual({
            plugins: { adapters: [], protocols: [], applications: [] },
        });
        expect(JSON.stringify(created)).not.toContain("private-token");
        const account = service.addAccount(created.id, created.revision, "mock", "new");
        const edited = service.edit({
            id: account.id,
            expectedRevision: account.revision,
            changes: [],
            secrets: [{ op: "set", path: ["mock.new", "token"], value: "repair-secret" }],
        });
        expect(service.read(edited.id).mode).toBe("repair");
        expect(store.read(edited.id).repair).toEqual(repair);
        expect(JSON.stringify(edited)).not.toContain("repair-secret");
        revision = "b".repeat(64);
        expect(() => service.read(edited.id)).toThrow(ConfigurationConflictError);
        expect(() =>
            service.edit({
                id: edited.id,
                expectedRevision: edited.revision,
                changes: [],
                secrets: [],
            }),
        ).toThrow(ConfigurationConflictError);
    });
    it("没有显式repair上下文不能创建修复草稿；普通草稿不能借repair旁路读取", () => {
        const { store, context, service } = fixture();
        expect(() =>
            service.createRepair(context.base, {
                backupId: "11111111-1111-4111-8111-111111111111",
                originalRevision: context.base.configRevision,
            }),
        ).toThrow(ConfigurationConflictError);
        const ordinary = service.create(context.base);
        const damaged = new ConfigurationDrafts({
            store,
            current: () => {
                throw new Error("damaged");
            },
            repairCurrent: () => ({ base: context.base, schemas: context.schemas }),
        });
        expect(() => damaged.read(ordinary.id)).toThrow("damaged");
    });
    it("危险ui字段不能使新增列表先持久化再投影失败", () => {
        const { service, context, store } = fixture();
        for (const key of ["__proto__", "constructor", "prototype"]) {
            context.schemas.adapters.mock.rows = {
                type: "array",
                ui: { fields: [{ key, type: "string" }] },
            };
            const draft = service.create(context.base);
            const before = store.read(draft.id);
            expect(() =>
                service.editList(draft.id, draft.revision, {
                    path: ["mock.001.with.dot", "rows"],
                    action: "append",
                }),
            ).toThrow();
            expect(store.read(draft.id)).toEqual(before);
        }
    });
    it("列表删行重算秘密索引并以草稿revision拒绝旧索引请求", () => {
        const { service, context, store } = fixture();
        context.schemas.adapters.mock.rows = {
            type: "array",
            items: {
                type: "object",
                properties: {
                    token: { type: "string", sensitive: true },
                },
            },
        };
        Object.assign(context.document["mock.001.with.dot"], {
            rows: [{ token: "first" }, { token: "second" }],
        });
        const draft = service.create(context.base);
        const change = { path: ["mock.001.with.dot", "rows"], action: "remove" as const, index: 0 };
        const result = service.editList(draft.id, draft.revision, change);
        expect(JSON.stringify(result)).not.toContain("second");
        expect(result.secretStates).toContainEqual({
            path: ["mock.001.with.dot", "rows", "0", "token"],
            configured: true,
        });
        expect(store.read(draft.id).document["mock.001.with.dot"]).toMatchObject({
            rows: [{ token: "second" }],
        });
        expect(() => service.editList(draft.id, draft.revision, change)).toThrow(
            ConfigurationConflictError,
        );
    });
    it("显式账号和协议操作只选择对应扩展，删除容器不影响其他账号", () => {
        const { service, context, store } = fixture();
        context.schemas = normalizeConfigurationSchema({
            schemas: {
                schemaVersion: 1,
                adapters: { mock: { token: { type: "string", sensitive: true } } },
                protocols: {
                    "custom-wire-v2": { access_token: { type: "string", sensitive: true } },
                },
                applications: {},
            },
            protocols: [{ registrationName: "custom-wire-v2", name: "custom-wire", version: "v2" }],
        });
        const draft = service.create(context.base);
        const added = service.addAccount(draft.id, draft.revision, "mock", "second.id");
        expect(added.document.plugins).toEqual({
            adapters: ["mock"],
            protocols: [],
            applications: [],
        });
        const enabled = service.setProtocol(draft.id, {
            expectedRevision: added.revision,
            accountKey: "mock.second.id",
            protocol: "custom-wire.v2",
            enabled: true,
        });
        expect(enabled.document.plugins).toEqual({
            adapters: ["mock"],
            protocols: ["custom-wire-v2"],
            applications: [],
        });
        const secret = service.edit({
            id: draft.id,
            expectedRevision: enabled.revision,
            changes: [],
            secrets: [
                {
                    op: "set",
                    path: ["mock.second.id", "custom-wire.v2", "access_token"],
                    value: "protocol-secret",
                },
            ],
        });
        const disabled = service.setProtocol(draft.id, {
            expectedRevision: secret.revision,
            accountKey: "mock.second.id",
            protocol: "custom-wire.v2",
            enabled: false,
        });
        expect(store.read(draft.id).document["mock.second.id"]).toEqual({});
        const removed = service.removeAccount(draft.id, disabled.revision, "mock.second.id");
        expect(removed.document).not.toHaveProperty("mock.second.id");
        expect(store.read(draft.id).document["mock.001.with.dot"]).toEqual(
            context.document["mock.001.with.dot"],
        );
        expect(() => service.removeAccount(draft.id, removed.revision, "plugins")).toThrow(
            "账号不存在",
        );
    });
    it("快照与草稿只返回秘密状态，未知字段保留私有", () => {
        const { service, context, store } = fixture();
        const draft = service.create(context.base);
        expect(JSON.stringify(service.snapshot())).not.toContain("private-token");
        expect(JSON.stringify(draft)).not.toContain("unknown-private");
        expect(draft.unknownPaths).toEqual([["mock.001.with.dot", "extra"]]);
        expect(store.read(draft.id).document).toEqual(context.document);
    });

    it("普通字段修改保留秘密，秘密只能明确替换或清除", () => {
        const { service, context, store } = fixture();
        const draft = service.create(context.base);
        const next = service.edit({
            id: draft.id,
            expectedRevision: draft.revision,
            changes: [{ op: "set", path: ["mock.001.with.dot", "nickname"], value: "after" }],
            secrets: [{ op: "keep", path: ["mock.001.with.dot", "token"] }],
        });
        expect(store.read(draft.id).document["mock.001.with.dot"]).toEqual({
            nickname: "after",
            token: "private-token",
            extra: "unknown-private",
        });
        expect(() =>
            service.edit({
                id: draft.id,
                expectedRevision: next.revision,
                changes: [{ op: "set", path: ["mock.001.with.dot", "token"], value: "bypass" }],
                secrets: [],
            }),
        ).toThrow();
        const updated = service.edit({
            id: draft.id,
            expectedRevision: next.revision,
            changes: [],
            secrets: [{ op: "set", path: ["mock.001.with.dot", "token"], value: "replacement" }],
        });
        expect(JSON.stringify(updated)).not.toContain("replacement");
        expect(context.document["mock.001.with.dot"].nickname).toBe("before");
    });

    it("运行版本变更后拒绝旧草稿，两个编辑器不能覆盖彼此", () => {
        const { service, context } = fixture();
        const draft = service.create(context.base);
        service.addAccount(draft.id, draft.revision, "mock", "002");
        expect(() => service.addAccount(draft.id, draft.revision, "mock", "003")).toThrow(
            ConfigurationConflictError,
        );
        context.base = { ...context.base, generationId: "new-generation" };
        expect(() => service.read(draft.id)).toThrow(ConfigurationConflictError);
    });

    it("新增账号不填凭据或出口，但能安全编辑尚未配置的秘密", () => {
        const { service, context, store } = fixture();
        const draft = service.create(context.base);
        const account = service.addAccount(draft.id, draft.revision, "mock", "0003.a");
        expect(account.document["mock.0003.a"]).toEqual({});
        expect(account.secretStates).toContainEqual({
            path: ["mock.0003.a", "token"],
            configured: false,
        });
        service.edit({
            id: draft.id,
            expectedRevision: account.revision,
            changes: [],
            secrets: [{ op: "set", path: ["mock.0003.a", "token"], value: "new-secret" }],
        });
        expect(store.read(draft.id).document["mock.0003.a"]).toEqual({ token: "new-secret" });
    });
});
