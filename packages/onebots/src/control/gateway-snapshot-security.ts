import { execFileSync } from "node:child_process";
import {
    windowsAclPrincipals,
    windowsFullControlAclBuilder,
    windowsFullControlAclVerifier,
} from "../windows-closed-acl.js";

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
    const principals = windowsAclPrincipals("$sid.Value", [
        "$sid.Value",
        "'S-1-5-18'",
        "'S-1-5-32-544'",
    ]);
    const builder = windowsFullControlAclBuilder("directory");
    // Node 创建的快照继承私有目录权限；只接受身份、数量和权限完全闭合的继承规则。
    const verifier = windowsFullControlAclVerifier(
        secureDirectory ? "directory" : "file",
        !secureDirectory,
    );
    const script = String.raw`
$ErrorActionPreference='Stop'
$stage='inspect'
try {
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'))
$item=Get-Item -LiteralPath $p -Force
if($item.PSIsContainer -ne $${secureDirectory ? "true" : "false"} -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw 'unsafe entry'}
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
${principals}
${
    secureDirectory
        ? String.raw`$stage='acl-build'
${builder}
$stage='acl-apply'
Set-Acl -LiteralPath $p -AclObject $acl`
        : ""
}
$stage='verify'
$check=Get-Acl -LiteralPath $p
${verifier}
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
