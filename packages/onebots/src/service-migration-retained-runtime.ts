import path from "node:path";
import { lstat, realpath, open } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { canonicalServiceJson, closedServiceObject } from "./service-operation-storage.js";
import { parseLegacyServiceSpec } from "./service-metadata.js";
import { renderLaunchdPlist, renderSystemdUnit, type ServiceSpec } from "./service-definition.js";
import { getServiceFiles } from "./service-files.js";
import { parseManagerServiceSpec } from "./manager-service-spec.js";
import type { ServiceHost } from "./service-host.js";
import type {
    ServiceMigrationBackup,
    ServiceMigrationFile,
    ServiceMigrationReloadOldReceipt,
} from "./service-migration-types.js";
import { within, hashRuntimeFile, scanRuntimeTree } from "./service-migration-runtime-tree-scan.js";
import { assertSystemNativeDependencies } from "./service-migration-native-dependencies.js";
import { scanLegacyRuntimeForest } from "./service-migration-runtime-forest-scan.js";
import {
    verifyLegacyRuntimeTree,
    type LegacyRuntimeTreeReceipt,
} from "./service-migration-runtime-tree.js";
import {
    verifyLegacyNodeRuntime,
    type LegacyNodeRuntimeReceipt,
} from "./service-migration-node-runtime.js";

interface RetainedRuntimeContract {
    runtime: LegacyRuntimeTreeReceipt;
    node: LegacyNodeRuntimeReceipt;
    original: ServiceSpec;
    rollback: ServiceSpec;
}
export type RetainedLegacyRuntime = RetainedRuntimeContract &
    ({ schemaVersion: 1; sourceRoot: string } | { schemaVersion: 2; sourceRoots: string[] });
const rollbackRoles = ["definition", "metadata", "configuration", "runner"] as const;
export type ServiceMigrationRollbackContractFile =
    | {
          state: "file";
          role: ServiceMigrationFile["role"];
          path: string;
          mode: number;
          sha256: string;
      }
    | {
          state: "absent";
          role: "target-configuration";
          path: string;
      };
