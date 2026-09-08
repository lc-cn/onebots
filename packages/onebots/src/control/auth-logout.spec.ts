import * as fs from "node:fs";
import { createHash } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { ControlAuth } from "./auth.js";
import { handleControlAuth } from "./auth-api.js";
vi.mock("node:fs", async original => {
    const module = await original<typeof import("node:fs")>();
    return { ...module, renameSync: vi.fn(module.renameSync) };
});
const directories: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const path of directories.splice(0)) fs.rmSync(path, { recursive: true, force: true });
});
function fixture() {
    const directory = fs.mkdtempSync("/tmp/ob-logout-");
    directories.push(directory);
    const auth = new ControlAuth({ statePath: `${directory}/auth.json` });
    const token = auth.pair(auth.issueBootstrap());
    const revoked = vi.fn();
    const input = {
        pathname: "/api/control/auth/logout",
        request: { method: "POST", headers: { authorization: `Bearer ${token}` } },
        local: false,
        auth,
        body: async () => ({}),
        revoked,
    };
    return { auth, token, input, revoked };
}
it("撤销成功持久化并清理该会话的 MCP 资源", async () => {
    const f = fixture();
    expect(await handleControlAuth(f.input)).toEqual({ status: 200, body: { loggedOut: true } });
    expect(f.auth.verify(f.token)).toBe(false);
    expect(f.revoked).toHaveBeenCalledExactlyOnceWith(
        createHash("sha256").update(f.token).digest("hex"),
    );
});
it.each([false, true])("本地权限不绕过当前 Bearer 会话要求 local=%s", async local => {
    const f = fixture();
    for (const authorization of [undefined, f.token, "Bearer invalid"]) {
        expect(
            (
                await handleControlAuth({
                    ...f.input,
                    local,
                    request: { method: "POST", headers: { authorization } },
                })
            )?.status,
        ).toBe(401);
        expect(f.auth.verify(f.token)).toBe(true);
    }
});
it("无效 body 不撤销有效会话", async () => {
    const f = fixture();
    expect(
        (await handleControlAuth({ ...f.input, body: async () => ({ token: f.token }) }))?.status,
    ).toBe(400);
    expect(f.auth.verify(f.token)).toBe(true);
});
it("读取 body 后重新认证，旧请求不撤销新会话", async () => {
    const f = fixture();
    let next = "";
    expect(
        (
            await handleControlAuth({
                ...f.input,
                body: async () => {
                    next = f.auth.pair(f.auth.issueRecovery());
                    return {};
                },
            })
        )?.status,
    ).toBe(401);
    expect(f.auth.verify(next)).toBe(true);
    expect(f.revoked).not.toHaveBeenCalled();
});
it("磁盘撤销失败不宣称成功且不泄漏错误", async () => {
    const f = fixture();
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
        throw new Error("private-path-token");
    });
    const result = await handleControlAuth(f.input);
    expect(result?.status).toBe(503);
    expect(JSON.stringify(result)).not.toContain("private-path-token");
    expect(f.auth.verify(f.token)).toBe(true);
    expect(f.revoked).not.toHaveBeenCalled();
});
