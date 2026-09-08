import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigurationFile } from "./configuration-file.js";
import { ConfigurationConflictError } from "./configuration-store.js";

const roots: string[] = [];
afterEach(() => {
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
        expect(() => source.read()).toThrow("运行配置无法读取或解析");
        expect(fs.readFileSync(other, "utf8")).toBe("private-token: [\n");
    });
});
