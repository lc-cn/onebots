import { execFileSync } from "node:child_process";
import {
    buildPackageRemovalInvocation,
    buildPackageUpdateInvocation,
    PACKAGE_MANAGER_MUTATION_TIMEOUT_MS,
    type PackageUpdateInvocation,
    type VerifiedPackageManager,
} from "./package-manager.js";

export interface PackageUpdateEvidence {
    name: string;
    target: string;
}

export interface PackageVersionSnapshot {
    name: string;
    current: string | null;
}

type PackageVersionResolver = (name: string, runtimeRoot: string) => string | null;
type PackageInvocationExecutor = (invocation: PackageUpdateInvocation) => void;

interface FailedUpdateRecoveryOptions {
    metadataChanged?: boolean;
    execute?: PackageInvocationExecutor;
    verifyMetadata?: () => void;
    packageManager?: VerifiedPackageManager;
}

const executePackageInvocation: PackageInvocationExecutor = invocation => {
    execFileSync(invocation.executable, invocation.args, {
        cwd: invocation.cwd,
        env: invocation.environment,
        stdio: "inherit",
        timeout: PACKAGE_MANAGER_MUTATION_TIMEOUT_MS,
    });
};

/** 包管理器成功退出后，逐包确认实际清单版本，再允许服务预检与切换。 */
export function assertUpdatedPackageVersions(
    updates: readonly PackageUpdateEvidence[],
    runtimeRoot: string,
    resolveVersion: PackageVersionResolver,
): void {
    const mismatches = updates.flatMap(item => {
        const actual = resolveVersion(item.name, runtimeRoot);
        return actual === item.target ? [] : [{ ...item, actual }];
    });
    if (!mismatches.length) return;
    const evidence = mismatches
        .map(item => `${item.name} 期望 ${item.target}，实际 ${item.actual ?? "未安装"}`)
        .join("；");
    throw new Error(`包更新版本校验失败：${evidence}。服务预检、定义改写与重启均未执行`);
}

/** 在服务定义或进程切换前，恢复更新前的整组包版本并验证结果。 */
export function rollbackUpdatedPackages(
    snapshots: readonly PackageVersionSnapshot[],
    runtimeRoot: string,
    projectRoot: string | null,
    resolveVersion: PackageVersionResolver,
    execute: PackageInvocationExecutor = executePackageInvocation,
    packageManager?: VerifiedPackageManager,
): void {
    const previousPackages = snapshots.flatMap(item =>
        item.current ? [`${item.name}@${item.current}`] : [],
    );
    if (previousPackages.length) {
        execute(
            buildPackageUpdateInvocation(
                runtimeRoot,
                previousPackages,
                projectRoot,
                process.platform,
                process.env,
                packageManager,
            ),
        );
    }
    const newlyAddedPackages = snapshots.flatMap(item => (item.current ? [] : [item.name]));
    if (newlyAddedPackages.length) {
        execute(
            buildPackageRemovalInvocation(
                runtimeRoot,
                newlyAddedPackages,
                projectRoot,
                process.platform,
                process.env,
                packageManager,
            ),
        );
    }
    const mismatches = snapshots.flatMap(item => {
        const actual = resolveVersion(item.name, runtimeRoot);
        return actual === item.current ? [] : [{ ...item, actual }];
    });
    if (!mismatches.length) return;
    const evidence = mismatches
        .map(
            item =>
                `${item.name} 期望恢复为 ${item.current ?? "未安装"}，实际 ${item.actual ?? "未安装"}`,
        )
        .join("；");
    throw new Error(`更新依赖恢复版本校验失败：${evidence}`);
}

/**
 * 包管理器非零退出后按落盘版本判断是否已经产生部分写入。
 * 未发生变化时保留原错误；发生变化时恢复整组依赖并留下明确事务证据。
 */
export function recoverPackagesAfterFailedUpdate(
    snapshots: readonly PackageVersionSnapshot[],
    runtimeRoot: string,
    projectRoot: string | null,
    resolveVersion: PackageVersionResolver,
    originalError: unknown,
    options: FailedUpdateRecoveryOptions = {},
): never {
    const changed =
        options.metadataChanged === true ||
        snapshots.some(item => resolveVersion(item.name, runtimeRoot) !== item.current);
    if (!changed) {
        throw originalError instanceof Error ? originalError : new Error(String(originalError));
    }
    try {
        rollbackUpdatedPackages(
            snapshots,
            runtimeRoot,
            projectRoot,
            resolveVersion,
            options.execute,
            options.packageManager,
        );
        options.verifyMetadata?.();
    } catch (rollbackError) {
        throw new AggregateError(
            [originalError, rollbackError],
            `包管理器执行失败且依赖恢复失败：更新错误：${errorMessage(originalError)}；恢复错误：${errorMessage(rollbackError)}；后续预检与服务切换均未执行`,
        );
    }
    throw new Error(
        `包管理器执行失败但已改写依赖，已恢复更新前依赖；后续预检与服务切换均未执行：${errorMessage(originalError)}`,
        { cause: originalError instanceof Error ? originalError : undefined },
    );
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
