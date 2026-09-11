import { captureLegacyRuntimeProjection } from "./service-migration-runtime-tree.js";
import {
    scanLegacyRuntimeForest,
    type LegacyRuntimeRoot,
} from "./service-migration-runtime-forest-scan.js";

/** 一个工件保留多个安装根的原路径拓扑；不复制根之间的共同祖先内容。 */
export async function captureLegacyRuntimeForest(
    roots: LegacyRuntimeRoot[],
    store: string,
    id: string,
) {
    const selected = structuredClone(roots);
    return captureLegacyRuntimeProjection(
        selected.map(root => root.source),
        store,
        id,
        () => scanLegacyRuntimeForest(selected),
    );
}
