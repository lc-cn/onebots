import path from "node:path";
import { createHash } from "node:crypto";
import type { ServiceHost } from "./service-host.js";

const SID = /^S-1-(?:[0-9]+-)+[0-9]+$/;
const failure = () => new Error("Windows 服务状态目录 ACL 无法确认");

export type WindowsServiceSecurityStage =
    | "process"
    | "ancestor"
    | "acl-build"
    | "create"
    | "inspect"
    | "verify";

export class WindowsServiceSecurityError extends Error {
    constructor(readonly stage: WindowsServiceSecurityStage) {
        super("Windows 服务状态目录 ACL 无法确认");
        this.name = "WindowsServiceSecurityError";
    }
}

function encoded(script: string): string {
    return Buffer.from(script, "utf16le").toString("base64");
}

function parseProof(output: string): string {
    const value: unknown = JSON.parse(output.trim());
    if (
        value &&
        typeof value === "object" &&
        !Array.isArray(value) &&
        Reflect.ownKeys(value).length === 2 &&
        (value as Record<string, unknown>).secured === false &&
        typeof (value as Record<string, unknown>).stage === "string" &&
        ["ancestor", "acl-build", "create", "inspect", "verify"].includes(
            (value as Record<string, string>).stage,
        )
    )
        throw new WindowsServiceSecurityError(
            (value as Record<string, WindowsServiceSecurityStage>).stage,
        );
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
 * ACL 只保留已提升 Administrators 与 LocalSystem；过滤 token 中 deny-only 的管理员组
 * 不会命中 Allow ACE，因此同一用户的非提升进程不能改写管理工件。
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
    const script = String.raw`
$ErrorActionPreference='Stop'
$p=${location}
$ownerSid='S-1-5-32-544'
$allowedSids=@($ownerSid,'S-1-5-18')
$stage='ancestor'
try {
$ancestor=[IO.Path]::GetDirectoryName($p)
while($ancestor){
  $parent=New-Object System.IO.DirectoryInfo($ancestor)
  if(-not $parent.Exists -or (($parent.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw 'unsafe ancestor'}
  $next=[IO.Path]::GetDirectoryName($ancestor)
  if(-not $next -or $next -eq $ancestor){break}
  $ancestor=$next
}

$stage='acl-build'
$acl=New-Object System.Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
$inherit=[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
$prop=[System.Security.AccessControl.PropagationFlags]::None
$allow=[System.Security.AccessControl.AccessControlType]::Allow
foreach($identity in $allowedSids){
  $principal=New-Object System.Security.Principal.SecurityIdentifier($identity)
  $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($principal,'FullControl',$inherit,$prop,$allow)
  $acl.AddAccessRule($rule)|Out-Null
}
$acl.SetOwner((New-Object System.Security.Principal.SecurityIdentifier($ownerSid)))
$stage='create'
$item=New-Object System.IO.DirectoryInfo($p)
if(-not $item.Exists){
  if($PSVersionTable.PSEdition -eq 'Desktop'){
    [System.IO.Directory]::CreateDirectory($p,$acl)|Out-Null
  } elseif($PSVersionTable.PSEdition -eq 'Core'){
    [System.IO.FileSystemAclExtensions]::CreateDirectory($acl,$p)|Out-Null
  } else {throw 'unsupported powershell runtime'}
}
$stage='inspect'
$item.Refresh()
if(-not $item.Exists -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw 'unsafe path'}
if($PSVersionTable.PSEdition -eq 'Desktop'){
  $check=[System.IO.Directory]::GetAccessControl($p)
} elseif($PSVersionTable.PSEdition -eq 'Core'){
  $check=[System.IO.FileSystemAclExtensions]::GetAccessControl($item)
} else {throw 'unsupported powershell runtime'}
$rules=@($check.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]))
$ids=@($rules|ForEach-Object{$_.IdentityReference.Value}|Sort-Object -Unique)
$owner=$check.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
$bad=@($rules|Where-Object{$_.IsInherited -or $_.AccessControlType -ne 'Allow' -or $_.InheritanceFlags -ne $inherit -or $_.PropagationFlags -ne $prop -or $_.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl})
$stage='verify'
if(-not $check.AreAccessRulesProtected -or $owner -ne $ownerSid -or $rules.Count -ne 2 -or $ids.Count -ne 2 -or $ids[0] -notin $allowedSids -or $ids[1] -notin $allowedSids -or $bad.Count -ne 0){throw 'unsafe acl'}
$encoded=[Convert]::ToBase64String($check.GetSecurityDescriptorBinaryForm())
[Console]::Out.Write('{"secured":true,"sddl":"'+$encoded+'"}')
} catch {
  [Console]::Out.Write((@{secured=$false;stage=$stage}|ConvertTo-Json -Compress))
}
`;
    try {
        const output = host.exec(
            "powershell.exe",
            ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded(script)],
            { timeoutMs: 15_000 },
        );
        return parseProof(output);
    } catch (error) {
        if (error instanceof WindowsServiceSecurityError) throw error;
        throw new WindowsServiceSecurityError("process");
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
$ownerSid='S-1-5-32-544'
$allowedSids=@($ownerSid,'S-1-5-18')
$stage='inspect'
try {
$item=New-Object System.IO.DirectoryInfo($p)
if(-not $item.Exists -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw 'unsafe directory'}
if($PSVersionTable.PSEdition -eq 'Desktop'){
  $check=[System.IO.Directory]::GetAccessControl($p)
} elseif($PSVersionTable.PSEdition -eq 'Core'){
  $check=[System.IO.FileSystemAclExtensions]::GetAccessControl($item)
} else {throw 'unsupported powershell runtime'}
$rules=@($check.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]))
$ids=@($rules|ForEach-Object{$_.IdentityReference.Value}|Sort-Object -Unique)
$owner=$check.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
$inherit=[System.Security.AccessControl.InheritanceFlags]'ContainerInherit,ObjectInherit'
$prop=[System.Security.AccessControl.PropagationFlags]::None
$bad=@($rules|Where-Object{$_.AccessControlType -ne 'Allow' -or $_.InheritanceFlags -ne $inherit -or $_.PropagationFlags -ne $prop -or $_.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl})
$inherited=@($rules|Where-Object{$_.IsInherited}).Count
$legalInheritance=(-not $check.AreAccessRulesProtected -and $inherited -eq 2)
$protectedExact=($check.AreAccessRulesProtected -and $inherited -eq 0)
$stage='verify'
if((-not $legalInheritance -and -not $protectedExact) -or $owner -ne $ownerSid -or $rules.Count -ne 2 -or $ids.Count -ne 2 -or $ids[0] -notin $allowedSids -or $ids[1] -notin $allowedSids -or $bad.Count -ne 0){throw 'unsafe acl'}
$encoded=[Convert]::ToBase64String($check.GetSecurityDescriptorBinaryForm())
[Console]::Out.Write('{"secured":true,"sddl":"'+$encoded+'"}')
} catch {
  [Console]::Out.Write((@{secured=$false;stage=$stage}|ConvertTo-Json -Compress))
}
`;
    try {
        return parseProof(
            host.exec(
                "powershell.exe",
                ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded(script)],
                { timeoutMs: 15_000 },
            ),
        );
    } catch (error) {
        if (error instanceof WindowsServiceSecurityError) throw error;
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
$ownerSid='S-1-5-32-544'
$allowedSids=@($ownerSid,'S-1-5-18')
$item=New-Object System.IO.FileInfo($p)
if(-not $item.Exists -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw 'unsafe file'}
if($PSVersionTable.PSEdition -eq 'Desktop'){
  $check=[System.IO.File]::GetAccessControl($p)
} elseif($PSVersionTable.PSEdition -eq 'Core'){
  $check=[System.IO.FileSystemAclExtensions]::GetAccessControl($item)
} else {throw 'unsupported powershell runtime'}
$rules=@($check.GetAccessRules($true,$true,[System.Security.Principal.SecurityIdentifier]))
$ids=@($rules|ForEach-Object{$_.IdentityReference.Value}|Sort-Object -Unique)
$owner=$check.GetOwner([System.Security.Principal.SecurityIdentifier]).Value
$bad=@($rules|Where-Object{$_.AccessControlType -ne 'Allow' -or $_.FileSystemRights -ne [System.Security.AccessControl.FileSystemRights]::FullControl})
if(-not $check.AreAccessRulesProtected -or $owner -ne $ownerSid -or $rules.Count -ne 2 -or $ids.Count -ne 2 -or $ids[0] -notin $allowedSids -or $ids[1] -notin $allowedSids -or $bad.Count -ne 0){throw 'unsafe acl'}
$encoded=[Convert]::ToBase64String($check.GetSecurityDescriptorBinaryForm())
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
$ownerSid='S-1-5-32-544'
$allowedSids=@($ownerSid,'S-1-5-18')
$item=New-Object System.IO.FileInfo($p)
if(-not $item.Exists -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw 'unsafe file'}
$acl=New-Object System.Security.AccessControl.FileSecurity
$acl.SetAccessRuleProtection($true,$false)
$allow=[System.Security.AccessControl.AccessControlType]::Allow
foreach($identity in $allowedSids){
  $principal=New-Object System.Security.Principal.SecurityIdentifier($identity)
  $rule=New-Object System.Security.AccessControl.FileSystemAccessRule($principal,'FullControl',$allow)
  $acl.AddAccessRule($rule)|Out-Null
}
$acl.SetOwner((New-Object System.Security.Principal.SecurityIdentifier($ownerSid)))
if($PSVersionTable.PSEdition -eq 'Desktop'){
  [System.IO.File]::SetAccessControl($p,$acl)
} elseif($PSVersionTable.PSEdition -eq 'Core'){
  [System.IO.FileSystemAclExtensions]::SetAccessControl($item,$acl)
} else {throw 'unsupported powershell runtime'}
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
