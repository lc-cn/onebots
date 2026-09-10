import { describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createDefaultServiceHost } from "./service-host.js";
import type { ServiceHost } from "./service-host.js";
import {
    inspectWindowsServiceFileSecurity,
    inspectWindowsServiceDirectorySecurity,
    secureWindowsServiceDirectory,
    secureWindowsServiceFile,
    WindowsServiceSecurityError,
} from "./windows-service-security.js";

function host(output = '{"secured":true,"sddl":"TzpTWVNURU0="}'): ServiceHost {
    return {
        platform: "win32",
        homedir: "C:\\Users\\admin",
        isElevated: true,
        windowsSid: "S-1-5-21-100-200-300-1001",
        env: {},
        exec: vi.fn(() => output),
        spawn: vi.fn(async () => 0),
    };
}

describe("Windows 服务状态 ACL", () => {
    it("使用编码 PowerShell 建立无继承的调用SID与LocalSystem边界", () => {
        const value = host();
        secureWindowsServiceDirectory(value, "C:\\ProgramData\\OneBots");
        expect(value.exec).toHaveBeenCalledWith(
            "powershell.exe",
            [
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-EncodedCommand",
                expect.stringMatching(/^[A-Za-z0-9+/]+=*$/),
            ],
            { timeoutMs: 15_000 },
        );
        const encoded = (value.exec as ReturnType<typeof vi.fn>).mock.calls[0][1][4] as string;
        const script = Buffer.from(encoded, "base64").toString("utf16le");
        expect(script).toContain("$rules.Count -ne 2");
        expect(script).toContain("$_.AccessControlType -ne 'Allow'");
        expect(script).toContain("$_.FileSystemRights -ne");
        expect(script).toContain("$_.InheritanceFlags -ne $inherit");
        expect(script).toContain("[System.IO.FileSystemAclExtensions]::CreateDirectory($acl,$p)");
        expect(script).toContain(
            "$check.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier])",
        );
        expect(script).toContain(
            "$principal=New-Object System.Security.Principal.SecurityIdentifier($identity)",
        );
        expect(script).toContain("FileSystemAccessRule($principal,'FullControl'");
        expect(script).not.toContain("FileSystemAccessRule($identity");
        expect(script).not.toContain(".Translate(");
        expect(script).toContain("GetSecurityDescriptorBinaryForm()");
        expect(script).toContain("@{secured=$false;stage=$stage}|ConvertTo-Json -Compress");
    });

    it("拒绝非管理员、非Windows路径和未确认输出", () => {
        const value = host();
        expect(() =>
            secureWindowsServiceDirectory({ ...value, isElevated: false }, "C:\\x"),
        ).toThrow("ACL 无法确认");
        expect(() => secureWindowsServiceDirectory(value, "/tmp/x")).toThrow("ACL 无法确认");
        expect(() => secureWindowsServiceDirectory(host(""), "C:\\x")).toThrow("ACL 无法确认");
        expect(() =>
            secureWindowsServiceDirectory(host('{"secured":false,"stage":"create"}'), "C:\\x"),
        ).toThrow(new WindowsServiceSecurityError("create"));
        expect(() =>
            secureWindowsServiceDirectory(
                host('{"secured":false,"stage":"private-path"}'),
                "C:\\x",
            ),
        ).toThrow(new WindowsServiceSecurityError("process"));
        const timedOut = host();
        timedOut.exec = vi.fn(() => {
            throw new Error("private timeout detail");
        });
        expect(() => secureWindowsServiceDirectory(timedOut, "C:\\x")).toThrow(
            new WindowsServiceSecurityError("process"),
        );
        expect(() =>
            secureWindowsServiceDirectory(
                host('{"secured":true,"sddl":"ZHJpZnRlZA==","extra":true}'),
                "C:\\x",
            ),
        ).toThrow("ACL 无法确认");
    });

    it("文件证明要求受保护且恰好两条 Allow FullControl 规则", () => {
        const value = host();
        inspectWindowsServiceFileSecurity(value, "C:\\ProgramData\\OneBots\\service.json");
        const script = Buffer.from(
            (value.exec as ReturnType<typeof vi.fn>).mock.calls[0][1][4] as string,
            "base64",
        ).toString("utf16le");
        expect(script).toContain("$check.AreAccessRulesProtected");
        expect(script).toContain("$rules.Count -ne 2");
        expect(script).toContain("$_.AccessControlType -ne 'Allow'");
        expect(script).toContain("$_.FileSystemRights -ne");
        const secured = host("");
        secured.exec = vi
            .fn()
            .mockReturnValueOnce("")
            .mockReturnValueOnce('{"secured":true,"sddl":"TzpTWVNURU0="}');
        expect(
            secureWindowsServiceFile(secured, "C:\\ProgramData\\OneBots\\.onebots-install-test"),
        ).toMatch(/^[a-f0-9]{64}$/);
        const secureScript = Buffer.from(
            (secured.exec as ReturnType<typeof vi.fn>).mock.calls[0][1][4] as string,
            "base64",
        ).toString("utf16le");
        expect(secureScript).toContain("[System.IO.FileSystemAclExtensions]::SetAccessControl");
        expect(secureScript).toContain(
            "$principal=New-Object System.Security.Principal.SecurityIdentifier($identity)",
        );
        expect(secureScript).toContain("FileSystemAccessRule($principal,'FullControl',$allow)");
        expect(secureScript).not.toContain("FileSystemAccessRule($identity");
    });

    it("恢复期目录证明只读检查既有ACL", () => {
        const value = host();
        inspectWindowsServiceDirectorySecurity(value, "C:\\ProgramData\\OneBots");
        const script = Buffer.from(
            (value.exec as ReturnType<typeof vi.fn>).mock.calls[0][1][4] as string,
            "base64",
        ).toString("utf16le");
        expect(script).toContain("[System.IO.FileSystemAclExtensions]::GetAccessControl($item)");
        expect(script).toContain("$legalInheritance");
        expect(script).not.toContain("SetAccessRuleProtection");
        expect(script).not.toContain("Set-Acl");
    });

    it.runIf(process.platform === "win32")("接受可信父目录的完整合法继承", () => {
        const parent = path.join(os.tmpdir(), `onebots-acl-parent-${randomUUID()}`);
        const child = path.join(parent, "child");
        const real = createDefaultServiceHost();
        try {
            secureWindowsServiceDirectory(real, parent);
            fs.mkdirSync(child);
            expect(inspectWindowsServiceDirectorySecurity(real, child)).toMatch(/^[a-f0-9]{64}$/);
        } finally {
            fs.rmSync(parent, { recursive: true, force: true });
        }
    });

    it.runIf(process.platform === "win32")("实机拒绝安装后新增的同SID Deny规则", () => {
        const directory = path.join(os.tmpdir(), `onebots-acl-drift-${randomUUID()}`);
        const real = createDefaultServiceHost();
        try {
            secureWindowsServiceDirectory(real, directory);
            const script = String.raw`
$ErrorActionPreference='Stop'
$p=${JSON.stringify(directory)}
$sid=${JSON.stringify(real.windowsSid)}
$acl=Get-Acl -LiteralPath $p
$deny=New-Object System.Security.AccessControl.FileSystemAccessRule($sid,'ReadData','Deny')
$acl.AddAccessRule($deny)|Out-Null
Set-Acl -LiteralPath $p -AclObject $acl
`;
            execFileSync(
                "powershell.exe",
                [
                    "-NoLogo",
                    "-NoProfile",
                    "-NonInteractive",
                    "-EncodedCommand",
                    Buffer.from(script, "utf16le").toString("base64"),
                ],
                { stdio: "pipe", timeout: 15_000 },
            );
            expect(() => secureWindowsServiceDirectory(real, directory)).toThrow("ACL 无法确认");
        } finally {
            // 调用者仍是 owner，可以在删除前恢复继承；失败时让 CI 保留现场。
            try {
                execFileSync(
                    "powershell.exe",
                    [
                        "-NoLogo",
                        "-NoProfile",
                        "-NonInteractive",
                        "-Command",
                        `$acl=Get-Acl -LiteralPath '${directory.replaceAll("'", "''")}';$acl.SetAccessRuleProtection($false,$true);Set-Acl -LiteralPath '${directory.replaceAll("'", "''")}' -AclObject $acl`,
                    ],
                    { stdio: "pipe", timeout: 15_000 },
                );
                fs.rmSync(directory, { recursive: true });
            } catch {
                // 保留漂移现场，避免测试清理覆盖安全失败证据。
            }
        }
    });
});
