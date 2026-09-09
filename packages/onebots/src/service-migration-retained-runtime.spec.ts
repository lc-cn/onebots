import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { parseRetainedLegacyRuntime } from "./service-migration-retained-runtime.js";
import { createServiceMigrationPort } from "./service-migration-port.js";
import { FileServiceMigrationJournal } from "./service-migration-journal.js";
import { migrateSystemService } from "./service-migration-coordinator.js";
import { retainServiceMigrationRuntime } from "./service-migration-retention.js";
import { getServiceFiles } from "./service-files.js";
import type { ServiceHost } from "./service-host.js";
import { buildServiceArgs, type ServiceSpec } from "./service-definition.js";
import type { ServiceMigrationBackup, ServiceMigrationFile } from "./service-migration-types.js";
import type { ServicePlatformState } from "./service-platform.js";

describe.skipIf(process.platform !== "darwin")("旧工件与迁移回退整合", () => {
    it.each(["separate", "mixed"])(
        "%s 布局下新实例失败后执行保留程序并保留配置与账号数据",
        async layout => {
            const root = fs.realpathSync(
                fs.mkdtempSync(path.join(os.tmpdir(), "retained-migration-")),
            );
            try {
                const source = path.join(root, "old-install");
                const workspace = layout === "mixed" ? source : path.join(root, "workspace");
                fs.mkdirSync(source, { mode: 0o700 });
                if (workspace !== source) fs.mkdirSync(workspace, { mode: 0o700 });
                fs.mkdirSync(path.join(workspace, "data"), { mode: 0o700 });
                fs.writeFileSync(
                    path.join(workspace, "data", "account.fixture"),
                    "stable-account-id",
                    { mode: 0o600 },
                );
                fs.writeFileSync(path.join(source, "package.json"), '{"type":"module"}', {
                    mode: 0o600,
                });
                fs.writeFileSync(
                    path.join(source, "bin.js"),
                    `
import fs from "node:fs";
import path from "node:path";
const config = process.argv[process.argv.indexOf("-c") + 1];
if (fs.readFileSync(config, "utf8") !== "general: {}\\n") throw new Error("configuration changed");
if (fs.readFileSync(path.join(path.dirname(config), "data/account.fixture"), "utf8") !== "stable-account-id") throw new Error("account data changed");
process.stdout.write("old-behavior");
`,
                    {
                        mode: 0o600,
                    },
                );
                const original: ServiceSpec = {
                    scope: "user",
                    configPath: path.join(workspace, "old.yaml"),
                    nodePath: process.execPath,
                    binPath: path.join(source, "bin.js"),
                    workingDirectory: source,
                    adapters: [],
                    protocols: [],
                };
                const host: ServiceHost = {
                    platform: "darwin",
                    homedir: root,
                    env: {},
                    exec: () => {
                        throw new Error("unexpected OS call");
                    },
                    spawn: async () => {
                        throw new Error("unexpected OS spawn");
                    },
                };
                const paths = getServiceFiles("user", host);
                const files = (
                    [
                        ["definition", paths.definition, "old definition"],
                        ["metadata", paths.metadata, JSON.stringify(original)],
                        ["configuration", original.configPath, "general: {}\n"],
                    ] as const
                ).map(([role, file, content]): ServiceMigrationFile => {
                    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
                    fs.writeFileSync(file, content, { mode: 0o600 });
                    return {
                        role,
                        path: file,
                        mode: 0o600,
                        contentBase64: Buffer.from(content).toString("base64"),
                    };
                });
                const backup: ServiceMigrationBackup = {
                    schemaVersion: 1,
                    files,
                    previousRunning: true,
                    previousEnabled: true,
                    target: {
                        schemaVersion: 1,
                        runtimeKind: "control",
                        scope: "user",
                        workspace,
                        workingDirectory: source,
                        nodePath: process.execPath,
                        binPath: "/new/bin.js",
                        host: "127.0.0.1",
                        port: 6727,
                    },
                };
                let state: ServicePlatformState = {
                    state: "running",
                    running: true,
                    enabled: true,
                    loaded: true,
                    definitionPath: paths.definition,
                    processId: 100,
                    identity: "original",
                    quiescent: false,
                };
                let executed = "";
                const operationId = randomUUID();
                const makePort = (bound: ServiceMigrationBackup) =>
                    createServiceMigrationPort({
                        backup: bound,
                        host,
                        operationId,
                        originalState: structuredClone(state),
                        readinessTimeoutMs: 1,
                        confirmStopped: async () => true,
                        platform: {
                            inspect: async () => structuredClone(state),
                            quiesce: async () => {
                                state = {
                                    ...state,
                                    state: "stopped",
                                    running: false,
                                    quiescent: true,
                                    processId: null,
                                    identity: null,
                                };
                            },
                            reload: async () => {},
                            start: async () => {
                                const spec = JSON.parse(fs.readFileSync(paths.metadata, "utf8"));
                                if (spec.runtimeKind === "control") {
                                    if (layout === "mixed") fs.unlinkSync(original.binPath);
                                    else fs.rmSync(source, { recursive: true });
                                } else
                                    executed = execFileSync(spec.nodePath, buildServiceArgs(spec), {
                                        cwd: spec.workingDirectory,
                                        env: { PATH: "/usr/bin:/bin" },
                                        encoding: "utf8",
                                    });
                                state = {
                                    ...state,
                                    state: "running",
                                    running: true,
                                    quiescent: false,
                                    processId: 200,
                                    identity: "new-instance",
                                };
                            },
                        },
                        manager: {
                            inspect: async () => {
                                throw new Error("candidate failed");
                            },
                            release: async () => {
                                throw new Error("must not release");
                            },
                        },
                    });
                const result = await migrateSystemService({
                    stateDirectory: paths.stateDir,
                    id: operationId,
                    capture: async () => backup,
                    retain: async input => {
                        const intent = JSON.parse(
                            fs.readFileSync(
                                path.join(
                                    paths.stateDir,
                                    "migrations",
                                    `${operationId}.journal.json`,
                                ),
                                "utf8",
                            ),
                        );
                        expect(intent.phase).toBe("capturing-runtime");
                        return retainServiceMigrationRuntime(input, paths.stateDir, operationId);
                    },
                    port: makePort,
                });
                const journal = new FileServiceMigrationJournal(
                    path.join(paths.stateDir, "migrations"),
                );
                const bound = journal.backup(journal.read(operationId));
                const retained = bound.retainedRuntime!;
                expect(result).toMatchObject({
                    status: "failed",
                    rolledBack: true,
                    recoveryRequired: false,
                });
                expect(executed).toBe("old-behavior");
                expect(fs.existsSync(original.binPath)).toBe(false);
                expect(fs.existsSync(source)).toBe(layout === "mixed");
                expect(
                    fs.readFileSync(path.join(workspace, "data", "account.fixture"), "utf8"),
                ).toBe("stable-account-id");
                for (const name of ["old.yaml", "data", ".control"])
                    expect(fs.existsSync(path.join(retained.runtime.root, name))).toBe(false);
                expect(fs.readFileSync(original.configPath, "utf8")).toBe("general: {}\n");
                expect(JSON.parse(fs.readFileSync(paths.metadata, "utf8"))).toEqual(
                    retained.rollback,
                );
                expect(retained.rollback.configPath).toBe(original.configPath);
                expect(() =>
                    parseRetainedLegacyRuntime({
                        ...retained,
                        rollback: { ...retained.rollback, configPath: "/other/config.yaml" },
                    }),
                ).toThrow();
                fs.writeFileSync(retained.rollback.binPath, "throw new Error('tampered');");
                await expect(makePort(bound).startOriginal(bound)).rejects.toThrow();
            } finally {
                fs.rmSync(root, { recursive: true, force: true });
            }
        },
        120_000,
    );
});
