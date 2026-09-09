import path from "node:path";
import { lstat, realpath, open } from "node:fs/promises";
import { constants } from "node:fs";
import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { closedServiceObject } from "./service-operation-storage.js";
import { parseLegacyServiceSpec } from "./service-metadata.js";
import { renderLaunchdPlist, renderSystemdUnit, type ServiceSpec } from "./service-definition.js";
import { getServiceFiles } from "./service-files.js";
import type { ServiceHost } from "./service-host.js";
import type { ServiceMigrationBackup } from "./service-migration-types.js";
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
const invalid = () => new Error("旧运行工件与服务回退契约不匹配，禁止切换");
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
