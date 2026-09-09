import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { describe, expect, it } from "vitest";
import {
    createServiceMigrationRollbackContract,
    digestServiceMigrationReloadOldReceipt,
    parseRetainedLegacyRuntime,
    retainedRollbackFiles,
} from "./service-migration-retained-runtime.js";
import { createServiceMigrationFilePlan } from "./service-migration-file-plan.js";
import { ServiceMigrationFiles } from "./service-migration-files.js";
import { createServiceMigrationPort } from "./service-migration-port.js";
import { FileServiceMigrationJournal } from "./service-migration-journal.js";
import { migrateSystemService } from "./service-migration-coordinator.js";
import { retainServiceMigrationRuntime } from "./service-migration-retention.js";
import { getServiceFiles } from "./service-files.js";
import type { ServiceHost } from "./service-host.js";
import { buildServiceArgs, type ServiceSpec } from "./service-definition.js";
import type { ServiceMigrationBackup, ServiceMigrationFile } from "./service-migration-types.js";
import type { ServicePlatformState } from "./service-platform.js";

function rollbackFixture(platform: "darwin" | "linux") {
    const homedir = platform === "darwin" ? "/Users/fixture" : "/home/fixture";
    const host: ServiceHost = {
        platform,
        homedir,
        env: {},
        exec: () => {
            throw new Error("unexpected OS call");
        },
        spawn: async () => {
            throw new Error("unexpected OS spawn");
        },
    };
    const source = "/opt/onebots-legacy";
    const original: ServiceSpec = {
        scope: "user",
        configPath: path.join(homedir, "onebots", "config.yaml"),
        adapters: ["mock"],
        protocols: ["onebot-v11"],
        applications: ["zhin"],
        nodePath: "/usr/local/bin/node",
        binPath: path.join(source, "lib", "bin.js"),
        workingDirectory: source,
    };
    const runtimeRoot = path.join(homedir, "retained", "runtime");
    const nodeRoot = path.join(homedir, "retained", "node");
    const rollback: ServiceSpec = {
        ...original,
        nodePath: path.join(nodeRoot, "node"),
        binPath: path.join(runtimeRoot, "lib", "bin.js"),
        workingDirectory: runtimeRoot,
    };
    const retained = parseRetainedLegacyRuntime({
        schemaVersion: 1,
        sourceRoot: source,
        runtime: {
            schemaVersion: 1,
            id: "00000000-0000-4000-8000-000000000001",
            root: runtimeRoot,
            digest: "1".repeat(64),
        },
        node: {
            schemaVersion: 1,
            tree: {
                schemaVersion: 1,
                id: "00000000-0000-4000-8000-000000000002",
                root: nodeRoot,
                digest: "2".repeat(64),
            },
            version: "v24.0.0",
            platform,
            arch: "x64",
        },
        original,
        rollback,
    });
    const paths = getServiceFiles("user", host);
    const file = (
        role: ServiceMigrationFile["role"],
        filePath: string,
        content: string,
        mode = 0o600,
    ): ServiceMigrationFile => ({
        role,
        path: filePath,
        mode,
        contentBase64: Buffer.from(content).toString("base64"),
    });
    const backup: ServiceMigrationBackup = {
        schemaVersion: 1,
        target: {
            schemaVersion: 1,
            runtimeKind: "control",
            scope: "user",
            workspace: path.join(homedir, "onebots"),
            workingDirectory: path.join(homedir, "onebots"),
            nodePath: "/usr/local/bin/node",
            binPath: "/usr/local/lib/onebots/bin.js",
            host: "127.0.0.1",
            port: 6727,
        },
        previousRunning: true,
        previousEnabled: true,
        retainedRuntime: retained,
        files: [
            file("runner", path.join(homedir, "onebots", "runner.sh"), "runner", 0o700),
            file("configuration", rollback.configPath, "general: {}\n"),
            file("metadata", paths.metadata, JSON.stringify(original)),
            file("definition", paths.definition, "superseded definition", 0o644),
        ],
    };
    return { backup, host, paths };
}