export interface ServiceMigrationRollbackContract {
    schemaVersion: 1;
    platform: "darwin" | "linux";
    scope: ServiceSpec["scope"];
    previousEnabled: boolean;
    rollback: ServiceSpec;
    files: ServiceMigrationRollbackContractFile[];
}
const invalid = () => new Error("旧运行工件与服务回退契约不匹配，禁止切换");
const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
/** 仅排除旧内核明确使用的配置与持久数据，不接受客户端任意忽略运行文件。 */
export function legacyRuntimeExclusions(original: ServiceSpec, sourceRoot: string): string[] {
    return [
        original.configPath,
        path.join(path.dirname(original.configPath), "data"),
        path.join(path.dirname(original.configPath), ".control"),
    ]
        .filter(file => within(sourceRoot, file))
        .map(file => path.relative(sourceRoot, file).split(path.sep).join("/"));
}
function tree(input: unknown): LegacyRuntimeTreeReceipt {
    const value = closedServiceObject(input, ["schemaVersion", "id", "root", "digest"]);
    if (
        value.schemaVersion !== 1 ||
        typeof value.id !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            value.id,
        ) ||
        typeof value.root !== "string" ||
        !path.isAbsolute(value.root) ||
        path.normalize(value.root) !== value.root ||
        typeof value.digest !== "string" ||
        !/^[0-9a-f]{64}$/.test(value.digest)
    )
        throw invalid();
    return { schemaVersion: 1, id: value.id, root: value.root, digest: value.digest };
}
function mapped(
    spec: ServiceSpec,
    source: string,
    runtime: LegacyRuntimeTreeReceipt,
    node: LegacyNodeRuntimeReceipt,
): ServiceSpec {
    if (!within(source, spec.binPath) || !within(source, spec.workingDirectory)) throw invalid();
    return {
        ...spec,
        binPath: path.join(runtime.root, path.relative(source, spec.binPath)),
        workingDirectory: path.join(runtime.root, path.relative(source, spec.workingDirectory)),
        nodePath: path.join(node.tree.root, "node"),
    };
}
function mappedForest(
    spec: ServiceSpec,
    sources: string[],
    runtime: LegacyRuntimeTreeReceipt,
    node: LegacyNodeRuntimeReceipt,
): ServiceSpec {
    const project = (file: string) => {
        if (
            !sources.some(source => within(source, file)) ||
            sources.some(source =>
                legacyRuntimeExclusions(spec, source).some(excluded =>
                    within(path.join(source, excluded), file),
                ),
            )
        )
            throw invalid();
        return path.join(runtime.root, "fs", file.slice(1));
    };
    return {
        ...spec,
        binPath: project(spec.binPath),
        workingDirectory: project(spec.workingDirectory),
        nodePath: path.join(node.tree.root, "node"),
    };
}
/** 纯解析；磁盘内容须由异步verify在停机及回退前核实。 */
export function parseRetainedLegacyRuntime(input: unknown): RetainedLegacyRuntime {
    const forest =
        typeof input === "object" &&
        input !== null &&
        Object.getOwnPropertyDescriptor(input, "schemaVersion")?.value === 2;
    const value = closedServiceObject(input, [
        "schemaVersion",
        forest ? "sourceRoots" : "sourceRoot",
        "runtime",
        "node",
        "original",
        "rollback",
    ]);
    if (value.schemaVersion !== (forest ? 2 : 1)) throw invalid();
    const rawRoots = forest ? value.sourceRoots : [value.sourceRoot];
    if (
        !Array.isArray(rawRoots) ||
        !rawRoots.length ||
        rawRoots.length > 128 ||
        rawRoots.some(
            source =>
                typeof source !== "string" ||
                !path.isAbsolute(source) ||
                path.normalize(source) !== source ||
                (forest &&
                    (source === path.parse(source).root ||
                        !source.startsWith("/") ||
                        /[\u0000-\u001f\u007f\\]/u.test(source))),
        )
    )
        throw invalid();
    const sources: string[] = rawRoots.map(source => String(source));
    if (
        forest &&
        sources.some((source, index) =>
            sources.some((other, otherIndex) => index !== otherIndex && within(source, other)),
        )
    )
        throw invalid();
    const runtime = tree(value.runtime);
    const nodeValue = closedServiceObject(value.node, [
        "schemaVersion",
        "tree",
        "version",
        "platform",
        "arch",
    ]);
    if (
        nodeValue.schemaVersion !== 1 ||
        typeof nodeValue.version !== "string" ||
        !/^v\d+\.\d+\.\d+$/.test(nodeValue.version) ||
        !["darwin", "linux"].includes(String(nodeValue.platform)) ||
        typeof nodeValue.arch !== "string" ||
        !["arm64", "x64"].includes(nodeValue.arch)
    )
        throw invalid();
    const node: LegacyNodeRuntimeReceipt = {
        schemaVersion: 1,
        tree: tree(nodeValue.tree),
        version: nodeValue.version,
        platform: String(nodeValue.platform),
        arch: nodeValue.arch,
    };
    if (
        within(runtime.root, node.tree.root) ||
        within(node.tree.root, runtime.root) ||
        sources.some(source => within(source, runtime.root) || within(source, node.tree.root))
    )
        throw invalid();
    const original = parseLegacyServiceSpec(value.original);
    const rollback = parseLegacyServiceSpec(value.rollback);
    if (
        !isDeepStrictEqual(
            rollback,
            forest
                ? mappedForest(original, sources, runtime, node)
                : mapped(original, sources[0]!, runtime, node),
        )
    )
        throw invalid();
    return forest
        ? { schemaVersion: 2, sourceRoots: sources, runtime, node, original, rollback }
        : { schemaVersion: 1, sourceRoot: sources[0]!, runtime, node, original, rollback };
}
export async function bindRetainedLegacyRuntimeForest(
    original: ServiceSpec,
    sourceRoots: string[],
    runtime: LegacyRuntimeTreeReceipt,
    node: LegacyNodeRuntimeReceipt,
): Promise<RetainedLegacyRuntime> {
    const result = parseRetainedLegacyRuntime({
        schemaVersion: 2,
        sourceRoots,
        runtime,
        node,
        original,
        rollback: mappedForest(original, sourceRoots, runtime, node),
    });
    if (result.schemaVersion !== 2) throw invalid();
    const snapshot = await scanLegacyRuntimeForest(
        result.sourceRoots.map(source => ({
            source,
            excludedPaths: legacyRuntimeExclusions(result.original, source),
        })),
    );
    if (
        createHash("sha256").update(JSON.stringify(snapshot.entries)).digest("hex") !==
            result.runtime.digest ||
        !isDeepStrictEqual(
            await hashRuntimeFile(await realpath(result.original.nodePath)),
            await hashRuntimeFile(result.rollback.nodePath),
        )
    )
        throw invalid();
    await verifyRetainedLegacyRuntime(result);
    return result;
}
export async function bindRetainedLegacyRuntime(
    original: ServiceSpec,
    sourceRoot: string,
    runtime: LegacyRuntimeTreeReceipt,
    node: LegacyNodeRuntimeReceipt,
): Promise<RetainedLegacyRuntime> {
    const result = parseRetainedLegacyRuntime({
        schemaVersion: 1,
        sourceRoot,
        runtime,
        node,
        original,
        rollback: mapped(original, sourceRoot, runtime, node),
    });
    const sourceDigest = createHash("sha256")
        .update(
            JSON.stringify(
                await scanRuntimeTree(
                    sourceRoot,
                    false,
                    legacyRuntimeExclusions(original, sourceRoot),
                ),
            ),
        )
        .digest("hex");
    if (
        sourceDigest !== result.runtime.digest ||
        !isDeepStrictEqual(
            await hashRuntimeFile(await realpath(original.nodePath)),
            await hashRuntimeFile(result.rollback.nodePath),
        )
    )
        throw invalid();
    await verifyRetainedLegacyRuntime(result);
    return result;
}
export async function verifyRetainedLegacyRuntime(input: RetainedLegacyRuntime): Promise<void> {
    const value = parseRetainedLegacyRuntime(input);
    await verifyLegacyRuntimeTree(value.runtime);
    // 不依赖扩展名：检查物理树中所有Mach-O/ELF文件，别名由整棵树校验约束。
    for (const entry of await scanRuntimeTree(value.runtime.root, true)) {
        if (entry.type !== "file") continue;
        const file = path.join(value.runtime.root, entry.path);
        const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
        let magic: string;
        try {
            const header = Buffer.alloc(4);
            const read = await handle.read(header, 0, 4, 0);
            magic = header.subarray(0, read.bytesRead).toString("hex");
        } finally {
            await handle.close();
        }
        if (
            [
                "feedface",
                "cefaedfe",
                "feedfacf",
                "cffaedfe",
                "cafebabe",
                "bebafeca",
                "cafebabf",
                "bfbafeca",
                "7f454c46",
            ].includes(magic) ||
            /\.(node|dylib|so)(\.|$)/.test(entry.path)
        )
            await assertSystemNativeDependencies(file);
    }
    await verifyLegacyRuntimeTree(value.runtime);
    await verifyLegacyNodeRuntime(value.node);
    const bin = await realpath(value.rollback.binPath);
    const cwd = await realpath(value.rollback.workingDirectory);
    if (
        !within(value.runtime.root, bin) ||
        !within(value.runtime.root, cwd) ||
        !(await lstat(bin)).isFile() ||
        !(await lstat(cwd)).isDirectory()
    )
        throw invalid();
}

