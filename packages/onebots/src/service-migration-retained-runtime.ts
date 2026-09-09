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
import {
    verifyLegacyRuntimeTree,
    type LegacyRuntimeTreeReceipt,
} from "./service-migration-runtime-tree.js";
import {
    verifyLegacyNodeRuntime,
    type LegacyNodeRuntimeReceipt,
} from "./service-migration-node-runtime.js";

export interface RetainedLegacyRuntime {
    schemaVersion: 1;
    sourceRoot: string;
    runtime: LegacyRuntimeTreeReceipt;
    node: LegacyNodeRuntimeReceipt;
    original: ServiceSpec;
    rollback: ServiceSpec;
}
const invalid = () => new Error("旧运行工件与服务回退契约不匹配，禁止切换");
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
/** 纯解析；磁盘内容须由异步verify在停机及回退前核实。 */
export function parseRetainedLegacyRuntime(input: unknown): RetainedLegacyRuntime {
    const value = closedServiceObject(input, [
        "schemaVersion",
        "sourceRoot",
        "runtime",
        "node",
        "original",
        "rollback",
    ]);
    if (
        value.schemaVersion !== 1 ||
        typeof value.sourceRoot !== "string" ||
        !path.isAbsolute(value.sourceRoot) ||
        path.normalize(value.sourceRoot) !== value.sourceRoot
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
        within(value.sourceRoot, runtime.root) ||
        within(value.sourceRoot, node.tree.root)
    )
        throw invalid();
    const original = parseLegacyServiceSpec(value.original);
    // 配置及其账号数据目录必须独立保留，不能随旧安装目录被替换或删除。
    if (within(value.sourceRoot, path.dirname(original.configPath))) throw invalid();
    const rollback = parseLegacyServiceSpec(value.rollback);
    if (!isDeepStrictEqual(rollback, mapped(original, value.sourceRoot, runtime, node)))
        throw invalid();
    return { schemaVersion: 1, sourceRoot: value.sourceRoot, runtime, node, original, rollback };
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
        .update(JSON.stringify(await scanRuntimeTree(sourceRoot)))
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
