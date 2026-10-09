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
    expect(scripts[0]).not.toContain("$legalInheritance");
    expect(scripts[1]).toContain("$legalInheritance");
    expect(scripts[1]).toContain("$inheritedCount -eq $allowedSids.Count");
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
    expect(() => secureGatewaySnapshotDirectory("C:\\private")).toThrow(
        /^网关快照目录权限无法确认（阶段：process）$/,
    );
});
it.each(["inspect", "acl-build", "acl-apply", "verify"])("只允许固定阶段诊断：%s", stage => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    vi.mocked(execFileSync).mockReturnValueOnce(`unsafe:${stage}`);
    expect(() => secureGatewaySnapshotDirectory("C:\\private")).toThrow(
        new RegExp(`^网关快照目录权限无法确认（阶段：${stage}）$`),
    );
});
it("伪造或秘密阶段输出被固定 process 错误取代", () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    vi.mocked(execFileSync).mockReturnValueOnce("unsafe:secret raw output");
    expect(() => secureGatewaySnapshotDirectory("C:\\private")).toThrow(
        /^网关快照目录权限无法确认（阶段：process）$/,
    );
});
it.each(["owner", "protection", "count", "identity", "rights", "read"])(
    "核验失败只发布固定 ACL 原因：%s",
    reason => {
        vi.stubGlobal("process", { ...process, platform: "win32" });
        vi.mocked(execFileSync).mockReturnValueOnce(`unsafe:verify:${reason}`);
        expect(() => assertGatewaySnapshotFileSecurity("C:\\private\\config.yaml")).toThrow(
            `网关快照目录权限无法确认（阶段：verify；对象：file；原因：${reason}）`,
        );
    },
);
it("未知 ACL 原因不能进入公开错误", () => {
    vi.stubGlobal("process", { ...process, platform: "win32" });
    vi.mocked(execFileSync).mockReturnValueOnce("unsafe:verify:secret raw output");
    expect(() => assertGatewaySnapshotFileSecurity("C:\\private\\config.yaml")).toThrow(
        /^网关快照目录权限无法确认（阶段：verify）$/,
    );
});