function strictRollbackBackupFiles(input: unknown): ServiceMigrationFile[] {
    if (
        !Array.isArray(input) ||
        Object.getPrototypeOf(input) !== Array.prototype ||
        Reflect.ownKeys(input).length !== input.length + 1 ||
        input.length < 3 ||
        input.length > 4
    )
        throw invalid();
    const roles = new Set<string>();
    const paths = new Set<string>();
    const files: ServiceMigrationFile[] = [];
    for (let index = 0; index < input.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(input, String(index));
        if (!descriptor?.enumerable || !("value" in descriptor)) throw invalid();
        const value = closedServiceObject(descriptor.value, [
            "role",
            "path",
            "mode",
            "contentBase64",
        ]);
        const bytes =
            typeof value.contentBase64 === "string"
                ? Buffer.from(value.contentBase64, "base64")
                : null;
        if (
            typeof value.role !== "string" ||
            !rollbackRoles.includes(value.role as ServiceMigrationFile["role"]) ||
            roles.has(value.role) ||
            typeof value.path !== "string" ||
            value.path.length > 4096 ||
            !path.isAbsolute(value.path) ||
            path.normalize(value.path) !== value.path ||
            /[\u0000\r\n]/u.test(value.path) ||
            paths.has(path.resolve(value.path)) ||
            typeof value.mode !== "number" ||
            !Number.isInteger(value.mode) ||
            value.mode < 0 ||
            value.mode > 0o777 ||
            typeof value.contentBase64 !== "string" ||
            value.contentBase64.length > 2 * 1024 * 1024 ||
            !bytes ||
            bytes.length > 1_048_576 ||
            bytes.toString("base64") !== value.contentBase64
        )
            throw invalid();
        roles.add(value.role);
        paths.add(path.resolve(value.path));
        files.push(value as unknown as ServiceMigrationFile);
    }
    if (!rollbackRoles.slice(0, 3).every(role => roles.has(role))) throw invalid();
    return files;
}

/**
 * 固化旧服务回退会实际写入的完整字节契约。definition/metadata 取保留运行时派生值，
 * configuration/runner 取原始备份；角色顺序不受备份数组顺序影响。
 */
