import fs from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { ControlAuth } from "./auth.js";
import { handleControlAuth } from "./auth-api.js";
const directories: string[] = [];
afterEach(() => { vi.restoreAllMocks(); for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture() {
    const dir = fs.mkdtempSync("/tmp/ob-session-api-"); directories.push(dir);
    const auth = new ControlAuth({ statePath: `${dir}/auth.json` });
    const first = auth.pair(auth.issueBootstrap());
    const second = auth.pair(auth.issueDevice());
    const id = auth.sessions(first).find(session => !session.current)!.id;
    const revoked = vi.fn();
    const input = {
        pathname: "/api/control/auth/sessions/revoke", local: false, auth,
        request: { method: "POST", headers: { authorization: `Bearer ${first}` } },
        body: async () => ({ id }), revoked,
    };
    return { auth, first, second, id, revoked, input };
}
it("撤销目标仅清理其 MCP owner，重复请求幂等", async () => {
    const f = fixture();
    expect(await handleControlAuth(f.input)).toEqual({ status: 200, body: { revoked: true } });
    expect(f.revoked).toHaveBeenCalledExactlyOnceWith(createHash("sha256").update(f.second).digest("hex"));
    expect(f.auth.verify(f.first)).toBe(true);
    expect(f.auth.verify(f.second)).toBe(false);
    expect(await handleControlAuth(f.input)).toEqual({ status: 200, body: { revoked: true } });
    expect(f.revoked).toHaveBeenCalledTimes(1);
});
it("读取 body 后重新验证调用者，旧请求不能撤销新授权", async () => {
    const f = fixture();
    expect((await handleControlAuth({ ...f.input, body: async () => {
        f.auth.revoke(f.first); return { id: f.id };
    } }))?.status).toBe(401);
    expect(f.auth.verify(f.second)).toBe(true);
    expect(f.revoked).not.toHaveBeenCalled();
});
it("撤销写入失败不返回成功或清理 MCP", async () => {
    const f = fixture();
    vi.spyOn(f.auth, "revokeSession").mockImplementation(() => { throw new Error("secret"); });
    const result = await handleControlAuth(f.input);
    expect(result?.status).toBe(503);
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(f.revoked).not.toHaveBeenCalled();
});
it("恢复兑换持久成功后清理全部旧 owner", async () => {
    const f = fixture();
    const code = f.auth.issueRecovery();
    expect((await handleControlAuth({ ...f.input, pathname: "/api/control/auth/pair",
        body: async () => ({ code }),
    }))?.status).toBe(200);
    expect(f.revoked.mock.calls.map(([owner]) => owner).sort()).toEqual(
        [f.first, f.second].map(token => createHash("sha256").update(token).digest("hex")).sort(),
    );
});
