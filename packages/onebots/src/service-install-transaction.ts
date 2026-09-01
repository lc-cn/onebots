import type { ServiceSpec } from "./service-definition.js";

export interface ServiceInstallTransactionOptions {
    target: ServiceSpec;
    previous: ServiceSpec | null;
    apply(spec: ServiceSpec, replaced: ServiceSpec | null): Promise<void>;
    remove(spec: ServiceSpec): Promise<void>;
    verify(spec: ServiceSpec): boolean;
    validateBeforeCommit?(spec: ServiceSpec): void;
    commit(spec: ServiceSpec): void;
    definitionPath(spec: ServiceSpec): string;
}

/** 平台定义与私有元数据共同提交；失败时恢复安装前可启动的服务契约。 */
export async function runServiceInstallTransaction(
    options: ServiceInstallTransactionOptions,
): Promise<void> {
    try {
        await options.apply(options.target, options.previous);
        assertDefinition(options, options.target, "安装");
        options.validateBeforeCommit?.(options.target);
        options.commit(options.target);
    } catch (error) {
        try {
            if (options.previous) {
                await options.apply(options.previous, options.target);
                assertDefinition(options, options.previous, "回滚");
            } else {
                await options.remove(options.target);
            }
        } catch (rollbackError) {
            throw new AggregateError(
                [error, rollbackError],
                `服务安装失败且无法恢复上一份定义: ${options.definitionPath(options.target)}`,
            );
        }
        throw error;
    }
}

function assertDefinition(
    options: ServiceInstallTransactionOptions,
    spec: ServiceSpec,
    phase: "安装" | "回滚",
): void {
    if (!options.verify(spec)) {
        throw new Error(`服务定义${phase}后验证失败: ${options.definitionPath(spec)}`);
    }
}
