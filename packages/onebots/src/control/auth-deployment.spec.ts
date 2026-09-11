import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { ControlAuth } from "./auth.js";
import { consumeDeploymentAuthenticationEnvironment } from "./auth-deployment.js";
vi.mock("node:fs", async original => ({
    ...(await original<typeof import("node:fs")>()),
    renameSync: vi.fn((await original<typeof import("node:fs")>()).renameSync),
}));
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-deployment-auth-"));
    roots.push(root);
    let time = 1_000_000;
    const options = { statePath: path.join(root, "auth.json"), now: () => time };
    return {
        options,
        restart: () => new ControlAuth(options),
        advance: () => {
            time += 300_001;
        },
    };
}
it("environment is removed immediately, code is hash-only and pair is single use across restart", () => {
    const test = fixture(),
        code = randomBytes(32).toString("base64url");
    const env = { ONEBOTS_BOOTSTRAP_CODE: code, HF_TOKEN: "download-only" };
    const install = consumeDeploymentAuthenticationEnvironment(env)!;
    expect(env).toEqual({ HF_TOKEN: "download-only" });
    install(test.restart());
    expect(() => install(test.restart())).toThrow("控制认证失败");
    const raw = fs.readFileSync(test.options.statePath, "utf8");
    expect(raw).not.toContain(code);
    const token = test.restart().pair(code);
    const paired = fs.readFileSync(test.options.statePath, "utf8");
    test.restart().installDeploymentBootstrap(code);
    test.restart().installDeploymentBootstrap(randomBytes(32).toString("base64url"));
    expect(fs.readFileSync(test.options.statePath, "utf8")).toBe(paired);
    expect(test.restart().verify(token)).toBe(true);
    expect(() => test.restart().pair(code)).toThrow();
});
it("restart cannot extend expiration; fresh deployment code rotates without reviving history", () => {
    const test = fixture(),
        code = randomBytes(32).toString("base64url");
    test.restart().installDeploymentBootstrap(code);
    const before = fs.readFileSync(test.options.statePath, "utf8");
    test.advance();
    test.restart().installDeploymentBootstrap(code);
    expect(fs.readFileSync(test.options.statePath, "utf8")).toBe(before);
    expect(() => test.restart().pair(code)).toThrow();
    const next = randomBytes(32).toString("base64url");
    test.restart().installDeploymentBootstrap(next);
    const rotated = fs.readFileSync(test.options.statePath, "utf8");
    test.restart().installDeploymentBootstrap(code);
    expect(fs.readFileSync(test.options.statePath, "utf8")).toBe(rotated);
    expect(() => test.restart().pair(code)).toThrow();
    const token = test.restart().pair(next);
    expect(test.restart().verify(token)).toBe(true);
});
it("invalid deployment input is consumed from environment; HF_TOKEN is never accepted", () => {
    const test = fixture(),
        env = { ONEBOTS_BOOTSTRAP_CODE: "weak-secret" };
    const install = consumeDeploymentAuthenticationEnvironment(env)!;
    expect(env).toEqual({});
    expect(() => install(test.restart())).toThrow("控制认证失败");
    expect(fs.existsSync(test.options.statePath)).toBe(false);
    expect(
        consumeDeploymentAuthenticationEnvironment({
            HF_TOKEN: randomBytes(32).toString("base64url"),
        }),
    ).toBeUndefined();
});
it("publication uncertainty consumes deployment intent and blocks the current instance", () => {
    const test = fixture(),
        code = randomBytes(32).toString("base64url"),
        auth = test.restart();
    const original = fs.renameSync;
    vi.mocked(fs.renameSync).mockImplementationOnce((from, to) => {
        original(from, to);
        throw new Error("private-error");
    });
    expect(() => auth.installDeploymentBootstrap(code)).toThrow("控制认证失败");
    expect(() => auth.installDeploymentBootstrap(code)).toThrow("控制认证失败");
    expect(JSON.parse(fs.readFileSync(test.options.statePath, "utf8")).bootstrap).toBeNull();
    const cold = test.restart();
    cold.installDeploymentBootstrap(code);
    expect(() => cold.pair(code)).toThrow();
});
it("old state remains readable and an existing local challenge is not replaced", () => {
    const test = fixture(),
        auth = test.restart(),
        local = auth.issueBootstrap();
    const state = JSON.parse(fs.readFileSync(test.options.statePath, "utf8"));
    delete state.deploymentBootstrap;
    fs.writeFileSync(test.options.statePath, JSON.stringify(state));
    const code = randomBytes(32).toString("base64url");
    test.restart().installDeploymentBootstrap(code);
    expect(test.restart().verify(test.restart().pair(local))).toBe(true);
});

it("rotation history is bounded and local challenge is preserved across deployment rotations", () => {
    const test = fixture(),
        auth = test.restart(),
        local = auth.issueBootstrap();
    for (let index = 0; index < 16; index++)
        test.restart().installDeploymentBootstrap(randomBytes(32).toString("base64url"));
    const before = fs.readFileSync(test.options.statePath, "utf8");
    expect(() =>
        test.restart().installDeploymentBootstrap(randomBytes(32).toString("base64url")),
    ).toThrow("请通过本机控制入口处理");
    expect(fs.readFileSync(test.options.statePath, "utf8")).toBe(before);
    expect(test.restart().verify(test.restart().pair(local))).toBe(true);
});

it("恢复秘密与初始化秘密都立即清除，冲突不能隐式授权", () => {
    const test = fixture();
    const env = {
        ONEBOTS_BOOTSTRAP_CODE: randomBytes(32).toString("base64url"),
        ONEBOTS_RECOVERY_CODE: randomBytes(32).toString("base64url"),
    };
    const install = consumeDeploymentAuthenticationEnvironment(env)!;
    expect(env).toEqual({});
    expect(() => install(test.restart())).toThrow("控制认证失败");
    expect(() => install(test.restart())).toThrow("控制认证失败");
    expect(fs.existsSync(test.options.statePath)).toBe(false);
});
it("恢复秘密闭包仅可消费一次，不提前撤销当前会话", () => {
    const test = fixture();
    const auth = test.restart();
    const token = auth.pair(auth.issueBootstrap());
    const code = randomBytes(32).toString("base64url");
    const env = { ONEBOTS_RECOVERY_CODE: code };
    const install = consumeDeploymentAuthenticationEnvironment(env)!;
    expect(env).toEqual({});
    install(auth);
    expect(() => install(auth)).toThrow("控制认证失败");
    expect(auth.verify(token)).toBe(true);
    expect(auth.verify(auth.pair(code))).toBe(true);
    expect(auth.verify(token)).toBe(false);
});
