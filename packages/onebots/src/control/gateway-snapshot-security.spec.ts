import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import {
    assertGatewaySnapshotFileSecurity,
    secureGatewaySnapshotDirectory,
    secureGatewaySnapshotStagingFile,
} from "./gateway-snapshot-security.js";
import { createGatewayConfigurationSnapshot } from "./gateway-configuration-snapshot.js";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn(() => "private") }));
afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
});
it("新快照在发布前初始化文件 owner；复用既有快照不重写文件 ACL", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ob-owner-publish-")));
    try {
        vi.stubGlobal("process", { ...process, platform: "win32" });
        const publish = vi.spyOn(fs, "renameSync");
        const first = createGatewayConfigurationSnapshot(root, {});
        const scripts = vi
            .mocked(execFileSync)
            .mock.calls.map(call =>
                Buffer.from(String(call[1]?.[4]), "base64").toString("utf16le"),
            );
        expect(scripts).toHaveLength(3);
        expect(scripts[1]).toContain("FileSecurity");
        expect(scripts[1]).toContain("Set-Acl -LiteralPath");
        expect(scripts[1]).toContain("$acl.SetOwner");
        expect(scripts[1]).not.toContain("$legalInheritance");
        expect(scripts[2]).not.toContain("Set-Acl");
        expect(vi.mocked(execFileSync).mock.invocationCallOrder[1]).toBeLessThan(
            publish.mock.invocationCallOrder[0],
        );
        vi.mocked(execFileSync).mockClear();
        expect(createGatewayConfigurationSnapshot(root, {})).toEqual(first);
        const reusedScripts = vi
            .mocked(execFileSync)
            .mock.calls.map(call =>
                Buffer.from(String(call[1]?.[4]), "base64").toString("utf16le"),
            );
        expect(reusedScripts).toHaveLength(2);
        expect(reusedScripts[1]).not.toContain("Set-Acl");
        expect(() => secureGatewaySnapshotStagingFile(first.configPath)).toThrow(
            "网关临时快照无效",
        );
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
});
it("文件 ACL 初始化失败不发布快照且清理本次临时文件", () => {
    const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "ob-owner-failed-")));
    try {
        vi.stubGlobal("process", { ...process, platform: "win32" });
        vi.mocked(execFileSync)
            .mockReturnValueOnce("private")
            .mockReturnValueOnce("unsafe:acl-apply:read");
        expect(() => createGatewayConfigurationSnapshot(root, {})).toThrow("阶段：acl-apply");
        expect(fs.readdirSync(path.join(root, ".control", "configurations"))).toEqual([]);
    } finally {
        fs.rmSync(root, { recursive: true, force: true });
    }
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
