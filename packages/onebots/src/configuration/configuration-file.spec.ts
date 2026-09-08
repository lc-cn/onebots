import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigurationFile } from "./configuration-file.js";
import { ConfigurationConflictError } from "./configuration-store.js";

const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-config-file-"));
    roots.push(root);
    const file = path.join(root, "config.yaml");
    fs.writeFileSync(
        file,
        "plugins:\n  adapters: []\n  protocols: []\nmock.001.a:\n  token: private-token\n",
    );
    return { root, file, source: new ConfigurationFile(file) };
}
describe("配置文件版本与唯一写入器", () => {
    it("损坏原文只在私有raw接口读取，inspect仅固定原因和摘要", () => {
        const { source, file } = fixture();
        const raw = Buffer.from("秘密: [private-secret\r\n", "utf8");
        fs.writeFileSync(file, raw);
        const before = source.readRaw();
        expect(before.bytes.equals(raw)).toBe(true);
        expect(source.inspect()).toEqual({
            state: "damaged",
            revision: before.revision,
            reason: "INVALID_YAML",
        });
        expect(JSON.stringify(source.inspect())).not.toContain("private-secret");
        const good = source.replace(before.revision, { plugins: { adapters: [] } });
        source.replaceRaw(good.revision, raw);
        expect(source.readRaw().bytes.equals(raw)).toBe(true);
        expect(source.inspect().state).toBe("damaged");
    });
    it("缺失、硬链、超限不是可覆盖的损坏配置", () => {
        const { source, file, root } = fixture();
        fs.linkSync(file, path.join(root, "link"));
        expect(() => source.inspect()).toThrow("不可用");
        fs.unlinkSync(path.join(root, "link"));
        fs.writeFileSync(file, Buffer.alloc(1_048_577));
        expect(() => source.readRaw()).toThrow("不可用");
        fs.unlinkSync(file);
        expect(() => source.inspect()).toThrow("不可用");
    });
    it("读取期间替换inode拒绝，写入同步失败不更改源字节", () => {
        const { source, file, root } = fixture();
        const original = source.readRaw();
        const originalOpen = fs.openSync;
        const opened = vi
            .spyOn(fs, "openSync")
            .mockImplementationOnce((...args: Parameters<typeof fs.openSync>) => {
                fs.renameSync(file, path.join(root, "old"));
                fs.writeFileSync(file, "external: true\n");
                return originalOpen(...args);
            });
        expect(() => source.readRaw()).toThrow("不可用");
        opened.mockRestore();
        fs.writeFileSync(file, original.bytes);
        const sync = vi.spyOn(fs, "fsyncSync").mockImplementationOnce(() => {
            throw new Error("private-secret");
        });
        expect(() => source.replaceRaw(original.revision, Buffer.from("new: value\n"))).toThrow(
            "写入未确认",
        );
        sync.mockRestore();
        expect(fs.readFileSync(file).equals(original.bytes)).toBe(true);
        expect(fs.readdirSync(root).filter(name => name.endsWith(".tmp"))).toEqual([]);
    });
    it("读写保留账号字符串键与私有字段，原子替换使用私有权限", () => {
        const { root, file, source } = fixture();
        const before = source.read();
        const next = source.replace(before.revision, { ...before.document, log_level: "debug" });
        expect(next.revision).not.toBe(before.revision);
        expect(source.read()).toEqual(next);
        expect(next.document["mock.001.a"]).toEqual({ token: "private-token" });
        expect(fs.statSync(file).mode & 0o777).toBe(0o600);
        expect(fs.readdirSync(root)).toEqual(["config.yaml"]);
    });
    it("拒绝旧编辑和旧回退覆盖外部修改", () => {
        const { file, source } = fixture();
        const before = source.read();
        const next = source.replace(before.revision, { ...before.document, log_level: "trace" });
        fs.writeFileSync(file, "log_level: error\n");
        expect(() => source.replace(next.revision, before.document)).toThrow(
            ConfigurationConflictError,
        );
        expect(() => source.replace(before.revision, before.document)).toThrow(
            ConfigurationConflictError,
        );
        expect(source.read().document).toEqual({ log_level: "error" });
    });
    it("拒绝符号链接或损坏 YAML，不回显秘密片段", () => {
        const { file, root, source } = fixture();
        fs.writeFileSync(file, "private-token: [\n");
        expect(() => source.read()).toThrow("运行配置无法读取或解析");
        const other = path.join(root, "external");
        fs.renameSync(file, other);
        fs.symlinkSync(other, file);
        expect(() => source.read()).toThrow("运行配置文件不可用");
        expect(fs.readFileSync(other, "utf8")).toBe("private-token: [\n");
    });
});
