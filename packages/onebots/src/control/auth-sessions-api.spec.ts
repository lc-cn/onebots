import fs from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { ControlAuth } from "./auth.js";
import { handleControlAuth } from "./auth-api.js";
const directories: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});
function fixture() {
    const dir = fs.mkdtempSync("/tmp/ob-session-api-");
    directories.push(dir);
    const auth = new ControlAuth({ statePath: `${dir}/auth.json` });
    const first = auth.pair(auth.issueBootstrap());
    const second = auth.pair(auth.issueDevice());
    const id = auth.sessions(first).find(session => !session.current)!.id;
    const revoked = vi.fn();
    const input = {
        pathname: "/api/control/auth/sessions/revoke",
        local: false,
        auth,
        request: { method: "POST", headers: { authorization: `Bearer ${first}` } },
        body: async () => ({ id }),
        revoked,
    };
    return { auth, first, second, id, revoked, input };
}
it("撤销目标仅清理其 MCP owner，重复请求幂等", async () => {
    const f = fixture();
    expect(await handleControlAuth(f.input)).toEqual({ status: 200, body: { revoked: true } });
    expect(f.revoked).toHaveBeenCalledExactlyOnceWith(
        createHash("sha256").update(f.second).digest("hex"),
    );
    expect(f.auth.verify(f.first)).toBe(true);
    expect(f.auth.verify(f.second)).toBe(false);
    expect(await handleControlAuth(f.input)).toEqual({ status: 200, body: { revoked: true } });
    expect(f.revoked).toHaveBeenCalledTimes(1);
});
it("读取 body 后重新验证调用者，旧请求不能撤销新授权", async () => {
    const f = fixture();
    expect(
        (
            await handleControlAuth({
                ...f.input,
                body: async () => {
                    f.auth.revoke(f.first);
                    return { id: f.id };
                },
            })
        )?.status,
    ).toBe(401);
    expect(f.auth.verify(f.second)).toBe(true);
    expect(f.revoked).not.toHaveBeenCalled();
});
it("撤销写入失败不返回成功或清理 MCP", async () => {
    const f = fixture();
    vi.spyOn(f.auth, "revokeSession").mockImplementation(() => {
        throw new Error("secret");
    });
    const result = await handleControlAuth(f.input);
    expect(result?.status).toBe(503);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(f.revoked).not.toHaveBeenCalled();
});
it("恢复兑换持久成功后清理全部旧 owner", async () => {
    const f = fixture();
    const code = f.auth.issueRecovery();
    expect(
        (
            await handleControlAuth({
                ...f.input,
                pathname: "/api/control/auth/pair",
                body: async () => ({ code }),
            })
        )?.status,
    ).toBe(200);
    expect(f.revoked.mock.calls.map(([owner]) => owner).sort()).toEqual(
        [f.first, f.second].map(token => createHash("sha256").update(token).digest("hex")).sort(),
    );
});

it("已登录浏览器签发一次性设备码，匿名及带参数请求不得签发", async () => {
    const f = fixture();
    const pathname = "/api/control/auth/sessions/device";
    const anonymous = await handleControlAuth({
        ...f.input,
        pathname,
        request: { method: "POST", headers: {} },
        body: async () => ({}),
    });
    expect(anonymous?.status).toBe(401);
    const invalid = await handleControlAuth({
        ...f.input,
        pathname,
        body: async () => ({ duration: 999 }),
    });
    expect(invalid?.status).toBe(400);
    const result = await handleControlAuth({ ...f.input, pathname, body: async () => ({}) });
    expect(result?.status).toBe(200);
    const { code, expiresAt } = result?.body as { code: string; expiresAt: number };
    expect(expiresAt).toBeGreaterThan(Date.now());
    expect(expiresAt).toBeLessThanOrEqual(Date.now() + 300_000);
    const third = f.auth.pair(code);
    expect(f.auth.verify(f.first)).toBe(true);
    expect(f.auth.verify(third)).toBe(true);
    expect(() => f.auth.pair(code)).toThrow();
});

it("会话策略只由有效设备修改，续期响应不泄漏凭据", async () => {
    const f = fixture();
    const pathname = "/api/control/auth/sessions/policy";
    expect(
        await handleControlAuth({
            ...f.input,
            pathname,
            request: {
                method: "GET",
                headers: { authorization: `Bearer ${f.first}` },
            },
        }),
    ).toEqual({ status: 200, body: { durationDays: 30, autoRenew: true } });
    expect(
        (
            await handleControlAuth({
                ...f.input,
                pathname,
                body: async () => ({ durationDays: 999, autoRenew: true }),
            })
        )?.status,
    ).toBe(400);
    expect(
        (
            await handleControlAuth({
                ...f.input,
                pathname,
                body: async () => ({ durationDays: 365, autoRenew: true }),
            })
        )?.status,
    ).toBe(200);
    const renewal = await handleControlAuth({
        ...f.input,
        pathname: "/api/control/auth/sessions/renew",
        body: async () => ({}),
    });
    expect(renewal?.status).toBe(200);
    expect(JSON.stringify(renewal)).not.toContain(f.first);
    expect(
        f.auth.sessions(f.first)[0].expiresAt - f.auth.sessions(f.first)[0].issuedAt,
    ).toBeGreaterThanOrEqual(365 * 24 * 60 * 60 * 1000);
    f.auth.revoke(f.first);
    expect(
        (
            await handleControlAuth({
                ...f.input,
                pathname: "/api/control/auth/sessions/renew",
                body: async () => ({}),
            })
        )?.status,
    ).toBe(401);
});
