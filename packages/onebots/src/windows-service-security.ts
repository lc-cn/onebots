import path from "node:path";
import { createHash } from "node:crypto";
import type { ServiceHost } from "./service-host.js";

const SID = /^S-1-(?:[0-9]+-)+[0-9]+$/;
const failure = () => new Error("Windows 服务状态目录 ACL 无法确认");

function encoded(script: string): string {
    return Buffer.from(script, "utf16le").toString("base64");
}

function parseProof(output: string): string {
    const value: unknown = JSON.parse(output.trim());
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Reflect.ownKeys(value).length !== 2 ||
        (value as Record<string, unknown>).secured !== true ||
        typeof (value as Record<string, unknown>).sddl !== "string" ||
        !/^[A-Za-z0-9+/]{8,8192}={0,2}$/.test((value as Record<string, unknown>).sddl as string)
    )
        throw failure();
    const sddl = Buffer.from((value as Record<string, string>).sddl, "base64");
    if (!sddl.length || sddl.length > 4096) throw failure();
    return createHash("sha256").update(sddl).digest("hex");
}

/**
 * 在任何 TS 日志或候选工件落盘前建立 SCM 管理事务的 Windows 权威边界。
 * ACL 只保留调用管理员与 LocalSystem；拒绝继承、重解析点和额外显式主体。
 */
export function secureWindowsServiceDirectory(host: ServiceHost, directory: string): string {
    if (
        host.platform !== "win32" ||
        host.isElevated !== true ||
        typeof host.windowsSid !== "string" ||
        !SID.test(host.windowsSid) ||
        !path.win32.isAbsolute(directory) ||
        !/^(?:[A-Za-z]:\\|\\\\[^\\]+\\[^\\]+\\)/.test(directory) ||
        directory.includes("/") ||
        /[\u0000\r\n]/.test(directory)
    )
        throw failure();
    const location = JSON.stringify(directory);
    const sid = JSON.stringify(host.windowsSid);
    const script = String.raw`
$ErrorActionPreference='Stop'
$p=${location}
$sid=${sid}
$ancestor=[IO.Path]::GetDirectoryName($p)
while($ancestor){
  $parent=Get-Item -LiteralPath $ancestor -Force
  if(-not $parent.PSIsContainer -or (($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw 'unsafe ancestor'}
  $next=[IO.Path]::GetDirectoryName($ancestor)
  if(-not $next -or $next -eq $ancestor){break}
  $ancestor=$next
}

$acl=New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
$inherit=[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
$prop=[System.Security.AccessControl.PropagationFlags]::None
$allow=[System.Security.AccessControl.AccessControlType]::Allow
foreach($identity in @($sid,'S-1-5-18')){
  $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($identity,'FullControl',$inherit,$prop,$allow)
  $acl.AddAccessRule($rule)|Out-Null
}
$acl.SetOwner((New-Object System.Security.Principal.SecurityIdentifier($sid)))
if(-not (Test-Path -LiteralPath $p)){[System.IO.Directory]::CreateDirectory($p,$acl)|Out-Null}
$item=Get-Item -LiteralPath $p -Force
if(-not $item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw 'unsafe path'}
$check=Get-Acl -LiteralPath $p
$rules=@($check.Access)
$ids=@($rules|ForEach-Object{$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value}|Sort-Object -Unique)
$owner=$check.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
$bad=@($rules|Where-Object{$_.IsInherited -or $_.AccessControlType -ne 'Allow' -or $_.InheritanceFlags -ne $inherit -or $_.PropagationFlags -ne $prop -or $_.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl})
if(-not $check.AreAccessRulesProtected -or $owner -ne $sid -or $rules.Count -ne 2 -or $ids.Count -ne 2 -or $ids[0] -notin @($sid,'S-1-5-18') -or $ids[1] -notin @($sid,'S-1-5-18') -or $bad.Count -ne 0){throw 'unsafe acl'}
$encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($check.Sddl))
[Console]::Out.Write('{"secured":true,"sddl":"'+$encoded+'"}')
`;
    try {
        const output = host.exec(
            "powershell.exe",
            ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded(script)],
            { timeoutMs: 15_000 },
        );
        return parseProof(output);
    } catch {
        throw failure();
    }
}

