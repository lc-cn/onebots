import * as fs from "node:fs";
import { randomBytes } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { ControlAuth } from "./auth.js";
vi.mock("node:fs", async original => {
    const module = await original<typeof import("node:fs")>();
    return { ...module, renameSync: vi.fn(module.renameSync) };
});
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
const code = () => randomBytes(32).toString("base64url");
function fixture(paired = true) {
    const root = fs.mkdtempSync("/tmp/ob-deployment-recover-");
    roots.push(root);
    let time = 1_000_000;
    const statePath = `${root}/auth.json`;
    const restart = () => new ControlAuth({ statePath, now: () => time });
    const auth = restart();
    const token = paired ? auth.pair(auth.issueBootstrap()) : "";
    return {
        auth,
        token,
        restart,
        statePath,
        raw: () => fs.readFileSync(statePath, "utf8"),
        advance: (ms = 300_001) => {
            time += ms;
        },
    };
}
it("仅显式恢复已配对部署，旧会话直到兑换成功才撤销，重启不可复用", () => {
    const f = fixture();
    const recovery = code();
    f.auth.installDeploymentRecovery(recovery);
    expect(f.auth.verify(f.token)).toBe(true);
    expect(f.raw()).not.toContain(recovery);
    const before = f.raw();
    f.restart().installDeploymentRecovery(recovery);
    expect(f.raw()).toBe(before);
    const next = f.restart().pair(recovery);
    expect(f.restart().verify(f.token)).toBe(false);
    expect(f.restart().verify(next)).toBe(true);
    f.restart().installDeploymentRecovery(recovery);
    expect(() => f.restart().pair(recovery)).toThrow("控制认证失败");
});
it("未配对和非规范码均拒绝且不写状态", () => {
    const f = fixture(false);
    for (const invalid of ["weak", "A".repeat(42), `${"A".repeat(42)}B`, `${code()}=`, code()])
        expect(() => f.auth.installDeploymentRecovery(invalid)).toThrow("控制认证失败");
    expect(fs.existsSync(f.statePath)).toBe(false);
});
it("过期不能通过相同环境码续期，新部署码可替换旧部署challenge", () => {
    const f = fixture();
    const old = code();
    const next = code();
    f.auth.installDeploymentRecovery(old);
    f.advance();
    const expired = f.raw();
    f.restart().installDeploymentRecovery(old);
    expect(f.raw()).toBe(expired);
    expect(() => f.restart().pair(old)).toThrow();
    f.restart().installDeploymentRecovery(next);
    f.restart().installDeploymentRecovery(old);
    expect(() => f.restart().pair(old)).toThrow();
    expect(f.restart().verify(f.restart().pair(next))).toBe(true);
});
it("老state兼容且部署轮换不覆盖本地恢复码", () => {
    const f = fixture();
    const local = f.auth.issueRecovery();
    const state = JSON.parse(f.raw());
    delete state.deploymentRecovery;
    delete state.deploymentRecoveryHistory;
    fs.writeFileSync(f.statePath, JSON.stringify(state));
    for (let index = 0; index < 2; index++) f.restart().installDeploymentRecovery(code());
    expect(f.restart().verify(f.restart().pair(local))).toBe(true);
});
it("部署发码和重启不能重置兑换限流", () => {
    const f = fixture();
    for (let index = 0; index < 4; index++) expect(() => f.auth.pair("wrong")).toThrow();
    const recovery = code();
    f.auth.installDeploymentRecovery(recovery);
    expect(() => f.restart().pair(recovery)).toThrow(); // bootstrap兑换已使用本窗口一次
    f.advance(60_001);
    expect(f.restart().verify(f.restart().pair(recovery))).toBe(true);
});
it("bootstrap和recovery历史交叉拒绝码复用", () => {
    const f = fixture(false);
    const bootstrap = code();
    f.auth.installDeploymentBootstrap(bootstrap);
    f.auth.pair(bootstrap);
    expect(() => f.auth.installDeploymentRecovery(bootstrap)).toThrow("控制认证失败");
    const recovery = code();
    f.auth.installDeploymentRecovery(recovery);
    expect(() => f.auth.installDeploymentBootstrap(recovery)).toThrow("控制认证失败");
});
it("两组历史均16条时状态仍低于读取上限并保留本地恢复能力", () => {
    const f = fixture(false);
    let bootstrap = "";
    for (let index = 0; index < 16; index++) {
        bootstrap = code();
        f.restart().installDeploymentBootstrap(bootstrap);
    }
    f.restart().pair(bootstrap);
    const local = f.restart().issueRecovery();
    for (let index = 0; index < 16; index++) f.restart().installDeploymentRecovery(code());
    const before = f.raw();
    expect(Buffer.byteLength(before)).toBeLessThanOrEqual(4096);
    expect(() => f.restart().installDeploymentRecovery(code())).toThrow("请通过本机控制入口处理");
    expect(f.raw()).toBe(before);
    expect(f.restart().verify(f.restart().pair(local))).toBe(true);
});
it.each([1, 2])("第%d次发布写入结果未知时阻断当前实例，冷启动不再发布相同码", stage => {
    const f = fixture();
    const recovery = code();
    const original = vi.mocked(fs.renameSync).getMockImplementation()!;
    let writes = 0;
    vi.mocked(fs.renameSync).mockImplementation((from, to) => {
        original(from, to);
        if (++writes === stage) throw new Error("private-write-error");
    });
    expect(() => f.auth.installDeploymentRecovery(recovery)).toThrow("控制认证失败");
    expect(() => f.auth.verify(f.token)).toThrow("控制认证失败");
    vi.mocked(fs.renameSync).mockImplementation(original);
    const before = f.raw();
    f.restart().installDeploymentRecovery(recovery);
    expect(f.raw()).toBe(before);
    if (stage === 1) expect(() => f.restart().pair(recovery)).toThrow();
    else expect(f.restart().verify(f.restart().pair(recovery))).toBe(true); // 已发布的原challenge可兑换，但不重发
});
it("部署恢复不重置本地发码限流", () => {
    const f = fixture();
    for (let index = 0; index < 4; index++) f.auth.issueRecovery();
    f.auth.installDeploymentRecovery(code());
    expect(() => f.restart().issueRecovery()).toThrow("控制认证失败");
});
it("损坏恢复历史和超大状态固定拒绝而非重置配对", () => {
    const f = fixture();
    f.auth.installDeploymentRecovery(code());
    const state = JSON.parse(f.raw());
    for (const history of [
        ["invalid"],
        Array(17).fill("0".repeat(64)),
        [state.deploymentRecoveryHistory[0], state.deploymentRecoveryHistory[0]],
    ]) {
        fs.writeFileSync(
            f.statePath,
            JSON.stringify({ ...state, deploymentRecoveryHistory: history }),
        );
        expect(() => f.restart()).toThrow("控制认证失败");
    }
    fs.writeFileSync(f.statePath, JSON.stringify(state) + " ".repeat(4096));
    expect(() => f.restart()).toThrow("控制认证失败");
});

it("有效本地恢复码优先，过期后只有新部署码可替换，已消费部署码不复活", () => {
    const f = fixture();
    const local = f.auth.issueRecovery();
    const consumed = code();
    f.auth.installDeploymentRecovery(consumed);
    const before = f.raw();
    f.advance();
    f.restart().installDeploymentRecovery(consumed);
    expect(f.raw()).toBe(before);
    expect(() => f.restart().pair(consumed)).toThrow();
    expect(() => f.restart().pair(local)).toThrow();
    const fresh = code();
    f.restart().installDeploymentRecovery(fresh);
    expect(f.restart().verify(f.restart().pair(fresh))).toBe(true);
});
