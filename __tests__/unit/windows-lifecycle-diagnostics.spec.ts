import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { assertWindowsCliSuccess } from "../../scripts/windows-lifecycle-diagnostics.mjs";

const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function workspace(error: string) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-win-diagnostic-"));
    roots.push(root);
    fs.mkdirSync(path.join(root, ".control"));
    fs.writeFileSync(
        path.join(root, ".control/gateway.json"),
        JSON.stringify({
            actual: "failed",
            recoveryRequired: false,
            error,
            secret: "private-gateway-value",
        }),
    );
    return root;
}
it("CLI 失败仅带固定命令与快照阶段，不输出原始 stdout/stderr", () => {
    const root = workspace("网关快照目录权限无法确认（阶段：verify）");
    expect(() =>
        assertWindowsCliSuccess(
            { status: 1, stdout: "private-output", stderr: "private-error" },
            "status",
            root,
        ),
    ).toThrow(
        '{"code":"WINDOWS_LIFECYCLE_CLI_FAILED","command":"status","exitCode":1,"gateway":{"readable":true,"actual":"failed","recoveryRequired":false,"snapshotStage":"verify"}}',
    );
});
it("未知阶段、命令和缺失工作区不外发原文，失败不会被当成成功", () => {
    const root = workspace("网关快照目录权限无法确认（阶段：private-value）");
    expect(() => assertWindowsCliSuccess({ status: 1 }, "private-command", root)).toThrow(
        '{"code":"WINDOWS_LIFECYCLE_CLI_FAILED","command":"unclassified","exitCode":1,"gateway":{"readable":true,"actual":"failed","recoveryRequired":false,"snapshotStage":"unclassified"}}',
    );
    expect(() =>
        assertWindowsCliSuccess({ status: null }, "status", path.join(root, "absent")),
    ).toThrow(
        '{"code":"WINDOWS_LIFECYCLE_CLI_FAILED","command":"status","exitCode":null,"gateway":{"readable":false}}',
    );
    expect(() => assertWindowsCliSuccess({ status: 0 }, "status", root)).not.toThrow();
});