/** 恢复对账只读复核目录 DACL；绝不借恢复入口重写或收紧现场权限。 */
export function inspectWindowsServiceDirectorySecurity(
    host: ServiceHost,
    directory: string,
): string {
    if (
        host.platform !== "win32" ||
        host.isElevated !== true ||
        typeof host.windowsSid !== "string" ||
        !SID.test(host.windowsSid) ||
        !path.win32.isAbsolute(directory) ||
        directory.includes("/") ||
        /[\u0000\r\n]/.test(directory)
    )
        throw failure();
    const script = String.raw`
$ErrorActionPreference='Stop'
$p=${JSON.stringify(directory)}
$sid=${JSON.stringify(host.windowsSid)}
$item=Get-Item -LiteralPath $p -Force
if(-not $item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw 'unsafe directory'}
$check=Get-Acl -LiteralPath $p
$rules=@($check.Access)
$ids=@($rules|ForEach-Object{$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value}|Sort-Object -Unique)
$owner=$check.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
$inherit=[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
$prop=[System.Security.AccessControl.PropagationFlags]::None
$bad=@($rules|Where-Object{$_.AccessControlType -ne 'Allow' -or $_.InheritanceFlags -ne $inherit -or $_.PropagationFlags -ne $prop -or $_.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl})
$inherited=@($rules|Where-Object{$_.IsInherited}).Count
$legalInheritance=(-not $check.AreAccessRulesProtected -and $inherited -eq 2)
$protectedExact=($check.AreAccessRulesProtected -and $inherited -eq 0)
if((-not $legalInheritance -and -not $protectedExact) -or $owner -ne $sid -or $rules.Count -ne 2 -or $ids.Count -ne 2 -or $ids[0] -notin @($sid,'S-1-5-18') -or $ids[1] -notin @($sid,'S-1-5-18') -or $bad.Count -ne 0){throw 'unsafe acl'}
$encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($check.Sddl))
[Console]::Out.Write('{"secured":true,"sddl":"'+$encoded+'"}')
`;
    try {
        return parseProof(
            host.exec(
                "powershell.exe",
                ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded(script)],
                { timeoutMs: 15_000 },
            ),
        );
    } catch {
        throw failure();
    }
}

/** 只读证明服务文件本身的 DACL；目录 ACL 不能替代文件 ACL 身份。 */
export function inspectWindowsServiceFileSecurity(host: ServiceHost, file: string): string {
    if (
        host.platform !== "win32" ||
        host.isElevated !== true ||
        typeof host.windowsSid !== "string" ||
        !SID.test(host.windowsSid) ||
        !path.win32.isAbsolute(file) ||
        file.includes("/") ||
        /[\u0000\r\n]/.test(file)
    )
        throw failure();
    const script = String.raw`
$ErrorActionPreference='Stop'
$p=${JSON.stringify(file)}
$sid=${JSON.stringify(host.windowsSid)}
$item=Get-Item -LiteralPath $p -Force
if($item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw 'unsafe file'}
$check=Get-Acl -LiteralPath $p
$rules=@($check.Access)
$ids=@($rules|ForEach-Object{$_.IdentityReference.Translate([System.Security.Principal.SecurityIdentifier]).Value}|Sort-Object -Unique)
$owner=$check.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
$bad=@($rules|Where-Object{$_.AccessControlType -ne 'Allow' -or $_.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl})
if(-not $check.AreAccessRulesProtected -or $owner -ne $sid -or $rules.Count -ne 2 -or $ids.Count -ne 2 -or $ids[0] -notin @($sid,'S-1-5-18') -or $ids[1] -notin @($sid,'S-1-5-18') -or $bad.Count -ne 0){throw 'unsafe acl'}
$encoded=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($check.Sddl))
[Console]::Out.Write('{"secured":true,"sddl":"'+$encoded+'"}')
`;
    try {
        return parseProof(
            host.exec(
                "powershell.exe",
                ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded(script)],
                { timeoutMs: 15_000 },
            ),
        );
    } catch {
        throw failure();
    }
}

/** 仅用于尚未发布、位于已验证私有目录内的安装临时文件。 */
export function secureWindowsServiceFile(host: ServiceHost, file: string): string {
    if (
        host.platform !== "win32" ||
        host.isElevated !== true ||
        typeof host.windowsSid !== "string" ||
        !SID.test(host.windowsSid) ||
        !path.win32.isAbsolute(file) ||
        file.includes("/") ||
        /[\u0000\r\n]/.test(file)
    )
        throw failure();
    const script = String.raw`
$ErrorActionPreference='Stop'
$p=${JSON.stringify(file)}
$sid=${JSON.stringify(host.windowsSid)}
$item=Get-Item -LiteralPath $p -Force
if($item.PSIsContainer -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw 'unsafe file'}
$acl=New-Object System.Security.AccessControl.FileSecurity
$acl.SetAccessRuleProtection($true,$false)
$allow=[System.Security.AccessControl.AccessControlType]::Allow
foreach($identity in @($sid,'S-1-5-18')){
  $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($identity,'FullControl',$allow)
  $acl.AddAccessRule($rule)|Out-Null
}
$acl.SetOwner((New-Object System.Security.Principal.SecurityIdentifier($sid)))
[IO.File]::SetAccessControl($p,$acl)
`;
    try {
        host.exec(
            "powershell.exe",
            ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded(script)],
            { timeoutMs: 15_000 },
        );
        return inspectWindowsServiceFileSecurity(host, file);
    } catch {
        throw failure();
    }
}
