import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { createHash } from "node:crypto";
import { afterEach, expect, it } from "vitest";
import { ControlAuth } from "./auth.js";

const directories: string[] = [];
afterEach(() =>
    directories
        .splice(0)
        .forEach(directory => fs.rmSync(directory, { recursive: true, force: true })),
);
function fixture() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ob-device-auth-"));
    directories.push(directory);
    const statePath = path.join(directory, "auth.json");
    let time = 1_000_000;
    const options = { statePath, now: () => time };
    return {
        auth: new ControlAuth(options),
        reopen: () => new ControlAuth(options),
        advance: (duration = 60_001) => {
            time += duration;
        },
        statePath,
    };
}
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

it("追加设备保留既有会话，重启仍有效，列表不暴露凭据", () => {
    const f = fixture();
    expect(() => f.auth.issueDevice()).toThrow();
    const first = f.auth.pair(f.auth.issueBootstrap());
    const code = f.auth.issueDevice();
    const second = f.reopen().pair(code);
    expect(f.auth.verify(first)).toBe(true);
    expect(f.auth.verify(second)).toBe(true);
    const sessions = f.auth.sessions(first);
    expect(sessions).toHaveLength(2);
    expect(sessions.map(session => session.current)).toEqual([true, false]);
    expect(JSON.stringify(sessions)).not.toContain(hash(first));
    expect(JSON.stringify(sessions)).not.toContain(second);
    expect(() => f.auth.pair(code)).toThrow();
    expect(() => f.auth.sessions("invalid")).toThrow();
});

it("按安全 ID 撤销指定设备及自身，返回 hash 供清理 MCP", () => {
    const f = fixture();
    const first = f.auth.pair(f.auth.issueBootstrap());
    const second = f.auth.pair(f.auth.issueDevice());
    const [current, other] = f.auth.sessions(first);
    expect(f.auth.revokeSession(first, other.id)).toBe(hash(second));
    expect(f.reopen().verify(second)).toBe(false);
    expect(f.auth.verify(first)).toBe(true);
    expect(f.auth.revokeSession(first, other.id)).toBeNull();
    expect(() => f.auth.revokeSession(second, current.id)).toThrow();
    expect(f.auth.revokeSession(first, current.id)).toBe(hash(first));
    expect(f.auth.verify(first)).toBe(false);
    expect(() => f.auth.issueBootstrap()).toThrow();
});

it("恢复码兑换替换所有设备并消费未兑换追加设备码", () => {
    const f = fixture();
    const first = f.auth.pair(f.auth.issueBootstrap());
    const second = f.auth.pair(f.auth.issueDevice());
    const device = f.auth.issueDevice();
    const recovery = f.auth.issueRecovery();
    const result = f.auth.pairWithRevocations(recovery);
    expect(result.revoked).toEqual([hash(first), hash(second)]);
    expect(f.auth.verify(first)).toBe(false);
    expect(f.auth.verify(second)).toBe(false);
    expect(f.auth.sessions(result.token)).toHaveLength(1);
    expect(() => f.auth.pair(device)).toThrow();
});

it("追加设备不撤销待用恢复码，登出只撤销自己", () => {
    const f = fixture();
    const first = f.auth.pair(f.auth.issueBootstrap());
    const recovery = f.auth.issueRecovery();
    const second = f.auth.pair(f.auth.issueDevice());
    f.auth.revoke(first);
    expect(f.auth.verify(second)).toBe(true);
    expect(f.auth.verify(f.auth.pair(recovery))).toBe(true);
    expect(f.auth.verify(second)).toBe(false);
});

it("追加设备码五分钟过期，签发及兑换共用限流", () => {
    const f = fixture();
    f.auth.pair(f.auth.issueBootstrap());
    const code = f.auth.issueDevice();
    f.advance(300_000);
    expect(() => f.auth.pair(code)).toThrow();
    let fresh = "";
    for (let i = 0; i < 5; i++) fresh = i % 2 ? f.auth.issueRecovery() : f.auth.issueDevice();
    expect(() => f.auth.issueDevice()).toThrow();
    for (let i = 0; i < 4; i++) expect(() => f.auth.pair("wrong")).toThrow();
    expect(() => f.reopen().pair(fresh)).toThrow();
});

