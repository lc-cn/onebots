import { execFileSync } from "node:child_process";
import { afterEach, expect, it, vi } from "vitest";
import {
    assertGatewaySnapshotFileSecurity,
    secureGatewaySnapshotDirectory,
} from "./gateway-snapshot-security.js";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn(() => "private") }));
afterEach(() => {
    vi.unstubAllGlobals();
    vi.clearAllMocks();
});
it("Windows 目录有保护 ACL 并核验；文件只读核验不擅自改权限", () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    const location = "C:\\private\\test'$().yaml";
    secureGatewaySnapshotDirectory(location);
    assertGatewaySnapshotFileSecurity(location);
    const calls = vi.mocked(execFileSync).mock.calls;
    const scripts = calls.map(call =>
        Buffer.from(String(call[1]?.[4]), "base64").toString("utf16le"),
    );
    expect(scripts[0]).toContain("SetAccessRuleProtection($true,$false)");
    expect(scripts[0]).toContain("Set-Acl -LiteralPath");
    expect(scripts[1]).not.toContain("Set-Acl");
    for (const script of scripts) {
        expect(script).toContain("GetAccessRules");
        expect(script).toContain("$_ -notin $allowedSids");
        expect(script).not.toContain(location);
    }
});
it("无法证明 DACL 时关闭快照入口，不暴露原始 PowerShell 输出", () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    vi.mocked(execFileSync).mockImplementationOnce(() => {
        throw new Error("secret raw output");
    });
    let message = "";
    try {
        secureGatewaySnapshotDirectory("C:\\private");
    } catch (error) {
        message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toBe("网关快照目录权限无法确认（阶段：process）");
    expect(message).not.toContain("secret raw output");
});
it("只保留固定失败阶段，不回显 PowerShell 原文或路径", () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    vi.mocked(execFileSync).mockReturnValueOnce("stage:acl");
    expect(() => secureGatewaySnapshotDirectory("C:\\private\\secret")).toThrow(
        /^网关快照目录权限无法确认（阶段：acl）$/u,
    );
});
