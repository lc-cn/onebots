import { execFileSync } from "node:child_process";
import { protectedWindowsDirectoryAclScript } from "../windows-acl-script.js";

type SnapshotSecurityStage = "process" | "inspect" | "acl-build" | "acl-apply" | "verify";
class SnapshotSecurityError extends Error {
    constructor(readonly stage: SnapshotSecurityStage) {
        super(`网关快照目录权限无法确认（阶段：${stage}）`);
    }
}

/** Windows POSIX mode 不限制 DACL；快照私有目录只授权当前宿主与系统管理员。 */
export function secureGatewaySnapshotDirectory(directory: string): void {
    verifyWindowsSnapshotPermissions(directory, true);
}

export function assertGatewaySnapshotFileSecurity(file: string): void {
    verifyWindowsSnapshotPermissions(file, false);
}

function verifyWindowsSnapshotPermissions(location: string, secureDirectory: boolean): void {
    if (process.platform !== "win32") return;
    // 路径通过 Base64 传入固定脚本，不能把工作区名插入 PowerShell 源码。
    const encodedPath = Buffer.from(location, "utf8").toString("base64");
    const script = String.raw`
$ErrorActionPreference='Stop'
$stage='inspect'
try {
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'))
$item=Get-Item -LiteralPath $p -Force
if($item.PSIsContainer -ne $${secureDirectory ? "true" : "false"} -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw 'unsafe entry'}
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$ids=@($sid.Value,'S-1-5-18','S-1-5-32-544')|Sort-Object -Unique
$ownerSid=$sid.Value
$allowedSids=$ids
${
    secureDirectory
        ? String.raw`$stage='acl-build'
${protectedWindowsDirectoryAclScript}
$stage='acl-apply'
Set-Acl -LiteralPath $p -AclObject $acl`
        : ""
}
$stage='verify'
$check=Get-Acl -LiteralPath $p
$rules=@($check.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
if(${secureDirectory ? "-not $check.AreAccessRulesProtected -or " : ""}$check.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $ids -or $rules.Count -ne $ids.Count){throw 'unsafe acl'}
foreach($rule in $rules){
 if($rule.IdentityReference.Value -notin $ids -or $rule.AccessControlType -ne 'Allow' -or $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl){throw 'unsafe rule'}
}
[Console]::Out.Write('private')
} catch {
  [Console]::Out.Write('unsafe:'+$stage)
}
`;
    try {
        const proof = execFileSync(
            "powershell.exe",
            [
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-EncodedCommand",
                Buffer.from(script, "utf16le").toString("base64"),
            ],
            { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000 },
        );
        if (proof !== "private") {
            const stage = proof.startsWith("unsafe:") ? proof.slice(7) : "process";
            if (
                stage === "inspect" ||
                stage === "acl-build" ||
                stage === "acl-apply" ||
                stage === "verify"
            )
                throw new SnapshotSecurityError(stage);
            throw new SnapshotSecurityError("process");
        }
    } catch (error) {
        // 不发布子进程输出，避免工作区或凭据进入诊断。
        if (error instanceof SnapshotSecurityError) throw error;
        throw new SnapshotSecurityError("process");
    }
}
