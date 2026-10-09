import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import { probeWindowsSnapshotAcl } from "../../scripts/windows-snapshot-acl-probe.mjs";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));
const roots: string[] = [];
afterEach(() => {
    vi.clearAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function root() {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "ob-acl-probe-"));
    roots.push(directory);
    return directory;
}
it("两种应用方式共用同一闭合策略，结果仅保留固定类别与数值", () => {
    vi.mocked(execFileSync)
        .mockReturnValueOnce(
            '{"ok":false,"category":"privilege","hresult":-2147023582,"secret":"private-value"}',
        )
        .mockReturnValueOnce('{"ok":true,"secret":"private-value"}')
        .mockReturnValueOnce('{"ok":false,"nativeError":1307,"secret":"private-value"}');
    expect(probeWindowsSnapshotAcl(root())).toEqual({
        cmdlet: { ok: false, category: "privilege", hresult: -2147023582 },
        dotnet: { ok: true },
        native: { ok: false, nativeError: 1307 },
    });
    const scripts = vi
        .mocked(execFileSync)
        .mock.calls.map(call => Buffer.from(String(call[1]?.[4]), "base64").toString("utf16le"));
    expect(scripts[0]).toContain("Set-Acl -LiteralPath $p -AclObject $acl");
    expect(scripts[1]).toContain("[IO.Directory]::SetAccessControl($p,$acl)");
    expect(scripts[2]).toContain("SetNamedSecurityInfoW(name,1,0x80000005u");
    expect(scripts[2]).not.toContain("AdjustTokenPrivileges");
    for (const script of scripts) {
        expect(script).toContain("$acl.SetOwner");
        expect(script).toContain("$owner -ne $ownerSid");
        expect(script).toContain("$rules.Count -ne $allowedSids.Count");
        expect(script).not.toContain("$failure.Message");
    }
});
it("未知类别与子进程原始错误不会进入公开诊断", () => {
    vi.mocked(execFileSync).mockReturnValueOnce(
        '{"ok":false,"category":"private-value","hresult":1}',
    );
    expect(() => probeWindowsSnapshotAcl(root())).toThrow(/^Windows ACL 隔离探针结果无效$/);
    vi.mocked(execFileSync).mockImplementationOnce(() => {
        throw new Error("private-output");
    });
    expect(() => probeWindowsSnapshotAcl(root())).toThrow(/^Windows ACL 隔离探针执行失败$/);
});
