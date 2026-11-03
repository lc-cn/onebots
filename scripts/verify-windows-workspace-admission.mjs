import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire, syncBuiltinESMExports } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

if (process.platform !== "win32") {
    process.stdout.write("Windows workspace admission acceptance requires Windows.\n");
    process.exit(0);
}
const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const load = name =>
    import(pathToFileURL(path.join(repository, "packages/onebots/lib", name)).href);

if (process.argv[2] === "--crash-after-auth") {
    // Lose the registrar process after native replacement completed, before its acknowledgement
    // can advance the cross-file transaction. No production fallback or injected native path.
    const childProcess = createRequire(import.meta.url)("node:child_process");
    const original = childProcess.execFileSync;
    childProcess.execFileSync = function (file, args, options) {
        const result = original.call(this, file, args, options);
        if (
            args[0] === "private-file-replace" &&
            JSON.parse(options.input).fileName === "auth.json"
        )
            process.exit(86);
        return result;
    };
    syncBuiltinESMExports();
    const { registerWorkspace } = await load("workspace-admission/registration.js");
    const plan = JSON.parse(fs.readFileSync(process.argv[3], "utf8"));
    await registerWorkspace(plan, plan.digest);
    throw new Error("crash checkpoint not reached");
}
if (process.argv[2] === "--inspect") {
    const { acquireControlWorkspace } = await load("control/workspace.js");
    const { createDefaultServiceHost } = await load("service-host.js");
    const { acquireWorkspaceAdmission } = await load("workspace-admission/admission.js");
    const release = acquireControlWorkspace(process.argv[3], createDefaultServiceHost());
    try {
        const lease = acquireWorkspaceAdmission(process.argv[3], process.argv[4]);
        try {
            process.stdout.write(JSON.stringify(lease.inspection));
        } finally {
            lease.release();
        }
    } finally {
        release();
    }
    process.exit(0);
}

const { createWindowsPrivateDirectory, replaceWindowsPrivateFile } =
    await load("windows-private-file.js");
const { readWindowsWorkspaceIdentity, acquireWindowsWorkspaceIdentity } = await load(
    "windows-workspace-identity.js",
);
const { planWorkspaceRegistration } = await load("workspace-admission/registration-plan.js");
const { resumeWorkspaceRegistration } = await load("workspace-admission/registration.js");
const { AuthorityRegistry } = await load("workspace-admission/registry.js");
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "onebots-admission-"));
const workspace = path.join(temporary, "original");
const authority = path.join(temporary, "authority");
const copy = path.join(temporary, "copy");
const planFile = path.join(temporary, "plan.json");
function child(args) {
    return spawnSync(process.execPath, [fileURLToPath(import.meta.url), ...args], {
        encoding: "utf8",
        timeout: 30_000,
        windowsHide: true,
    });
}
function inspect(directory) {
    const result = child(["--inspect", directory, authority]);
    assert.equal(result.status, 0, "standalone admission inspection failed");
    return JSON.parse(result.stdout);
}
function privateCopy(source, target) {
    createWindowsPrivateDirectory(target);
    for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
        const from = path.join(source, entry.name),
            to = path.join(target, entry.name);
        assert.ok(!entry.isSymbolicLink(), "fixture unexpectedly contains a link");
        if (entry.isDirectory()) privateCopy(from, to);
        else
            replaceWindowsPrivateFile({
                directory: target,
                fileName: entry.name,
                expectedDigest: null,
                bytes: fs.readFileSync(from),
            });
    }
}
try {
    createWindowsPrivateDirectory(workspace);
    const plan = await planWorkspaceRegistration(workspace, authority, { desired: "stopped" });
    fs.writeFileSync(planFile, JSON.stringify(plan), { mode: 0o600 });
    assert.equal(
        child(["--crash-after-auth", planFile]).status,
        86,
        "durable replacement checkpoint not reached",
    );
    const registry = AuthorityRegistry.open(authority);
    try {
        assert.equal(registry.findById(plan.requestId)?.status, "prepared");
    } finally {
        registry.close();
    }
    assert.notEqual(
        inspect(workspace).state,
        "verified",
        "partial registration gained runtime admission",
    );
    const resumed = await resumeWorkspaceRegistration(workspace, authority, plan.requestId);
    assert.equal(resumed.status, "committed");
    const identity = readWindowsWorkspaceIdentity(path.join(workspace, ".control"));
    assert.equal(inspect(workspace).state, "verified");
    assert.equal(inspect(workspace).state, "verified", "same-volume standalone reopen failed");
    assert.deepEqual(readWindowsWorkspaceIdentity(path.join(workspace, ".control")), identity);
    const anchorDirectory = path.join(temporary, "anchored");
    createWindowsPrivateDirectory(anchorDirectory);
    const anchor = acquireWindowsWorkspaceIdentity(anchorDirectory);
    assert.throws(
        () => fs.renameSync(anchorDirectory, anchorDirectory + "-moved"),
        "live Node anchor did not prevent directory replacement",
    );
    anchor.close();
    anchor.close(); // Never replay raw handle tokens.
    fs.renameSync(anchorDirectory, anchorDirectory + "-moved");
    privateCopy(workspace, copy);
    assert.notDeepEqual(readWindowsWorkspaceIdentity(path.join(copy, ".control")), identity);
    const rejected = inspect(copy);
    assert.equal(rejected.state, "binding-mismatch");
    assert.equal(
        rejected.reason,
        "DIRECTORY_IDENTITY_MISMATCH",
        "copy must be denied by physical identity rather than weaker ACLs",
    );
    process.stdout.write(
        "Windows compiled native/Node registration, process-crash recovery, reopen and private-copy rejection passed.\n",
    );
} finally {
    fs.rmSync(temporary, { recursive: true, force: true });
}