describe("旧服务回退摘要契约", () => {
    it.each(["linux", "darwin"] as const)("%s 固定角色顺序并绑定平台路径", platform => {
        const { backup, host, paths } = rollbackFixture(platform);
        const result = createServiceMigrationRollbackContract(backup, host);
        expect(result.contract).toMatchObject({
            schemaVersion: 1,
            platform,
            scope: "user",
            previousEnabled: true,
            rollback: backup.retainedRuntime!.rollback,
        });
        expect(result.contract.files.map(file => file.role)).toEqual([
            "definition",
            "metadata",
            "configuration",
            "runner",
        ]);
        expect(result.contract.files.map(file => file.path)).toEqual([
            paths.definition,
            paths.metadata,
            backup.retainedRuntime!.rollback.configPath,
            path.join(host.homedir, "onebots", "runner.sh"),
        ]);
        expect(
            result.contract.files
                .slice(0, 2)
                .map(file => (file.state === "file" ? file.mode : null)),
        ).toEqual([0o600, 0o600]);
        const reordered = structuredClone(backup);
        reordered.files.reverse();
        expect(createServiceMigrationRollbackContract(reordered, host)).toEqual(result);
    });

    it.each(["linux", "darwin"] as const)(
        "%s 对实际文件、模式、回退规格及启用状态变化敏感",
        platform => {
            const fixture = rollbackFixture(platform);
            const digest = createServiceMigrationRollbackContract(
                fixture.backup,
                fixture.host,
            ).digest;
            const changedConfiguration = structuredClone(fixture.backup);
            changedConfiguration.files.find(file => file.role === "configuration")!.contentBase64 =
                Buffer.from("general:\n  host: changed\n").toString("base64");
            const changedConfigurationMode = structuredClone(fixture.backup);
            changedConfigurationMode.files.find(file => file.role === "configuration")!.mode =
                0o400;
            const changedRunner = structuredClone(fixture.backup);
            changedRunner.files.find(file => file.role === "runner")!.contentBase64 =
                Buffer.from("changed runner").toString("base64");
            const changedRunnerMode = structuredClone(fixture.backup);
            changedRunnerMode.files.find(file => file.role === "runner")!.mode = 0o500;
            const changedEnabled = structuredClone(fixture.backup);
            changedEnabled.previousEnabled = false;
            const changedSpec = rollbackFixture(platform);
            changedSpec.backup.retainedRuntime = parseRetainedLegacyRuntime({
                ...changedSpec.backup.retainedRuntime,
                original: {
                    ...changedSpec.backup.retainedRuntime!.original,
                    adapters: ["mock", "qq"],
                },
                rollback: {
                    ...changedSpec.backup.retainedRuntime!.rollback,
                    adapters: ["mock", "qq"],
                },
            });
            changedSpec.backup.files.find(file => file.role === "metadata")!.contentBase64 =
                Buffer.from(JSON.stringify(changedSpec.backup.retainedRuntime.original)).toString(
                    "base64",
                );
            for (const candidate of [
                changedConfiguration,
                changedConfigurationMode,
                changedRunner,
                changedRunnerMode,
                changedEnabled,
                changedSpec.backup,
            ])
                expect(
                    createServiceMigrationRollbackContract(candidate, fixture.host).digest,
                ).not.toBe(digest);
        },
    );

    it.each(["linux", "darwin"] as const)("%s 拒绝未绑定的恢复路径", platform => {
        const { backup, host } = rollbackFixture(platform);
        const wrongDefinition = structuredClone(backup);
        wrongDefinition.files.find(file => file.role === "definition")!.path = "/tmp/service";
        expect(() => createServiceMigrationRollbackContract(wrongDefinition, host)).toThrow();
        const wrongConfiguration = structuredClone(backup);
        wrongConfiguration.files.find(file => file.role === "configuration")!.path =
            "/tmp/config.yaml";
        expect(() => createServiceMigrationRollbackContract(wrongConfiguration, host)).toThrow();
        const noncanonicalRunner = structuredClone(backup);
        noncanonicalRunner.files.find(file => file.role === "runner")!.path =
            `${path.join(host.homedir, "onebots")}/nested/../runner.sh`;
        expect(() => createServiceMigrationRollbackContract(noncanonicalRunner, host)).toThrow();
    });

    it.each(["linux", "darwin"] as const)("%s 绑定迁移新增配置文件的删除效果", platform => {
        const { backup, host } = rollbackFixture(platform);
        const customPath = path.join(backup.target.workspace, "custom.yaml");
        const retained = backup.retainedRuntime!;
        backup.retainedRuntime = parseRetainedLegacyRuntime({
            ...retained,
            original: { ...retained.original, configPath: customPath },
            rollback: { ...retained.rollback, configPath: customPath },
        });
        backup.files.find(file => file.role === "configuration")!.path = customPath;
        backup.files.find(file => file.role === "metadata")!.contentBase64 = Buffer.from(
            JSON.stringify(backup.retainedRuntime.original),
        ).toString("base64");

        expect(createServiceMigrationRollbackContract(backup, host).contract.files).toContainEqual({
            state: "absent",
            role: "target-configuration",
            path: path.join(backup.target.workspace, "config.yaml"),
        });
    });

    it("将 Linux custom.yaml 回退契约与实际恢复终态逐项对账", () => {
        const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "rollback-contract-")));
        try {
            const host: ServiceHost = {
                platform: "linux",
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
            const workspace = path.join(root, "workspace");
            const source = path.join(root, "legacy");
            const runtimeRoot = path.join(root, "retained", "runtime");
            const nodeRoot = path.join(root, "retained", "node");
            const original: ServiceSpec = {
                scope: "user",
                configPath: path.join(workspace, "custom.yaml"),
                adapters: ["mock"],
                protocols: ["onebot-v11"],
                nodePath: "/usr/local/bin/node",
                binPath: path.join(source, "lib", "bin.js"),
                workingDirectory: source,
            };
            const rollback: ServiceSpec = {
                ...original,
                nodePath: path.join(nodeRoot, "node"),
                binPath: path.join(runtimeRoot, "lib", "bin.js"),
                workingDirectory: runtimeRoot,
            };
            const retained = parseRetainedLegacyRuntime({
                schemaVersion: 1,
                sourceRoot: source,
                runtime: {
                    schemaVersion: 1,
                    id: "00000000-0000-4000-8000-000000000011",
                    root: runtimeRoot,
                    digest: "1".repeat(64),
                },
                node: {
                    schemaVersion: 1,
                    tree: {
                        schemaVersion: 1,
                        id: "00000000-0000-4000-8000-000000000012",
                        root: nodeRoot,
                        digest: "2".repeat(64),
                    },
                    version: "v24.0.0",
                    platform: "linux",
                    arch: "x64",
                },
                original,
                rollback,
            });
            const originals = (
                [
                    ["definition", paths.definition, "old definition", 0o644],
                    ["metadata", paths.metadata, JSON.stringify(original), 0o600],
                    ["configuration", original.configPath, "general: {}\n", 0o640],
                ] as const
            ).map(([role, file, content, mode]): ServiceMigrationFile => {
                fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
                fs.writeFileSync(file, content, { mode });
                return {
                    role,
                    path: file,
                    mode,
                    contentBase64: Buffer.from(content).toString("base64"),
                };
            });
            const backup: ServiceMigrationBackup = {
                schemaVersion: 1,
                target: {
                    schemaVersion: 1,
                    runtimeKind: "control",
                    scope: "user",
                    workspace,
                    workingDirectory: workspace,
                    nodePath: "/usr/local/bin/node",
                    binPath: path.join(root, "manager", "bin.js"),
                    host: "127.0.0.1",
                    port: 6727,
                },
                previousRunning: true,
                previousEnabled: true,
                retainedRuntime: retained,
                files: originals,
            };
            const plan = createServiceMigrationFilePlan(backup, host);
            const files = new ServiceMigrationFiles(
                backup,
                plan.files,
                retainedRollbackFiles(backup, host),
            );
            const contract = createServiceMigrationRollbackContract(backup, host).contract;
            expect(new Set(contract.files.map(file => file.path))).toEqual(
                new Set([...backup.files, ...plan.files].map(file => file.path)),
            );

            files.apply();
            files.restore();

            expect(files.matchesRestored()).toBe(true);
            for (const effect of contract.files) {
                if (effect.state === "absent") {
                    expect(fs.existsSync(effect.path)).toBe(false);
                    continue;
                }
                const stat = fs.lstatSync(effect.path);
                expect(stat.isFile()).toBe(true);
                expect(stat.mode & 0o777).toBe(effect.mode);
                expect(
                    createHash("sha256").update(fs.readFileSync(effect.path)).digest("hex"),
                ).toBe(effect.sha256);
            }
        } finally {
            fs.rmSync(root, { recursive: true, force: true });
        }
    });

    it("对 reload-old 收据做闭合且稳定的摘要", () => {
        const receipt = {
            schemaVersion: 1,
            backupDigest: "a".repeat(64),
            rollbackContractDigest: "b".repeat(64),
            enabled: true,
            loaded: true,
            definitionPath: "/etc/systemd/system/onebots-gateway.service",
        } as const;
        const reordered = {
            definitionPath: receipt.definitionPath,
            loaded: receipt.loaded,
            enabled: receipt.enabled,
            rollbackContractDigest: receipt.rollbackContractDigest,
            backupDigest: receipt.backupDigest,
            schemaVersion: receipt.schemaVersion,
        };
        expect(digestServiceMigrationReloadOldReceipt(reordered)).toBe(
            digestServiceMigrationReloadOldReceipt(receipt),
        );
        expect(digestServiceMigrationReloadOldReceipt({ ...receipt, enabled: false })).not.toBe(
            digestServiceMigrationReloadOldReceipt(receipt),
        );
        expect(() => digestServiceMigrationReloadOldReceipt({ ...receipt, extra: true })).toThrow();
    });
});

