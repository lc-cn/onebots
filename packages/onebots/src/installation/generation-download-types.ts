export interface GenerationDownloadInput {
    directory: string;
    manifest: object;
    token?: string;
    signal?: AbortSignal;
    /** 受信宿主配置，不接受 Web 用户传入任意可执行文件。 */
    pnpmExecutable?: string;
    /** Windows 可通过 node.exe + 受信 pnpm.cjs 入口运行，禁止 shell/.cmd。 */
    pnpmScript?: string;
    timeoutMs?: number;
    /** 私有控制目录，供冷恢复清理；生产宿主应明确传入。 */
    credentialRoot?: string;
}

export class GenerationDownloadError extends Error {
    constructor(
        readonly code:
            | "INVALID_INPUT"
            | "UNSUPPORTED_EXECUTABLE"
            | "PACKAGE_MANAGER_MISMATCH"
            | "CANCELLED"
            | "DOWNLOAD_FAILED"
            | "CLEANUP_FAILED",
    ) {
        super(
            {
                INVALID_INPUT: "候选下载输入无效，请重新创建安装计划",
                UNSUPPORTED_EXECUTABLE:
                    "下载器不支持 shell 脚本入口，请使用 pnpm 可执行文件或 Node 与 pnpm.js 入口",
                PACKAGE_MANAGER_MISMATCH: "下载器要求 pnpm 9.15.9，请配置受信任的对应版本入口",
                CANCELLED: "依赖下载已取消",
                DOWNLOAD_FAILED: "依赖下载失败，请检查网络、仓库授权和依赖版本",
                CLEANUP_FAILED: "下载临时文件清理失败，禁止继续验证或激活",
            }[code],
        );
        this.name = "GenerationDownloadError";
    }
}