it("最多 16 会话，清理过期设备后可追加且不延长存活会话", () => {
    const f = fixture();
    const first = f.auth.pair(f.auth.issueBootstrap());
    let latest = first;
    for (let i = 0; i < 15; i++) {
        f.advance();
        latest = f.auth.pair(f.auth.issueDevice());
    }
    expect(f.auth.sessions(latest)).toHaveLength(16);
    f.advance();
    const code = f.auth.issueDevice();
    expect(() => f.auth.pair(code)).toThrow("上限");
    f.advance(30 * 24 * 60 * 60 * 1000 - 16 * 60_001);
    const replacement = f.auth.pairWithRevocations(f.auth.issueDevice());
    expect(replacement.revoked).toEqual([hash(first)]);
    expect(f.auth.sessions(replacement.token)).toHaveLength(16);
    expect(f.auth.verify(latest)).toBe(true);
    expect(f.auth.verify(first)).toBe(false);
});

it("迁移旧有效会话不延长到期，安全 ID 跨重启稳定", () => {
    const f = fixture();
    const token = f.auth.pair(f.auth.issueBootstrap());
    const state = JSON.parse(fs.readFileSync(f.statePath, "utf8"));
    const session = state.sessions[0];
    state.version = 1;
    state.sessionHash = session.hash;
    state.sessionLifetime = { issuedAt: session.issuedAt, expiresAt: session.expiresAt };
    delete state.sessions;
    delete state.device;
    fs.writeFileSync(f.statePath, JSON.stringify(state));
    const before = f.auth.sessions(token);
    expect(f.reopen().sessions(token)).toEqual(before);
    f.auth.pair(f.auth.issueDevice());
    expect(f.reopen().sessions(token)[0]).toEqual(before[0]);
    f.advance(30 * 24 * 60 * 60 * 1000);
    expect(f.reopen().verify(token)).toBe(false);
});

it("损坏或重复会话记录拒绝读取，不允许退回单会话字段", () => {
    const f = fixture();
    f.auth.pair(f.auth.issueBootstrap());
    const state = JSON.parse(fs.readFileSync(f.statePath, "utf8"));
    const valid = state.sessions[0];
    for (const sessions of [
        Array(17).fill(valid),
        [valid, valid],
        [{ ...valid, id: "invalid" }],
        [{ ...valid, hash: "invalid" }],
        [{ ...valid, expiresAt: valid.expiresAt + 1 }],
    ]) {
        fs.writeFileSync(f.statePath, JSON.stringify({ ...state, sessions }));
        expect(() => f.reopen()).toThrow("控制认证失败");
    }
    fs.writeFileSync(f.statePath, JSON.stringify({ ...state, sessionHash: valid.hash }));
    expect(() => f.reopen()).toThrow("控制认证失败");
});

it("旧损坏未配对状态和混合代际字段不能通过迁移重新开放 bootstrap", () => {
    const f = fixture();
    f.auth.pair(f.auth.issueBootstrap());
    const current = JSON.parse(fs.readFileSync(f.statePath, "utf8"));
    const session = current.sessions[0];
    const legacy = {
        ...current,
        version: 1,
        sessionHash: session.hash,
        sessionLifetime: { issuedAt: session.issuedAt, expiresAt: session.expiresAt },
    };
    delete legacy.sessions;
    delete legacy.device;
    for (const input of [
        { ...legacy, paired: false, sessionLifetime: null },
        { ...legacy, paired: false, sessionLifetime: undefined },
        { ...legacy, sessions: [] },
        { ...legacy, device: null },
    ]) {
        const raw = JSON.stringify(input);
        fs.writeFileSync(f.statePath, raw);
        expect(() => f.reopen()).toThrow("控制认证失败");
        expect(() => f.auth.issueBootstrap()).toThrow("控制认证失败");
        expect(fs.readFileSync(f.statePath, "utf8")).toBe(raw);
    }
});
