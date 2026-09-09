import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import { captureLegacyRuntimeTree } from "./service-migration-runtime-tree.js";
import { captureLegacyNodeRuntime } from "./service-migration-node-runtime.js";
import {
    bindRetainedLegacyRuntime,
    parseRetainedLegacyRuntime,
} from "./service-migration-retained-runtime.js";
import { createServiceMigrationPort } from "./service-migration-port.js";
import { FileServiceMigrationJournal } from "./service-migration-journal.js";
import { ServiceMigrationTransaction } from "./service-migration-transaction.js";
import { getServiceFiles } from "./service-files.js";
import type { ServiceHost } from "./service-host.js";
import type { ServiceSpec } from "./service-definition.js";
import type { ServiceMigrationBackup, ServiceMigrationFile } from "./service-migration-types.js";
import type { ServicePlatformState } from "./service-platform.js";

describe.skipIf(process.platform !== "darwin")("旧工件与迁移回退整合", () => {
    it("新实例失败且原安装已删除时，事务执行保留的Node和旧程序并保留配置", async () => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "retained-migration-")));
        try {
            const source = path.join(root, "old-install");
            const workspace = path.join(root, "workspace");
            fs.mkdirSync(source, { mode: 0o700 });
            fs.mkdirSync(workspace, { mode: 0o700 });
            fs.writeFileSync(path.join(source, "bin.js"), 'process.stdout.write("old-behavior");', {
                mode: 0o600,
            });
            const original: ServiceSpec = {
                scope: "user",
                configPath: path.join(workspace, "old.yaml"),
                nodePath: process.execPath,
                binPath: path.join(source, "bin.js"),
                workingDirectory: source,
                adapters: [],
                protocols: [],
            };
            const runtime = await captureLegacyRuntimeTree(
                source,
                path.join(root, "runtimes"),
                randomUUID(),
            );
            const node = await captureLegacyNodeRuntime(
                process.execPath,
                path.join(root, "nodes"),
                randomUUID(),
            );
            const retained = await bindRetainedLegacyRuntime(original, source, runtime, node);
            expect(retained.rollback.configPath).toBe(original.configPath);
            expect(() =>
                parseRetainedLegacyRuntime({
                    ...retained,
                    rollback: { ...retained.rollback, configPath: "/other/config.yaml" },
                }),
            ).toThrow();
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
                retainedRuntime: retained,
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
            const port = createServiceMigrationPort({
                backup,
                host,
                operationId: "retained-test",
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
                        if (spec.runtimeKind === "control") fs.rmSync(source, { recursive: true });
                        else
                            executed = execFileSync(spec.nodePath, [spec.binPath], {
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
            const journal = new FileServiceMigrationJournal(path.join(root, "journal"));
            const result = await new ServiceMigrationTransaction(journal, port).run(
                "retained-test",
                backup,
            );
            expect(result).toMatchObject({
                status: "failed",
                rolledBack: true,
                recoveryRequired: false,
            });
            expect(executed).toBe("old-behavior");
            expect(fs.existsSync(source)).toBe(false);
            expect(fs.readFileSync(original.configPath, "utf8")).toBe("general: {}\n");
            expect(JSON.parse(fs.readFileSync(paths.metadata, "utf8"))).toEqual(retained.rollback);
            expect(journal.backup(journal.read("retained-test")).retainedRuntime).toEqual(retained);
            fs.writeFileSync(retained.rollback.binPath, "throw new Error('tampered');");
            await expect(port.startOriginal(backup)).rejects.toThrow();
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    }, 120_000);
});