describe.skipIf(process.platform !== "darwin")("旧工件与迁移回退整合", () => {
    it.each(["separate", "mixed", "global"])(
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
                fs.writeFileSync(
                    path.join(source, "package.json"),
                    '{"type":"module","name":"onebots","dependencies":{"@onebots/core":"1.0.0"}}',
                    {
                        mode: 0o600,
                    },
                );
                const core = path.join(source, "node_modules", "@onebots", "core");
                fs.mkdirSync(core, { recursive: true, mode: 0o700 });
                fs.writeFileSync(
                    path.join(core, "package.json"),
                    '{"name":"@onebots/core","type":"module"}',
                    { mode: 0o600 },
                );
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
                if (layout === "global") {
                    fs.mkdirSync(path.join(workspace, "node_modules"), { mode: 0o700 });
                    fs.writeFileSync(
                        path.join(source, "shared.mjs"),
                        "export const identity = {};",
                        { mode: 0o600 },
                    );
                    fs.symlinkSync(
                        path.join(source, "shared.mjs"),
                        path.join(workspace, "node_modules", "shared.mjs"),
                    );
                    fs.appendFileSync(
                        path.join(source, "bin.js"),
                        `
import { identity } from './shared.mjs';
import { pathToFileURL } from 'node:url';
const plugin = await import(pathToFileURL(path.join(process.cwd(), 'node_modules/shared.mjs')).href);
if (plugin.identity !== identity) throw new Error('split module');
`,
                    );
                }
                const original: ServiceSpec = {
                    scope: "user",
                    configPath: path.join(workspace, "old.yaml"),
                    nodePath: process.execPath,
                    binPath: path.join(source, "bin.js"),
                    workingDirectory: layout === "global" ? workspace : source,
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
                        workingDirectory: original.workingDirectory,
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
                                    if (layout === "global")
                                        fs.rmSync(path.join(workspace, "node_modules"), {
                                            recursive: true,
                                        });
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
                if (layout === "global") {
                    expect(retained.schemaVersion).toBe(2);
                    expect(() =>
                        parseRetainedLegacyRuntime({ ...retained, sourceRoots: [workspace] }),
                    ).toThrow();
                    expect(() =>
                        parseRetainedLegacyRuntime({ ...retained, sourceRoots: [root, workspace] }),
                    ).toThrow();
                    expect(() =>
                        parseRetainedLegacyRuntime({ ...retained, sourceRoots: ["/"] }),
                    ).toThrow();
                    for (const name of ["old.yaml", "data", ".control"])
                        expect(
                            fs.existsSync(path.join(retained.rollback.workingDirectory, name)),
                        ).toBe(false);
                }
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
