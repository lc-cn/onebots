import * as fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { ControlAuth } from "./auth.js";
import {
    planAuthenticationBinding,
    applyAuthenticationBinding,
    verifyAuthenticationBinding,
} from "./auth-binding.js";
import type { AuthenticationBindingContext } from "./auth-binding-context.js";
import { authenticationBytes, authenticationDigest } from "./auth-binding-file.js";

vi.mock("node:fs", async importOriginal => {
    const original = await importOriginal<typeof import("node:fs")>();
    return { ...original, renameSync: vi.fn(original.renameSync) };
});

const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-auth-binding-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, ".control"), { mode: 0o700 });
    const statePath = path.join(root, ".control", "auth.json");
    const context: AuthenticationBindingContext = {
        authorityId: randomUUID(),
        workspaceId: randomUUID(),
        bindingRevision: 1,
        operationId: randomUUID(),
    };
    let time = Date.now();
    return {
        root,
        statePath,
        context,
        now: () => time,
        strict: () => new ControlAuth({ statePath, bindingContext: context, now: () => time }),
        advance: (duration: number) => {
            time += duration;
        },
    };
}

it("登记只读计划保留策略和已消费部署码历史，显式应用后撤销全部旧会话与挑战", () => {
    const f = fixture();
    const legacy = new ControlAuth({ statePath: f.statePath, now: f.now });
    const deployment = randomBytes(32).toString("base64url");
    legacy.installDeploymentBootstrap(deployment);
    const oldToken = legacy.pair(deployment);
    legacy.setSessionPolicy(oldToken, { durationDays: 90, autoRenew: false });
    const deploymentRecovery = randomBytes(32).toString("base64url");
    legacy.installDeploymentRecovery(deploymentRecovery);
    const recovery = legacy.issueRecovery();
    const device = legacy.issueDevice();
    const before = fs.readFileSync(f.statePath, "utf8");
    const plan = planAuthenticationBinding(f.root, f.context);
    expect(fs.readFileSync(f.statePath, "utf8")).toBe(before);
    expect(JSON.stringify(plan)).not.toContain(oldToken);
    expect(JSON.stringify(plan)).not.toContain(deploymentRecovery);
    applyAuthenticationBinding(f.root, plan);
    const state = JSON.parse(fs.readFileSync(f.statePath, "utf8"));
    const previous = JSON.parse(before);
    expect(state).toMatchObject({
        version: 3,
        paired: true,
        bindingContext: f.context,
        sessions: [],
        bootstrap: null,
        recovery: null,
        device: null,
        deploymentBootstrap: null,
        deploymentRecovery: null,
        deploymentBootstrapHistory: previous.deploymentBootstrapHistory,
        deploymentRecoveryHistory: previous.deploymentRecoveryHistory,
        sessionPolicy: previous.sessionPolicy,
        issuance: previous.issuance,
        attempts: previous.attempts,
    });
    expect(verifyAuthenticationBinding(f.root, f.context)).toBe(true);
    const auth = f.strict();
    expect(auth.verify(oldToken)).toBe(false);
    expect(() => legacy.verify(oldToken)).toThrow();
    for (const code of [recovery, device, deploymentRecovery])
        expect(() => auth.pair(code)).toThrow();
    auth.installDeploymentRecovery(deploymentRecovery);
    expect(() => auth.pair(deploymentRecovery)).toThrow();
    f.advance(60_001);
    const next = auth.pair(auth.issueRecovery());
    expect(auth.verify(next)).toBe(true);
    expect(auth.verify(oldToken)).toBe(false);
    expect(verifyAuthenticationBinding(f.root, f.context)).toBe(true);
    const paired = fs.readFileSync(f.statePath, "utf8");
    expect(() => applyAuthenticationBinding(f.root, plan)).toThrow();
    expect(fs.readFileSync(f.statePath, "utf8")).toBe(paired);
});

it("strict 模式缺文件不自建，不接受旧格式或错误上下文，legacy模式不接纳v3", () => {
    const f = fixture();
    expect(() => f.strict()).toThrow("控制认证失败");
    expect(fs.readdirSync(path.dirname(f.statePath))).toEqual([]);
    const legacy = new ControlAuth({ statePath: f.statePath, now: f.now });
    legacy.issueBootstrap();
    expect(() => f.strict()).toThrow("控制认证失败");
    const plan = planAuthenticationBinding(f.root, f.context);
    applyAuthenticationBinding(f.root, plan);
    expect(() => new ControlAuth({ statePath: f.statePath, now: f.now })).toThrow("控制认证失败");
    expect(
        () =>
            new ControlAuth({
                statePath: f.statePath,
                bindingContext: { ...f.context, operationId: randomUUID() },
            }),
    ).toThrow();
    expect(verifyAuthenticationBinding(f.root, { ...f.context, workspaceId: randomUUID() })).toBe(
        false,
    );
    expect(() => planAuthenticationBinding(f.root, { ...f.context, bindingRevision: 2 })).toThrow();
});

it("全新认证计划不写文件，同一目标可续办；正规配对后只检查登记上下文", () => {
    const f = fixture();
    const plan = planAuthenticationBinding(f.root, f.context);
    expect(plan.previousDigest).toBeNull();
    expect(fs.readdirSync(path.dirname(f.statePath))).toEqual([]);
    applyAuthenticationBinding(f.root, plan);
    const before = fs.readFileSync(f.statePath, "utf8");
    applyAuthenticationBinding(f.root, JSON.parse(JSON.stringify(plan)));
    expect(fs.readFileSync(f.statePath, "utf8")).toBe(before);
    const auth = f.strict();
    const token = auth.pair(auth.issueBootstrap());
    expect(f.strict().verify(token)).toBe(true);
    expect(verifyAuthenticationBinding(f.root, f.context)).toBe(true);
});

