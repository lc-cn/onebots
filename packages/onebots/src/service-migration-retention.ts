import path from "node:path";
import { parseLegacyServiceSpec } from "./service-metadata.js";
import { captureLegacyRuntimeForest } from "./service-migration-runtime-forest.js";
import { discoverLegacyRuntimeLayout } from "./service-migration-runtime-layout.js";
import { captureLegacyNodeRuntime } from "./service-migration-node-runtime.js";
import { bindRetainedLegacyRuntimeForest } from "./service-migration-retained-runtime.js";
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
    const roots = await discoverLegacyRuntimeLayout(original);
    const store = path.join(stateDirectory, "legacy-runtime-artifacts");
    const runtime = await captureLegacyRuntimeForest(roots, path.join(store, "programs"), id);
    const node = await captureLegacyNodeRuntime(original.nodePath, path.join(store, "nodes"), id);
    return bindRetainedLegacyRuntimeForest(
        original,
        roots.map(root => root.source),
        runtime,
        node,
    );
}
