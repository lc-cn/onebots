import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import { afterEach, expect, it } from "vitest";
import { openGatewayLog, readGatewayLog } from "./gateway-log.js";
const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const workspace = fs.mkdtempSync(path.join(tmpdir(), "ob-gateway-log-"));
    roots.push(workspace);
    const control = path.join(workspace, ".control");
    fs.mkdirSync(control, { mode: 0o700 });
    return { workspace, control, file: path.join(control, "gateway.log") };
}
it("没有日志时不创建文件，写入后可有界读取且不修改内容", () => {
    const f = fixture();
    expect(readGatewayLog(f.workspace)).toEqual({
        source: "gateway",
        text: "",
        truncated: false,
        exists: false,
    });
    expect(fs.existsSync(f.file)).toBe(false);
    const writer = openGatewayLog(f.workspace);
    fs.writeSync(writer.fd, "启动失败\n");
    writer.close();
    expect(readGatewayLog(f.workspace)).toEqual({
        source: "gateway",
        text: "启动失败\n",
        truncated: false,
        exists: true,
    });
    expect(fs.readFileSync(f.file, "utf8")).toBe("启动失败\n");
});
it("大日志仅取末尾64KiB，不从UTF8续字节开始", () => {
    const f = fixture();
    fs.writeFileSync(f.file, "中".repeat(40000) + "末尾\n", { mode: 0o600 });
    const result = readGatewayLog(f.workspace);
    expect(result.truncated).toBe(true);
    expect(Buffer.byteLength(result.text)).toBeLessThanOrEqual(65536);
    expect(result.text.endsWith("末尾\n")).toBe(true);
    expect(result.text).not.toContain("�");
});
it("拒绝符号链接和硬链接日志，不修改其指向的文件", () => {
    const f = fixture();
    const secret = path.join(f.workspace, "secret");
    fs.writeFileSync(secret, "private", { mode: 0o600 });
    for (const make of [() => fs.symlinkSync(secret, f.file), () => fs.linkSync(secret, f.file)]) {
        make();
        expect(() => readGatewayLog(f.workspace)).toThrow();
        expect(() => openGatewayLog(f.workspace)).toThrow();
        expect(fs.readFileSync(secret, "utf8")).toBe("private");
        fs.unlinkSync(f.file);
    }
});
it.skipIf(process.platform === "win32")("拒绝公开权限日志，不擅自chmod原文件", () => {
    const f = fixture();
    fs.writeFileSync(f.file, "private", { mode: 0o644 });
    expect(() => readGatewayLog(f.workspace)).toThrow();
    expect(() => openGatewayLog(f.workspace)).toThrow();
    expect(fs.statSync(f.file).mode & 0o777).toBe(0o644);
});
it("控制目录重定向后拒绝读写，日志正文不泄漏到错误", () => {
    const f = fixture();
    const alternate = path.join(f.workspace, "other");
    fs.renameSync(f.control, alternate);
    fs.symlinkSync(alternate, f.control);
    fs.writeFileSync(path.join(alternate, "gateway.log"), "secret-content", { mode: 0o600 });
    expect(() => readGatewayLog(f.workspace)).toThrow("网关日志");
    expect(() => openGatewayLog(f.workspace)).toThrow();
});
