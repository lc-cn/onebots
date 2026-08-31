export const MINIMUM_NODE_MAJOR = 24;

export interface NodeRuntimeSupport {
    supported: boolean;
    version: string;
    major?: number;
}

/** 在加载 CLI 及平台 SDK 前解析运行时版本，给不受支持的 Node.js 明确诊断。 */
export function inspectNodeRuntime(version: string = process.version): NodeRuntimeSupport {
    const normalized = version.trim().replace(/^v/u, "");
    const majorText = normalized.split(".", 1)[0];
    const major = /^\d+$/u.test(majorText) ? Number(majorText) : undefined;
    return {
        supported: major !== undefined && major >= MINIMUM_NODE_MAJOR,
        version: version.trim() || version,
        major,
    };
}

export function unsupportedNodeRuntimeMessage(runtime: NodeRuntimeSupport): string {
    return runtime.major === undefined
        ? `无法识别 Node.js 版本 ${JSON.stringify(runtime.version)}；OneBots 需要 Node.js >=${MINIMUM_NODE_MAJOR}`
        : `当前 Node.js ${runtime.version} 不受支持；OneBots 需要 Node.js >=${MINIMUM_NODE_MAJOR}`;
}
