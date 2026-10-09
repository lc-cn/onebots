import { execFileSync } from "node:child_process";

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
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'))
$item=Get-Item -LiteralPath $p -Force
if($item.PSIsContainer -ne $${secureDirectory ? "true" : "false"} -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw 'unsafe entry'}
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
$ids=@($sid.Value,'S-1-5-18','S-1-5-32-544')|Sort-Object -Unique
${
    secureDirectory
        ? String.raw`$acl=New-Object Security.AccessControl.DirectorySecurity
$acl.SetAccessRuleProtection($true,$false)
$acl.SetOwner($sid)
foreach($id in $ids){
  $principal=New-Object Security.Principal.SecurityIdentifier($id)
  $rule=New-Object Security.AccessControl.FileSystemAccessRule($principal,'FullControl','ContainerInherit,ObjectInherit','None','Allow')
  $acl.AddAccessRule($rule)|Out-Null
}
Set-Acl -LiteralPath $p -AclObject $acl`
        : ""
}
$check=Get-Acl -LiteralPath $p
$rules=@($check.GetAccessRules($true,$true,[Security.Principal.SecurityIdentifier]))
if(${secureDirectory ? "-not $check.AreAccessRulesProtected -or " : ""}$check.GetOwner([Security.Principal.SecurityIdentifier]).Value -notin $ids -or $rules.Count -ne $ids.Count){throw 'unsafe acl'}
foreach($rule in $rules){
 if($rule.IdentityReference.Value -notin $ids -or $rule.AccessControlType -ne 'Allow' -or $rule.FileSystemRights -ne [Security.AccessControl.FileSystemRights]::FullControl){throw 'unsafe rule'}
}
[Console]::Out.Write('private')
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
        if (proof !== "private") throw new Error();
    } catch {
        // 不发布子进程输出，避免工作区或凭据进入诊断。
        throw new Error("网关快照目录权限无法确认");
    }
}
