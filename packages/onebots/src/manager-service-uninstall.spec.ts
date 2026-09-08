import fs from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { uninstallManagerService } from "./manager-service-uninstall.js";
import { getServiceFiles } from "./service-files.js";
import { renderInstalledManagerService } from "./manager-service-definition.js";
import { FileManagerServiceJournal } from "./manager-service-journal.js";
import {
    prepareServiceMigrationWorkspace,
    releaseServiceMigrationPending,
} from "./service-migration-workspace.js";
import { prepareServiceProcessOwnershipSeed } from "./service-migration-processes.js";
import { acquireControlWorkspace } from "./control/workspace.js";
import { allocateConfigurationVerification } from "./configuration/configuration-verify-ownership.js";
import type { ManagerServiceSpec } from "./manager-service-spec.js";
import type { ServiceHost } from "./service-host.js";
import type { ServicePlatform, ServicePlatformState } from "./service-platform.js";
const roots: string[] = [];
afterEach(() => {
    vi.restoreAllMocks();
    for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});
function fixture(running = false) {
    const root = fs.realpathSync(fs.mkdtempSync("/tmp/manager-uninstall-"));
    roots.push(root);
    const host: ServiceHost = {
        platform: "linux",
        homedir: root,
        uid: process.getuid?.(),
        env: {},
        exec: (file, args) => {
            if (file === "systemctl" && args.includes("show") && !state.loaded)
                return "LoadState=not-found\nActiveState=inactive\nSubState=dead\nMainPID=0\nControlPID=0\nControlGroup=\nFragmentPath=\n";
            throw new Error("unexpected OS command");
        },
        spawn: async () => {
            throw new Error("must not spawn");
        },
    };
    const workspace = path.join(root, "workspace");
    fs.mkdirSync(workspace, { mode: 0o700 });
    const spec: ManagerServiceSpec = {
        schemaVersion: 1,
        runtimeKind: "control",
        scope: "user",
        workspace,
        workingDirectory: root,
        nodePath: process.execPath,
        binPath: "/app/bin.js",
        host: "127.0.0.1",
        port: 6727,
    };
    const files = getServiceFiles("user", host);
    for (const directory of [path.dirname(files.definition), files.stateDir])
        fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    fs.writeFileSync(
        files.definition,
        renderInstalledManagerService(spec, host.platform, files.stateDir),
        { mode: 0o644 },
    );
    fs.writeFileSync(files.metadata, JSON.stringify(spec), { mode: 0o600 });
    prepareServiceMigrationWorkspace(workspace, "fixture-seed", "stopped");
    const unlock = acquireControlWorkspace(workspace);
    try {
        prepareServiceProcessOwnershipSeed(workspace);
        releaseServiceMigrationPending(workspace, "fixture-seed");
    } finally {
        unlock();
    }
    fs.writeFileSync(path.join(workspace, ".control/auth.json"), "synthetic-auth", { mode: 0o600 });
    fs.writeFileSync(path.join(workspace, "config.yaml"), "secret: [\r\n", { mode: 0o600 });
    fs.writeFileSync(path.join(workspace, "id_map.db"), Buffer.from([0, 255, 10]), { mode: 0o600 });
    const preserved = [
        "config.yaml",
        "id_map.db",
        ".control/auth.json",
        ".control/gateway.json",
        ".control/process-ownership.json",
    ].map(file => ({
        file: path.join(workspace, file),
        bytes: fs.readFileSync(path.join(workspace, file)),
    }));
    let state: ServicePlatformState = {
        state: running ? "running" : "stopped",
        running,
        enabled: true,
        loaded: true,
        definitionPath: files.definition,
        processId: running ? 100 : null,
        identity: running ? "old-identity" : null,
        quiescent: !running,
    };
    const events: string[] = [];
    const controls = { replaceDefinition: false, replaceMetadata: false, failUnregister: false };
    const platform: ServicePlatform = {
        inspect: async () => structuredClone(state),
        quiesce: async () => {
            events.push("quiesce");
            state = {
                ...state,
                state: "stopped",
                running: false,
                enabled: false,
                processId: null,
                identity: null,
                quiescent: true,
            };
            if (controls.replaceDefinition) {
                const next = `${files.definition}.external`;
                fs.writeFileSync(next, "external-service", { mode: 0o644 });
                fs.renameSync(next, files.definition);
            }
        },
        reload: async () => {
            events.push("reload");
            throw new Error("must not reload");
        },
        start: async () => {
            events.push("start");
            throw new Error("must not start");
        },
    };
    const unregister = vi.fn(async () => {
        events.push("unregister");
        expect(fs.existsSync(files.definition)).toBe(false);
        expect(fs.existsSync(files.metadata)).toBe(true);
        expect(() => acquireControlWorkspace(workspace)).toThrow();
        if (controls.failUnregister) throw new Error("synthetic-secret");
        if (controls.replaceMetadata) {
            const replacement = `${files.metadata}.external`;
            fs.writeFileSync(replacement, fs.readFileSync(files.metadata), { mode: 0o600 });
            fs.renameSync(replacement, files.metadata);
        }
        state = { ...state, loaded: false, enabled: false };
    });
    return {
        root,
        host,
        spec,
        files,
        workspace,
        preserved,
        platform,
        unregister,
        controls,
        events,
    };
}
describe("manager uninstall persistent transaction", () => {
    it.each(["failed", "transitioning"] as const)(
        "refuses deletion when quiesce leaves OS state %s despite quiet process flags",
        async state => {
            const test = fixture();
            const inspect = test.platform.inspect;
            test.platform.inspect = async () => ({
                ...(await inspect()),
                ...(test.events.includes("quiesce") ? { state } : {}),
            });
            const result = await uninstallManagerService("user", test.host, {
                platform: test.platform,
                unregister: test.unregister,
            });
            expect(result).toMatchObject({ status: "interrupted", recoveryRequired: true });
            expect(test.events).toEqual(["quiesce"]);
            expect(fs.existsSync(test.files.definition)).toBe(true);
            expect(fs.existsSync(test.files.metadata)).toBe(true);
        },
    );
    it("accepts migrated private service definitions without changing workspace data", async () => {
        const test = fixture();
        fs.chmodSync(test.files.definition, 0o600);
        const result = await uninstallManagerService("user", test.host, {
            platform: test.platform,
            unregister: test.unregister,
        });
        expect(result).toMatchObject({ status: "succeeded", recoveryRequired: false });
        expect(test.events).toEqual(["quiesce", "unregister"]);
        expect(fs.existsSync(test.files.definition)).toBe(false);
        expect(fs.existsSync(test.files.metadata)).toBe(false);
        for (const saved of test.preserved)
            expect(fs.readFileSync(saved.file)).toEqual(saved.bytes);
    });
    it.each([false, true])(
        "running=%s removes only service files and keeps workspace bytes under one held lock",
        async running => {
            const test = fixture(running);
            const result = await uninstallManagerService("user", test.host, {
                platform: test.platform,
                unregister: test.unregister,
            });
            expect(result).toMatchObject({
                action: "uninstall",
                status: "succeeded",
                recoveryRequired: false,
            });
            expect(test.events).toEqual(["quiesce", "unregister"]);
            expect(fs.existsSync(test.files.definition)).toBe(false);
            expect(fs.existsSync(test.files.metadata)).toBe(false);
            for (const saved of test.preserved)
                expect(fs.readFileSync(saved.file)).toEqual(saved.bytes);
            expect(
                new FileManagerServiceJournal(
                    path.join(test.files.stateDir, "manager-operations"),
                ).read(result.id),
            ).toEqual(result);
            const unlock = acquireControlWorkspace(test.workspace);
            unlock();
        },
    );
    it("replacement definition after capture is not removed or unregistered", async () => {
        const test = fixture();
        test.controls.replaceDefinition = true;
        const result = await uninstallManagerService("user", test.host, {
            platform: test.platform,
            unregister: test.unregister,
        });
        expect(result).toMatchObject({ status: "interrupted", recoveryRequired: true });
        expect(test.events).toEqual(["quiesce"]);
        expect(fs.readFileSync(test.files.definition, "utf8")).toBe("external-service");
        expect(fs.existsSync(test.files.metadata)).toBe(true);
    });
    it("OS unregister failure leaves metadata and gates retry without inverse compensation", async () => {
        const test = fixture();
        test.controls.failUnregister = true;
        const result = await uninstallManagerService("user", test.host, {
            platform: test.platform,
            unregister: test.unregister,
        });
        expect(result).toMatchObject({ status: "interrupted", recoveryRequired: true });
        expect(JSON.stringify(result)).not.toContain("synthetic-secret");
        expect(fs.existsSync(test.files.metadata)).toBe(true);
        expect(test.events).toEqual(["quiesce", "unregister"]);
        await expect(
            uninstallManagerService("user", test.host, {
                platform: test.platform,
                unregister: test.unregister,
            }),
        ).rejects.toThrow();
        expect(test.events).toEqual(["quiesce", "unregister"]);
    });
    it("live verification worker proof prevents both service file deletions", async () => {
        const test = fixture();
        allocateConfigurationVerification(
            path.join(test.workspace, ".control/configuration/verification-workers"),
        );
        const result = await uninstallManagerService("user", test.host, {
            platform: test.platform,
            unregister: test.unregister,
        });
        expect(result).toMatchObject({ status: "interrupted", recoveryRequired: true });
        expect(test.events).toEqual(["quiesce"]);
        expect(fs.existsSync(test.files.definition)).toBe(true);
        expect(fs.existsSync(test.files.metadata)).toBe(true);
    });
    it.each(["missing", "corrupt"])("%s metadata causes no OS effects or deletion", async kind => {
        const test = fixture();
        if (kind === "missing") fs.unlinkSync(test.files.metadata);
        else fs.writeFileSync(test.files.metadata, "{");
        const before = fs.readFileSync(test.files.definition);
        await expect(
            uninstallManagerService("user", test.host, {
                platform: test.platform,
                unregister: test.unregister,
            }),
        ).rejects.toThrow();
        expect(test.events).toEqual([]);
        expect(fs.readFileSync(test.files.definition)).toEqual(before);
    });
    it("removal intent persistence failure never unlinks the definition", async () => {
        const test = fixture();
        const original = fs.renameSync;
        vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
            if (
                String(to).includes("manager-operations") &&
                JSON.parse(fs.readFileSync(String(from), "utf8")).phase === "removing-definition"
            )
                throw new Error("synthetic-secret");
            original(from, to);
        });
        const result = await uninstallManagerService("user", test.host, {
            platform: test.platform,
            unregister: test.unregister,
        });
        expect(result).toMatchObject({ status: "interrupted", recoveryRequired: true });
        expect(test.events).toEqual(["quiesce"]);
        expect(fs.existsSync(test.files.definition)).toBe(true);
        expect(fs.existsSync(test.files.metadata)).toBe(true);
    });
});

it("byte-identical metadata replacement after unregister is preserved by captured file identity", async () => {
    const test = fixture();
    test.controls.replaceMetadata = true;
    const result = await uninstallManagerService("user", test.host, {
        platform: test.platform,
        unregister: test.unregister,
    });
    expect(result).toMatchObject({ status: "interrupted", recoveryRequired: true });
    expect(fs.existsSync(test.files.metadata)).toBe(true);
    expect(test.events).toEqual(["quiesce", "unregister"]);
});