it("计划后出现第三态拒绝覆盖，不能通过重新计划重绑已登记认证", () => {
    const f = fixture();
    const legacy = new ControlAuth({ statePath: f.statePath, now: f.now });
    legacy.issueBootstrap();
    const plan = planAuthenticationBinding(f.root, f.context);
    legacy.issueBootstrap();
    const changed = fs.readFileSync(f.statePath, "utf8");
    expect(() => applyAuthenticationBinding(f.root, plan)).toThrow();
    expect(fs.readFileSync(f.statePath, "utf8")).toBe(changed);
});

it("rename后持久化失败不宣称完成；显式同目标续办再次建立屏障且不复活旧会话", () => {
    const f = fixture();
    const legacy = new ControlAuth({ statePath: f.statePath, now: f.now });
    const token = legacy.pair(legacy.issueBootstrap());
    const plan = planAuthenticationBinding(f.root, f.context);
    const original = fs.fsyncSync;
    let count = 0;
    const sync = vi.spyOn(fs, "fsyncSync").mockImplementation(fd => {
        if (++count === 2) throw new Error("injected directory flush failure");
        original(fd);
    });
    expect(() => applyAuthenticationBinding(f.root, plan)).toThrow();
    expect(f.strict().verify(token)).toBe(false);
    const bytes = fs.readFileSync(f.statePath, "utf8");
    sync.mockRestore();
    const resumed = vi.spyOn(fs, "fsyncSync");
    applyAuthenticationBinding(f.root, plan);
    expect(resumed).toHaveBeenCalledTimes(2);
    expect(fs.readFileSync(f.statePath, "utf8")).toBe(bytes);
    expect(f.strict().verify(token)).toBe(false);
});

it("损坏、混合代际字段、硬链接和读取中消失均不降级成空认证", () => {
    const f = fixture();
    fs.writeFileSync(f.statePath, "malformed-secret-state", { mode: 0o600 });
    expect(() => planAuthenticationBinding(f.root, f.context)).toThrow("控制认证登记状态无法确认");
    expect(fs.readFileSync(f.statePath, "utf8")).toBe("malformed-secret-state");
    fs.rmSync(f.statePath);
    const legacy = new ControlAuth({ statePath: f.statePath, now: f.now });
    legacy.issueBootstrap();
    const bytes = fs.readFileSync(f.statePath, "utf8");
    fs.writeFileSync(
        f.statePath,
        JSON.stringify({ ...JSON.parse(bytes), bindingContext: f.context }),
    );
    expect(() => planAuthenticationBinding(f.root, f.context)).toThrow();
    fs.writeFileSync(f.statePath, bytes);
    fs.linkSync(f.statePath, path.join(f.root, "linked-auth"));
    expect(() => planAuthenticationBinding(f.root, f.context)).toThrow();
    fs.rmSync(path.join(f.root, "linked-auth"));
    const original = fs.openSync;
    vi.spyOn(fs, "openSync").mockImplementation((file, flags, mode) => {
        if (file === f.statePath) throw Object.assign(new Error("disappeared"), { code: "ENOENT" });
        return original(file, flags, mode);
    });
    expect(() => planAuthenticationBinding(f.root, f.context)).toThrow();
    expect(fs.readFileSync(f.statePath, "utf8")).toBe(bytes);
});

it("目标摘要或目标会话被改写时拒绝应用", () => {
    const f = fixture();
    const plan = planAuthenticationBinding(f.root, f.context);
    expect(() =>
        applyAuthenticationBinding(f.root, { ...plan, targetDigest: "0".repeat(64) }),
    ).toThrow();
    const legacy = new ControlAuth({ statePath: f.statePath, now: f.now });
    legacy.pair(legacy.issueBootstrap());
    const oldState = JSON.parse(fs.readFileSync(f.statePath, "utf8"));
    const changed = planAuthenticationBinding(f.root, f.context);
    const targetState = { ...oldState, version: 3, bindingContext: f.context };
    expect(() =>
        applyAuthenticationBinding(f.root, {
            ...changed,
            targetState,
            targetDigest: authenticationDigest(authenticationBytes(targetState)),
        }),
    ).toThrow();
    expect(() => planAuthenticationBinding(f.root, { ...f.context, bindingRevision: 0 })).toThrow();
    expect(() =>
        planAuthenticationBinding(f.root, { ...f.context, authorityId: "untrusted" }),
    ).toThrow();
});

it("v1 只读解码后显式登记，不继承其仍有效的旧会话", () => {
    const f = fixture();
    const legacy = new ControlAuth({ statePath: f.statePath, now: f.now });
    const token = legacy.pair(legacy.issueBootstrap());
    const state = JSON.parse(fs.readFileSync(f.statePath, "utf8"));
    const session = state.sessions[0];
    state.version = 1;
    state.sessionHash = session.hash;
    state.sessionLifetime = { issuedAt: session.issuedAt, expiresAt: session.expiresAt };
    delete state.sessions;
    delete state.device;
    fs.writeFileSync(f.statePath, JSON.stringify(state));
    const bytes = fs.readFileSync(f.statePath, "utf8");
    expect(legacy.verify(token)).toBe(true);
    const plan = planAuthenticationBinding(f.root, f.context);
    expect(fs.readFileSync(f.statePath, "utf8")).toBe(bytes);
    applyAuthenticationBinding(f.root, plan);
    expect(f.strict().verify(token)).toBe(false);
});
