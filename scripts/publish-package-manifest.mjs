const DEPENDENCY_FIELDS = [
    "dependencies",
    "devDependencies",
    "peerDependencies",
    "optionalDependencies",
];

const LOCAL_DEPENDENCY_PROTOCOL = /^(?:catalog|file|link|patch|portal|workspace):/u;

/**
 * 校验最终 tarball 内的 package.json，而不是只相信 workspace 源清单。
 * pnpm pack 应将 workspace:/catalog: 改写为 npm 消费者可解析的版本。
 */
export function publishedManifestErrors(sourceManifest, publishedManifest) {
    const errors = [];
    for (const field of ["name", "version"]) {
        if (publishedManifest[field] !== sourceManifest[field]) {
            errors.push(
                `发布清单 ${field} 错配，期望 ${formatValue(sourceManifest[field])}，实际 ${formatValue(publishedManifest[field])}`,
            );
        }
    }

    for (const field of DEPENDENCY_FIELDS) {
        const dependencies = publishedManifest[field];
        if (dependencies === undefined) continue;
        if (!isRecord(dependencies)) {
            errors.push(`发布清单 ${field} 必须是依赖对象`);
            continue;
        }
        for (const [name, version] of Object.entries(dependencies)) {
            if (typeof version !== "string" || version.length === 0) {
                errors.push(`发布清单 ${field}.${name} 必须是非空版本字符串`);
                continue;
            }
            if (LOCAL_DEPENDENCY_PROTOCOL.test(version)) {
                errors.push(`发布清单 ${field}.${name} 仍使用本地依赖协议 ${version}`);
            }
        }
    }

    return errors;
}

function isRecord(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

function formatValue(value) {
    return value === undefined ? "未声明" : JSON.stringify(value);
}
