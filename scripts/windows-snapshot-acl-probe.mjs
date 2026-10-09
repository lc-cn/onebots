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
    for (const mode of ["cmdlet", "dotnet", "native"]) {
        const directory = path.join(root, `acl-probe-${mode}`);
        fs.mkdirSync(directory);
        const encoded = Buffer.from(directory, "utf8").toString("base64");
        const script = `
$ErrorActionPreference='Stop'
$stage='decode'
try {
  $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User
  $stage='principals'
  ${windowsAclPrincipals("$sid.Value", ["$sid.Value", "'S-1-5-18'", "'S-1-5-32-544'"])}
  $stage='builder'
  ${windowsFullControlAclBuilder("directory")}
  $stage='apply'
  ${mode === "cmdlet" ? "Set-Acl -LiteralPath $p -AclObject $acl" : mode === "dotnet" ? "[IO.Directory]::SetAccessControl($p,$acl)" : nativeAclApplication}
  $stage='read'
  ${mode === "cmdlet" ? "$check=Get-Acl -LiteralPath $p" : "$check=[IO.Directory]::GetAccessControl($p)"}
  $stage='verify'
  ${windowsFullControlAclVerifier("directory")}
  [Console]::Out.Write('{"ok":true}')
} catch {
  $failure=$_.Exception.GetBaseException()
  $category=switch($failure.GetType().FullName){
    'System.UnauthorizedAccessException' {'access'}
    'System.Security.AccessControl.PrivilegeNotHeldException' {'privilege'}
    'System.ArgumentException' {'argument'}
    'System.InvalidOperationException' {'operation'}
    'System.SystemException' {'system'}
    'System.Management.Automation.RuntimeException' {'runtime'}
    'System.Management.Automation.ParameterBindingException' {'binding'}
    default {'unclassified'}
  }
  $errorId=[string]$_.FullyQualifiedErrorId
  $fault=switch($errorId.Split(',')[0]){
    'InvokeMethodOnNull' {'null-method'}
    'MethodNotFound' {'method'}
    'VariableNotWritable' {'readonly-variable'}
    'NamedParameterNotFound' {'parameter'}
    'TypeNotFound' {'type'}
    default {'unclassified'}
  }
  [Console]::Out.Write('{"ok":false,"category":"'+$category+'","stage":"'+$stage+'","fault":"'+$fault+'","hresult":'+$failure.HResult+'}')
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
            "system",
            "runtime",
            "binding",
            "unclassified",
        ]);
        if (proof?.ok === true) results[mode] = { ok: true };
        else if (
            mode === "native" &&
            proof?.ok === false &&
            Number.isInteger(proof.nativeError) &&
            proof.nativeError > 0 &&
            proof.nativeError <= 0xffffffff
        )
            results[mode] = { ok: false, nativeError: proof.nativeError };
        else if (
            proof?.ok === false &&
            categories.has(proof.category) &&
            Number.isInteger(proof.hresult)
        )
            results[mode] = {
                ok: false,
                category: proof.category,
                hresult: proof.hresult,
                ...(new Set(["decode", "principals", "builder", "apply", "read", "verify"]).has(
                    proof.stage,
                )
                    ? { stage: proof.stage }
                    : {}),
                ...(new Set([
                    "null-method",
                    "method",
                    "readonly-variable",
                    "parameter",
                    "type",
                    "unclassified",
                ]).has(proof.fault)
                    ? { fault: proof.fault }
                    : {}),
            };
        else throw new Error("Windows ACL 隔离探针结果无效");
    }
    return results;
}

// 原生 API 返回 Win32 数值错误码，避免从包含身份或路径的异常正文推测失败原因。
// 仍使用同一描述符，只写 owner 和受保护 DACL，不写 SACL、不启用令牌特权。
const nativeAclApplication = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class OnebotsAclProbe {
  [DllImport("advapi32.dll", CharSet=CharSet.Unicode, ExactSpelling=true)]
  private static extern uint SetNamedSecurityInfoW(string name, uint kind, uint flags,
    IntPtr owner, IntPtr group, IntPtr dacl, IntPtr sacl);
  [DllImport("advapi32.dll", ExactSpelling=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetSecurityDescriptorOwner(IntPtr sd, out IntPtr owner,
    [MarshalAs(UnmanagedType.Bool)] out bool defaulted);
  [DllImport("advapi32.dll", ExactSpelling=true)]
  [return: MarshalAs(UnmanagedType.Bool)]
  private static extern bool GetSecurityDescriptorDacl(IntPtr sd,
    [MarshalAs(UnmanagedType.Bool)] out bool present, out IntPtr dacl,
    [MarshalAs(UnmanagedType.Bool)] out bool defaulted);
  public static uint Apply(string name, byte[] bytes) {
    IntPtr sd=Marshal.AllocHGlobal(bytes.Length);
    try {
      Marshal.Copy(bytes,0,sd,bytes.Length);
      IntPtr owner,dacl; bool present,defaulted;
      if(!GetSecurityDescriptorOwner(sd,out owner,out defaulted) || owner==IntPtr.Zero ||
        !GetSecurityDescriptorDacl(sd,out present,out dacl,out defaulted) || !present || dacl==IntPtr.Zero)
        return 87;
      return SetNamedSecurityInfoW(name,1,0x80000005u,owner,IntPtr.Zero,dacl,IntPtr.Zero);
    } finally {Marshal.FreeHGlobal(sd);}
  }
}
'@ | Out-Null
$nativeError=[OnebotsAclProbe]::Apply($p,$acl.GetSecurityDescriptorBinaryForm())
if($nativeError -ne 0){
  [Console]::Out.Write('{"ok":false,"nativeError":'+$nativeError+'}')
  exit
}
`;