export function createServiceMigrationRollbackContract(
    backup: ServiceMigrationBackup,
    host: ServiceHost,
): { contract: ServiceMigrationRollbackContract; digest: string } {
    if (!backup.retainedRuntime || typeof backup.previousEnabled !== "boolean") throw invalid();
    const retained = parseRetainedLegacyRuntime(backup.retainedRuntime);
    const target = parseManagerServiceSpec(backup.target);
    if (
        (host.platform !== "darwin" && host.platform !== "linux") ||
        retained.node.platform !== host.platform ||
        target.scope !== retained.rollback.scope ||
        path.dirname(retained.rollback.configPath) !== target.workspace
    )
        throw invalid();
    const paths = getServiceFiles(retained.rollback.scope, host);
    const expectedPaths: Record<Exclude<ServiceMigrationFile["role"], "runner">, string> = {
        definition: paths.definition,
        metadata: paths.metadata,
        configuration: retained.rollback.configPath,
    };
    const files = strictRollbackBackupFiles(backup.files);
    for (const role of rollbackRoles.slice(0, 3)) {
        if (files.find(file => file.role === role)?.path !== expectedPaths[role]) throw invalid();
    }
    const derived = retainedRollbackFiles(backup, host);
    const derivedByPath = new Map(derived.map(file => [file.path, file]));
    const contractFiles: ServiceMigrationRollbackContractFile[] = rollbackRoles.flatMap(role => {
        const original = files.find(file => file.role === role);
        if (!original) return [];
        const replacement =
            role === "definition" || role === "metadata"
                ? derivedByPath.get(original.path)
                : undefined;
        if ((role === "definition" || role === "metadata") && !replacement) throw invalid();
        const bytes = replacement?.bytes ?? Buffer.from(original.contentBase64, "base64");
        return [
            {
                state: "file" as const,
                role,
                path: original.path,
                mode: replacement?.mode ?? original.mode,
                sha256: sha256(bytes),
            },
        ];
    });
    if (contractFiles.length !== files.length) throw invalid();
    const targetConfiguration = path.join(target.workspace, "config.yaml");
    if (!contractFiles.some(file => file.path === targetConfiguration)) {
        contractFiles.push({
            state: "absent",
            role: "target-configuration",
            path: targetConfiguration,
        });
    }
    const contract: ServiceMigrationRollbackContract = {
        schemaVersion: 1,
        platform: host.platform,
        scope: retained.rollback.scope,
        previousEnabled: backup.previousEnabled,
        rollback: retained.rollback,
        files: contractFiles,
    };
    return { contract, digest: sha256(canonicalServiceJson(contract)) };
}

/** 对严格闭合的 reload-old 收据生成唯一摘要，供 start-old 收据复验。 */
export function digestServiceMigrationReloadOldReceipt(input: unknown): string {
    const value = closedServiceObject(input, [
        "schemaVersion",
        "backupDigest",
        "rollbackContractDigest",
        "enabled",
        "loaded",
        "definitionPath",
    ]);
    if (
        value.schemaVersion !== 1 ||
        typeof value.backupDigest !== "string" ||
        !/^[0-9a-f]{64}$/.test(value.backupDigest) ||
        typeof value.rollbackContractDigest !== "string" ||
        !/^[0-9a-f]{64}$/.test(value.rollbackContractDigest) ||
        typeof value.enabled !== "boolean" ||
        typeof value.loaded !== "boolean" ||
        typeof value.definitionPath !== "string" ||
        !value.definitionPath.startsWith("/") ||
        value.definitionPath.length > 4096 ||
        /[\u0000\r\n]/u.test(value.definitionPath)
    )
        throw invalid();
    return sha256(canonicalServiceJson(value as unknown as ServiceMigrationReloadOldReceipt));
}

export function retainedRollbackFiles(backup: ServiceMigrationBackup, host: ServiceHost) {
    if (!backup.retainedRuntime) return [];
    const retained = parseRetainedLegacyRuntime(backup.retainedRuntime);
    if (retained.node.platform !== host.platform) throw invalid();
    const metadata = backup.files.find(file => file.role === "metadata");
    if (
        !metadata ||
        !isDeepStrictEqual(
            parseLegacyServiceSpec(
                JSON.parse(Buffer.from(metadata.contentBase64, "base64").toString("utf8")),
            ),
            retained.original,
        )
    )
        throw invalid();
    const paths = getServiceFiles(retained.original.scope, host);
    const definition =
        host.platform === "linux"
            ? renderSystemdUnit(retained.rollback)
            : host.platform === "darwin"
              ? renderLaunchdPlist(
                    retained.rollback,
                    path.join(paths.stateDir, "onebots.log"),
                    path.join(paths.stateDir, "onebots-error.log"),
                )
              : null;
    if (definition === null) throw invalid();
    return [
        { path: paths.definition, bytes: Buffer.from(definition), mode: 0o600 },
        {
            path: paths.metadata,
            bytes: Buffer.from(JSON.stringify(retained.rollback) + "\n"),
            mode: 0o600,
        },
    ];
}
