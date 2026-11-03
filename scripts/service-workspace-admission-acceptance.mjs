import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

/** No command may allocate a journal, alter definitions, or touch legacy business bytes. */
export function snapshotFixtureTree(filename) {
    const result = [];
    const visit = (file, relative) => {
        const stat = fs.lstatSync(file);
        assert.equal(stat.isSymbolicLink(), false, "测试夹具不得含符号链接");
        result.push({
            path: relative,
            mode: stat.mode,
            uid: stat.uid,
            gid: stat.gid,
            ino: stat.ino,
            bytes: stat.isFile() ? fs.readFileSync(file) : null,
        });
        if (stat.isDirectory())
            for (const name of fs.readdirSync(file).sort())
                visit(path.join(file, name), path.join(relative, name));
        else assert.equal(stat.isFile(), true, "测试夹具只允许普通文件和目录");
    };
    visit(filename, ".");
    return result;
}

/** Real OS-service fixtures: maintenance first, explicit offline registration, no bootstrap bypass. */
export async function registerStoppedServiceWorkspace({
    workspace,
    authorityDirectory,
    planFile,
    system = false,
    invokeCli,
    cliJson,
    operation,
    operationIds,
    eventually,
    readStopFailureEvidence,
}) {
    const scope = system ? ["--system"] : [];
    const absentBusinessState = () => {
        assert.deepEqual(fs.readdirSync(workspace), [".control"]);
        for (const name of fs.readdirSync(path.join(workspace, ".control")))
            assert.match(name, /^manager-lock\.sqlite(?:-journal|-wal|-shm)?$/u);
    };
    absentBusinessState();
    const denied = async () =>
        eventually(
            () => cliJson(["status", ...scope, "--json"], [0, 1]),
            value =>
                value.manager.state === "running" &&
                value.manager.ipc === "available" &&
                value.diagnostic === "admission-rejected",
            "未登记的真实 OS manager 未进入可诊断的来源拒绝态",
        );
    operationIds.push(operation(invokeCli(["start", ...scope]).stdout, "unbound start"));
    const before = await denied();
    assert.equal(before.gateway.actual, "unknown");
    assert.equal(before.gateway.desired, "unknown");
    operationIds.push(operation(invokeCli(["restart", ...scope]).stdout, "unbound restart"));
    const after = await denied();
    assert.notEqual(after.manager.pid, before.manager.pid, "拒绝态 restart 必须确认新的 manager");
    assert.equal(after.gateway.actual, "unknown");
    assert.equal(after.gateway.desired, "unknown");
    const stopped = invokeCli(["stop", ...scope], [0, 1]);
    if (stopped.status !== 0) {
        const summary = stopped.stdout?.match(
            /^操作 ([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})：(running|succeeded|failed|interrupted)（(prepared|stopping|restoring-enablement|verifying|completed)）$/mu,
        );
        let evidence = "not-provided";
        if (readStopFailureEvidence) {
            try {
                evidence = await readStopFailureEvidence();
            } catch {
                // Evidence lookup failure remains unknown; never print arbitrary exception text.
                evidence = "unavailable";
            }
        }
        assert.equal(
            stopped.status,
            0,
            `拒绝态 stop 未确认；${JSON.stringify({
                operation: summary
                    ? { id: summary[1], status: summary[2], phase: summary[3] }
                    : "summary-unavailable",
                beforePid: Number.isSafeInteger(before.manager.pid) ? before.manager.pid : null,
                restartedPid: Number.isSafeInteger(after.manager.pid) ? after.manager.pid : null,
                evidence,
            })}`,
        );
    }
    operationIds.push(operation(stopped.stdout, "unbound stop"));
    await eventually(
        () => cliJson(["status", ...scope, "--json"]),
        value => value.manager.state === "stopped" && value.manager.pid === null,
        "来源登记前必须真实停止 manager",
    );
    absentBusinessState();
    const args = ["--data-dir", workspace, "--authority-dir", authorityDirectory];
    const plan = cliJson(["workspace", "plan", ...args]);
    assert.equal(plan.kind, "new");
    assert.equal(plan.workspace, workspace);
    assert.equal(plan.authorityDirectory, authorityDirectory);
    assert.match(plan.digest, /^[a-f0-9]{64}$/u);
    absentBusinessState();
    fs.writeFileSync(planFile, JSON.stringify(plan), { mode: 0o600, flag: "wx" });
    const registration = cliJson([
        "workspace",
        "register",
        "--plan-file",
        planFile,
        "--confirm",
        plan.digest,
    ]);
    assert.equal(registration.status, "committed");
    assert.equal(registration.requestId, plan.requestId);
    assert.equal(cliJson(["workspace", "inspect", ...args]).state, "verified");
    fs.unlinkSync(planFile);
}

/** Unexpected manager exit recovery is exercised only after genuine v2 registration. */
export async function verifyRegisteredServiceColdStart({
    workspace,
    stateDirectory,
    before,
    cliJson,
    statusArgs,
    killManager,
    eventually,
}) {
    const migrationDirectory = path.join(stateDirectory, "migrations");
    const migrationHistory = fs.existsSync(migrationDirectory)
        ? snapshotFixtureTree(migrationDirectory)
        : null;
    const metadata = new Map(
        ["config.yaml", ".control/auth.json", ".control/workspace-binding.json"].map(name => {
            const file = path.join(workspace, name);
            return [file, fs.existsSync(file) ? fs.readFileSync(file) : null];
        }),
    );
    assert.ok(metadata.get(path.join(workspace, ".control/workspace-binding.json")));
    killManager(before.os.manager.pid);
    const after = await eventually(
        () => ({
            os: cliJson(statusArgs),
            control: cliJson(["control", "status", "--data-dir", workspace]),
            ...(before.metadata ? { metadata: before.metadata } : {}),
        }),
        value =>
            value.os.manager.state === "running" &&
            value.os.manager.ipc === "available" &&
            value.os.manager.pid !== before.os.manager.pid &&
            value.control.manager.id !== before.control.manager.id &&
            value.control.gateway.desired === "running" &&
            value.control.gateway.actual === "running" &&
            value.control.gateway.instance?.id !== before.control.gateway.instance?.id,
        "正规登记后的 OS 服务未在 manager 异常退出后恢复新实例",
    );
    for (const [file, bytes] of metadata)
        assert.deepEqual(
            fs.existsSync(file) ? fs.readFileSync(file) : null,
            bytes,
            "冷启动必须保留配置、认证和来源引用的原始字节",
        );
    assert.deepEqual(
        fs.existsSync(migrationDirectory) ? snapshotFixtureTree(migrationDirectory) : null,
        migrationHistory,
        "v2 冷启动不得改写或重派已完成的历史迁移 operation",
    );
    return after;
}
