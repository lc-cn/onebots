import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createGatewayConfigurationSnapshot } from "../packages/onebots/lib/control/gateway-configuration-snapshot.js";
import {
    assertGatewaySnapshotFileSecurity,
    secureGatewaySnapshotStagingFile,
} from "../packages/onebots/lib/control/gateway-snapshot-security.js";

if (process.platform !== "win32") throw new Error("快照 ACL 验收仅在 Windows 执行");
const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "onebots-snapshot-acl-")));

/** 模拟合法 DACL 但默认 owner 非当前用户；仅修改本脚本生成的隔离测试文件。 */
function useAdministratorOwner(file) {
    const encoded = Buffer.from(file, "utf8").toString("base64");
    const script = `
$ErrorActionPreference='Stop'
try {
  $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))
  $identity=[Security.Principal.WindowsIdentity]::GetCurrent()
  if($identity.User.Value -eq 'S-1-5-32-544'){throw 'invalid fixture'}
  $acl=[IO.File]::GetAccessControl($p)
  $acl.SetOwner((New-Object System.Security.Principal.SecurityIdentifier('S-1-5-32-544')))
  [IO.File]::SetAccessControl($p,$acl)
  if(([IO.File]::GetAccessControl($p)).GetOwner([Security.Principal.SecurityIdentifier]).Value -ne 'S-1-5-32-544'){throw 'invalid fixture'}
  [Console]::Out.Write('owner-set')
} catch {[Console]::Out.Write('fixture-failed')}
`;
    let proof;
    try {
        proof = execFileSync(
            "powershell.exe",
            [
                "-NoLogo",
                "-NoProfile",
                "-NonInteractive",
                "-EncodedCommand",
                Buffer.from(script, "utf16le").toString("base64"),
            ],
            { encoding: "utf8", timeout: 15_000, stdio: ["ignore", "pipe", "pipe"] },
        );
    } catch {
        throw new Error("Windows 快照 owner 隔离夹具执行失败");
    }
    assert.equal(proof, "owner-set", "Windows 快照 owner 隔离夹具未建立");
}

try {
    const snapshot = createGatewayConfigurationSnapshot(root, { log_level: "off" });
    assertGatewaySnapshotFileSecurity(snapshot.configPath);
    const staging = path.join(path.dirname(snapshot.configPath), `.snapshot-${randomUUID()}`);
    const descriptor = fs.openSync(staging, "wx", 0o600);
    fs.closeSync(descriptor);
    useAdministratorOwner(staging);
    assert.throws(() => assertGatewaySnapshotFileSecurity(staging), /原因：owner/);
    secureGatewaySnapshotStagingFile(staging);
    assertGatewaySnapshotFileSecurity(staging);
    fs.unlinkSync(staging);

    // 既有文件 owner 漂移必须拒绝，不能通过重复发布修补并接受它。
    const original = fs.readFileSync(snapshot.configPath);
    useAdministratorOwner(snapshot.configPath);
    assert.throws(
        () => createGatewayConfigurationSnapshot(root, { log_level: "off" }),
        /原因：owner/,
    );
    assert.throws(() => assertGatewaySnapshotFileSecurity(snapshot.configPath), /原因：owner/);
    assert.deepEqual(fs.readFileSync(snapshot.configPath), original);
    console.log("[onebots] Windows 新快照 owner 初始化、严格核验和既有文件拒绝验收通过");
} finally {
    fs.rmSync(root, { recursive: true, force: true });
}
