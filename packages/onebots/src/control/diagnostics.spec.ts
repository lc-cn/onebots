import { prepareServiceProcessOwnershipSeed } from "../service-migration-processes.js";
import { acquireControlWorkspace } from "./workspace.js";
import fs from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ControlClient, createHttpControlTransport } from "../../../core/src/control.js";
import { startControlHost } from "./host.js";
import { prepareServiceMigrationWorkspace } from "../service-migration-workspace.js";
import { createLocalControlTransport } from "../client/local-control.js";
import { runManagerDoctor } from "../manager-doctor.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
    vi.restoreAllMocks();
    for (const fn of cleanup.splice(0).reverse()) await fn();
});
it("diagnostics is authenticated, closed and readonly for empty and damaged configuration", async () => {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/ob-diag-"));
    cleanup.push(async () => fs.rmSync(root, { recursive: true, force: true }));
    prepareServiceMigrationWorkspace(root, "11111111-1111-4111-8111-111111111111", "stopped");
    const release = acquireControlWorkspace(root);
    try {
        prepareServiceProcessOwnershipSeed(root);
    } finally {
        release();
    }
    fs.writeFileSync(path.join(root, "config.yaml"), "{}\n", { mode: 0o600 });
    const host = await startControlHost({ workspace: root, port: 0 });
    cleanup.push(() => host.close());
    const address = host.server.address();
    if (!address || typeof address === "string") throw new Error("missing address");
    const url = `http://127.0.0.1:${address.port}`;
    expect((await fetch(`${url}/api/control/diagnostics`)).status).toBe(401);
    const local = new ControlClient(createLocalControlTransport(root));
    const { code } = await local.bootstrap();
    let token = "";
    const remote = new ControlClient(createHttpControlTransport(url, () => token));
    ({ token } = await remote.pair(code));
    const before = snapshot(root);
    const write = vi.spyOn(fs, "writeFileSync"),
        mkdir = vi.spyOn(fs, "mkdirSync"),
        rename = vi.spyOn(fs, "renameSync");
    const value = await remote.diagnostics();
    expect(value).toMatchObject({
        schemaVersion: 1,
        manager: { id: host.id, pid: process.pid },
        management: { host: "127.0.0.1", port: address.port },
        gateway: { actual: "stopped", desired: "stopped", recoveryRequired: false },
        configuration: { state: "ready", recoveryRequired: false },
        generation: { activeId: null, recoveryRequired: false },
        processOwnership: { available: true },
        serviceMigration: { pending: true, recoveryRequired: false },
    });
    expect(Object.keys(value).sort()).toEqual([
        "configuration",
        "gateway",
        "generation",
        "management",
        "manager",
        "processOwnership",
        "schemaVersion",
        "serviceMigration",
    ]);
    expect(Object.keys(value.gateway).sort()).toEqual(["actual", "desired", "recoveryRequired"]);
    expect(snapshot(root)).toEqual(before);
    expect(write).not.toHaveBeenCalled();
    expect(mkdir).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    // An explicitly configured module would write a marker if diagnostics imported plugins.
    const plugin = path.join(root, "plugin.mjs"),
        marker = path.join(root, "imported");
    fs.writeFileSync(
        plugin,
        `import fs from 'node:fs'; fs.writeFileSync(${JSON.stringify(marker)}, 'unexpected');`,
    );
    fs.writeFileSync(
        path.join(root, "config.yaml"),
        `plugins:\n  adapters: [${JSON.stringify(plugin)}]\n`,
    );
    expect((await local.diagnostics()).configuration.state).toBe("ready");
    expect(fs.existsSync(marker)).toBe(false);
    fs.writeFileSync(path.join(root, "config.yaml"), "token: synthetic-secret\nbroken: [");
    const damagedBefore = snapshot(root);
    const damaged = await local.diagnostics();
    expect(damaged.configuration.state).toBe("damaged");
    expect(JSON.stringify(damaged)).not.toMatch(/synthetic-secret|plugin\.mjs|config\.yaml/);
    const report = await runManagerDoctor({ dataDir: root });
    expect(report.checks).toEqual(
        expect.arrayContaining([
            expect.objectContaining({ id: "configuration", status: "fail" }),
            expect.objectContaining({ id: "healthz", status: "pass" }),
            expect.objectContaining({ id: "ready", status: "pass" }),
            expect.objectContaining({ id: "anonymous-access", status: "pass" }),
        ]),
    );
    expect(JSON.stringify(report)).not.toContain("synthetic-secret");
    expect(snapshot(root)).toEqual(damagedBefore);
    fs.unlinkSync(path.join(root, "config.yaml"));
    expect((await local.diagnostics()).configuration.state).toBe("unavailable");
});
function snapshot(root: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const name of fs.readdirSync(root, { recursive: true })) {
        const file = path.join(root, String(name));
        const stat = fs.lstatSync(file);
        if (stat.isFile())
            result[String(name)] =
                `${stat.mode}:${stat.mtimeMs}:${fs.readFileSync(file).toString("base64")}`;
    }
    return result;
}
