import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import {
    windowsAclPrincipals,
    windowsFullControlAclBuilder,
    windowsFullControlAclVerifier,
} from "../packages/onebots/lib/windows-closed-acl.js";

/** 在无敏感内容的隔离夹具比较两种 ACL 应用方式，策略和核验完全相同。 */
export function probeWindowsSnapshotAcl(root) {
    const results = {};
    for (const mode of ["cmdlet", "dotnet"]) {
        const directory = path.join(root, `acl-probe-${mode}`);
        fs.mkdirSync(directory);
        const encoded = Buffer.from(directory, "utf8").toString("base64");
        const script = `
$ErrorActionPreference='Stop'
try {
  $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
  ${windowsAclPrincipals("$sid.Value", ["$sid.Value", "'S-1-5-18'", "'S-1-5-32-544'"])}
  ${windowsFullControlAclBuilder("directory")}
  ${mode === "cmdlet" ? "Set-Acl -LiteralPath $p -AclObject $acl" : "[IO.Directory]::SetAccessControl($p,$acl)"}
  $check=Get-Acl -LiteralPath $p
  ${windowsFullControlAclVerifier("directory")}
  [Console]::Out.Write('{"ok":true}')
} catch {
  $failure=$_.Exception.GetBaseException()
  $category=switch($failure.GetType().FullName){
    'System.UnauthorizedAccessException' {'access'}
    'System.Security.AccessControl.PrivilegeNotHeldException' {'privilege'}
    'System.ArgumentException' {'argument'}
    'System.InvalidOperationException' {'operation'}
    default {'unclassified'}
  }
  [Console]::Out.Write('{"ok":false,"category":"'+$category+'","hresult":'+$failure.HResult+'}')
}
`;
        let proof;
        try {
            proof = JSON.parse(
                execFileSync(
                    "powershell.exe",
                    [
                        "-NoLogo",
                        "-NoProfile",
                        "-NonInteractive",
                        "-EncodedCommand",
                        Buffer.from(script, "utf16le").toString("base64"),
                    ],
                    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 15_000 },
                ),
            );
        } catch {
            throw new Error("Windows ACL 隔离探针执行失败");
        }
        const categories = new Set([
            "access",
            "privilege",
            "argument",
            "operation",
            "unclassified",
        ]);
        if (proof?.ok === true) results[mode] = { ok: true };
        else if (
            proof?.ok === false &&
            categories.has(proof.category) &&
            Number.isInteger(proof.hresult)
        )
            results[mode] = { ok: false, category: proof.category, hresult: proof.hresult };
        else throw new Error("Windows ACL 隔离探针结果无效");
    }
    return results;
}
