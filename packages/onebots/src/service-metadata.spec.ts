import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { parseLegacyServiceSpec, readServiceMetadata } from "./service-metadata.js";

const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    roots.splice(0).forEach(root => fs.rmSync(root, { recursive: true, force: true }));
});
function legacy() {
    return {
        scope: "user",
        configPath: "/home/test/work space/custom.yaml",
        adapters: ["mock"],
        protocols: ["onebot-v11"],
        nodePath: "/usr/bin/node",
        binPath: "/opt/onebots/bin.js",
        workingDirectory: "/home/test/work space",
    };
}
function manager() {
    return {
        schemaVersion: 1,
        runtimeKind: "control",
        scope: "user",
        workspace: "/home/test/work space",
        nodePath: "/usr/bin/node",
        binPath: "/opt/onebots/bin.js",
        workingDirectory: "/home/test/work space",
        host: "127.0.0.1",
        port: 6727,
    };
}
function fixture(value: unknown = legacy()) {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-metadata-"));
    roots.push(root);
    const file = path.join(root, "service.json");
    fs.writeFileSync(file, JSON.stringify(value), { mode: 0o600 });
    return { root, file };
}
describe("唯一服务元数据分类", () => {
    it("区分legacy/control并保留原路径，读取不改字节或权限", () => {
        for (const [kind, value] of [
            ["legacy", legacy()],
            ["control", manager()],
        ] as const) {
            const f = fixture(value);
            const before = fs.readFileSync(f.file);
            expect(readServiceMetadata(f.file)).toEqual({ kind, spec: value });
            expect(fs.readFileSync(f.file)).toEqual(before);
            expect(fs.statSync(f.file).mode & 0o777).toBe(0o600);
            fs.chmodSync(f.file, 0o400);
            expect(readServiceMetadata(f.file)).toEqual({ kind, spec: value });
        }
    });
    it("任一新标识出现只走control校验，不降级legacy", () => {
        for (const marker of [
            { runtimeKind: "run" },
            { runtimeKind: "control" },
            { schemaVersion: 0 },
            { schemaVersion: 1 },
            { runtimeKind: null },
            { schemaVersion: null },
        ]) {
            const f = fixture({ ...legacy(), ...marker });
            expect(readServiceMetadata(f.file)).toEqual({ kind: "invalid" });
        }
        for (const override of [
            { extra: true },
            { port: "6727" },
            { runtimeKind: "legacy" },
            { schemaVersion: 2 },
        ]) {
            const f = fixture({ ...manager(), ...override });
            expect(readServiceMetadata(f.file)).toEqual({ kind: "invalid" });
        }
    });
    it("legacy闭合字段、路径及列表严格校验，不猜缺失字段", () => {
        expect(parseLegacyServiceSpec({ ...legacy(), applications: ["zhin"] })).toEqual({
            ...legacy(),
            applications: ["zhin"],
        });
        for (const key of Object.keys(legacy())) {
            const value: Record<string, unknown> = { ...legacy() };
            delete value[key];
            expect(() => parseLegacyServiceSpec(value)).toThrow();
        }
        for (const patch of [
            { unknown: true },
            { scope: ["user"] },
            { applications: undefined },
            { adapters: "mock" },
            { protocols: [1] },
            { configPath: "relative" },
            { nodePath: "/bin/no\nde" },
            { workingDirectory: "/home/\ttest" },
            { binPath: "/app/\u007fbin" },
        ])
            expect(() => parseLegacyServiceSpec({ ...legacy(), ...patch })).toThrow(
                "旧服务元数据契约无效",
            );
    });
    it("不执行getter，克隆插件数组且拒绝稀疏/额外数组属性", () => {
        const getter = vi.fn(() => ["mock"]);
        const source = legacy();
        Object.defineProperty(source, "adapters", { enumerable: true, get: getter });
        expect(() => parseLegacyServiceSpec(source)).toThrow();
        expect(getter).not.toHaveBeenCalled();
        const array = ["mock"];
        Object.defineProperty(array, "0", { enumerable: true, get: getter });
        expect(() => parseLegacyServiceSpec({ ...legacy(), adapters: array })).toThrow();
        expect(getter).not.toHaveBeenCalled();
        expect(() => parseLegacyServiceSpec({ ...legacy(), adapters: new Array(2) })).toThrow();
        expect(() =>
            parseLegacyServiceSpec({
                ...legacy(),
                adapters: Object.assign(["mock"], { extra: true }),
            }),
        ).toThrow();
        const original = legacy();
        parseLegacyServiceSpec(original).adapters.push("discord");
        expect(original.adapters).toEqual(["mock"]);
    });
    it("仅真正ENOENT归missing，权限/目录/链接/硬链一律invalid", () => {
        const f = fixture();
        expect(readServiceMetadata(path.join(f.root, "missing/service.json"))).toEqual({
            kind: "missing",
        });
        expect(readServiceMetadata(path.join(f.file, "child"))).toEqual({ kind: "invalid" });
        for (const mode of [0, 0o644, 0o640, 0o700]) {
            fs.chmodSync(f.file, mode);
            expect(
                readServiceMetadata(f.file),
                String(mode) + ":" + String(fs.statSync(f.file).mode & 0o7777),
            ).toEqual({ kind: "invalid" });
        }
        fs.chmodSync(f.file, 0o600);
        const hard = path.join(f.root, "hard");
        fs.linkSync(f.file, hard);
        expect(readServiceMetadata(f.file)).toEqual({ kind: "invalid" });
        fs.unlinkSync(hard);
        const link = path.join(f.root, "link");
        fs.symlinkSync(f.file, link);
        expect(readServiceMetadata(link)).toEqual({ kind: "invalid" });
        fs.unlinkSync(f.file);
        expect(readServiceMetadata(link)).toEqual({ kind: "invalid" });
        expect(readServiceMetadata(f.root)).toEqual({ kind: "invalid" });
    });
    it("Windows 以 DACL 为权限边界，不把 NTFS 映射的 POSIX mode 当成拒绝依据", () => {
        const f = fixture(manager());
        fs.chmodSync(f.file, 0o666);
        const originalPlatform = process.platform;
        try {
            Object.defineProperty(process, "platform", { value: "win32" });
            expect(readServiceMetadata(f.file)).toEqual({ kind: "control", spec: manager() });
        } finally {
            Object.defineProperty(process, "platform", { value: originalPlatform });
        }
        expect(readServiceMetadata(f.file)).toEqual({ kind: "invalid" });
    });
    it("祖先链接不能把缺失假装成正常missing", () => {
        const f = fixture();
        const link = path.join(f.root, "linkdir");
        fs.symlinkSync(path.join(f.root, "missing"), link);
        expect(readServiceMetadata(path.join(link, "service.json"))).toEqual({ kind: "invalid" });
    });
    it("坏JSON/UTF8/超限只返回invalid，原文不泄漏也不修改", () => {
        const f = fixture();
        for (const bytes of [
            Buffer.from('{"private-secret":'),
            Buffer.from([0xff, 0xfe]),
            Buffer.alloc(1_048_577, 120),
        ]) {
            fs.writeFileSync(f.file, bytes);
            expect(readServiceMetadata(f.file)).toEqual({ kind: "invalid" });
            expect(fs.readFileSync(f.file)).toEqual(bytes);
        }
    });
    it("首次确认存在后读取期间消失仍invalid，不误报missing", () => {
        const f = fixture();
        const original = fs.lstatSync;
        let count = 0;
        vi.spyOn(fs, "lstatSync").mockImplementation((...args: Parameters<typeof fs.lstatSync>) => {
            const result = original(...args);
            if (args[0] === f.file && ++count === 1) fs.unlinkSync(f.file);
            return result;
        });
        expect(readServiceMetadata(f.file)).toEqual({ kind: "invalid" });
    });
});
