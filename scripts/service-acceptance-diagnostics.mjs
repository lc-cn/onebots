import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const phases = new Set(["queued", "downloading", "verifying", "verified", "failed", "interrupted"]);
const errors = new Set([
    "ARTIFACT_INPUT_FAILED",
    "CANDIDATE_ALLOCATION_FAILED",
    "DOWNLOAD_FAILED",
    "VERIFICATION_FAILED",
    "INSTALL_FAILED",
    "INTERRUPTED",
]);

/** CI 只暴露候选阶段和固定错误码，不打印下载器输出、包路径或授权信息。 */
export function managerCandidateStates(stateDirectory) {
    const directory = path.join(stateDirectory, "manager-artifacts", "operations");
    try {
        return fs
            .readdirSync(directory)
            .filter(name => name.endsWith(".json"))
            .map(name => {
                try {
                    const operation = JSON.parse(
                        fs.readFileSync(path.join(directory, name), "utf8"),
                    );
                    return {
                        phase: phases.has(operation.phase) ? operation.phase : "invalid",
                        error: errors.has(operation.error) ? operation.error : null,
                    };
                } catch {
                    return { phase: "unreadable", error: null };
                }
            });
    } catch (error) {
        return [{ phase: error?.code === "ENOENT" ? "missing" : "unreadable", error: null }];
    }
}

/** One read-only failure sample, not an atomic ownership proof or a recovery operation. */
export async function unboundStopFailureEvidence({
    service,
    definition,
    workspace,
    stateDirectory,
    runtime,
    execute,
}) {
    const evidence = {
        os: "unavailable",
        recovery: "unavailable",
        emptyWorkspace: "unavailable",
        control: "unavailable",
        readiness: "unavailable",
    };
    try {
        const names = [
            "LoadState",
            "ActiveState",
            "SubState",
            "UnitFileState",
            "MainPID",
            "ControlPID",
            "InvocationID",
            "ControlGroup",
            "FragmentPath",
            "Result",
            "ExecMainCode",
            "ExecMainStatus",
        ];
        const output = execute("systemctl", [
            "show",
            service,
            `--property=${names.join(",")}`,
        ]).stdout;
        const values = Object.fromEntries(
            output.split(/\r?\n/u).map(line => {
                const separator = line.indexOf("=");
                return [line.slice(0, separator), line.slice(separator + 1)];
            }),
        );
        const member = (name, allowed) =>
            allowed.includes(values[name]) ? values[name] : "unknown";
        const number = name =>
            /^(?:0|[1-9][0-9]{0,9})$/u.test(values[name] ?? "") ? Number(values[name]) : null;
        evidence.os = {
            load: member("LoadState", [
                "loaded",
                "not-found",
                "error",
                "bad-setting",
                "masked",
                "stub",
                "merged",
            ]),
            active: member("ActiveState", [
                "active",
                "inactive",
                "activating",
                "deactivating",
                "failed",
                "reloading",
                "maintenance",
                "refreshing",
            ]),
            sub: member("SubState", [
                "running",
                "exited",
                "dead",
                "failed",
                "start-pre",
                "start",
                "start-post",
                "auto-restart",
                "auto-restart-queued",
                "stop",
                "stop-watchdog",
                "stop-sigterm",
                "stop-sigkill",
                "stop-post",
                "final-watchdog",
                "final-sigterm",
                "final-sigkill",
                "reload",
                "reload-signal",
                "reload-notify",
            ]),
            enabled: member("UnitFileState", ["enabled", "disabled"]),
            pid: number("MainPID"),
            controlPid: number("ControlPID"),
            invocation: /^[0-9a-f]{32}$/u.test(values.InvocationID ?? "")
                ? values.InvocationID
                : values.InvocationID === ""
                  ? null
                  : "invalid",
            definitionMatches: Object.hasOwn(values, "FragmentPath")
                ? values.FragmentPath === definition
                : null,
            groupReported: Object.hasOwn(values, "ControlGroup")
                ? Boolean(values.ControlGroup)
                : null,
            result: member("Result", [
                "success",
                "exit-code",
                "signal",
                "core-dump",
                "timeout",
                "watchdog",
                "protocol",
                "resources",
                "start-limit-hit",
            ]),
            exitCode: number("ExecMainCode"),
            exitStatus: number("ExecMainStatus"),
        };
    } catch {
        // A failed OS lookup stays unavailable; do not print raw command output.
    }
    try {
        const names = [
            "manager-lock.sqlite",
            "manager-lock.sqlite-journal",
            "manager-lock.sqlite-wal",
            "manager-lock.sqlite-shm",
            "control.sock",
        ];
        const entries = fs.readdirSync(path.join(workspace, ".control"));
        evidence.control = {
            entries: entries
                .filter(name => names.includes(name))
                .sort()
                .map(name => {
                    const stat = fs.lstatSync(path.join(workspace, ".control", name));
                    return {
                        name,
                        type: stat.isSymbolicLink()
                            ? "link"
                            : stat.isSocket()
                              ? "socket"
                              : stat.isFile()
                                ? "file"
                                : "other",
                        mode: stat.mode & 0o7777,
                        owned: stat.uid === process.getuid(),
                    };
                }),
            otherCount: entries.filter(name => !names.includes(name)).length,
        };
    } catch {
        // Unknown contents are not treated as empty and arbitrary names are never logged.
    }
    const load = name =>
        import(pathToFileURL(path.join(runtime, "node_modules/onebots/lib", name)).href);
    try {
        const { inspectServiceRecoveryDetails } = await load("service-recovery-inspection.js");
        evidence.recovery = inspectServiceRecoveryDetails(stateDirectory);
    } catch {
        /* Keep unknown; never construct a journal to collect evidence. */
    }
    try {
        const { isEmptyBusinessWorkspace } = await load("workspace-admission/registration-plan.js");
        evidence.emptyWorkspace = isEmptyBusinessWorkspace(workspace);
    } catch {
        /* Owner's read-only check could not confirm the workspace. */
    }
    try {
        const { inspectManagerReadiness } = await load("manager-service-readiness.js");
        const readiness = await inspectManagerReadiness(workspace);
        evidence.readiness = {
            manager: readiness.manager,
            admission: readiness.admission,
            gateway: readiness.gateway,
        };
    } catch {
        /* An unreachable local transport is unavailable, not proof of absence. */
    }
    return evidence;
}
