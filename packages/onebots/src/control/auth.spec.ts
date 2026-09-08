import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ControlAuth } from "./auth.js";

vi.mock("node:fs", async importOriginal => {
    const original = await importOriginal<typeof import("node:fs")>();
    return { ...original, renameSync: vi.fn(original.renameSync) };
});

const directories: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const directory of directories.splice(0)) {
        fs.rmSync(directory, { recursive: true, force: true });
    }
});

function fixture() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-control-auth-"));
    directories.push(directory);
    const statePath = path.join(directory, "private", "auth.json");
    let time = 1_000_000;
    const options = { statePath, now: () => time };
    return {
        statePath,
        auth: new ControlAuth(options),
        reopen: () => new ControlAuth(options),
        advance: (duration: number) => {
            time += duration;
        },
    };
}

describe("control auth", () => {
    it("配对只持久化摘要，重启后有效且配对码不能重放", () => {
        const { auth, statePath, reopen } = fixture();
        const code = auth.issueBootstrap();
        expect(code.length).toBeGreaterThanOrEqual(32);
        expect(fs.readFileSync(statePath, "utf8")).not.toContain(code);
        const token = reopen().pair(code);
        expect(token.length).toBeGreaterThanOrEqual(43);
        expect(reopen().verify(token)).toBe(true);
        expect(reopen().verify("incorrect")).toBe(false);
        expect(fs.readFileSync(statePath, "utf8")).not.toContain(token);
        expect(() => reopen().pair(code)).toThrow("控制认证失败");
        expect(() => reopen().issueBootstrap()).toThrow("控制认证失败");
        expect(fs.readdirSync(path.dirname(statePath))).toEqual(["auth.json"]);
        if (process.platform !== "win32") {
            expect(fs.statSync(statePath).mode & 0o777).toBe(0o600);
            expect(fs.statSync(path.dirname(statePath)).mode & 0o777).toBe(0o700);
        }
    });

    it("第 5 分钟立即过期，新码替代旧码", () => {
        const { auth, advance } = fixture();
        const expired = auth.issueBootstrap();
        advance(300_000);
        expect(() => auth.pair(expired)).toThrow("控制认证失败");
        const old = auth.issueBootstrap();
        const current = auth.issueBootstrap();
        expect(() => auth.pair(old)).toThrow("控制认证失败");
        advance(299_999);
        expect(auth.verify(auth.pair(current))).toBe(true);
    });

    it("所有配对尝试共用有界持久限流，重新发码和重启不绕过限制", () => {
        const { auth, reopen, advance, statePath } = fixture();
        for (let attempt = 0; attempt < 5; attempt++) {
            expect(() => reopen().pair(`wrong-${attempt}`)).toThrow("控制认证失败");
        }
        const code = auth.issueBootstrap();
        const before = fs.readFileSync(statePath, "utf8");
        for (let attempt = 0; attempt < 20; attempt++) {
            expect(() => reopen().pair(code)).toThrow("控制认证失败");
        }
        expect(fs.readFileSync(statePath, "utf8")).toBe(before);
        advance(60_000);
        expect(reopen().verify(reopen().pair(code))).toBe(true);
    });

    it("撤销幂等且不能使已配对工作区重新开放配对", () => {
        const { auth, reopen } = fixture();
        const token = auth.pair(auth.issueBootstrap());
        auth.revoke("incorrect");
        expect(auth.verify(token)).toBe(true);
        reopen().revoke(token);
        expect(auth.verify(token)).toBe(false);
        auth.revoke(token);
        expect(() => auth.issueBootstrap()).toThrow("控制认证失败");
    });

    it("损坏或替换成符号链接的状态拒绝认证，不泄漏内容", () => {
        const { auth, statePath, reopen } = fixture();
        auth.issueBootstrap();
        fs.writeFileSync(statePath, "secret-corrupt-content");
        expect(() => reopen()).toThrow(/^控制认证失败$/);
        const target = `${statePath}.target`;
        fs.renameSync(statePath, target);
        fs.symlinkSync(target, statePath);
        expect(() => reopen()).toThrow(/^控制认证失败$/);
    });

    it("消费持久化失败不返回会话，不丢失原配对码", () => {
        const { auth, reopen, statePath } = fixture();
        const code = auth.issueBootstrap();
        const before = fs.readFileSync(statePath, "utf8");
        const rename = vi.spyOn(fs, "renameSync").mockImplementationOnce(() => {
            throw new Error("private filesystem details");
        });
        expect(() => auth.pair(code)).toThrow(/^控制认证失败$/);
        rename.mockRestore();
        expect(fs.readFileSync(statePath, "utf8")).toBe(before);
        expect(fs.readdirSync(path.dirname(statePath))).toEqual(["auth.json"]);
        const token = reopen().pair(code);
        expect(auth.verify(token)).toBe(true);
    });
});
