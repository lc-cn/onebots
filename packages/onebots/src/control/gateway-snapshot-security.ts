import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
    windowsAclPrincipals,
    windowsFullControlAclBuilder,
    windowsFullControlAclVerifier,
} from "../windows-closed-acl.js";

type SnapshotSecurityStage = "process" | "inspect" | "acl-build" | "acl-apply" | "verify";
const aclReasons = new Set(["owner", "protection", "count", "identity", "rights", "read"]);
class SnapshotSecurityError extends Error {
    constructor(
        readonly stage: SnapshotSecurityStage,
        kind?: "directory" | "file",
        reason?: string,
    ) {
        super(
            `网关快照目录权限无法确认（阶段：${stage}${kind && reason ? `；对象：${kind}；原因：${reason}` : ""}）`,
        );
    }
}

/** Windows POSIX mode 不限制 DACL；快照私有目录只授权当前宿主与系统管理员。 */
export function secureGatewaySnapshotDirectory(directory: string): void {
    verifyWindowsSnapshotPermissions(directory, true);
}

export function assertGatewaySnapshotFileSecurity(file: string): void {
    verifyWindowsSnapshotPermissions(file, false);
}

/** 仅初始化调用方以 wx 新建的私有 staging 文件，既有摘要文件不得走此入口。 */
export function secureGatewaySnapshotStagingFile(file: string): void {
    if (process.platform !== "win32") return;
    const stat = fs.lstatSync(file);
    if (
        !/^\.snapshot-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(
            path.basename(file),
        ) ||
        !stat.isFile() ||
        stat.isSymbolicLink() ||
        stat.nlink !== 1
    )
        throw new Error("网关临时快照无效");
    verifyWindowsSnapshotPermissions(file, false, true);
}

function verifyWindowsSnapshotPermissions(
    location: string,
    secureDirectory: boolean,
    initializeFile = false,
): void {
    if (process.platform !== "win32") return;
    // 路径通过 Base64 传入固定脚本，不能把工作区名插入 PowerShell 源码。
    const encodedPath = Buffer.from(location, "utf8").toString("base64");
    const principals = windowsAclPrincipals("$sid.Value", [
        "$sid.Value",
        "'S-1-5-18'",
        "'S-1-5-32-544'",
    ]);
    const builder = windowsFullControlAclBuilder(secureDirectory ? "directory" : "file");
    const fileSystem = secureDirectory ? "Directory" : "File";
    // DACL 可继承但 owner 来自创建令牌。新文件显式初始化；既有文件只读核验。
    const verifier = windowsFullControlAclVerifier(
        secureDirectory ? "directory" : "file",
        !secureDirectory && !initializeFile,
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
    secureDirectory || initializeFile
        ? String.raw`$stage='acl-build'
${builder}
$stage='acl-apply'
[System.IO.${fileSystem}]::SetAccessControl($p,$acl)`
        : ""
}
$stage='verify'
$check=[System.IO.${fileSystem}]::GetAccessControl($p)
${verifier}
[Console]::Out.Write('private')
} catch {
  # 按固定优先级报告首个不匹配项，不发布异常、路径或身份。
  $reason='read'
  if($stage -eq 'verify' -and $null -ne $owner){
    if($owner -ne $ownerSid){$reason='owner'}
    elseif(-not $protectionOk){$reason='protection'}
    elseif($rules.Count -ne $allowedSids.Count -or $ids.Count -ne $allowedSids.Count){$reason='count'}
    elseif(@($ids|Where-Object{$_ -notin $allowedSids}).Count -ne 0){$reason='identity'}
    elseif($bad.Count -ne 0){$reason='rights'}
  }
  [Console]::Out.Write('unsafe:'+$stage+':'+$reason)
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
            const [stage, reason] = proof.startsWith("unsafe:")
                ? proof.slice(7).split(":")
                : ["process"];
            if (
                stage === "inspect" ||
                stage === "acl-build" ||
                stage === "acl-apply" ||
                stage === "verify"
            )
                throw new SnapshotSecurityError(
                    stage,
                    secureDirectory ? "directory" : "file",
                    reason && aclReasons.has(reason) ? reason : undefined,
                );
            throw new SnapshotSecurityError("process");
        }
    } catch (error) {
        // 不发布子进程输出，避免工作区或凭据进入诊断。
        if (error instanceof SnapshotSecurityError) throw error;
        throw new SnapshotSecurityError("process");
    }
}
