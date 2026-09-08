import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { inspectDiagnosticStorage } from "./diagnostic-storage.js";
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ob-storage-check-")));
    roots.push(root);
    return root;
}
describe("管理域只读存储诊断", () => {
    it("空安装可创建data和DB，不创建任何文件", () => {
        const root = fixture();
        const mkdir = vi.spyOn(fs, "mkdirSync"),
            chmod = vi.spyOn(fs, "chmodSync"),
            open = vi.spyOn(fs, "openSync");
        expect(inspectDiagnosticStorage(root, {})).toEqual({
            dataDirectory: "creatable",
            database: "creatable",
            publicStatic: "disabled",
            databaseIntegrity: "not-checked",
        });
        expect(fs.readdirSync(root)).toEqual([]);
        expect(mkdir).not.toHaveBeenCalled();
        expect(chmod).not.toHaveBeenCalled();
        expect(open).not.toHaveBeenCalled();
    });
    it("null配置全部未知，不访问业务路径", () => {
        const probe = vi.spyOn(fs, "lstatSync");
        expect(inspectDiagnosticStorage("/synthetic-secret", null)).toEqual({
            dataDirectory: "unavailable",
            database: "unavailable",
            publicStatic: "unavailable",
            databaseIntegrity: "not-checked",
        });
        expect(probe).not.toHaveBeenCalled();
    });
    it("已有DB只证明文件可访问，不假称内容完整", () => {
        const root = fixture();
        fs.mkdirSync(path.join(root, "data"), { mode: 0o700 });
        fs.writeFileSync(path.join(root, "data", "onebots.db"), "not sqlite", { mode: 0o600 });
        const read = vi.spyOn(fs, "readFileSync");
        expect(inspectDiagnosticStorage(root, {}).database).toBe("ready");
        expect(inspectDiagnosticStorage(root, {}).databaseIntegrity).toBe("not-checked");
        expect(read).not.toHaveBeenCalled();
    });
    it("数据库相对data，绝对路径保留，自动补.db", () => {
        const root = fixture(),
            external = fixture();
        fs.mkdirSync(path.join(root, "data"), { mode: 0o700 });
        fs.writeFileSync(path.join(root, "data", "custom.db"), "db", { mode: 0o600 });
        fs.writeFileSync(path.join(external, "external.db"), "db", { mode: 0o600 });
        expect(inspectDiagnosticStorage(root, { database: "custom" }).database).toBe("ready");
        expect(
            inspectDiagnosticStorage(root, { database: path.join(external, "external") }).database,
        ).toBe("ready");
        expect(inspectDiagnosticStorage(root, { database: "missing/nested" }).database).toBe(
            "creatable",
        );
    });
    it.each(["symlink", "hardlink", "directory", "mode", "group-read", "parent"])(
        "DB %s 边界拒绝",
        issue => {
            const root = fixture(),
                data = path.join(root, "data"),
                db = path.join(data, "onebots.db");
            fs.mkdirSync(data, { mode: 0o700 });
            if (issue === "directory") fs.mkdirSync(db);
            else if (issue === "symlink") fs.symlinkSync(path.join(root, "missing"), db);
            else {
                fs.writeFileSync(db, "db", { mode: 0o600 });
                if (issue === "hardlink") fs.linkSync(db, path.join(root, "copy"));
                if (issue === "mode") fs.chmodSync(db, 0o666);
                if (issue === "group-read") fs.chmodSync(db, 0o640);
                if (issue === "parent") fs.chmodSync(data, 0o777);
            }
            expect(inspectDiagnosticStorage(root, {}).database).toBe("invalid");
        },
    );
    it("非所有者文件和访问失败不报告ready", () => {
        const root = fixture(),
            data = path.join(root, "data");
        fs.mkdirSync(data, { mode: 0o700 });
        const lstat = fs.lstatSync;
        vi.spyOn(fs, "lstatSync").mockImplementation((file, options) => {
            const value = lstat(file, options);
            if (file === data) Reflect.set(value, "uid", 2147483646);
            return value;
        });
        expect(inspectDiagnosticStorage(root, {}).dataDirectory).toBe("invalid");
        vi.restoreAllMocks();
        vi.spyOn(fs, "accessSync").mockImplementation(() => {
            throw new Error("synthetic-secret");
        });
        const output = inspectDiagnosticStorage(root, {});
        expect(output.dataDirectory).toBe("unavailable");
        expect(JSON.stringify(output)).not.toContain("synthetic-secret");
    });
    it("静态目录允许绝对路径，相对路径仅严格子目录，缺失不创建", () => {
        const root = fixture(),
            external = path.join(fixture(), "public");
        // 私有父目录是被检查的安全边界；Linux 的 /tmp 本身不能充当目标直接父目录。
        fs.mkdirSync(external, { mode: 0o755 });
        fs.mkdirSync(path.join(root, "public"), { mode: 0o755 });
        expect(inspectDiagnosticStorage(root, { public_static_dir: " public " }).publicStatic).toBe(
            "ready",
        );
        expect(inspectDiagnosticStorage(root, { public_static_dir: external }).publicStatic).toBe(
            "ready",
        );
        for (const value of [".", "..", "../outside"])
            expect(inspectDiagnosticStorage(root, { public_static_dir: value }).publicStatic).toBe(
                "invalid",
            );
        expect(inspectDiagnosticStorage(root, { public_static_dir: "missing" }).publicStatic).toBe(
            "unavailable",
        );
        expect(fs.existsSync(path.join(root, "missing"))).toBe(false);
        expect(inspectDiagnosticStorage(root, { public_static_dir: "  " }).publicStatic).toBe(
            "disabled",
        );
    });
    it("静态目录链接和非目录拒绝，getter不执行", () => {
        const root = fixture(),
            external = fixture();
        fs.symlinkSync(external, path.join(root, "link"));
        fs.writeFileSync(path.join(root, "file"), "x");
        for (const value of ["link", "file", 42])
            expect(inspectDiagnosticStorage(root, { public_static_dir: value }).publicStatic).toBe(
                "invalid",
            );
        expect(inspectDiagnosticStorage(root, { database: null }).database).toBe("invalid");
        const getter = vi.fn(() => "synthetic-secret"),
            document = {};
        Object.defineProperty(document, "database", { get: getter });
        expect(inspectDiagnosticStorage(root, document).database).toBe("invalid");
        expect(getter).not.toHaveBeenCalled();
    });
});
