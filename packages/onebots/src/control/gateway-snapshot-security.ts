import { execFileSync } from "node:child_process";
import {
    windowsAclPrincipals,
    windowsFullControlAclBuilder,
    windowsFullControlAclVerifier,
} from "../windows-closed-acl.js";

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
    const verifier = windowsFullControlAclVerifier(secureDirectory ? "directory" : "file");
    const script = String.raw`
$ErrorActionPreference='Stop'
$p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encodedPath}'))
$stage='entry'
try {
$item=Get-Item -LiteralPath $p -Force
if($item.PSIsContainer -ne $${secureDirectory ? "true" : "false"} -or (($item.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0)){throw 'unsafe entry'}
$sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
${principals}
${
    secureDirectory
        ? String.raw`$stage='apply'
${builder}
Set-Acl -LiteralPath $p -AclObject $acl`
        : ""
}
$stage='acl'
$check=Get-Acl -LiteralPath $p
${verifier}
[Console]::Out.Write('private')
} catch {
 [Console]::Out.Write('stage:'+$stage)
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
            const stage = /^stage:(entry|apply|acl)$/u.exec(proof)?.[1] ?? "process";
            throw new Error(`网关快照目录权限无法确认（阶段：${stage}）`);
        }
    } catch (error) {
        if (error instanceof Error && error.message.startsWith("网关快照目录权限无法确认（阶段："))
            throw error;
        // 不发布子进程输出，避免工作区或凭据进入诊断。
        throw new Error("网关快照目录权限无法确认（阶段：process）");
    }
}
