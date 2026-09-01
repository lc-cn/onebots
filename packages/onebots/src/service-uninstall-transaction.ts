export interface ServiceUninstallTransactionOptions {
    remove(): Promise<void>;
    restore(): Promise<void>;
    verifyRestored(): boolean;
    commit(): void;
    definitionPath: string;
}

/** 平台定义与私有元数据共同删除；失败时恢复可管理的已停止服务契约。 */
export async function runServiceUninstallTransaction(
    options: ServiceUninstallTransactionOptions,
): Promise<void> {
    try {
        await options.remove();
        options.commit();
    } catch (error) {
        try {
            await options.restore();
            if (!options.verifyRestored()) {
                throw new Error(`服务定义恢复后验证失败: ${options.definitionPath}`);
            }
        } catch (restoreError) {
            throw new AggregateError(
                [error, restoreError],
                `服务卸载失败且无法恢复平台定义: ${options.definitionPath}；私有元数据已保留，请重新执行 onebots install`,
            );
        }
        throw new Error(
            `服务卸载失败，已恢复平台定义并保留私有元数据：${error instanceof Error ? error.message : String(error)}`,
            { cause: error },
        );
    }
}
