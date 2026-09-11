import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { waitForBrowserPort } from "../../scripts/browser-startup.mjs";

const directories = [];
afterEach(() => {
    for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true });
});
function fixture() {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), "browser-startup-"));
    directories.push(profile);
    const child = Object.assign(new EventEmitter(), {
        stderr: new PassThrough(), exitCode: null, signalCode: null,
    });
    return { profile, child };
}
describe("浏览器启动握手", () => {
    it("进程提前退出时立即报告原因，不等待通用超时", async () => {
        const { profile, child } = fixture();
        const ready = waitForBrowserPort(child, profile);
        child.stderr.write("Chrome startup failed");
        child.emit("close", 1, null);
        await expect(ready).rejects.toThrow("exit=1, signal=none）：Chrome startup failed");
        expect(child.listenerCount("close")).toBe(0);
        expect(child.stderr.listenerCount("data")).toBe(0);
    });
    it("不接受部分端口文件，完整握手后返回端口", async () => {
        const { profile, child } = fixture();
        fs.writeFileSync(path.join(profile, "DevToolsActivePort"), "42");
        const ready = waitForBrowserPort(child, profile, { interval: 5 });
        fs.writeFileSync(path.join(profile, "DevToolsActivePort"), "42000\n/devtools/browser/test\n");
        await expect(ready).resolves.toBe(42000);
        expect(child.listenerCount("error")).toBe(0);
    });
    it("区分进程创建失败和存活但未就绪的超时", async () => {
        const first = fixture();
        const ready = waitForBrowserPort(first.child, first.profile);
        first.child.emit("error", Object.assign(new Error("missing"), { code: "ENOENT" }));
        await expect(ready).rejects.toThrow("浏览器启动失败：ENOENT");
        const second = fixture();
        await expect(waitForBrowserPort(second.child, second.profile, { timeout: 10 }))
            .rejects.toThrow("浏览器调试端口启动超时（无启动输出）");
    });
});
