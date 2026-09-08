import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
    ConfigurationStore,
    ConfigurationConflictError,
    canonicalConfiguration,
} from "./configuration-store.js";

const roots: string[] = [];
const base = { generationId: null, configRevision: "a".repeat(64) };
function setup() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-draft-test-"));
    roots.push(root);
    return { root, store: new ConfigurationStore(root) };
}
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("私有配置草稿", () => {
    it("持久化未完成配置，不写运行配置且保留字符串账号 ID", () => {
        const { root, store } = setup();
        const document = { "mock.001.with.dot": { token: "private-value" } };
        const draft = store.create(base, document);
        document["mock.001.with.dot"].token = "changed";
        expect(new ConfigurationStore(root).read(draft.id).document).toEqual({
            "mock.001.with.dot": { token: "private-value" },
        });
        expect(fs.existsSync(path.join(root, "config.yaml"))).toBe(false);
        expect(fs.statSync(path.join(root, `${draft.id}.json`)).mode & 0o777).toBe(0o600);
        expect(fs.statSync(root).mode & 0o777).toBe(0o700);
    });

    it("同一版本并发编辑只有第一次成功，返回值不共享内部对象", () => {
        const { store } = setup();
        const original = store.create(base, { field: "initial" });
        const next = store.replace(original.id, original.revision, { field: "first" });
        expect(() => store.replace(original.id, original.revision, { field: "lost" })).toThrow(
            ConfigurationConflictError,
        );
        next.document.field = "mutated";
        expect(store.read(original.id).document.field).toBe("first");
    });

    it("篡改的草稿、符号链接及错误 JSON 不回显凭据", () => {
        const { root, store } = setup();
        const draft = store.create(base, { password: "secret-marker" });
        const file = path.join(root, `${draft.id}.json`);
        fs.writeFileSync(file, '{"secret-marker":');
        expect(() => store.read(draft.id)).toThrow("配置草稿不存在或已损坏");
        fs.unlinkSync(file);
        const external = path.join(root, "external");
        fs.writeFileSync(external, JSON.stringify(draft));
        fs.symlinkSync(external, file);
        expect(() => store.read(draft.id)).toThrow("配置草稿不存在或已损坏");
        expect(() => store.read("../../secret-marker")).toThrow("配置草稿不存在或已损坏");
    });

    it("文档摘要对键顺序稳定并绑定基础版本", () => {
        const { root, store } = setup();
        expect(canonicalConfiguration({ b: 2, a: 1 })).toBe(canonicalConfiguration({ a: 1, b: 2 }));
        const draft = store.create(base, { a: 1 });
        const file = path.join(root, `${draft.id}.json`);
        fs.writeFileSync(
            file,
            JSON.stringify({ ...draft, base: { ...base, configRevision: "b".repeat(64) } }),
        );
        expect(() => store.read(draft.id)).toThrow("配置草稿不存在或已损坏");
    });

    it("拒绝不可序列化值、原型污染、循环、稀疏数组及访问器", () => {
        const cyclic: Record<string, unknown> = {};
        cyclic.self = cyclic;
        for (const document of [
            cyclic,
            { value: undefined },
            { value: NaN },
            { value: new Date() },
            { value: [, 1] },
            JSON.parse('{"__proto__":{"polluted":true}}'),
        ])
            expect(() => canonicalConfiguration(document)).toThrow();
        const document = Object.defineProperty({}, "value", {
            enumerable: true,
            get() {
                throw new Error("secret-marker");
            },
        });
        expect(() => canonicalConfiguration(document)).toThrow("配置文档或修改请求无效");
        expect(Object.hasOwn({}, "polluted")).toBe(false);
    });
});
