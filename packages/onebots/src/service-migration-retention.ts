import path from "node:path";
import { realpath } from "node:fs/promises";
import { parseLegacyServiceSpec } from "./service-metadata.js";
import { captureLegacyRuntimeTree } from "./service-migration-runtime-tree.js";
import { captureLegacyNodeRuntime } from "./service-migration-node-runtime.js";
import { bindRetainedLegacyRuntime } from "./service-migration-retained-runtime.js";
import { within } from "./service-migration-runtime-tree-scan.js";
import type { ServiceMigrationBackup } from "./service-migration-types.js";

/** 供协调器retain步骤调用；服务锁与capturing-runtime意图必须先建立。 */
export async function retainServiceMigrationRuntime(
    backup: ServiceMigrationBackup,
    stateDirectory: string,
    id: string,
) {
    const metadata = backup.files.find(file => file.role === "metadata");
    if (!metadata || backup.retainedRuntime) throw new Error("旧服务工件捕获基线无效");
    const original = parseLegacyServiceSpec(
        JSON.parse(Buffer.from(metadata.contentBase64, "base64").toString("utf8")),
    );
    const source = await realpath(original.workingDirectory);
    if (
        source !== original.workingDirectory ||
        !within(source, original.binPath) ||
        within(source, path.dirname(original.configPath))
    )
        throw new Error("旧安装尚非独立运行目录，请先保留安装和数据，不能自动搬迁");
    const store = path.join(stateDirectory, "legacy-runtime-artifacts");
    const runtime = await captureLegacyRuntimeTree(source, path.join(store, "programs"), id);
    const node = await captureLegacyNodeRuntime(original.nodePath, path.join(store, "nodes"), id);
    return bindRetainedLegacyRuntime(original, source, runtime, node);
}
