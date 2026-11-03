import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { registerStoppedServiceWorkspace } from "../../scripts/service-workspace-admission-acceptance.mjs";
import { unboundStopFailureEvidence } from "../../scripts/service-acceptance-diagnostics.mjs";

interface CliResult {
    status: number;
    stdout: string;
    stderr?: string;
}
const roots: string[] = [];
afterEach(() => {
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(stopResult: CliResult, readStopFailureEvidence: () => Promise<unknown>) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-stop-evidence-"));
    roots.push(root);
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(path.join(workspace, ".control"), { recursive: true });
    const authorityDirectory = path.join(root, "authority");
    let queries = 0;
    const invokeCli = vi.fn((args: string[], statuses?: number[]) => {
        if (args[0] === "stop") expect(statuses).toEqual([0, 1]);
        return args[0] === "stop" ? stopResult : { status: 0, stdout: args[0] };
    });
    const cliJson = vi.fn((args: string[]) => {
        if (args[0] === "status") {
            queries++;
            return queries < 3
                ? {
                      manager: {
                          state: "running",
                          pid: queries === 1 ? 100 : 101,
                          ipc: "available",
                      },
                      diagnostic: "admission-rejected",
                      gateway: { actual: "unknown", desired: "unknown" },
                  }
                : { manager: { state: "stopped", pid: null } };
        }
        if (args[1] === "plan")
            return {
                kind: "new",
                workspace,
                authorityDirectory,
                digest: "a".repeat(64),
                requestId: "request",
            };
        if (args[1] === "register") return { status: "committed", requestId: "request" };
        if (args[1] === "inspect") return { state: "verified" };
        throw new Error("unexpected fixture command");
    });
    return {
        workspace,
        invokeCli,
        cliJson,
        options: {
            workspace,
            authorityDirectory,
            planFile: path.join(root, "plan.json"),
            system: true,
            invokeCli,
            cliJson,
            operation: (_output: string, label: string) => label,
            operationIds: [] as string[],
            readStopFailureEvidence,
            eventually: async <T>(read: () => T | Promise<T>, accepts: (value: T) => boolean) => {
                const value = await read();
                expect(accepts(value)).toBe(true);
                return value;
            },
        },
    };
}
describe("unbound stop failure evidence", () => {
    it("distinguishes missing OS fields from observed empty fields", async () => {
        const root = fs.mkdtempSync(path.join(os.tmpdir(), "ob-stop-os-fields-"));
        roots.push(root);
        const options = {
            service: "onebots-gateway.service",
            definition: "/synthetic/definition",
            workspace: root,
            stateDirectory: root,
            runtime: root,
        };
        const missing = await unboundStopFailureEvidence({
            ...options,
            execute: () => ({ stdout: "LoadState=loaded\nMainPID=0" }),
        });
        expect(missing.os).toMatchObject({ definitionMatches: null, groupReported: null, pid: 0 });
        const empty = await unboundStopFailureEvidence({
            ...options,
            execute: () => ({ stdout: "FragmentPath=\nControlGroup=" }),
        });
        expect(empty.os).toMatchObject({ definitionMatches: false, groupReported: false });
        expect(fs.readdirSync(root)).toEqual([]);
    });

    it("keeps the nonzero failure and samples once without retrying stop or exposing raw output", async () => {
        const id = "123e4567-e89b-42d3-a456-426614174000";
        const readEvidence = vi.fn(async () => ({ os: { active: "inactive", pid: 0 } }));
        const test = fixture(
            {
                status: 1,
                stdout: `操作 ${id}：interrupted（stopping）\nsynthetic-secret /private/config`,
                stderr: "synthetic-secret",
            },
            readEvidence,
        );
        const failure = await registerStoppedServiceWorkspace(test.options).catch(error => error);
        expect(failure).toBeInstanceOf(Error);
        if (!(failure instanceof Error)) throw new Error("expected stop failure");
        expect(failure.message).toContain(`"id":"${id}"`);
        expect(failure.message).toContain('"phase":"stopping"');
        expect(failure.message).toContain('"restartedPid":101');
        expect(failure.message).toContain('"active":"inactive"');
        expect(failure.message).not.toMatch(/synthetic-secret|private\/config/);
        expect(readEvidence).toHaveBeenCalledTimes(1);
        expect(test.invokeCli.mock.calls.map(([args]) => args[0])).toEqual([
            "start",
            "restart",
            "stop",
        ]);
        expect(test.invokeCli.mock.calls[2][1]).toEqual([0, 1]);
        expect(test.cliJson.mock.calls).toHaveLength(2);
        expect(fs.readdirSync(path.join(test.workspace, ".control"))).toEqual([]);
    });
    it("an unavailable diagnostic cannot replace the original stop failure or leak its exception", async () => {
        const test = fixture(
            { status: 1, stdout: "untrusted-secret" },
            vi.fn(async () => {
                throw new Error("untrusted-secret");
            }),
        );
        const failure = await registerStoppedServiceWorkspace(test.options).catch(error => error);
        if (!(failure instanceof Error)) throw new Error("expected stop failure");
        expect(failure.message).toContain("stop 未确认");
        expect(failure.message).toContain('"evidence":"unavailable"');
        expect(failure.message).toContain('"operation":"summary-unavailable"');
        expect(failure.message).not.toContain("untrusted-secret");
        expect(test.invokeCli.mock.calls.filter(([args]) => args[0] === "stop")).toHaveLength(1);
    });
    it("successful stop preserves the registration flow without invoking additional diagnostics", async () => {
        const readEvidence = vi.fn(async () => {
            throw new Error("must not run");
        });
        const test = fixture({ status: 0, stdout: "stopped" }, readEvidence);
        await registerStoppedServiceWorkspace(test.options);
        expect(readEvidence).not.toHaveBeenCalled();
        expect(test.options.operationIds).toEqual([
            "unbound start",
            "unbound restart",
            "unbound stop",
        ]);
        expect(
            test.cliJson.mock.calls
                .filter(([args]) => args[0] === "workspace")
                .map(([args]) => args[1]),
        ).toEqual(["plan", "register", "inspect"]);
    });
});
