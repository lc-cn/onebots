import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

/** Explicit enrollment of a disposable empty fixture through the exact CLI under test. */
export function registerInstalledWorkspace({
    packageRoot,
    workspace,
    authorityDirectory,
    environment = process.env,
}) {
    const root = fs.realpathSync(workspace);
    assert.deepEqual(fs.readdirSync(root), [], "首登夹具必须仍是空业务工作区");
    const authority = path.join(
        fs.realpathSync(path.dirname(authorityDirectory)),
        path.basename(authorityDirectory),
    );
    assert.equal(fs.existsSync(authority), false, "测试必须使用独立的新 authority");
    const bin = path.join(fs.realpathSync(packageRoot), "lib/bin.js");
    const run = args =>
        JSON.parse(
            execFileSync(process.execPath, [bin, "workspace", ...args], {
                cwd: path.dirname(bin),
                env: environment,
                encoding: "utf8",
                timeout: 30_000,
                maxBuffer: 1024 * 1024,
                stdio: ["ignore", "pipe", "pipe"],
            }),
        );
    const plan = run(["plan", "--data-dir", root, "--authority-dir", authority]);
    assert.equal(plan.kind, "new");
    assert.equal(plan.workspace, root);
    assert.equal(plan.authorityDirectory, authority);
    assert.match(plan.digest, /^[a-f0-9]{64}$/);
    assert.deepEqual(fs.readdirSync(root), [], "只读 plan 不得创建认证或业务状态");
    const planFile = `${authority}.plan.json`;
    fs.writeFileSync(planFile, JSON.stringify(plan), { flag: "wx", mode: 0o600 });
    // Confirmation is explicit and limited to the immutable plan for this test-owned workspace.
    const result = run(["register", "--plan-file", planFile, "--confirm", plan.digest]);
    assert.equal(result.status, "committed");
    assert.equal(result.requestId, plan.requestId);
    const inspection = run(["inspect", "--data-dir", root, "--authority-dir", authority]);
    assert.equal(inspection.state, "verified");
    fs.unlinkSync(planFile);
    return authority;
}
